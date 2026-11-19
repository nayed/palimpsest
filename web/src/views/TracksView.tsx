// Tracks, the home screen: one track per file, colored by who was writing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { shortenPath } from "../app/format";
import { DateDisplay } from "../components/DateDisplay";
import { Legend } from "../components/Legend";
import { Transport } from "../components/Transport";
import type { History } from "../data/history";
import type { Playback } from "../store/playback";
import { useStore } from "../store/store";
import { clipTexts } from "../timeline/notes";
import type { TrackRow } from "../timeline/renderer";
import { Timeline } from "../timeline/Timeline";
import { CommitFeed } from "./CommitFeed";
import { CurrentCommit } from "./CurrentCommit";
import { FileHistory } from "./FileHistory";

/** Characters of a 12px monospace path that fit in the 168px gutter. */
const LABEL_CHARS = 21;

function relativeTo(folder: string, path: string): string {
  const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

type StaticRow = Omit<TrackRow, "bornNow" | "dot">;

/** The parts of each file's track that do not depend on the playhead. */
export function fileTracks(h: History, files: number[]): StaticRow[] {
  return files.map((file) => {
    const clips = h.clipsOf(file).map((c) => ({
      ...c,
      rank: c.author < 0 ? 0 : h.rank(c.author),
      texts: clipTexts(h, file, c),
    }));
    const died = h.died(file);
    const last = clips[clips.length - 1];
    return {
      clips,
      died: died >= 0 ? h.commitTime(died) : null,
      deathNoted: died >= 0 && last !== undefined && last.author < 0,
    };
  });
}

/** Adds what the current commit changes: a birth label, a dot while playing. */
export function fileRows(
  h: History,
  files: number[],
  tracks: StaticRow[],
  commit: number,
  playing: boolean,
): TrackRow[] {
  const changed = new Set(h.changesIn(commit).map((c) => c.file));
  return tracks.map((t, i) => ({
    ...t,
    bornNow: h.born(files[i]!) === commit,
    dot: playing && changed.has(files[i]!),
  }));
}

export function TracksView({ playback }: { playback: Playback }) {
  const h = playback.history;
  const commit = useStore(playback.store, (s) => h.commitAt(s.time));
  const playing = useStore(playback.store, (s) => s.playing);
  const folder = useStore(playback.store, (s) => s.folder);
  const selected = useStore(playback.store, (s) => s.selectedFile);
  const [fit, setFit] = useState(0);

  const files = useMemo(() => (fit ? h.pickFiles(folder, fit) : []), [h, folder, fit]);

  // Select the most-committed file when nothing shown is selected.
  useEffect(() => {
    if (!files.length || files.includes(selected)) return;
    const busiest = [...files].sort((a, b) => h.data.files.commits[b]! - h.data.files.commits[a]!)[0]!;
    playback.store.set({ selectedFile: busiest });
  }, [files, selected, h, playback]);

  const tracks = useMemo(() => fileTracks(h, files), [h, files]);
  const buildRows = useCallback(
    (c: number, isPlaying: boolean) => fileRows(h, files, tracks, c, isPlaying),
    [h, files, tracks],
  );

  const changed = new Set(h.changesIn(commit).map((c) => c.file));
  const labels = files.map((file) => {
    const path = h.pathAt(file, Math.max(commit, h.born(file)));
    const classes = ["path-label"];
    if (file === selected && !playing) classes.push("selected");
    if (playing && changed.has(file)) classes.push("changed");
    if (!h.existsAt(file, commit)) classes.push("absent");
    return (
      <span className={classes.join(" ")} title={path}>
        {shortenPath(relativeTo(folder, path), LABEL_CHARS)}
      </span>
    );
  });

  return (
    <>
      <main className="upper">
        {playing || selected < 0 ? (
          <CommitFeed history={h} commit={commit} />
        ) : (
          <FileHistory history={h} file={selected} commit={commit} />
        )}
        <section className="panel panel-side">
          <DateDisplay playback={playback} />
          {!playing && <CurrentCommit history={h} commit={commit} />}
        </section>
      </main>
      <Transport playback={playback} />
      <div className="lower">
        <Legend history={h} />
        <Timeline
          playback={playback}
          labels={labels}
          buildRows={buildRows}
          onRowClick={(row) => {
            const file = files[row];
            if (file !== undefined) playback.store.set({ selectedFile: file });
          }}
          onFit={setFit}
          label="Files over time"
        />
      </div>
    </>
  );
}
