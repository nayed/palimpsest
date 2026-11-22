// Overview: the whole repository, one track per folder, taller for bigger
// folders, with who wrote the code that exists on the day.

import { useCallback, useMemo, useState } from "react";
import { formatDate, plural, formatCount } from "../app/format";
import { useViewKeys } from "../app/keys";
import type { Session } from "../app/session";
import { AuthorChip } from "../components/AuthorChip";
import { authorColor } from "../components/authorColor";
import { DateDisplay } from "../components/DateDisplay";
import { ChevronRightIcon } from "../components/Icons";
import { Legend } from "../components/Legend";
import { Transport } from "../components/Transport";
import { ChangeKind } from "../data/format";
import { CurrentCommit } from "./CurrentCommit";
import type { History } from "../data/history";
import { useStore } from "../store/store";
import { LAYOUT, rowsTop, type Marker, type RowContent } from "../timeline/renderer";
import { Timeline } from "../timeline/Timeline";
import { spanText } from "../timeline/notes";

const MIN_ROW = 44;
const GAP = 6;
const MARKER_SPACE = 26;
/** On a phone: folder names above their rows, thinner rows, a hint under them. */
const PHONE = { minRow: 14, gap: 4, labelAbove: 20, moments: 2 };
/** Notable moments drawn at once. */
const MOMENTS = 3;
/** A move of fewer files is not notable. */
const MIN_MOVED = 3;

/** "38k lines", or "gone 2019" for a folder that no longer exists. */
export function folderSize(lines: number, died: number | null): string {
  if (died !== null && lines === 0) return `gone ${new Date(died * 1000).getUTCFullYear()}`;
  return lines >= 1000 ? `${Math.round(lines / 1000)}k lines` : plural(lines, "line");
}

/** Row heights proportional to each folder's size today, at least `min` px. */
export function rowHeights(sizes: number[], available: number, min = MIN_ROW, gap = GAP): number[] {
  const total = sizes.reduce((s, n) => s + n, 0);
  const free = Math.max(0, available - gap * (sizes.length - 1));
  if (total === 0) return sizes.map(() => min);
  // Folders too small for the minimum get it; the rest share what is left by
  // size. Repeat until no shared row falls under the minimum.
  const small = sizes.map(() => false);
  let heights = sizes.map(() => min);
  for (let pass = 0; pass <= sizes.length; pass++) {
    const fixed = small.filter(Boolean).length * min;
    const bigTotal = sizes.reduce((s, n, i) => (small[i] ? s : s + n), 0);
    heights = sizes.map((n, i) => (small[i] || bigTotal === 0 ? min : ((free - fixed) * n) / bigTotal));
    const newlySmall = heights.map((h, i) => !small[i] && h < min);
    if (!newlySmall.some(Boolean)) break;
    newlySmall.forEach((v, i) => v && (small[i] = true));
  }
  return heights.map((h) => Math.floor(h));
}

/** "JW 38%" segments for who wrote the code alive at a month. */
export function shareAt(h: History, month: number): { author: number | null; rank: number; share: number }[] {
  const s = h.data.overview.share;
  const out = new Map<number, number>(); // rank -> lines; 0 = Others
  let total = 0;
  const representative = new Map<number, number>();
  for (let k = s.start[month] ?? 0; k < (s.start[month + 1] ?? 0); k++) {
    const rank = h.rank(s.author[k]!);
    out.set(rank, (out.get(rank) ?? 0) + s.lines[k]!);
    representative.set(rank, s.author[k]!);
    total += s.lines[k]!;
  }
  if (!total) return [];
  return [...out.entries()]
    .sort((a, b) => (a[0] || 99) - (b[0] || 99))
    .map(([rank, n]) => ({ author: rank ? representative.get(rank)! : null, rank, share: n / total }));
}

function monthIndex(h: History, time: number): number {
  const starts = h.data.overview.monthStarts;
  let m = 0;
  while (m + 1 < starts.length - 1 && starts[m + 1]! <= time) m++;
  return m;
}

