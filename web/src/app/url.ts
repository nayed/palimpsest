// The URL is the state: repository, date, view, folder, file and line, and
// for a repository too big to read whole, the window of history loaded.
//   /<owner>/<repo>?at=2026-03-12&view=tracks&folder=src&file=src/lexer.ts&line=43&since=2025-11-22
// "/" alone is the demo repository, in Tracks, playing.

import type { View } from "../store/playback";

export interface Route {
  /** "owner/name", or null for the default demo. */
  repo: string | null;
  /** Unix seconds at the start of the day, or null. */
  at: number | null;
  view: View;
  folder: string;
  /** File path at the playhead. */
  file: string | null;
  /** 1-based line number at the playhead. */
  line: number | null;
  /** Only the history since this day (Unix seconds), or null for all of it. */
  since: number | null;
}

const VIEWS: View[] = ["overview", "tracks", "lines"];

export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const q = new URLSearchParams(search);
  const at = q.get("at");
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) / 1000 : NaN);
  const atTime = day(at);
  const sinceTime = day(q.get("since"));
  const view = q.get("view") as View | null;
  const line = Number(q.get("line"));
  return {
    repo: parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null,
    at: Number.isFinite(atTime) ? atTime : null,
    view: view && VIEWS.includes(view) ? view : "tracks",
    folder: (q.get("folder") ?? "").replace(/^\/+|\/+$/g, ""),
    file: q.get("file") || null,
    line: Number.isInteger(line) && line > 0 ? line : null,
    since: Number.isFinite(sinceTime) ? sinceTime : null,
  };
}

export function isoDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function routeUrl(r: Route): string {
  const q = new URLSearchParams();
  if (r.at !== null) q.set("at", isoDay(r.at));
  if (r.view !== "tracks") q.set("view", r.view);
  if (r.folder) q.set("folder", r.folder);
  if (r.file) q.set("file", r.file);
  if (r.line !== null) q.set("line", String(r.line));
  if (r.since !== null) q.set("since", isoDay(r.since));
  const path = r.repo ? `/${r.repo}` : "/";
  const query = q.toString().replace(/%2F/g, "/");
  return query ? `${path}?${query}` : path;
}

/**
 * Accepts github.com/owner/repo, https://github.com/owner/repo(.git), and
 * owner/repo. Returns "owner/repo" or null.
 */
export function parseRepoInput(input: string): string | null {
  const s = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}
