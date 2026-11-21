// Finding a file by part of its path, in every path it ever had.

import type { History } from "./history";

export interface FoundFile {
  file: number;
  /** Its latest path. */
  path: string;
  /** The older path that matched, when only an older one did. */
  was?: string;
}

const index = new WeakMap<History, { latest: string[]; all: string[][] }>();

function pathsIndex(h: History) {
  let i = index.get(h);
  if (!i) {
    const latest: string[] = [];
    const all: string[][] = [];
    for (let f = 0; f < h.fileCount; f++) {
      latest.push(h.latestPath(f));
      all.push(h.pathsOf(f).map((p) => p.path));
    }
    i = { latest, all };
    index.set(h, i);
  }
  return i;
}

/** How much a match counts, times the file's commits: the file name beats a folder. */
const WEIGHT = [4, 2, 1, 0.5];

/**
 * Files whose path contains the query, ignoring case, busiest first. A match
 * that starts the file name counts four times its commits, one inside the
 * name twice, one in a folder once, and one only in an older path half.
 */
export function findFiles(h: History, query: string, limit = 8): FoundFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { latest, all } = pathsIndex(h);
  const found: { f: FoundFile; score: number }[] = [];
  for (let file = 0; file < latest.length; file++) {
    const path = latest[file]!;
    const lower = path.toLowerCase();
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    let score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1;
    let was: string | undefined;
    if (score < 0) {
      was = all[file]!.find((p) => p.toLowerCase().includes(q));
      if (was === undefined) continue;
      score = 3;
    }
    found.push({ f: was === undefined ? { file, path } : { file, path, was }, score });
  }
  const commits = h.data.files.commits;
  const rank = (x: { f: FoundFile; score: number }) => commits[x.f.file]! * WEIGHT[x.score]!;
  found.sort((a, b) => rank(b) - rank(a) || a.score - b.score || a.f.path.localeCompare(b.f.path));
  return found.slice(0, limit).map((x) => x.f);
}
