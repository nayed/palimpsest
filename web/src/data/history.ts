// A loaded repository history with the lookups the views need. Built once per
// repository; every view reads from it and none computes history itself.

import { ChangeKind, FORMAT, VERSION, type Data } from "./format";
import { releases, type Release } from "../timeline/tags";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface FileChange {
  commit: number;
  file: number;
  kind: number;
  added: number;
  deleted: number;
}

export interface Clip {
  from: number;
  to: number;
  /** Author id, or -1 for Untouched. */
  author: number;
}

export class History {
  readonly data: Data;
  readonly start: number;
  readonly end: number;
  readonly commitCount: number;
  /** For each file, the commits that changed it, oldest first. */
  private readonly fileCommits: number[][];

  constructor(data: Data) {
    if (data.format !== FORMAT || data.version !== VERSION) {
      throw new Error(`Unsupported data: ${data.format} version ${data.version}`);
    }
    this.data = data;
    this.start = data.repo.start;
    this.end = data.repo.end;
    this.commitCount = data.repo.commitCount;
    this.fileCommits = data.files.born.map(() => []);
    const { start, file } = data.changes;
    for (let c = 0; c < this.commitCount; c++) {
      for (let k = start[c]!; k < start[c + 1]!; k++) this.fileCommits[file[k]!]!.push(c);
    }
  }

  get fileCount(): number {
    return this.data.files.born.length;
  }

  /** The last commit at or before `time`, or -1 before the first one. */
  commitAt(time: number): number {
    const t = this.data.commits.time;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid]! <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  commitTime(commit: number): number {
    return this.data.commits.time[Math.max(0, Math.min(commit, this.commitCount - 1))]!;
  }

  changesIn(commit: number): FileChange[] {
    const c = this.data.changes;
    const out: FileChange[] = [];
    if (commit < 0) return out;
    for (let k = c.start[commit]!; k < c.start[commit + 1]!; k++) {
      out.push({ commit, file: c.file[k]!, kind: c.kind[k]!, added: c.added[k]!, deleted: c.deleted[k]! });
    }
    return out;
  }

  /** Commits that changed `file`, oldest first. */
  commitsOf(file: number): readonly number[] {
    return this.fileCommits[file] ?? [];
  }

  /** The change `commit` made to `file`. */
  changeOf(file: number, commit: number): FileChange | undefined {
    return this.changesIn(commit).find((c) => c.file === file);
  }

  /** Every path the file has had, with the commit it took that path. */
  pathsOf(file: number): { commit: number; path: string }[] {
    const f = this.data.files;
    const out = [];
    for (let k = f.pathStart[file]!; k < f.pathStart[file + 1]!; k++) {
      out.push({ commit: f.pathCommit[k]!, path: this.data.paths[f.path[k]!]! });
    }
    return out;
  }

  /** The file's path at `commit` (its first path before it was born). */
  pathAt(file: number, commit: number): string {
    const paths = this.pathsOf(file);
    let current = paths[0]!.path;
    for (const p of paths) if (p.commit <= commit) current = p.path;
    return current;
  }

  latestPath(file: number): string {
    const paths = this.pathsOf(file);
    return paths[paths.length - 1]!.path;
  }

  born(file: number): number {
    return this.data.files.born[file]!;
  }

  /** The commit that deleted the file, or -1. */
  died(file: number): number {
    return this.data.files.died[file]!;
  }

  /** Whether the file exists after `commit`. */
  existsAt(file: number, commit: number): boolean {
    const died = this.died(file);
    return this.born(file) <= commit && (died < 0 || commit < died);
  }

  clipsOf(file: number): Clip[] {
    const c = this.data.clips;
    const out: Clip[] = [];
    for (let k = c.start[file]!; k < c.start[file + 1]!; k++) {
      out.push({ from: c.from[k]!, to: c.to[k]!, author: c.author[k]! });
    }
    return out;
  }

  /**
   * While a repository is still being read, ranks are not known yet, so
   * every author is drawn in the Others gray until reading finishes.
   */
  get provisional(): boolean {
    return this.data.repo.partial !== undefined;
  }

