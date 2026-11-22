// Reads a pasted repository off the main thread: lists its head, checks its
// size from a commits-only pack, downloads the whole pack (or takes it from
// this browser's storage), then reads history newest first with the Rust
// core compiled to WebAssembly, sending a data file for what has been read
// every so often. Afterwards it works out line history in the background.

import init, { Reader } from "../wasm/pkg/palimpsest_wasm.js";
import { GitError, countCommits, fetchPack, lsRefs } from "../git/smartHttp";
import { readPack, writePack } from "./cache";
import type { FromWorker, LoadStatus, ToWorker } from "./protocol";

const post = (m: FromWorker) => self.postMessage(m);
const status = (s: Partial<LoadStatus>) => post({ type: "status", status: s });
const tick = () => new Promise((r) => setTimeout(r, 0));

let reader: Reader | null = null;
let version = 0;
let stopped = false;
const abort = new AbortController();

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

async function open(repo: string, proxy: string, limit: number) {
  await init();
  status({ step: "connecting" });
  const { head, tags } = await lsRefs(proxy, repo, abort.signal);

  let pack = await readPack(repo, head);
  if (pack) {
    status({ step: "indexing", fromCache: true, downloaded: true, bytes: pack.length });
  } else {
    // Count the commits first, so a repository over the limit is refused
    // before the big download. Only a pack header is downloaded for this.
    status({ step: "counting" });
    const commits = await countCommits(proxy, repo, head, abort.signal);
    if (commits > limit) {
      status({ step: "failed", failure: { kind: "tooBig", message: String(commits) } });
      return;
    }
    const due = every(150);
    status({ step: "downloading" });
    pack = await fetchPack(proxy, repo, head, {
      signal: abort.signal,
      onBytes: (bytes) => due() && status({ bytes }),
    });
    status({ step: "indexing", bytes: pack.length, downloaded: true });
    void writePack(repo, head, pack);
  }
  // Stopped while the last of the download arrived: say so.
  if (stopped) return status({ step: "stopped" });

  reader = new Reader(repo);
  const total = reader.load(
    pack,
    head,
    tags.map((t) => t.name),
    tags.map((t) => t.commit),
    () => {},
  );
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

  // Who wrote the code that exists: needs every line's history. Worked out
  // in steps, so requests for a file's lines are answered in between.
  const lineDue = every(150);
  let lines = 0;
  let step = 20;
  while (lines < total && !stopped) {
    const t = performance.now();
    lines = reader.workLines(step);
    step = Math.max(1, Math.min(5000, Math.round(step * (50 / Math.max(1, performance.now() - t)))));
    if (lineDue()) status({ lines: lines / total });
    await tick();
  }
  if (stopped) return status({ step: "stopped" });
  version++;
  post({ type: "data", json: reader.finishLines(), version });
  status({ step: "done", lines: 1 });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "open") {
    try {
      await open(m.repo, m.proxy, m.limit);
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
    let json: string | null = null;
    if (reader && m.version === version) {
      try {
        json = reader.lines(m.file) ?? null;
      } catch (err) {
        // A trap in WebAssembly leaves the reader unusable: say so rather
        // than failing quietly later.
        if (err instanceof WebAssembly.RuntimeError) {
          stopped = true;
          status({ step: "failed", failure: { kind: "internal", message: err.message } });
        }
      }
    }
    post({ type: "lines", id: m.id, json, version });
  }
};
