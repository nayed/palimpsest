const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Mar 2026", in UTC. Uppercased by CSS where the design wants it. */
export function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 2814 → "2,814". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1 file", "3 files". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "6 minutes", "90 seconds". */
export function formatDuration(seconds: number): string {
  if (seconds < 120) return plural(Math.round(seconds), "second");
  return plural(Math.round(seconds / 60), "minute");
}

/** Shortens a path from the left to at most `max` characters: "…/src/term/mod.rs". */
export function shortenPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  let out = parts.pop()!;
  while (parts.length && out.length + parts[parts.length - 1]!.length + 3 <= max) {
    out = `${parts.pop()}/${out}`;
  }
  return `…/${out}`;
}
