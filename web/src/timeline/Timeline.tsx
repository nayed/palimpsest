// The timeline shared by the three views: a DOM ruler and row labels around
// a canvas that draws the rows, markers, the veil and the playhead. The canvas
// subscribes to the playhead store directly and redraws at most once per
// frame. Rows scroll when they do not fit, and only visible rows are built and
// drawn, so a file with thousands of lines stays cheap.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDate } from "../app/format";
import type { Playback } from "../store/playback";
import { useStore } from "../store/store";
import { LAYOUT, draw, rowsTop, type DrawnRow, type Marker, type RowContent } from "./renderer";
import { xToTime, yearSegments, type Scale } from "./scale";
import { readTheme, type CanvasTheme } from "./theme";

export interface TimelineProps {
  playback: Playback;
  /** Track height of each row. */
  heights: number[];
  gap: number;
  /** Width of the label gutter left of the tracks; 0 puts labels above them. */
  gutter: number;
  /** Height of a label above its track (phone), when `gutter` is 0. */
  labelAbove?: number;
  label: (row: number) => ReactNode;
  /** Builds what a row shows at a commit. */
  content: (row: number, commit: number, playing: boolean) => RowContent;
  /** Dashed markers with labels (moves, notable moments). */
  markers?: Marker[];
  /** Space above the first row for marker labels. */
  markerSpace?: number;
  /** A caption over the label gutter ("Taller track, bigger folder"). */
  caption?: ReactNode;
  monthStarts?: number[];
  onRowClick?: (row: number) => void;
  /** What a mouse resting on a row at a time shows: details of the clip there. */
  hoverCard?: (row: number, time: number) => ReactNode;
  /** Reports the size available to the timeline. */
  onSize?: (width: number, height: number) => void;
  /** Keeps this row in view. */
  revealRow?: number;
  shortYears?: boolean;
  /** Accessible name. */
  name: string;
  /** Text after the rows (phone hint). */
  footer?: ReactNode;
}

const GUTTER_GAP = 12;
const DRAG_THRESHOLD = 3;
/** Space between the pointer and the hover card. */
const CARD_OFFSET = 14;

