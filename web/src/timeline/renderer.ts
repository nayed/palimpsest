// Draws tracks on a canvas: one row per thing (a folder, a file, a line), a
// colored strip for its life, the color for who was writing. Rows come in as
// plain data with their positions, so Overview, Tracks and Lines share this
// renderer. Also draws the future veil, dashed markers and the playhead.

import type { Clip } from "../data/history";
import { timeToX, type Scale } from "./scale";
import type { CanvasTheme } from "./theme";

export const LAYOUT = {
  /** Space above the ruler for the playhead handle. */
  top: 26,
  ruler: 22,
  gap: 4,
  bottom: 24,
  handleWidth: 18,
  handleHeight: 14,
};

/** Where the rows start, for a given space reserved for markers above them. */
export function rowsTop(markerSpace: number): number {
  return LAYOUT.top + LAYOUT.ruler + LAYOUT.gap + markerSpace;
}

export interface TrackClip extends Clip {
  /** Rank of the author (1 to 5, 0 Others); ignored for Untouched. */
  rank: number;
  /** Texts from most to least detailed; the first that fits is drawn. */
  texts: string[];
}

export interface RowContent {
  /** "clips": labeled strips (Tracks). "plain": unlabeled strips (Lines).
      "silhouette": a filled size-over-time shape with author chips (Overview). */
  style: "clips" | "plain" | "silhouette";
  clips: TrackClip[];
  /** Time of deletion, for a dashed cap (clips style). */
  died?: number | null;
  /** The last clip's note already says it was deleted. */
  deathNoted?: boolean;
  /** Draw "born in this commit" left of the playhead. */
  bornNow?: boolean;
  /** Changed by the current commit while playing: a dot on the playhead. */
  dot?: boolean;
  /** Silhouette: sizes per month and the largest one. */
  sizes?: number[];
  peak?: number;
}

export interface DrawnRow extends RowContent {
  /** Top of the track in content coordinates (0 = first row), and height. */
  y: number;
  h: number;
}

export interface Marker {
  time: number;
  /** "NOV 2020", drawn bold. */
  date: string;
  text: string;
}

export interface Frame {
  scale: Scale;
  /** The rows to draw (usually only the visible ones). */
  rows: DrawnRow[];
  playhead: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Space between the ruler and the first row, for marker labels. */
  markerSpace: number;
  scrollTop: number;
  /** Bottom of the last row, in content coordinates. */
  contentBottom: number;
  markers: Marker[];
  /** Month boundaries for silhouettes. */
  monthStarts?: number[];
}

const CLIP_GAP = 2;
const PAD = 7;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

let hatchCache: { key: string; pattern: CanvasPattern } | null = null;

function hatch(ctx: CanvasRenderingContext2D, theme: CanvasTheme, dpr: number): CanvasPattern | string {
  const key = `${theme.untouchedStripe}${theme.untouchedGap}${dpr}`;
  if (hatchCache?.key === key) return hatchCache.pattern;
  const size = Math.round(8 * dpr);
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const t = tile.getContext("2d");
  if (!t) return theme.untouchedGap;
  t.fillStyle = theme.untouchedGap;
  t.fillRect(0, 0, size, size);
  t.strokeStyle = theme.untouchedStripe;
  t.lineWidth = 2.8 * dpr;
  for (const o of [-size, 0, size]) {
    t.beginPath();
    t.moveTo(o, size);
    t.lineTo(o + size, 0);
    t.stroke();
  }
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return theme.untouchedGap;
  pattern.setTransform(new DOMMatrix().scale(1 / dpr));
  hatchCache = { key, pattern };
  return pattern;
}

function fitText(ctx: CanvasRenderingContext2D, texts: string[], room: number): string {
  for (const t of texts) if (t === "" || ctx.measureText(t).width <= room) return t;
  return "";
}

/** A text and shorter versions of it ending in an ellipsis. */
function ellipsized(text: string): string[] {
  const out = [text];
  for (let n = text.length - 2; n >= 6; n -= 2) out.push(`${text.slice(0, n).trimEnd()}…`);
  out.push("");
  return out;
}

