// Mapping between time and horizontal position, and the years on the ruler.

export interface Scale {
  start: number;
  end: number;
  /** Pixel width of the timeline. */
  width: number;
}

export function timeToX(s: Scale, t: number): number {
  if (s.end <= s.start) return 0;
  return ((t - s.start) / (s.end - s.start)) * s.width;
}

export function xToTime(s: Scale, x: number): number {
  const f = Math.min(1, Math.max(0, x / Math.max(1, s.width)));
  return s.start + f * (s.end - s.start);
}

export interface YearSegment {
  year: number;
  /** Left edge and width in pixels. */
  x: number;
  width: number;
  /** True when the segment starts on 1 January (it gets a tick). */
  tick: boolean;
}

const yearStart = (y: number) => Date.UTC(y, 0, 1) / 1000;

/** One segment per calendar year (UTC) the timeline covers, clipped to it. */
export function yearSegments(s: Scale): YearSegment[] {
  const first = new Date(s.start * 1000).getUTCFullYear();
  const last = new Date(s.end * 1000).getUTCFullYear();
  const out: YearSegment[] = [];
  for (let y = first; y <= last; y++) {
    const from = Math.max(s.start, yearStart(y));
    const to = Math.min(s.end, yearStart(y + 1));
    if (to <= from) continue;
    const x = timeToX(s, from);
    out.push({ year: y, x, width: timeToX(s, to) - x, tick: from === yearStart(y) });
  }
  return out;
}
