// The CSS variable holding an author rank's color.

/** Ranks 1 to 5 have their own colors, 0 is Others, 6 is code from before a loaded window. */
export function authorColor(rank: number): string {
  if (rank === 6) return "var(--author-earlier)";
  return rank >= 1 && rank <= 5 ? `var(--author-${rank})` : "var(--author-others)";
}