function fillFor(ctx: CanvasRenderingContext2D, c: TrackClip, theme: CanvasTheme, dpr: number) {
  return c.author < 0 ? hatch(ctx, theme, dpr) : (theme.authors[c.rank] ?? theme.authors[0]!);
}

function drawClips(ctx: CanvasRenderingContext2D, f: Frame, row: DrawnRow, y: number, theme: CanvasTheme, dpr: number) {
  const x = (t: number) => timeToX(f.scale, t);
  const labeled = row.style === "clips";
  row.clips.forEach((c, k) => {
    const x0 = x(c.from);
    const touchesNext = row.clips[k + 1]?.from === c.to;
    const x1 = x(c.to) - (touchesNext ? CLIP_GAP : 0);
    const w = x1 - x0;
    if (w <= 0.5) return;
    ctx.fillStyle = fillFor(ctx, c, theme, dpr);
    roundRect(ctx, x0, y, Math.max(w, 2), row.h, 4);
    ctx.fill();
    if (!labeled) return;
    const text = fitText(ctx, c.texts, w - 2 * PAD);
    if (!text) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y, w, row.h);
    ctx.clip();
    ctx.fillStyle = c.author < 0 ? theme.onUntouched : theme.onAuthor;
    ctx.textAlign = "left";
    ctx.fillText(text, x0 + PAD, y + row.h / 2 + 1);
    ctx.restore();
  });

  if (row.died != null) {
    const dx = x(row.died) + CLIP_GAP;
    const room = f.scale.width - dx;
    const withLabel = !row.deathNoted && room >= 70 && row.h >= 24;
    const w = withLabel ? 70 : Math.min(14, room);
    if (w > 4) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = theme.lineDashed;
      ctx.lineWidth = 1;
      roundRect(ctx, dx + 0.5, y + 0.5, w - 1, row.h - 1, 4);
      ctx.stroke();
      ctx.restore();
      if (withLabel) {
        ctx.fillStyle = theme.mute;
        ctx.textAlign = "left";
        ctx.fillText("deleted", dx + PAD, y + row.h / 2 + 1);
      }
    }
  }

  if (row.bornNow) {
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "right";
    ctx.fillText("born in this commit", x(f.playhead) - 10, y + row.h / 2 + 1);
  }
}

function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string | CanvasPattern, ink: string, theme: CanvasTheme) {
  ctx.font = theme.fontChip;
  const w = Math.max(26, ctx.measureText(text).width + 10);
  roundRect(ctx, x, y, w, 18, 3);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = theme.panel;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + 10);
  ctx.font = theme.fontClip;
}

function drawSilhouette(ctx: CanvasRenderingContext2D, f: Frame, row: DrawnRow, y: number, theme: CanvasTheme, dpr: number) {
  const months = f.monthStarts ?? [];
  const sizes = row.sizes ?? [];
  const peak = Math.max(1, row.peak ?? 1);
  const x = (t: number) => Math.min(f.scale.width, Math.max(0, timeToX(f.scale, t)));
  let k = 0;
  for (let m = 0; m < sizes.length; m++) {
    const from = months[m]!;
    const to = months[m + 1]!;
    const mid = (from + to) / 2;
    while (k < row.clips.length - 1 && row.clips[k]!.to <= mid) k++;
    const clip = row.clips[k];
    if (!clip || mid < clip.from || mid >= clip.to || sizes[m] === 0) continue;
    const bar = Math.max(1, (row.h * sizes[m]!) / peak);
    const x0 = Math.max(x(from), x(clip.from));
    const x1 = Math.min(x(to), x(clip.to));
    if (x1 <= x0) continue;
    ctx.fillStyle = fillFor(ctx, clip, theme, dpr);
    ctx.fillRect(x0, y + row.h - bar, x1 - x0 + 0.5, bar);
  }
  // A chip where each author's stretch starts, when there is room for it.
  let free = -Infinity;
  row.clips.forEach((c, i) => {
    if (row.clips[i - 1]?.author === c.author) return;
    const cx = Math.min(x(c.from) + 6, f.scale.width - 30);
    const next = row.clips[i + 1];
    const room = (next ? x(next.from) : f.scale.width) - x(c.from);
    if (cx < free || room < 34) return;
    free = cx + (c.author < 0 ? 70 : 34);
    if (c.author < 0) drawChip(ctx, cx, y + 6, "untouched", hatch(ctx, theme, dpr), theme.onUntouched, theme);
    else drawChip(ctx, cx, y + 6, c.texts[0] ?? "", theme.authors[c.rank] ?? theme.authors[0]!, theme.onAuthor, theme);
  });
}