/** `title` false leaves out the heading (phone); the bar keeps it as its name. */
function ShareBar({ history: h, time, title = true }: { history: History; time: number; title?: boolean }) {
  const parts = shareAt(h, monthIndex(h, time));
  const heading = "Who wrote the code that exists on this day";
  return (
    <div className="share">
      {title && <h2 className="panel-title">{heading}</h2>}
      <div className="share-bar" role="group" aria-label={heading}>
        {parts.map((p) => {
          const pct = Math.round(p.share * 100);
          const who = p.author === null ? "Others" : p.author === h.earlierAuthor ? "Earlier" : h.initials(p.author);
          const label = `${who} ${pct}%`;
          return (
            <div
              key={p.rank}
              className="share-part"
              style={{
                flexGrow: p.share,
                background: authorColor(p.rank),
              }}
              title={`${p.author === null ? "Others" : h.authorName(p.author)}: ${pct}%`}
            >
              {pct >= 6 && <span className="share-label">{label}</span>}
            </div>
          );
        })}
        {parts.length === 0 && (
          <div className="share-empty">{h.data.repo.lineHistory ? "No code yet." : "Working it out…"}</div>
        )}
      </div>
    </div>
  );
}

function CommitFiles({ session, commit }: { session: Session; commit: number }) {
  const h = session.history;
  const store = session.playback.store;
  if (commit < 0) return null;
  const c = h.data.commits;
  const s = h.commitSummary(commit);
  const changes = h.changesIn(commit).slice(0, 6);
  const more = h.changesIn(commit).length - changes.length;
  if (h.isWindowStart(commit)) {
    return (
      <section className="panel panel-wide">
        <CurrentCommit history={h} commit={commit} />
      </section>
    );
  }
  return (
    <section className="panel panel-wide">
      <div className="current-commit plain">
        <AuthorChip history={h} author={c.author[commit]!} />
        <div>
          <div className="history-subject large">{c.subject[commit]}</div>
          <div className="history-detail">
            This commit changed {plural(s.files, "file")}, added {formatCount(s.added)} and deleted {formatCount(s.deleted)}.
          </div>
        </div>
      </div>
      <ul className="commit-files">
        {changes.map((ch) => {
          const path = h.pathAt(ch.file, ch.kind === ChangeKind.Deleted ? commit - 1 : commit);
          const open = () => store.set({ selectedFile: ch.file, selectedLine: -1, view: ch.kind === ChangeKind.Deleted ? "tracks" : "lines" });
          const note =
            ch.kind === ChangeKind.Added
              ? "born"
              : ch.kind === ChangeKind.Deleted
                ? `deleted after ${spanText(h.commitTime(commit) - h.commitTime(h.born(ch.file)))}`
                : ch.kind === ChangeKind.Renamed
                  ? `moved from ${h.pathAt(ch.file, commit - 1)}`
                  : "changed, see lines";
          return (
            <li key={ch.file}>
              <button type="button" className={ch.kind === ChangeKind.Deleted ? "file-row deleted" : "file-row"} onClick={open}>
                <span className="mono file-path">{path}</span>
                <span className={ch.kind === ChangeKind.Modified ? "file-note highlight" : "file-note"}>{note}</span>
              </button>
            </li>
          );
        })}
        {more > 0 && <li className="file-more">and {plural(more, "more file")}</li>}
      </ul>
    </section>
  );
}

