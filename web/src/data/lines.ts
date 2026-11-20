// One file's line history (lines/<file id>.json), replayed once into every
// line's identity, versions, birth and death.
//
// Lines never move in a diff (a moved block is deletions plus insertions), so
// all the lines a file ever had can be laid out in one order in which the
// lines alive at any moment appear in their real order. That order is what
// the Lines view shows, and filtering it gives the file at any commit.

import type { History } from "./history";

export const LINES_FORMAT = "palimpsest-lines";

export interface LineFile {
  format: string;
  version: number;
  file: number;
  commits: number[];
  opsStart: number[];
  ops: number[];
  texts: string[];
}

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

export class LineHistory {
  readonly file: number;
  /** Every line the file ever had, in display order. */
  readonly order: number[];
  /** Commit that created each line, and that deleted it (-1 if alive at the end). */
  readonly born: number[] = [];
  readonly died: number[] = [];
  /** Versions of each line: commits and texts, oldest first. */
  readonly versionCommits: number[][] = [];
  readonly versionTexts: string[][] = [];

  constructor(lf: LineFile) {
    if (lf.format !== LINES_FORMAT || lf.version !== 1) throw new Error("Unsupported line history");
    this.file = lf.file;
    let merged: number[] = [];
    let text = 0;
    for (let k = 0; k < lf.commits.length; k++) {
      const commit = lf.commits[k]!;
      const out: number[] = [];
      let p = 0;
      // Copies dead lines through until the next living one.
      const skipDead = () => {
        while (p < merged.length && this.died[merged[p]!]! >= 0) out.push(merged[p++]!);
      };
      for (let o = lf.opsStart[k]!; o < lf.opsStart[k + 1]!; o += 2) {
        const op = lf.ops[o]!;
        let n = lf.ops[o + 1]!;
        if (op === INSERT) {
          skipDead();
          while (n-- > 0) {
            const id = this.born.length;
            this.born.push(commit);
            this.died.push(-1);
            this.versionCommits.push([commit]);
            this.versionTexts.push([lf.texts[text++] ?? ""]);
            out.push(id);
          }
          continue;
        }
        while (n-- > 0) {
          skipDead();
          const id = merged[p++];
          if (id === undefined) break;
          if (op === DELETE) this.died[id] = commit;
          else if (op !== KEEP) {
            this.versionCommits[id]!.push(commit);
            this.versionTexts[id]!.push(lf.texts[text++] ?? "");
          }
          out.push(id);
        }
      }
      while (p < merged.length) out.push(merged[p++]!);
      merged = out;
    }
    this.order = merged;
  }

  get count(): number {
    return this.order.length;
  }

  aliveAt(line: number, commit: number): boolean {
    const died = this.died[line]!;
    return this.born[line]! <= commit && (died < 0 || commit < died);
  }

  /** The version in effect at `commit`: the first one before birth. */
  versionAt(line: number, commit: number): number {
    const commits = this.versionCommits[line]!;
    let v = 0;
    while (v + 1 < commits.length && commits[v + 1]! <= commit) v++;
    return v;
  }

  textAt(line: number, commit: number): string {
    return this.versionTexts[line]![this.versionAt(line, commit)]!;
  }

  /** The lines of the file as it was at `commit`, in order. */
  linesAt(commit: number): number[] {
    return this.order.filter((id) => this.aliveAt(id, commit));
  }

  /** The line most recently written at or before `commit`, or -1. */
  latestChangedAt(commit: number): number {
    let best = -1;
    let bestCommit = -1;
    for (const id of this.order) {
      if (!this.aliveAt(id, commit)) continue;
      const c = this.versionCommits[id]![this.versionAt(id, commit)]!;
      if (c > bestCommit) {
        best = id;
        bestCommit = c;
      }
    }
    return best;
  }
}

/** Something that happened to a line, for its history panel. */
export interface LineEvent {
  commit: number;
  kind: "born" | "rewritten" | "moved" | "deleted";
  /** For a move: the file's previous path. */
  from?: string;
}

/** What happened to a line up to `commit`, newest first. */
export function lineEvents(h: History, lines: LineHistory, line: number, commit: number): LineEvent[] {
  const out: LineEvent[] = [];
  lines.versionCommits[line]!.forEach((c, v) => {
    if (c <= commit) out.push({ commit: c, kind: v === 0 ? "born" : "rewritten" });
  });
  const died = lines.died[line]!;
  const end = died >= 0 ? died : Infinity;
  const paths = h.pathsOf(lines.file);
  for (let k = 1; k < paths.length; k++) {
    const c = paths[k]!.commit;
    if (c > lines.born[line]! && c < end && c <= commit) out.push({ commit: c, kind: "moved", from: paths[k - 1]!.path });
  }
  if (died >= 0 && died <= commit) out.push({ commit: died, kind: "deleted" });
  return out.sort((a, b) => b.commit - a.commit);
}

const cache = new Map<string, Promise<LineHistory | null>>();
const ready = new Map<string, LineHistory | null>();

/** A file's line history if it has already loaded. */
export function peekLines(h: History, base: string, file: number): LineHistory | null | undefined {
  if (!h.data.files.hasLines[file]) return null;
  return ready.get(`${base}#${file}`);
}

/** Loads a file's line history, or null when it has none (binary, vendored). */
export function loadLines(h: History, base: string, file: number): Promise<LineHistory | null> {
  if (!h.data.files.hasLines[file]) return Promise.resolve(null);
  const key = `${base}#${file}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${base}/lines/${file}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Line history unavailable (${r.status})`);
        return r.json() as Promise<LineFile>;
      })
      .then((lf) => {
        const lines = new LineHistory(lf);
        ready.set(key, lines);
        return lines;
      });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