export function draw(ctx: CanvasRenderingContext2D, f: Frame, theme: CanvasTheme, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  ctx.font = theme.fontClip;
  ctx.textBaseline = "middle";
  const top = rowsTop(f.markerSpace);
  const px = timeToX(f.scale, f.playhead);
  const bottom = Math.min(f.height, top + f.contentBottom - f.scrollTop);

  // Rows, clipped to the area below the ruler and markers.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, f.width, f.height - top);
  ctx.clip();
  for (const row of f.rows) {
    const y = top + row.y - f.scrollTop;
    if (y > f.height || y + row.h < top) continue;
    ctx.fillStyle = theme.lane;
    roundRect(ctx, 0, y, f.scale.width, row.h, 4);
    ctx.fill();
    if (row.style === "silhouette") drawSilhouette(ctx, f, row, y, theme, dpr);
    else drawClips(ctx, f, row, y, theme, dpr);
  }
  ctx.restore();

  // Dashed markers with their labels above the rows. A label stops before
  // the next marker.
  const markers = [...f.markers].sort((a, b) => a.time - b.time);
  let labelsEnd = 0;
  for (const [i, m] of markers.entries()) {
    const mx = Math.round(timeToX(f.scale, m.time)) + 0.5;
    const nextX = i + 1 < markers.length ? timeToX(f.scale, markers[i + 1]!.time) - 10 : f.scale.width;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = theme.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, top - f.markerSpace + 2);
    ctx.lineTo(mx, bottom);
    ctx.stroke();
    ctx.restore();

    const ly = top - f.markerSpace / 2 - 1;
    ctx.textAlign = "left";
    ctx.fillStyle = theme.fg;
    ctx.font = theme.fontMarkerDate;
    const dateWidth = ctx.measureText(m.date).width;
    ctx.font = theme.fontMarker;
    const width = dateWidth + 5 + ctx.measureText(m.text).width;
    // Right of the line, up to the next marker; left of it only when the
    // right is too tight and the left is free.
    let lx = mx + 6;
    let room = nextX - lx;
    if (room < Math.min(width, dateWidth + 80) && mx - 6 - width >= labelsEnd) {
      lx = mx - 6 - width;
      room = width;
    }
    if (room < dateWidth) continue;
    ctx.font = theme.fontMarkerDate;
    ctx.fillText(m.date, lx, ly);
    ctx.font = theme.fontMarker;
    const text = fitText(ctx, ellipsized(m.text), room - dateWidth - 5);
    ctx.fillText(text, lx + dateWidth + 5, ly);
    labelsEnd = lx + dateWidth + 5 + ctx.measureText(text).width + 8;
    ctx.font = theme.fontClip;
  }

  // The future is veiled: it exists, but you are not there yet.
  const veilTop = LAYOUT.top + LAYOUT.ruler;
  ctx.fillStyle = theme.futureVeil;
  ctx.fillRect(px, veilTop, f.scale.width - px, Math.max(0, bottom - veilTop));

  // Playhead line and handle.
  ctx.fillStyle = theme.playheadLine;
  ctx.fillRect(px - 1, LAYOUT.top - 4, 2, bottom + 8 - (LAYOUT.top - 4));
  roundRect(ctx, px - LAYOUT.handleWidth / 2, LAYOUT.top - 18, LAYOUT.handleWidth, LAYOUT.handleHeight, 3);
  ctx.fillStyle = theme.now;
  ctx.fill();
  if (theme.nowOutline && theme.nowOutline !== "transparent") {
    ctx.strokeStyle = theme.nowOutline;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // A dot where the current commit is changing a track.
  for (const row of f.rows) {
    if (!row.dot) continue;
    const y = top + row.y - f.scrollTop + row.h / 2;
    if (y < top || y > f.height) continue;
    ctx.beginPath();
    ctx.arc(px, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = theme.now;
    ctx.fill();
    ctx.strokeStyle = theme.panel;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
