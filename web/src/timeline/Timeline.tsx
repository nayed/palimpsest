// The timeline: a DOM ruler and row labels around a canvas that draws the
// tracks, the veil and the playhead. The canvas subscribes to the playhead
// store directly and redraws at most once per frame; React only re-renders it
// when the rows change.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatDate } from "../app/format";
import type { Playback } from "../store/playback";
import { useStore } from "../store/store";
import { LAYOUT, draw, rowAt, rowTop, type TrackRow } from "./renderer";
import { xToTime, yearSegments, type Scale } from "./scale";
import { readTheme, type CanvasTheme } from "./theme";

interface Props {
  playback: Playback;
  /** Row labels, drawn in the gutter left of the tracks. */
  labels: ReactNode[];
  /** Builds the rows for a commit; called when the commit or playing state changes. */
  buildRows: (commit: number, playing: boolean) => TrackRow[];
  onRowClick: (row: number) => void;
  /** Reports how many rows fit in the available height. */
  onFit?: (rows: number) => void;
  label: string;
}

/** Rows that fit in a timeline of this height. */
export function rowsThatFit(height: number): number {
  const free = height - rowTop(0) - LAYOUT.bottom + LAYOUT.gap;
  return Math.max(3, Math.floor(free / (LAYOUT.row + LAYOUT.gap)));
}

const DRAG_THRESHOLD = 3;

export function Timeline({ playback, labels, buildRows, onRowClick, onFit, label }: Props) {
  const h = playback.history;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const themeRef = useRef<CanvasTheme | null>(null);
  const rowsRef = useRef<{ key: string; rows: TrackRow[] }>({ key: "", rows: [] });
  const buildRef = useRef(buildRows);
  buildRef.current = buildRows;
  const frameRef = useRef(0);
  const scale: Scale = { start: h.start, end: h.end, width: size.width };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Size of the track area, and how many rows fit.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect;
      setSize({ width: Math.floor(box.width), height: Math.floor(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (size.height) onFit?.(rowsThatFit(size.height));
  }, [size.height, onFit]);

  // Redraw on the next frame whenever the playhead, rows or size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    themeRef.current = readTheme(canvas);

    const render = () => {
      frameRef.current = 0;
      const s = playback.state;
      const commit = h.commitAt(s.time);
      const key = `${commit}|${s.playing}|${labels.length}`;
      if (rowsRef.current.key !== key) rowsRef.current = { key, rows: buildRef.current(commit, s.playing) };
      draw(
        ctx,
        { scale: scaleRef.current, rows: rowsRef.current.rows, playhead: s.time, width: size.width, height: size.height },
        themeRef.current!,
        dpr,
      );
    };
    const schedule = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(render);
    };
    rowsRef.current.key = "";
    schedule();
    const unsubscribe = playback.store.subscribe(schedule);
    // Canvas text needs the web fonts; draw again once they are in.
    document.fonts?.ready.then(() => {
      rowsRef.current.key = "";
      schedule();
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [playback, h, size.width, size.height, labels.length, buildRows]);

  // Dragging anywhere scrubs; a click on a track selects it; a click on the
  // ruler jumps there.
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const timeAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return xToTime(scaleRef.current, clientX - rect.left);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const onRuler = y < rowTop(0) - LAYOUT.gap;
    press.current = { x: e.clientX, y, dragging: onRuler };
    if (onRuler) {
      playback.store.set({ scrubbing: true });
      playback.seek(timeAt(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    if (!p) {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      e.currentTarget.style.cursor =
        y < rowTop(0) - LAYOUT.gap ? "ew-resize" : rowAt(y, labels.length) >= 0 ? "pointer" : "default";
      return;
    }
    if (!p.dragging && Math.abs(e.clientX - p.x) > DRAG_THRESHOLD) {
      p.dragging = true;
      playback.store.set({ scrubbing: true });
    }
    if (p.dragging) playback.seek(timeAt(e.clientX));
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.dragging) playback.store.set({ scrubbing: false });
    else {
      const row = rowAt(p.y, labels.length);
      if (row >= 0) onRowClick(row);
    }
  };

  const time = useStore(playback.store, (s) => Math.floor(s.time / 86_400) * 86_400);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      playback.step(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      playback.pause();
      playback.seek(e.key === "Home" ? h.start : h.end);
    }
  };

  const years = yearSegments(scale);
  return (
    <section className="timeline" aria-label={label}>
      <div className="timeline-gutter" style={{ paddingTop: rowTop(0) }}>
        {labels.map((l, i) => (
          <div key={i} className="row-label">
            {l}
          </div>
        ))}
      </div>
      <div
        ref={wrapRef}
        className="timeline-tracks"
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={h.start}
        aria-valuemax={h.end}
        aria-valuenow={Math.round(playback.state.time)}
        aria-valuetext={formatDate(time)}
        onKeyDown={onKeyDown}
      >
        <div className="ruler" style={{ top: LAYOUT.top, height: LAYOUT.ruler }} aria-hidden="true">
          {years.map((y) => (
            <div
              key={y.year}
              className={y.tick ? "year tick" : "year"}
              style={{ left: y.x, width: y.width }}
            >
              {y.width >= 36 ? y.year : ""}
            </div>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </section>
  );
}
