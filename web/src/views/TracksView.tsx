// Tracks, the home screen: one track per file, colored by who was writing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shortenPath } from "../app/format";
import { useViewKeys } from "../app/keys";
import { useLineHistory, type Session } from "../app/session";
import { AuthorChip } from "../components/AuthorChip";
import { DateDisplay } from "../components/DateDisplay";
import { Legend } from "../components/Legend";
import { Transport } from "../components/Transport";
import type { History } from "../data/history";
import { useStore } from "../store/store";
import { clipTexts } from "../timeline/notes";
import type { RowContent } from "../timeline/renderer";
import { Timeline, rowsThatFit } from "../timeline/Timeline";
import { CommitFeed } from "./CommitFeed";
import { CurrentCommit } from "./CurrentCommit";
import { CodeViewer, LineHistoryPanel, effectiveLine } from "./LinePanels";

const ROW = { desktop: 30, phone: 28 };
const GAP = { desktop: 4, phone: 8 };
const LABEL_ABOVE = 22;
const GUTTER = 168;
/** The hint under the tracks on a phone. */
const FOOTER = 48;
/** Characters of a 12px monospace path that fit in the gutter. */
const LABEL_CHARS = 21;

function relativeTo(folder: string, path: string): string {
  const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The parts of each file's track that do not depend on the playhead. */
export function fileTracks(h: History, files: number[]): RowContent[] {
  return files.map((file) => {
    const clips = h.clipsOf(file).map((c) => ({
      ...c,
      rank: c.author < 0 ? 0 : h.rank(c.author),
      texts: clipTexts(h, file, c),
    }));
    const died = h.died(file);
    const last = clips[clips.length - 1];
    return {
      style: "clips",
      clips,
      died: died >= 0 ? h.commitTime(died) : null,
      deathNoted: died >= 0 && last !== undefined && last.author < 0,
    };
  });
}

export function TracksView({ session }: { session: Session }) {
  const { playback, history: h, phone } = session;
  const store = playback.store;
  const commit = useStore(store, (s) => h.commitAt(s.time));
  const playing = useStore(store, (s) => s.playing);
  const folder = useStore(store, (s) => s.folder);
  const selected = useStore(store, (s) => s.selectedFile);
  const selectedLine = useStore(store, (s) => s.selectedLine);
  const [fit, setFit] = useState(0);
  const row = phone ? ROW.phone : ROW.desktop;
  const gap = phone ? GAP.phone : GAP.desktop;

  const files = useMemo(() => (fit ? h.pickFiles(folder, fit) : []), [h, folder, fit]);

  // With nothing shown selected, select the most-committed file that exists at
  // the playhead. A file picked this way, not by the person, is picked again
  // when playback stops or the playhead moves where it does not exist.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!files.length) return;
    if (files.includes(selected) && (playing || !autoPicked.current || h.existsAt(selected, commit))) return;
    const byCommits = [...files].sort((a, b) => h.data.files.commits[b]! - h.data.files.commits[a]!);
    const pick = byCommits.find((f) => h.existsAt(f, commit)) ?? byCommits[0]!;
    autoPicked.current = true;
    if (pick !== selected) store.set({ selectedFile: pick, selectedLine: -1 });
  }, [files, selected, h, store, playing, commit]);

  const tracks = useMemo(() => fileTracks(h, files), [h, files]);
  const heights = useMemo(() => files.map(() => row), [files, row]);
  const changed = useMemo(() => new Set(h.changesIn(commit).map((c) => c.file)), [h, commit]);
  const content = useCallback(
    (i: number, c: number, isPlaying: boolean): RowContent => {
      const file = files[i]!;
      const now = isPlaying && h.changesIn(c).some((ch) => ch.file === file);
      return { ...tracks[i]!, bornNow: h.born(file) === c, dot: now };
    },
    [h, files, tracks],
  );

  const select = (file: number) => {
    autoPicked.current = false;
    // A second click, or a tap on a phone, opens the file's lines.
    if (file === selected || phone) store.set({ selectedFile: file, view: "lines", selectedLine: -1 });
    else store.set({ selectedFile: file, selectedLine: -1 });
  };

  useViewKeys((e) => {
    const i = files.indexOf(selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = files[Math.min(files.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next !== undefined) {
        autoPicked.current = false;
        store.set({ selectedFile: next, selectedLine: -1 });
      }
      return true;
    }
    if (e.key === "Enter" && selected >= 0) {
      store.set({ view: "lines" });
      return true;
    }
    return false;
  });

  const lines = useLineHistory(session, phone || playing ? -1 : selected);
  const line = lines ? effectiveLine(lines, selectedLine, commit) : -1;

  const label = (i: number) => {
    const file = files[i]!;
    const path = h.pathAt(file, Math.max(commit, h.born(file)));
    const classes = ["path-label"];
    if (file === selected && !playing) classes.push("selected");
    if (playing && changed.has(file)) classes.push("changed");
    if (!h.existsAt(file, commit)) classes.push("absent");
    const status = !phone
      ? ""
      : h.died(file) >= 0 && h.died(file) <= commit
        ? ", deleted"
        : h.born(file) === commit
          ? ", new"
          : "";
    const shown = phone ? relativeTo(folder, path) : shortenPath(relativeTo(folder, path), LABEL_CHARS);
    return (
      <span className={classes.join(" ")} title={path}>
        {shown}
        {status}
      </span>
    );
  };

  const timeline = (
    <Timeline
      playback={playback}
      heights={heights}
      gap={gap}
      gutter={phone ? 0 : GUTTER}
      labelAbove={phone ? LABEL_ABOVE : 0}
      label={label}
      content={content}
      onRowClick={(i) => {
        const file = files[i];
        if (file !== undefined) select(file);
      }}
      onSize={(_, height) => setFit(rowsThatFit(height - (phone ? FOOTER : 0), row, gap, phone ? LABEL_ABOVE : 0))}
      revealRow={files.indexOf(selected)}
      shortYears={phone}
      name="Files over time"
      footer={phone ? <p className="caption">Drag the timeline to scrub. Tap a track to see its lines.</p> : undefined}
    />
  );

  if (phone) {
    const c = h.data.commits;
    return (
      <>
        {session.upper ?? (
          <section className="phone-upper">
            <DateDisplay playback={playback} />
            {commit >= 0 && (
              <div className="phone-commit">
                <AuthorChip history={h} author={c.author[commit]!} />
                <span>{c.subject[commit]}</span>
              </div>
            )}
          </section>
        )}
        <div className="lower tracks-lower">
          <Legend history={h} short />
          {timeline}
        </div>
        <Transport playback={playback} />
      </>
    );
  }

  return (
    <>
      {session.upper ?? (
        <>
          <main className="upper">
            {playing || selected < 0 ? (
              <CommitFeed history={h} commit={commit} />
            ) : (
              <section className="panel panel-main">
                <div className="panel-head">
                  <h2 className="panel-title mono">{h.pathAt(selected, Math.max(commit, h.born(selected)))}</h2>
                  <span className="caption">The file exactly as it was at the playhead</span>
                </div>
                <CodeViewer
                  history={h}
                  lines={lines}
                  commit={commit}
                  line={line}
                  onSelect={(id) => store.set({ selectedLine: id })}
                />
              </section>
            )}
            <section className="panel panel-side">
              <DateDisplay playback={playback} />
              {!playing && lines && line >= 0 ? (
                <LineHistoryPanel history={h} lines={lines} line={line} commit={commit} />
              ) : (
                !playing && <CurrentCommit history={h} commit={commit} />
              )}
            </section>
          </main>
        </>
      )}
      <Transport playback={playback} />
      <div className="lower">
        <Legend history={h} />
        {timeline}
      </div>
    </>
  );
}
