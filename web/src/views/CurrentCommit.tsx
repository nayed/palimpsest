import { formatCount, formatDate, plural } from "../app/format";
import { AuthorChip } from "../components/AuthorChip";
import type { History } from "../data/history";

/** The commit at the playhead: who, what, why, and how much it changed. */
export function CurrentCommit({ history, commit }: { history: History; commit: number }) {
  if (commit < 0) return null;
  const c = history.data.commits;
  const s = history.commitSummary(commit);
  if (history.isWindowStart(commit)) {
    return (
      <div className="current-commit">
        <AuthorChip history={history} author={c.author[commit]!} />
        <div>
          <div className="history-subject">{history.commitSubject(commit)}</div>
          <div className="history-detail">
            History before {formatDate(c.time[commit]!)} was not loaded. The {plural(s.files, "file")} already there are
            drawn as {history.authorName(c.author[commit]!)}.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="current-commit">
      <AuthorChip history={history} author={c.author[commit]!} />
      <div>
        <div className="history-subject">{c.subject[commit]}</div>
        <div className="history-detail">
          This commit changed {plural(s.files, "file")}, added {formatCount(s.added)} and deleted{" "}
          {formatCount(s.deleted)}.
        </div>
        {c.why[commit] && <p className="why">{c.why[commit]}</p>}
      </div>
    </div>
  );
}
