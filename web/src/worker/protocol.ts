// Messages between the app and the worker that reads a repository.

export const COMMIT_LIMIT = 50_000;

export type FailureKind = "notFound" | "network" | "protocol" | "tooBig" | "internal";

/** A window of recent history small enough to read: the last `months`. */
export interface HistoryWindow {
  months: number;
  /** Unix seconds, the start of a day (UTC). */
  since: number;
  /** Commits in it, as GitHub counts them. */
  commits: number;
}

/** Windows tried for a repository over the limit, longest first. */
export const WINDOW_MONTHS = [24, 12, 6, 3, 1];
/** The quick option offered beside the longest window that fits. */
export const SHORT_WINDOW_MONTHS = 3;

export interface LoadStatus {
  /** What is happening now. */
  step:
    | "connecting"
    | "counting"
    | "downloading"
    | "indexing"
    | "reading"
    | "crediting"
    | "lines"
    | "done"
    | "stopped"
    | "failed";
  /** Bytes downloaded so far, and whether the download is finished. */
  bytes: number;
  downloaded: boolean;
  /** The pack came from this browser's storage, not from GitHub. */
  fromCache: boolean;
  /** Share of the pack unpacked (indexed), 0 to 1. */
  unpacked: number;
  /** Share of the history whose merges are credited file by file, 0 to 1. */
  credited: number;
  /** Commits counted when there are too many to read: windows are being tried. */
  over: number | null;
  /** Commits on the default branch, once known, and how many are read. */
  total: number | null;
  read: number;
  /** Share of line history worked out, 0 to 1. */
  lines: number;
  failure: {
    kind: FailureKind;
    message: string;
    /** For a repository too big to read whole: windows that fit, longest first. */
    windows?: HistoryWindow[];
  } | null;
}

export const INITIAL_STATUS: LoadStatus = {
  step: "connecting",
  bytes: 0,
  downloaded: false,
  fromCache: false,
  unpacked: 0,
  credited: 0,
  over: null,
  total: null,
  read: 0,
  lines: 0,
  failure: null,
};

export type ToWorker =
  /** `since`: only the history since then (a window), or null for all of it. */
  | { type: "open"; repo: string; proxy: string; limit: number; since: number | null }
  /** A file's line history in snapshot `version`. */
  | { type: "lines"; id: number; file: number; version: number }
  | { type: "stop" };

export type FromWorker =
  | { type: "status"; status: Partial<LoadStatus> }
  /** A data file for what has been read; `version` counts snapshots. */
  | { type: "data"; json: string; version: number }
  /** null: no line history, or `version` is stale and the app should ask again. */
  | { type: "lines"; id: number; json: string | null; version: number };
