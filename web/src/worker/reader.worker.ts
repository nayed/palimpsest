// Reads a pasted repository off the main thread: lists its head, checks its
// size from a commits-only pack, downloads the whole pack (or takes it from
// this browser's storage), then reads history newest first with the Rust
// core compiled to WebAssembly, sending a data file for what has been read
// every so often. Afterwards it works out line history in the background.
//
// The finished data file and each line history worked out are kept beside
// the pack. Opened again, a repository shows its kept data at once, while a
// reader is rebuilt quietly for line histories not kept yet.

import init, { Reader } from "../wasm/pkg/palimpsest_wasm.js";
import wasmUrl from "../wasm/pkg/palimpsest_wasm_bg.wasm?url";
import { GitError, countCommits, fetchPack, lsRefs, type Tag } from "../git/smartHttp";
import { clearLines, readData, readLines, readPack, writeData, writeLines, writePack } from "./cache";
import { SHORT_WINDOW_MONTHS, WINDOW_MONTHS, type FromWorker, type HistoryWindow, type LoadStatus, type ToWorker } from "./protocol";

const post = (m: FromWorker) => self.postMessage(m);
const status = (s: Partial<LoadStatus>) => post({ type: "status", status: s });
const tick = () => new Promise((r) => setTimeout(r, 0));

let reader: Reader | null = null;
let version = 0;
let stopped = false;
const abort = new AbortController();

/** A fingerprint of the core: data kept by another version of it is not reused. */
let core = "";
/** Where this repository's pack, data and line histories are kept. */
let kept: { repo: string; key: string } | null = null;
/** The data file version whose file ids the kept data and line histories use. */
let finalVersion = -1;
/** Settles once the reader can work out line histories for the latest data. */
let readerReady: Promise<void> = Promise.resolve();
/** Starts rebuilding the reader for kept data, if not started yet. */
let startRebuild: (() => void) | null = null;
/**
 * Rebuilding is heavy work in slices; it waits this long so the line
 * histories asked for first, as the views open, are answered from storage
 * without competing with it.
 */
const REBUILD_DELAY_MS = 3000;

