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
  const note = clipNote(history, file, clip);
  return note ? [`${note} · ${initials}`, initials, ""] : [initials, ""];
}

/** A move or rename of the file during the clip: it is noted once, on the clip where it happened. */
export function clipNote(history: History, file: number, clip: Clip): string {
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
  return note;
}

/** The clip at a time, if any. */
export function clipAt<C extends Clip>(clips: readonly C[], time: number): C | undefined {
  const last = clips[clips.length - 1];
  return clips.find((c) => time >= c.from && time < c.to) ?? (last && time === last.to ? last : undefined);
}

/** The commits of a list that fall in a clip. The history's last moment belongs to the clip ending there. */
export function commitsInClip(history: History, commits: readonly number[], clip: Clip): number[] {
  return commits.filter((c) => {
    const t = history.commitTime(c);
    return t >= clip.from && (t < clip.to || (t === clip.to && t === history.end));
  });
}

/** What the hover card says about a file's clip, under the author's name and dates. */
export function fileClipDetails(history: History, file: number, clip: Clip): string[] {
  if (clip.author < 0) {
    const died = history.died(file);
    const deletedAtEnd = died >= 0 && history.commitTime(died) === clip.to;
    return [`No commits for ${spanText(clip.to - clip.from)}${deletedAtEnd ? ", then deleted" : ""}`];
  }
  const commits = commitsInClip(history, history.commitsOf(file), clip);
  const theirs = commits.filter((c) => history.data.commits.author[c] === clip.author).length;
  const first = history.authorName(clip.author).split(" ")[0];
  const count = commits.length === 1 ? "1 commit" : `${commits.length.toLocaleString("en-US")} commits`;
  const out = [
    commits.length <= 1 ? count : theirs === commits.length ? `${count}, all by ${first}` : `${count}, ${theirs} by ${first}`,
  ];
  const note = clipNote(history, file, clip);
  if (note) out.push(note.charAt(0).toUpperCase() + note.slice(1));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthOf(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mar 2019 – Nov 2020", or one month. */
export function clipDates(clip: Clip): string {
  const a = monthOf(clip.from);
  const b = monthOf(Math.max(clip.from, clip.to - 1));
  return a === b ? a : `${a} – ${b}`;
}