export function Timeline(props: TimelineProps) {
  const { playback, heights, gap, gutter, labelAbove = 0 } = props;
  const h = playback.history;
  // While a repository is read, newest first, mark how far back it has got.
  const readFrom = h.readFrom;
  const markerSpace = readFrom !== null ? Math.max(24, props.markerSpace ?? 0) : (props.markerSpace ?? 0);
  const markers = useMemo((): Marker[] => {
    const own = props.markers ?? [];
    if (readFrom === null) return own;
    const date = formatDate(readFrom).split(" ").slice(1).join(" ").toUpperCase();
    return [...own.filter((m) => m.time > readFrom), { time: readFrom, date, text: "read back to here" }];
  }, [props.markers, readFrom]);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, scrollbar: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const scrollTopRef = useRef(0);
  const themeRef = useRef<CanvasTheme | null>(null);
  const frameRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  const left = gutter ? gutter + GUTTER_GAP : 0;
  const trackWidth = Math.max(0, size.width - left - size.scrollbar);
  const scale: Scale = { start: h.start, end: h.end, width: trackWidth };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const top = rowsTop(markerSpace);

  // Row positions in content coordinates (0 = first row).
  const layout = useMemo(() => {
    const ys: number[] = [];
    let y = 0;
    for (const hh of heights) {
      y += labelAbove;
      ys.push(y);
      y += hh + gap;
    }
    return { ys, bottom: Math.max(0, y - gap) };
  }, [heights, gap, labelAbove]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const visible = (scrollY: number, height: number): [number, number] => {
    const { ys } = layoutRef.current;
    const from = scrollY - 40;
    const to = scrollY + height - top + 40;
    let a = 0;
    while (a < ys.length && ys[a]! + heights[a]! < from) a++;
    let b = a;
    while (b < ys.length && ys[b]! - labelAbove < to) b++;
    return [a, b];
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const scroller = scrollRef.current;
      const scrollbar = scroller ? scroller.offsetWidth - scroller.clientWidth : 0;
      setSize({ width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight), scrollbar });
    });
    ro.observe(el);
    if (scrollRef.current) ro.observe(scrollRef.current.firstElementChild!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (size.height) propsRef.current.onSize?.(size.width, size.height);
  }, [size.width, size.height]);

  // Keep a row in view (keyboard selection, a line chosen elsewhere).
  useEffect(() => {
    const row = props.revealRow;
    const scroller = scrollRef.current;
    if (row === undefined || row < 0 || !scroller) return;
    const y = layout.ys[row];
    if (y === undefined) return;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    if (y - labelAbove < viewTop) scroller.scrollTop = y - labelAbove - 8;
    else if (y + heights[row]! > viewBottom) scroller.scrollTop = y + heights[row]! - scroller.clientHeight + 8;
  }, [props.revealRow, layout, heights, labelAbove]);

  // Drawing. Everything the frame needs is read from `frame` when it is
  // drawn, so new props only schedule a redraw: resizing the canvas (which
  // clears it) happens only when its size changes. At high speed a view
  // re-renders on every commit, faster than the screen refreshes, and
  // restarting the drawing then would leave the canvas blank.
  const frame = useRef({ trackWidth, height: size.height, heights, markerSpace, readFrom, markers });
  frame.current = { trackWidth, height: size.height, heights, markerSpace, readFrom, markers };
  const cache = useRef<{ key: string; rows: Map<number, RowContent> }>({ key: "", rows: new Map() });
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let dpr = window.devicePixelRatio || 1;

    const render = () => {
      frameRef.current = 0;
      const f = frame.current;
      if (!f.trackWidth || !f.height) return;
      // Resize only when needed: assigning a size clears the canvas.
      dpr = window.devicePixelRatio || 1;
      const w = Math.round(f.trackWidth * dpr);
      const hh = Math.round(f.height * dpr);
      if (canvas.width !== w || canvas.height !== hh) {
        canvas.width = w;
        canvas.height = hh;
      }
      themeRef.current ??= readTheme(canvas);
      const p = propsRef.current;
      const s = playback.state;
      const history = playback.history;
      const commit = history.commitAt(s.time);
      const key = `${commit}|${s.playing}`;
      if (cache.current.key !== key) cache.current = { key, rows: new Map() };
      const [a, b] = visible(scrollTopRef.current, f.height);
      const rows: DrawnRow[] = [];
      for (let i = a; i < b; i++) {
        let c = cache.current.rows.get(i);
        if (!c) {
          c = p.content(i, commit, s.playing);
          cache.current.rows.set(i, c);
        }
        rows.push({ ...c, y: layoutRef.current.ys[i]!, h: f.heights[i]! });
      }
      draw(
        ctx,
        {
          scale: scaleRef.current,
          rows,
          playhead: s.time,
          width: f.trackWidth,
          height: f.height,
          markerSpace: f.markerSpace,
          scrollTop: scrollTopRef.current,
          contentBottom: layoutRef.current.bottom,
          markers: f.markers,
          readFrom: f.readFrom,
          monthStarts: p.monthStarts,
        },
        themeRef.current!,
        dpr,
      );
    };
    const schedule = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(render);
    };
    redrawRef.current = schedule;
    schedule();
    const unsubscribe = playback.store.subscribe(schedule);
    document.fonts?.ready.then(schedule);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [playback]);

  // New rows, sizes or markers: forget built rows and draw again.
  useEffect(() => {
    cache.current = { key: "", rows: new Map() };
    redrawRef.current();
  }, [props.content, h, trackWidth, size.height, heights, markerSpace, markers, readFrom]);

  // Dragging anywhere scrubs; a click on a row selects it; a click on the
  // ruler jumps there.
  const press = useRef<{ x: number; y: number; dragging: boolean; onTracks: boolean } | null>(null);
  const timeAt = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return xToTime(scaleRef.current, clientX - rect.left - left);
  };
  /** The row at a height; with `trackOnly`, not counting a label above it. */
  const rowAt = (clientY: number, trackOnly = false): number => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const y = clientY - rect.top - top + scrollTopRef.current;
    const { ys } = layoutRef.current;
    for (let i = 0; i < ys.length; i++) {
      if (y >= ys[i]! - (trackOnly ? 0 : labelAbove) && y <= ys[i]! + heights[i]!) return i;
      if (ys[i]! > y) break;
    }
    return -1;
  };
  // A mouse resting on a track shows a card about the clip under it.
  const [hover, setHover] = useState<{ x: number; y: number; row: number; time: number } | null>(null);
  const hoverAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const overCaption = (e.target as HTMLElement).closest(".timeline-caption");
    if (!propsRef.current.hoverCard || e.pointerType !== "mouse" || press.current || overCaption) return setHover(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const row = x >= left && x < rect.width - size.scrollbar && y >= top ? rowAt(e.clientY, true) : -1;
    setHover(row < 0 ? null : { x, y, row, time: timeAt(e.clientX) });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setHover(null);
    // Presses on the caption (Find a file) and on buttons in labels are theirs.
    // They still reach the page, so open menus elsewhere close.
    if (e.button !== 0 || (e.target as HTMLElement).closest(".timeline-caption, button")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x > rect.width - size.scrollbar) return; // the scrollbar
    const onRuler = y < top - markerSpace - LAYOUT.gap;
    const onTracks = x >= left;
    press.current = { x: e.clientX, y: e.clientY, dragging: onRuler && onTracks, onTracks };
    if (onRuler && onTracks) {
      e.currentTarget.setPointerCapture(e.pointerId);
      playback.store.set({ scrubbing: true });
      playback.seek(timeAt(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    hoverAt(e);
    const p = press.current;
    if (!p || !p.onTracks) return;
    if (!p.dragging && Math.abs(e.clientX - p.x) > DRAG_THRESHOLD) {
      p.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
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
      const row = rowAt(p.y);
      if (row >= 0) propsRef.current.onRowClick?.(row);
    }
  };

  const day = useStore(playback.store, (s) => Math.floor(s.time / 86_400) * 86_400);
  const [a, b] = visible(scrollTop, size.height);
  const years = yearSegments(scale);
  const labels: ReactNode[] = [];
  for (let i = a; i < b; i++) {
    const y = layout.ys[i]!;
    labels.push(
      gutter ? (
        <div key={i} className="row-label" style={{ top: y, height: heights[i], width: gutter }}>
          {props.label(i)}
        </div>
      ) : (
        <div key={i} className="row-label above" style={{ top: y - labelAbove, height: labelAbove, left: 0, right: 0 }}>
          {props.label(i)}
        </div>
      ),
    );
  }

  const card = hover && props.hoverCard?.(hover.row, hover.time);
  // Beside the pointer, flipped left or up near the far edges.
  const cardStyle = hover && {
    left: hover.x,
    top: hover.y,
    transform: `translate(${hover.x > size.width * 0.6 ? `calc(-100% - ${CARD_OFFSET}px)` : `${CARD_OFFSET}px`}, ${
      hover.y > size.height * 0.5 ? `calc(-100% - ${CARD_OFFSET}px)` : `${CARD_OFFSET}px`
    })`,
  };

  return (
    <section className="timeline" aria-label={props.name}>
      <div
        ref={wrapRef}
        className="timeline-area"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} style={{ left, width: trackWidth, height: size.height }} />
        <div
          className="ruler"
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={h.start}
          aria-valuemax={h.end}
          aria-valuenow={Math.round(day)}
          aria-valuetext={formatDate(day)}
          style={{ top: LAYOUT.top, height: LAYOUT.ruler, left, width: trackWidth }}
        >
          {years.map((y) => (
            <div key={y.year} className={y.tick ? "year tick" : "year"} style={{ left: y.x, width: y.width }} aria-hidden="true">
              {y.width >= (props.shortYears ? 22 : 36) ? (props.shortYears ? String(y.year).slice(2) : y.year) : ""}
            </div>
          ))}
        </div>
        {props.caption && gutter > 0 && (
          <div className="timeline-caption" style={{ top: top - 26, width: gutter }}>
            {props.caption}
          </div>
        )}
        <div
          ref={scrollRef}
          className="timeline-scroll"
          style={{ top }}
          onScroll={(e) => {
            scrollTopRef.current = e.currentTarget.scrollTop;
            setHover(null);
            setScrollTop(e.currentTarget.scrollTop);
            redrawRef.current();
          }}
        >
          <div className="timeline-content" style={{ height: layout.bottom + LAYOUT.bottom + (props.footer ? 48 : 0) }}>
            {labels}
            {props.footer && (
              <div className="timeline-footer" style={{ top: layout.bottom + 16 }}>
                {props.footer}
              </div>
            )}
          </div>
        </div>
        {card && cardStyle && (
          <div className="hover-card" role="tooltip" style={cardStyle}>
            {card}
          </div>
        )}
      </div>
    </section>
  );
}

/** How many rows of a given height fit in a timeline of this height. */
export function rowsThatFit(height: number, row: number, gap: number, labelAbove = 0, markerSpace = 0): number {
  const free = height - rowsTop(markerSpace) - LAYOUT.bottom + gap;
  return Math.max(3, Math.floor(free / (row + gap + labelAbove)));
}
