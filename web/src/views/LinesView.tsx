// Lines: one file, one track per line it ever had. The color changes where
// someone rewrote the line; deleted lines stay, struck through.

import { useCallback, useMemo, useRef, useState } from "react";
import { formatDate } from "../app/format";
import { useViewKeys } from "../app/keys";
import { useLineHistory, type Session } from "../app/session";
import { DateDisplay } from "../components/DateDisplay";
import { ChevronLeftIcon } from "../components/Icons";
import { Legend } from "../components/Legend";
import { Transport } from "../components/Transport";
import type { Clip, History } from "../data/history";
import type { LineHistory } from "../data/lines";
import { useStore } from "../store/store";
import { ClipCard } from "../components/ClipCard";
import { authorColor } from "../components/authorColor";
import { CodeText } from "../components/CodeText";
import { syntaxOf } from "../data/tone";
import { clipAt, commitsInClip, dirOf } from "../timeline/notes";
import type { Marker, RowContent, TrackClip } from "../timeline/renderer";
import { Timeline } from "../timeline/Timeline";
import { LineHistoryPanel, effectiveLine, lineAuthor } from "./LinePanels";

const ROW = 24;
const GAP = 3;
/** On a phone: each line's code above its track. */
const PHONE = { row: 14, gap: 6, labelAbove: 22 };

/** A line's track: one clip per stretch of the same author. */
export function lineClips(h: History, lines: LineHistory, line: number): TrackClip[] {
  const commits = lines.versionCommits[line]!;
  const died = lines.died[line]!;
  const end = died >= 0 ? h.commitTime(died) : h.end;
  const out: TrackClip[] = [];
  commits.forEach((c, v) => {
    const author = h.changeAuthor(lines.file, c);
    const from = h.commitTime(c);
    const to = v + 1 < commits.length ? h.commitTime(commits[v + 1]!) : end;
    const last = out[out.length - 1];
    if (last && last.author === author) last.to = to;
    else out.push({ from, to, author, rank: h.rank(author), texts: [] });
  });
  return out.filter((c) => c.to > c.from || c.to === end);
}

/** What the hover card says about a line's clip: its commits and why the first was made. */
export function lineClipDetails(h: History, lines: LineHistory, line: number, clip: Clip): string[] {
  const commits = commitsInClip(h, lines.versionCommits[line]!, clip);
  const first = commits[0];
  if (first === undefined) return [];
  if (h.isWindowStart(first)) {
    const later = commits.length - 1;
    return [
      later === 0
        ? "Already there when the loaded history starts"
        : `Already there when the loaded history starts, then edited ${later === 1 ? "once" : `${later} times`}`,
    ];
  }
  const born = first === lines.versionCommits[line]![0];
  const out = [
    commits.length === 1
      ? born ? "Wrote the line" : "Rewrote the line"
      : `${born ? "Wrote" : "Rewrote"} the line, then edited it ${commits.length === 2 ? "once" : `${commits.length - 1} times`}`,
  ];
  const subject = h.data.commits.subject[first];
  if (subject) out.push(`“${subject}”`);
  return out;
}

/** Moves of the file, as dashed markers. */
export function moveMarkers(h: History, file: number): Marker[] {
  const paths = h.pathsOf(file);
  const out: Marker[] = [];
  for (let k = 1; k < paths.length; k++) {
    const t = h.commitTime(paths[k]!.commit);
    const before = paths[k - 1]!.path;
    const after = paths[k]!.path;
    const text = dirOf(before) === dirOf(after) ? `file renamed from ${before.split("/").pop()}` : `file moves to ${dirOf(after) || "the top"}/`;
    out.push({ time: t, date: formatDate(t).split(" ").slice(1).join(" ").toUpperCase(), text });
  }
  return out;
}