  private releaseList: Release[] | null = null;

  /** Release tags, oldest first, with how big each release is. */
  get releases(): Release[] {
    this.releaseList ??= releases(this.data.tags);
    return this.releaseList;
  }

  /** Time of the oldest commit read so far, while reading; otherwise null. */
  get readFrom(): number | null {
    return this.data.repo.partial?.readFrom ?? null;
  }

  /** Commits in the whole history, read or not. */
  get totalCommits(): number {
    return this.data.repo.partial?.totalCommits ?? this.commitCount;
  }

  /** Number of the first commit read, minus one: for "Commit n of m". */
  get commitOffset(): number {
    return this.totalCommits - this.commitCount;
  }

  /**
   * When only a window of recent history was loaded: the stand-in author for
   * code already there when it starts (rank 6). Otherwise null.
   */
  get earlierAuthor(): number | null {
    return this.data.repo.earlierAuthor ?? null;
  }

  /** The window's first commit: what it changed is not known, only its files. */
  isWindowStart(commit: number): boolean {
    return commit === 0 && this.earlierAuthor !== null;
  }

  /** A commit's subject, or what the window's first commit stands for. */
  commitSubject(commit: number): string {
    return this.isWindowStart(commit) ? "The loaded history starts here" : (this.data.commits.subject[commit] ?? "");
  }

  /** The author's rank: 1 to 5, 0 for Others (sixth place down, and bots), 6 for earlier code. */
  rank(author: number): number {
    return this.provisional ? 0 : (this.data.authors.rank[author] ?? 0);
  }

  initials(author: number): string {
    return this.data.authors.initials[author] ?? "?";
  }

  authorName(author: number): string {
    if (author === this.earlierAuthor) {
      const d = new Date(this.start * 1000);
      return `Before ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    return this.data.authors.name[author] ?? "";
  }

  /** Ranked authors in rank order. */
  rankedAuthors(): number[] {
    const r = this.data.authors.rank;
    return r
      .map((rank, id) => ({ rank, id }))
      .filter((a) => a.rank > 0 && a.rank <= 5)
      .sort((a, b) => a.rank - b.rank)
      .map((a) => a.id);
  }

  /** Whether any commit is by someone drawn as Others. */
  hasOthers(): boolean {
    if (this.provisional) return false;
    return this.data.authors.rank.some((rank, id) => rank === 0 && this.data.authors.commits[id]! > 0);
  }

  /**
   * The files Tracks shows for a folder: the ones with the most commits over
   * the whole history, leaving out vendored and lock files. The list does not
   * depend on the playhead, so rows never jump while scrubbing. Rows are in
   * order of birth, so the tracks read as a staircase through time.
   */
  pickFiles(folder: string, count: number): number[] {
    const prefix = folder === "" ? "" : folder.replace(/\/$/, "") + "/";
    const f = this.data.files;
    const candidates: number[] = [];
    for (let i = 0; i < this.fileCount; i++) {
      if (f.vendored[i]) continue;
      if (prefix && !this.pathsOf(i).some((p) => p.path.startsWith(prefix))) continue;
      candidates.push(i);
    }
    candidates.sort((a, b) => f.commits[b]! - f.commits[a]! || this.born(a) - this.born(b) || a - b);
    return candidates
      .slice(0, Math.max(0, count))
      .sort((a, b) => this.born(a) - this.born(b) || this.latestPath(a).localeCompare(this.latestPath(b)));
  }

  /** "This commit changed n files, added a and deleted d." */
  commitSummary(commit: number): { files: number; added: number; deleted: number } {
    const changes = this.changesIn(commit);
    return {
      files: changes.length,
      added: changes.reduce((s, c) => s + c.added, 0),
      deleted: changes.reduce((s, c) => s + c.deleted, 0),
    };
  }

  /** The file a commit is about, for one-line summaries: its only file, or null. */
  soleFile(commit: number): number | null {
    const changes = this.changesIn(commit);
    return changes.length === 1 ? changes[0]!.file : null;
  }

  isRename(change: FileChange): boolean {
    return change.kind === ChangeKind.Renamed;
  }
}
