// The short text a clip carries: the author's initials, plus a note when
// something happened to the file in it ("moved to parser/", "untouched for
// 2 years, then deleted").

import type { Clip, History } from "../data/history";

const DAY = 86_400;
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** "2 years", "1 year", "8 months". */
export function spanText(seconds: number): string {
  const years = Math.round(seconds / YEAR);
  if (years >= 1) return years === 1 ? "1 year" : `${years} years`;
  const months = Math.max(1, Math.round(seconds / MONTH));
  return months === 1 ? "1 month" : `${months} months`;
}

/**
 * Text for a clip, from most to least detailed; the renderer uses the first
 * one that fits.
 */
export function clipTexts(history: History, file: number, clip: Clip): string[] {
  if (clip.author < 0) {
    const died = history.died(file);
    const deletedAtEnd = died >= 0 && history.commitTime(died) === clip.to;
    const span = spanText(clip.to - clip.from);
    return deletedAtEnd
      ? [`untouched for ${span}, then deleted`, `untouched ${span}`, ""]
      : [`untouched for ${span}`, "untouched", ""];
  }

  const initials = history.initials(clip.author);
  // A move or rename is noted once, on the clip where it happened.
  const paths = history.pathsOf(file);
  let note = "";
  for (let k = 1; k < paths.length; k++) {
    const t = history.commitTime(paths[k]!.commit);
    if (t >= clip.from && t < clip.to) {
      const before = paths[k - 1]!.path;
      const after = paths[k]!.path;
      note =
        dirOf(before) === dirOf(after) ? `renamed from ${nameOf(before)}` : `moved to ${dirOf(after) || "the top"}/`;
    }
  }
  return note ? [`${note} · ${initials}`, initials, ""] : [initials, ""];
}