export function OverviewView({ session }: { session: Session }) {
  const { playback, history: h, phone } = session;
  const store = playback.store;
  const commit = useStore(store, (s) => h.commitAt(s.time));
  const day = useStore(store, (s) => Math.floor(s.time / 86_400) * 86_400);
  const selectedRow = useStore(store, (s) => s.selectedRow);
  const [height, setHeight] = useState(0);
  const rows = h.data.overview.rows;

  const heights = useMemo(() => {
    const sizes = rows.map((r) => r.lines || r.peakLines * 0.15);
    if (phone) {
      const available =
        height - rowsTop(MARKER_SPACE) - LAYOUT.bottom - rows.length * PHONE.labelAbove;
      return rowHeights(sizes, Math.max(available, rows.length * PHONE.minRow), PHONE.minRow, PHONE.gap);
    }
    const available = height - rowsTop(MARKER_SPACE) - LAYOUT.bottom;
    return rowHeights(sizes, Math.max(available, rows.length * MIN_ROW));
  }, [rows, height, phone]);

  const contents = useMemo(
    () =>
      rows.map(
        (r): RowContent => ({
          style: "silhouette",
          sizes: r.sizes,
          peak: r.peakLines,
          clips: r.clips.from.map((from, k) => {
            const author = r.clips.author[k]!;
            return {
              from,
              to: r.clips.to[k]!,
              author,
              rank: author < 0 ? 0 : h.rank(author),
              texts: [author < 0 ? "untouched" : h.initials(author)],
            };
          }),
        }),
      ),
    [rows, h],
  );
  const content = useCallback((i: number) => contents[i]!, [contents]);

  const markers = useMemo((): Marker[] => {
    // The most notable moments, far enough apart for their labels.
    const apart = (h.end - h.start) * 0.15;
    const chosen: typeof h.data.overview.moments = [];
    for (const m of h.data.overview.moments) {
      if (m.kind === "move" && m.files < MIN_MOVED) continue;
      const t = h.commitTime(m.commit);
      if (chosen.length < (phone ? PHONE.moments : MOMENTS) && chosen.every((c) => Math.abs(h.commitTime(c.commit) - t) > apart)) chosen.push(m);
    }
    return chosen.map((m) => {
      const t = h.commitTime(m.commit);
      const date = formatDate(t).split(" ").slice(1).join(" ").toUpperCase();
      const text =
        m.kind === "folderBorn"
          ? `${m.folder}/ appears`
          : m.files === 1 && m.example
            ? `${m.example.split("/").pop()} moves from ${m.from || "the top"}/ to ${m.folder}/`
            : `files move from ${m.from || "the top"}/ to ${m.folder}/`;
      return { time: t, date, text };
    });
  }, [h, phone]);

  const open = (i: number) => {
    const r = rows[i];
    if (!r) return;
    store.set({ folder: r.folder ?? "", view: "tracks", selectedRow: i, selectedFile: -1 });
  };

  useViewKeys((e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = Math.min(rows.length - 1, Math.max(0, selectedRow + (e.key === "ArrowDown" ? 1 : -1)));
      store.set({ selectedRow: next });
      return true;
    }
    if (e.key === "Enter" && selectedRow >= 0) {
      open(selectedRow);
      return true;
    }
    return false;
  });

  const label = (i: number) => (
    <span className={i === selectedRow ? "folder-label selected" : "folder-label"}>
      <span className="mono">{rows[i]!.label}</span>
      <ChevronRightIcon />
      {phone && <span className="folder-size">{folderSize(rows[i]!.lines, rows[i]!.died)}</span>}
    </span>
  );

  if (phone) {
    const c = h.data.commits;
    return (
      <>
        {session.upper ?? (
          <section className="phone-upper">
            <DateDisplay playback={playback} />
            <ShareBar history={h} time={day + 86_399} title={false} />
            {commit >= 0 && (
              <div className="phone-commit">
                <AuthorChip history={h} author={c.author[commit]!} />
                <span>{h.commitSubject(commit)}</span>
              </div>
            )}
          </section>
        )}
        <div className="lower tracks-lower">
          <Legend history={h} short />
          <Timeline
            playback={playback}
            heights={heights}
            gap={PHONE.gap}
            gutter={0}
            labelAbove={PHONE.labelAbove}
            label={label}
            content={content}
            markers={markers}
            markerSpace={MARKER_SPACE}
            monthStarts={h.data.overview.monthStarts}
            onRowClick={open}
            onSize={(_, hh) => setHeight(hh)}
            revealRow={selectedRow}
            shortYears
            name="Folders over time"
          />
        </div>
        <Transport playback={playback} />
      </>
    );
  }

  return (
    <>
      {session.upper ?? (
        <>
          <main className="upper overview-upper">
            <section className="panel panel-date">
              <DateDisplay playback={playback} />
              <ShareBar history={h} time={day + 86_399} />
            </section>
            <CommitFiles session={session} commit={commit} />
          </main>
        </>
      )}
      <Transport playback={playback} />
      <div className="lower">
        <Legend history={h} />
        <Timeline
          playback={playback}
          heights={heights}
          gap={GAP}
          gutter={168}
          label={label}
          content={content}
          markers={markers}
          markerSpace={MARKER_SPACE}
          monthStarts={h.data.overview.monthStarts}
          caption="Taller track, bigger folder"
          onRowClick={open}
          onSize={(_, hh) => setHeight(hh)}
          revealRow={selectedRow}
          name="Folders over time"
        />
      </div>
    </>
  );
}
