// Repositories the viewer opened recently, kept in this browser only.

const KEY = "palimpsest.recent";
const MAX = 5;

export interface Recent {
  name: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export function getRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Recent[];
    return Array.isArray(list) ? list.filter((r) => typeof r?.name === "string") : [];
  } catch {
    return [];
  }
}

export function addRecent(name: string): void {
  try {
    const list = [{ name, at: Date.now() }, ...getRecent().filter((r) => r.name !== name)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private windows); recents are a convenience.
  }
}

/** "just now", "yesterday", "3 days ago". */
export function ago(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}
