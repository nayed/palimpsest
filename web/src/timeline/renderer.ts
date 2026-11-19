// Draws the tracks on a canvas: one row per thing (here, a file), colored
// clips for who was writing, the future veil and the playhead. Rows are given
// as plain data so the same renderer can later draw folders and lines.

import type { Clip } from "../data/history";
import { timeToX, type Scale } from "./scale";
import type { CanvasTheme } from "./theme";

export const LAYOUT = {
  /** Space above the ruler for the playhead handle. */
  top: 26,
  ruler: 22,
  gap: 4,
  row: 30,
  bottom: 24,
  handleWidth: 18,
  handleHeight: 14,
};

export interface TrackClip extends Clip {
  /** Rank of the author (1 to 5, 0 Others); ignored for Untouched. */
  rank: number;
  /** Texts from most to least detailed; the first that fits is drawn. */
  texts: string[];
}

export interface TrackRow {
  clips: TrackClip[];
  /** Time of deletion, if the thing was deleted. */
  died: number | null;
  /** Whether the last clip's note already says it was deleted. */
  deathNoted: boolean;
  /** Draw "born in this commit" left of the playhead. */
  bornNow: boolean;
  /** Changed by the current commit while playing: a dot on the playhead. */
  dot: boolean;
}

export interface Frame {
  scale: Scale;
  rows: TrackRow[];
  playhead: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

export function rowTop(i: number): number {
  return LAYOUT.top + LAYOUT.ruler + LAYOUT.gap + i * (LAYOUT.row + LAYOUT.gap);
}

/** The row under a y position, or -1. */
export function rowAt(y: number, count: number): number {
  const rel = y - rowTop(0);
  if (rel < 0) return -1;
  const i = Math.floor(rel / (LAYOUT.row + LAYOUT.gap));
  if (i >= count || rel - i * (LAYOUT.row + LAYOUT.gap) > LAYOUT.row) return -1;
  return i;
}

const CLIP_GAP = 2;
const PAD = 7;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
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

export function draw(ctx: CanvasRenderingContext2D, f: Frame, theme: CanvasTheme, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  ctx.font = theme.fontClip;
  ctx.textBaseline = "middle";
  const x = (t: number) => timeToX(f.scale, t);
  const px = x(f.playhead);
  const H = LAYOUT.row;

  f.rows.forEach((row, i) => {
    const y = rowTop(i);
    ctx.fillStyle = theme.lane;
    roundRect(ctx, 0, y, f.scale.width, H, 4);
    ctx.fill();

    row.clips.forEach((c, k) => {
      const x0 = x(c.from);
      const touchesNext = row.clips[k + 1]?.from === c.to;
      const x1 = x(c.to) - (touchesNext ? CLIP_GAP : 0);
      const w = x1 - x0;
      if (w <= 0.5) return;
      ctx.fillStyle = c.author < 0 ? hatch(ctx, theme, dpr) : (theme.authors[c.rank] ?? theme.authors[0]!);
      roundRect(ctx, x0, y, w, H, 4);
      ctx.fill();
      const text = fitText(ctx, c.texts, w - 2 * PAD);
      if (text) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y, w, H);
        ctx.clip();
        ctx.fillStyle = c.author < 0 ? theme.onUntouched : theme.onAuthor;
        ctx.textAlign = "left";
        ctx.fillText(text, x0 + PAD, y + H / 2 + 1);
        ctx.restore();
      }
    });

    if (row.died !== null) {
      const dx = x(row.died) + CLIP_GAP;
      const room = f.scale.width - dx;
      const labeled = !row.deathNoted && room >= 70;
      const w = labeled ? 70 : Math.min(14, room);
      if (w > 4) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = theme.lineDashed;
        ctx.lineWidth = 1;
        roundRect(ctx, dx + 0.5, y + 0.5, w - 1, H - 1, 4);
        ctx.stroke();
        ctx.restore();
        if (labeled) {
          ctx.fillStyle = theme.mute;
          ctx.textAlign = "left";
          ctx.fillText("deleted", dx + PAD, y + H / 2 + 1);
        }
      }
    }

    if (row.bornNow) {
      ctx.fillStyle = theme.fg;
      ctx.textAlign = "right";
      ctx.fillText("born in this commit", px - 10, y + H / 2 + 1);
    }
  });

  const bottom = rowTop(f.rows.length) - LAYOUT.gap;

  // The future is veiled: it exists, but you are not there yet.
  const veilTop = LAYOUT.top + LAYOUT.ruler;
  ctx.fillStyle = theme.futureVeil;
  ctx.fillRect(px, veilTop, f.scale.width - px, bottom - veilTop);

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
  f.rows.forEach((row, i) => {
    if (!row.dot) return;
    ctx.beginPath();
    ctx.arc(px, rowTop(i) + H / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = theme.now;
    ctx.fill();
    ctx.strokeStyle = theme.panel;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}
