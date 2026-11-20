import { formatCount, formatDate } from "../app/format";
import type { Playback } from "../store/playback";
import { useStore } from "../store/store";

/** The date at the playhead, like a timecode, and the current commit. */
export function DateDisplay({ playback }: { playback: Playback }) {
  const h = playback.history;
  // Re-render once per day of history, not every frame.
  const day = useStore(playback.store, (s) => Math.floor(s.time / 86_400));
  const commit = useStore(playback.store, (s) => h.commitAt(s.time));
  return (
    <div className="date-display">
      <div className="date" aria-live="off">
        {formatDate(day * 86_400)}
      </div>
      <div className="commit-count">
        {commit < 0 ? (
          h.readFrom !== null ? "Not read yet" : "Before the first commit"
        ) : (
          <>
            Commit {formatCount(h.commitOffset + commit + 1)} of {formatCount(h.totalCommits)} ·{" "}
            <span className="mono">{h.data.commits.hash[commit]}</span>
          </>
        )}
      </div>
    </div>
  );
}
