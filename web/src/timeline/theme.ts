// Colors for the canvas, read from the CSS variables in tokens.css so that
// components and canvas share one source.

export interface CanvasTheme {
  lane: string;
  fg: string;
  mute: string;
  lineDashed: string;
  onAuthor: string;
  onUntouched: string;
  untouchedStripe: string;
  untouchedGap: string;
  authors: string[]; // index = rank; 0 = Others
  futureVeil: string;
  playheadLine: string;
  now: string;
  nowOutline: string;
  panel: string;
  fontClip: string;
  fontChip: string;
  fontMarker: string;
  fontMarkerDate: string;
}

export function readTheme(el: Element): CanvasTheme {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    lane: v("--lane"),
    fg: v("--fg"),
    mute: v("--mute"),
    lineDashed: v("--line-dashed"),
    onAuthor: v("--on-author"),
    onUntouched: v("--on-untouched"),
    untouchedStripe: v("--untouched-stripe"),
    untouchedGap: v("--untouched-gap"),
    authors: [v("--author-others"), v("--author-1"), v("--author-2"), v("--author-3"), v("--author-4"), v("--author-5")],
    futureVeil: v("--future-veil"),
    playheadLine: v("--playhead-line"),
    now: v("--now"),
    nowOutline: v("--now-outline"),
    panel: v("--panel"),
    fontClip: `500 14px ${v("--font-display")}`,
    fontChip: `600 12px ${v("--font-display")}`,
    fontMarker: `400 13px ${v("--font-ui")}`,
    fontMarkerDate: `600 14px ${v("--font-display")}`,
  };
}