function LinesTimeline({
  session,
  lines,
  onPick,
}: {
  session: Session;
  lines: LineHistory;
  /** Called when a line is tapped or clicked, after it is selected. */
  onPick?: () => void;
}) {
  const { playback, history: h, phone } = session;
  const store = playback.store;
  const commit = useStore(store, (s) => h.commitAt(s.time));
  const selectedLine = useStore(store, (s) => s.selectedLine);
  const [width, setWidth] = useState(0);
  const line = effectiveLine(lines, selectedLine, commit);
  const alive = useMemo(() => lines.linesAt(commit), [lines, commit]);
  const numbers = useMemo(() => new Map(alive.map((id, i) => [id, i + 1])), [alive]);
  const clips = useMemo(() => lines.order.map((id) => lineClips(h, lines, id)), [h, lines]);
  const content = useCallback((i: number): RowContent => ({ style: "plain", clips: clips[i]! }), [clips]);
  const markers = useMemo(() => moveMarkers(h, lines.file), [h, lines.file]);
  const heights = useMemo(() => lines.order.map(() => (phone ? PHONE.row : ROW)), [lines, phone]);
  const syntax = useMemo(() => syntaxOf(h.latestPath(lines.file)), [h, lines.file]);

  useViewKeys((e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const i = lines.order.indexOf(line);
      const next = lines.order[Math.min(lines.count - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next !== undefined) store.set({ selectedLine: next });
      return true;
    }
    return false;
  });

  const hoverCard = (i: number, time: number) => {
    const id = lines.order[i]!;
    const clip = clipAt(clips[i]!, time);
    return clip ? <ClipCard history={h} clip={clip} details={lineClipDetails(h, lines, id, clip)} /> : null;
  };

  const label = (i: number) => {
    const id = lines.order[i]!;
    const born = lines.born[id]!;
    const died = lines.died[id]!;
    const future = born > commit;
    const dead = died >= 0 && died <= commit;
    const n = numbers.get(id);
    const author = lineAuthor(h, lines, id, commit);
    const rank = h.rank(author);
    const classes = ["line-label"];
    if (id === line) classes.push("selected");
    if (future || dead) classes.push("absent");
    return (
      <span className={classes.join(" ")}>
        <span className="code-number">{n ?? ""}</span>
        <span
          className="chip"
          style={{
            background: future || dead ? "var(--former-author-chip)" : authorColor(rank),
          }}
          title={h.authorName(author)}
        >
          {h.initials(author)}
        </span>
        <CodeText text={lines.textAt(id, commit)} syntax={syntax} className={dead ? "code-text struck" : "code-text"} />
        {dead && (
          <span className="line-note">
            {phone ? "del." : "deleted in"} {new Date(h.commitTime(died) * 1000).getUTCFullYear()}
          </span>
        )}
        {future && <span className="line-note">not written yet</span>}
      </span>
    );
  };

  return (
    <Timeline
      playback={playback}
      heights={heights}
      gap={phone ? PHONE.gap : GAP}
      gutter={phone ? 0 : Math.round(width * 0.44)}
      labelAbove={phone ? PHONE.labelAbove : 0}
      label={label}
      content={content}
      hoverCard={phone ? undefined : hoverCard}
      markers={markers}
      markerSpace={markers.length ? 24 : 18}
      caption="One track per line. The color changes where someone rewrote it."
      onRowClick={(i) => {
        store.set({ selectedLine: lines.order[i]! });
        onPick?.();
      }}
      onSize={(w) => setWidth(w)}
      revealRow={lines.order.indexOf(line)}
      shortYears={phone}
      name="Lines over time"
    />
  );
}

/**
 * On a phone, the selected line's story in a sheet above the controls. The
 * handle hides it, by a tap or a swipe down; tapping a line brings it back.
 */
function LineSheet({ children, onHide }: { children: React.ReactNode; onHide: () => void }) {
  const start = useRef<number | null>(null);
  return (
    <section className="line-sheet" aria-label="Line history">
      <button
        type="button"
        className="sheet-handle"
        aria-label="Hide the line history"
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const moved = start.current === null ? 0 : e.clientY - start.current;
          start.current = null;
          // A tap or a swipe down hides it; a swipe up does nothing.
          if (moved > 24 || Math.abs(moved) < 8) onHide();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onHide();
          }
        }}
      >
        <span aria-hidden="true" />
      </button>
      <div className="line-sheet-body">{children}</div>
    </section>
  );
}

export function LinesView({ session }: { session: Session }) {
  const { playback, history: h, phone } = session;
  const [sheet, setSheet] = useState(true);
  const store = playback.store;
  const commit = useStore(store, (s) => h.commitAt(s.time));
  const file = useStore(store, (s) => s.selectedFile);
  const selectedLine = useStore(store, (s) => s.selectedLine);
  const lines = useLineHistory(session, file);
  const line = lines ? effectiveLine(lines, selectedLine, commit) : -1;
  const path = file >= 0 ? h.pathAt(file, Math.max(commit, h.born(file))) : "";

  if (phone) {
    return (
      <>
        {session.upper ?? (
          <section className="phone-upper lines-phone-upper">
            <DateDisplay playback={playback} />
            {file >= 0 && (
              <button type="button" className="back-button" onClick={() => store.set({ view: "tracks" })}>
                <ChevronLeftIcon />
                <span className="mono">{path.split("/").pop()}</span>
              </button>
            )}
          </section>
        )}
        <div className="lower tracks-lower">
          {lines ? (
            <LinesTimeline session={session} lines={lines} onPick={() => setSheet(true)} />
          ) : (
            <p className="timeline-message">
              {file < 0
                ? "Pick a file in Tracks to see its lines."
                : lines === undefined
                  ? "Reading the file’s history…"
                  : "This file has no line history: it is binary or vendored."}
            </p>
          )}
        </div>
        {sheet && lines && line >= 0 && (
          <LineSheet onHide={() => setSheet(false)}>
            <LineHistoryPanel history={h} lines={lines} line={line} commit={commit} />
          </LineSheet>
        )}
        <Transport playback={playback} />
      </>
    );
  }

  return (
    <>
      {session.upper ?? (
        <>
          <main className="upper lines-upper">
            <section className="panel panel-date">
              <DateDisplay playback={playback} />
              {file >= 0 && (
                <button type="button" className="back-button" onClick={() => store.set({ view: "tracks" })}>
                  <ChevronLeftIcon />
                  <span className="mono">{path}</span>
                </button>
              )}
            </section>
            <section className="panel panel-wide">
              {lines && line >= 0 && <LineHistoryPanel history={h} lines={lines} line={line} commit={commit} columns />}
              {lines === null && <p className="caption">This file has no line history: it is binary or vendored.</p>}
              {file < 0 && <p className="caption">Pick a file in Tracks to see its lines.</p>}
            </section>
          </main>
        </>
      )}
      <Transport playback={playback} />
      <div className="lower">
        <Legend history={h} />
        {lines ? (
          <LinesTimeline session={session} lines={lines} />
        ) : (
          <p className="timeline-message">{lines === undefined ? "Reading the file’s history…" : ""}</p>
        )}
      </div>
    </>
  );
}