async function start() {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  await init({ module_or_path: bytes });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  core = [...hash.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sends the finished data file, and keeps it for next time. */
function finish(json: string) {
  version++;
  finalVersion = version;
  post({ type: "data", json, version });
  status({ step: "done", lines: 1 });
  if (kept) void writeData(kept.repo, kept.key, core, json);
}

/** Works out every line's history, in steps, then sends the finished data. */
async function workLines(total: number) {
  // Who wrote the code that exists: needs every line's history. Worked out
  // in steps, so requests for a file's lines are answered in between.
  const lineDue = every(150);
  let lines = 0;
  let step = 20;
  while (lines < total && !stopped) {
    const t = performance.now();
    lines = reader!.workLines(step);
    step = Math.max(1, Math.min(5000, Math.round(step * (50 / Math.max(1, performance.now() - t)))));
    if (lineDue()) status({ lines: lines / total });
    await tick();
  }
  if (stopped) return status({ step: "stopped" });
  finish(reader!.finishLines());
}

/**
 * Loads a pack into a new reader, indexing it in slices of about 50 ms so
 * messages (line histories, stop) are answered in between: a big pack takes
 * tens of seconds. Null when stopped meanwhile.
 */
async function loadPack(
  repo: string,
  pack: Uint8Array,
  head: string,
  tags: Tag[],
  onProgress?: (share: number) => void,
): Promise<Reader | null> {
  const r = new Reader(repo);
  r.begin(
    pack,
    head,
    tags.map((t) => t.name),
    tags.map((t) => t.commit),
  );
  let n = 500;
  for (;;) {
    const t = performance.now();
    const share = r.index(n);
    if (share >= 1) return r;
    n = Math.max(16, Math.min(200_000, Math.round(n * (50 / Math.max(1, performance.now() - t)))));
    onProgress?.(share);
    if (stopped) {
      r.free();
      return null;
    }
    await tick();
  }
}

/**
 * For kept data shown at once: reads the pack again, quietly, so line
 * histories not kept yet can be worked out. Should this reading number files
 * otherwise than the kept data (it should not), it finishes and replaces it.
 */
async function rebuild(repo: string, pack: Uint8Array, head: string, tags: Tag[], files: number) {
  const loaded = await loadPack(repo, pack, head, tags);
  if (!loaded) return;
  reader = loaded;
  const total = reader.commitCount();
  let read = 0;
  let batch = 20;
  while (read < total && !stopped) {
    const t = performance.now();
    read = reader.read(batch);
    batch = Math.max(1, Math.min(2000, Math.round(batch * (50 / Math.max(1, performance.now() - t)))));
    await tick();
  }
  if (stopped) return;
  reader.snapshot();
  if (reader.fileCount() !== files) {
    // Line histories kept for the old numbering no longer fit.
    if (kept) await clearLines(kept.repo, kept.key, core);
    await workLines(total);
  }
}

/** Throttles progress messages to a few per second. */
function every(ms: number) {
  let last = 0;
  return (force = false) => {
    const now = performance.now();
    if (!force && now - last < ms) return false;
    last = now;
    return true;
  };
}

function snapshot() {
  version++;
  post({ type: "data", json: reader!.snapshot(), version });
}

/** The proxy's limit on a request body is 64 KB; a want line is 46 bytes. */
const MAX_TAG_WANTS = 500;

/**
 * Release tags made on a branch that was never merged point to commits the
 * pack does not hold. Fetch just those commits, without their files, for the
 * tags' dates. Best effort: without them those tags are left out.
 */
async function fetchTagCommits(repo: string, proxy: string, head: string) {
  const missing = reader!.missingTagCommits().slice(0, MAX_TAG_WANTS);
  if (!missing.length) return;
  try {
    const pack = await fetchPack(proxy, repo, missing, { filter: "tree:0", haves: [head], signal: abort.signal });
    reader!.addTagCommits(pack);
  } catch {
    // Stopped, or GitHub would not send them: the tags just go without.
  }
}

const DAY = 86_400;

/** The start of the UTC day `months` before now. */
function monthsAgo(months: number): number {
  const t = Math.floor(Date.now() / 1000) - Math.round(months * 30.44 * DAY);
  return t - (t % DAY);
}

/**
 * For a repository over the limit: the longest recent window that fits, and
 * the short one beside it. One header-only count per window tried.
 */
async function findWindows(proxy: string, repo: string, head: string, limit: number): Promise<HistoryWindow[]> {
  const counted = new Map<number, HistoryWindow>();
  const count = async (months: number) => {
    const since = monthsAgo(months);
    const w = { months, since, commits: await countCommits(proxy, repo, head, abort.signal, since) };
    counted.set(months, w);
    return w;
  };
  let longest: HistoryWindow | null = null;
  for (const months of WINDOW_MONTHS) {
    const w = await count(months);
    if (w.commits <= limit) {
      longest = w;
      break;
    }
  }
  if (!longest) return [];
  if (longest.months <= SHORT_WINDOW_MONTHS) return [longest];
  return [longest, counted.get(SHORT_WINDOW_MONTHS) ?? (await count(SHORT_WINDOW_MONTHS))];
}

async function open(repo: string, proxy: string, limit: number, since: number | null) {
  await start();
  status({ step: "connecting" });
  const { head, tags } = await lsRefs(proxy, repo, abort.signal);

  // A window of history is a different pack from the whole one.
  const key = since === null ? head : `${head}-since-${since}`;
  kept = { repo, key };
  let pack = await readPack(repo, key);
  if (pack) {
    // Read before, by this core: show what it found at once.
    const data = await readData(repo, key, core);
    if (data !== null) {
      finish(data);
      status({ fromCache: true, downloaded: true, bytes: pack.length });
      const files = (JSON.parse(data) as { files: { born: unknown[] } }).files.born.length;
      const kept = pack;
      readerReady = new Promise<void>((resolve) => {
        startRebuild = () => {
          startRebuild = null;
          void rebuild(repo, kept, head, tags, files)
            .catch(() => {})
            .finally(resolve);
        };
      });
      setTimeout(() => startRebuild?.(), REBUILD_DELAY_MS);
      return;
    }
    status({ step: "indexing", fromCache: true, downloaded: true, bytes: pack.length });
  } else {
    // Count the commits first, so a repository over the limit is refused
    // before the big download. Only a pack header is downloaded for this.
    status({ step: "counting" });
    const commits = await countCommits(proxy, repo, head, abort.signal, since);
    if (commits > limit) {
      // Offer windows of recent history that fit instead.
      status({ over: commits });
      const windows = await findWindows(proxy, repo, head, limit);
      status({ step: "failed", failure: { kind: "tooBig", message: String(commits), windows } });
      return;
    }
    const due = every(150);
    status({ step: "downloading" });
    pack = await fetchPack(proxy, repo, head, {
      signal: abort.signal,
      since,
      onBytes: (bytes) => due() && status({ bytes }),
    });
    status({ step: "indexing", bytes: pack.length, downloaded: true });
    void writePack(repo, key, pack);
  }
  // Stopped while the last of the download arrived: say so.
  if (stopped) return status({ step: "stopped" });

  const indexDue = every(150);
  const loaded = await loadPack(repo, pack, head, tags, (share) => indexDue() && status({ unpacked: share }));
  if (!loaded) return status({ step: "stopped" });
  reader = loaded;
  const total = reader.commitCount();
  pack = null;
  await fetchTagCommits(repo, proxy, head);
  if (stopped) return status({ step: "stopped" });
  status({ step: "reading", total, read: 0 });

  // Read in batches of about 50 ms, sending a data file now and then; less
  // often as snapshots get slower.
  let batch = 20;
  let snapshotMs = 0;
  let lastSnapshot = performance.now();
  const due = every(100);
  for (;;) {
    const t = performance.now();
    const read = reader.read(batch);
    const took = performance.now() - t;
    batch = Math.max(1, Math.min(2000, Math.round(batch * (50 / Math.max(1, took)))));
    if (due()) status({ read });
    if (read >= total || stopped) break;
    if (performance.now() - lastSnapshot > Math.max(600, snapshotMs * 4)) {
      const s = performance.now();
      snapshot();
      snapshotMs = performance.now() - s;
      lastSnapshot = performance.now();
    }
    await tick();
  }
  snapshot();
  if (stopped) {
    status({ step: "stopped", read: reader.read(0) });
    return;
  }
  status({ step: "lines", read: total });
  await workLines(total);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "open") {
    try {
      await open(m.repo, m.proxy, m.limit, m.since);
    } catch (err) {
      if (err instanceof GitError && err.kind === "stopped") return status({ step: "stopped" });
      const kind = err instanceof GitError && err.kind !== "stopped" ? err.kind : "internal";
      const message = err instanceof Error ? err.message : String(err);
      status({ step: "failed", failure: { kind, message } });
    }
  } else if (m.type === "stop") {
    stopped = true;
    abort.abort();
  } else if (m.type === "lines") {
    void answerLines(m.id, m.file, m.version);
  }
};

/** A file's line history: kept from before, or worked out now (and kept). */
async function answerLines(id: number, file: number, asked: number) {
  let json: string | null = null;
  const final = asked === finalVersion && kept !== null;
  const saved = final ? await readLines(kept!.repo, kept!.key, core, file) : undefined;
  if (saved !== undefined) {
    json = saved === "null" ? null : saved;
  } else {
    if (final) {
      // Not kept: the reader is needed now.
      startRebuild?.();
      await readerReady;
    }
    if (reader && asked === version) {
      try {
        json = reader.lines(file) ?? null;
        if (asked === finalVersion && kept) void writeLines(kept.repo, kept.key, core, file, json);
      } catch (err) {
        // A trap in WebAssembly leaves the reader unusable: say so rather
        // than failing quietly later.
        if (err instanceof WebAssembly.RuntimeError) {
          stopped = true;
          status({ step: "failed", failure: { kind: "internal", message: err.message } });
        }
      }
    }
  }
  // Answered for the data version current now: the app asks again if that moved on.
  post({ type: "lines", id, json, version });
}
