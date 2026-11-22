// Release tags on the ruler: which ones get a label when they do not all fit.

export interface Release {
  name: string;
  time: number;
  /** 0 for a major release, 1 minor, 2 patch: lower levels are labeled first. */
  level: number;
}

/** The numbers of a version tag: "v0.16.0" → [0, 16, 0]. */
export function versionOf(name: string): number[] {
  const m = /(\d+(?:\.\d+)*)$/.exec(name);
  return m ? m[1]!.split(".").map(Number) : [];
}

/**
 * How big each release is, from the first number that changed since the
 * release before. While the major number is 0, a minor release counts as a
 * major one (0.12 → 0.13 is a big step).
 */
export function releases(tags: { name: string[]; time: number[] } | undefined): Release[] {
  if (!tags) return [];
  let prev: number[] = [];
  return tags.name.map((name, i) => {
    const v = versionOf(name);
    let level = v.findIndex((n, k) => n !== (prev[k] ?? 0));
    if (level < 0) level = 2;
    if (v[0] === 0 && (prev[0] ?? 0) === 0) level = Math.max(0, level - 1);
    prev = v;
    return { name, time: tags.time[i]!, level: Math.min(2, level) };
  });
}
