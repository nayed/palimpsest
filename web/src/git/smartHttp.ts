// Just enough of git's smart-HTTP protocol (version 2) to download a
// repository: list the default branch's head, then fetch a pack. Only the
// transport lives here; the pack is read by the Rust core.

export type GitErrorKind = "notFound" | "network" | "protocol" | "stopped";

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const FLUSH = "flush";
const DELIM = "delim";
type Line = string | typeof FLUSH | typeof DELIM;

/** Encodes request lines as pkt-lines. */
export function encodeRequest(lines: Line[]): Uint8Array {
  const parts: Uint8Array[] = lines.map((l) => {
    if (l === FLUSH) return enc.encode("0000");
    if (l === DELIM) return enc.encode("0001");
    const body = enc.encode(`${l}\n`);
    return concat([enc.encode((body.length + 4).toString(16).padStart(4, "0")), body]);
  });
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export type Packet = { kind: "data"; data: Uint8Array } | { kind: "flush" } | { kind: "delim" } | { kind: "end" };

/** Splits a stream of bytes into pkt-lines, chunk by chunk. */
export class PktReader {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Packet[] {
    this.buf = this.buf.length ? concat([this.buf, chunk]) : chunk;
    const out: Packet[] = [];
    let at = 0;
    while (this.buf.length - at >= 4) {
      const len = parseInt(dec.decode(this.buf.subarray(at, at + 4)), 16);
      if (Number.isNaN(len)) throw new GitError("protocol", "GitHub sent something that is not git data.");
      if (len < 4) {
        out.push({ kind: len === 0 ? "flush" : len === 1 ? "delim" : "end" });
        at += 4;
        continue;
      }
      if (this.buf.length - at < len) break;
      out.push({ kind: "data", data: this.buf.subarray(at + 4, at + len) });
      at += len;
    }
    this.buf = this.buf.slice(at);
    return out;
  }
}

async function post(proxy: string, repo: string, body: Uint8Array, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${proxy}/${repo}.git/git-upload-pack`, {
      method: "POST",
      headers: { "Content-Type": "application/x-git-upload-pack-request", "Git-Protocol": "version=2" },
      body: body as BodyInit,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new GitError("stopped", "Stopped.");
    throw new GitError("network", e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new GitError("notFound", `GitHub has no public repository ${repo}.`);
  }
  if (!res.ok) throw new GitError("network", `The proxy answered ${res.status}.`);
  return res;
}

/** The commit at the tip of the default branch. */
export async function lsRefs(proxy: string, repo: string, signal?: AbortSignal): Promise<{ head: string; ref: string }> {
  // Ask for the capabilities first, as git does: GitHub answers this at once,
  // while a POST about a missing repository takes it several seconds.
  let probe: Response;
  try {
    probe = await fetch(`${proxy}/${repo}.git/info/refs?service=git-upload-pack`, {
      headers: { "Git-Protocol": "version=2" },
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new GitError("stopped", "Stopped.");
    throw new GitError("network", e instanceof Error ? e.message : String(e));
  }
  if (probe.status === 401 || probe.status === 403 || probe.status === 404) {
    throw new GitError("notFound", `GitHub has no public repository ${repo}.`);
  }
  if (!probe.ok) throw new GitError("network", `The proxy answered ${probe.status}.`);
  await probe.body?.cancel();

  const res = await post(
    proxy,
    repo,
    encodeRequest(["command=ls-refs", "object-format=sha1", DELIM, "symrefs", "ref-prefix HEAD", FLUSH]),
    signal,
  );
  const packets = new PktReader().push(new Uint8Array(await res.arrayBuffer()));
  for (const p of packets) {
    if (p.kind !== "data") continue;
    const line = dec.decode(p.data).trim();
    const m = /^([0-9a-f]{40}) HEAD(?: symref-target:(\S+))?/.exec(line);
    if (m) return { head: m[1]!, ref: m[2] ?? "HEAD" };
    if (line.startsWith("ERR ")) throw new GitError("notFound", line.slice(4));
  }
  throw new GitError("notFound", `${repo} has no commits.`);
}

/**
 * Downloads a pack holding `want` and everything it reaches. `filter` asks
 * for less, e.g. "tree:0" for commits only. `onBytes` follows the download.
 */
export async function fetchPack(
  proxy: string,
  repo: string,
  want: string,
  opts: { filter?: string; onBytes?: (bytes: number) => void; signal?: AbortSignal; headerOnly?: boolean } = {},
): Promise<Uint8Array> {
  const lines: Line[] = ["command=fetch", "object-format=sha1", DELIM, `want ${want}`, "ofs-delta", "no-progress"];
  if (opts.filter) lines.push(`filter ${opts.filter}`);
  lines.push("done", FLUSH);
  const res = await post(proxy, repo, encodeRequest(lines), opts.signal);
  if (!res.body) throw new GitError("protocol", "GitHub sent an empty answer.");

  const reader = res.body.getReader();
  const pkt = new PktReader();
  const pack: Uint8Array[] = [];
  let inPack = false;
  let bytes = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (opts.signal?.aborted) throw new GitError("stopped", "Stopped.");
      throw new GitError("network", e instanceof Error ? e.message : String(e));
    }
    if (chunk.done) break;
    bytes += chunk.value.length;
    opts.onBytes?.(bytes);
    for (const p of pkt.push(chunk.value)) {
      if (p.kind !== "data") continue;
      if (!inPack) {
        const line = dec.decode(p.data).trim();
        if (line === "packfile") inPack = true;
        else if (line.startsWith("ERR ")) throw new GitError("protocol", line.slice(4));
        continue;
      }
      // Side band: 1 is pack data, 2 progress, 3 an error.
      const band = p.data[0];
      if (band === 1) pack.push(p.data.slice(1));
      if (opts.headerOnly && pack.reduce((n, c) => n + c.length, 0) >= 12) {
        void reader.cancel();
        return concat(pack).subarray(0, 12);
      }
      else if (band === 3) throw new GitError("protocol", dec.decode(p.data.subarray(1)).trim());
    }
  }
  if (!pack.length) throw new GitError("protocol", "GitHub sent no pack.");
  return concat(pack);
}

/**
 * How many commits the default branch reaches, as GitHub counts them: the
 * object count in the header of a commits-only pack. Only the header is
 * downloaded, so this is quick even for very large repositories.
 */
export async function countCommits(proxy: string, repo: string, want: string, signal?: AbortSignal): Promise<number> {
  const header = await fetchPack(proxy, repo, want, { filter: "tree:0", headerOnly: true, signal });
  if (header.length < 12 || dec.decode(header.subarray(0, 4)) !== "PACK") {
    throw new GitError("protocol", "GitHub sent something that is not a pack.");
  }
  return new DataView(header.buffer, header.byteOffset, 12).getUint32(8);
}
