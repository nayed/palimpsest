// The data file written by palimpsest-core (core/src/format.rs), version 1.
// Tables are stored column by column; `start` columns are offsets, so the
// entries of item i are start[i] .. start[i + 1].

export const FORMAT = "palimpsest";
export const VERSION = 1;

export interface Data {
  format: string;
  version: number;
  repo: {
    name: string;
    head: string;
    commitCount: number;
    start: number;
    end: number;
    /** Whether line history and overview.share are worked out. */
    lineHistory: boolean;
    /** Set while a repository is still being read, newest first. */
    partial?: { readFrom: number; totalCommits: number };
  };
  authors: {
    name: string[];
    initials: string[];
    commits: number[];
    /** 1 to 5 picks the color; 0 is Others. */
    rank: number[];
    bot: boolean[];
  };
  commits: {
    time: number[];
    author: number[];
    hash: string[];
    subject: string[];
    why: string[];
  };
  paths: string[];
  files: {
    born: number[];
    /** -1 while the file exists. */
    died: number[];
    commits: number[];
    lines: number[];
    vendored: boolean[];
    /** Whether lines/<file id>.json exists. */
    hasLines: boolean[];
    pathStart: number[];
    pathCommit: number[];
    path: number[];
  };
  changes: {
    start: number[];
    file: number[];
    /** 0 added, 1 modified, 2 deleted, 3 renamed. */
    kind: number[];
    added: number[];
    deleted: number[];
  };
  clips: Clips;
  overview: {
    rows: OverviewRow[];
    firstMonthStart: number;
    monthStarts: number[];
    moments: Moment[];
    /** Lines alive at the end of each month, by who last wrote them. */
    share: { start: number[]; author: number[]; lines: number[] };
  };
}

export interface Clips {
  start: number[];
  from: number[];
  to: number[];
  /** Author id, or -1 for Untouched. */
  author: number[];
}

export interface OverviewRow {
  label: string;
  folder: string | null;
  born: number;
  died: number | null;
  lines: number;
  peakLines: number;
  sizes: number[];
  clips: Clips;
}

export interface Moment {
  commit: number;
  kind: "folderBorn" | "move";
  folder: string;
  from: string | null;
  files: number;
  example: string | null;
}

export const ChangeKind = { Added: 0, Modified: 1, Deleted: 2, Renamed: 3 } as const;
