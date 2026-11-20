// Messages between the app and the worker that reads a repository.

export const COMMIT_LIMIT = 50_000;

export type FailureKind = "notFound" | "network" | "protocol" | "tooBig" | "internal";

export interface LoadStatus {
  /** What is happening now. */
  step: "connecting" | "counting" | "downloading" | "indexing" | "reading" | "lines" | "done" | "stopped" | "failed";
  /** Bytes downloaded so far, and whether the download is finished. */
  bytes: number;
  downloaded: boolean;
  /** The pack came from this browser's storage, not from GitHub. */
  fromCache: boolean;
  /** Commits on the default branch, once known, and how many are read. */
  total: number | null;
  read: number;
  /** Share of line history worked out, 0 to 1. */
  lines: number;
  failure: { kind: FailureKind; message: string } | null;
}

export const INITIAL_STATUS: LoadStatus = {
  step: "connecting",
  bytes: 0,
  downloaded: false,
  fromCache: false,
  total: null,
  read: 0,
  lines: 0,
  failure: null,
};

export type ToWorker =
  | { type: "open"; repo: string; proxy: string; limit: number }
  /** A file's line history in snapshot `version`. */
  | { type: "lines"; id: number; file: number; version: number }
  | { type: "stop" };

export type FromWorker =
  | { type: "status"; status: Partial<LoadStatus> }
  /** A data file for what has been read; `version` counts snapshots. */
  | { type: "data"; json: string; version: number }
  /** null: no line history, or `version` is stale and the app should ask again. */
  | { type: "lines"; id: number; json: string | null; version: number };
