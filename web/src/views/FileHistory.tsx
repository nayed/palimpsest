import { formatDate, plural } from "../app/format";
import { AuthorChip } from "../components/AuthorChip";
import { ChangeKind } from "../data/format";
import type { History } from "../data/history";

/**
 * When paused: every commit that changed the selected file up to the
 * playhead, newest first, with why. The code viewer replaces this once the
 * per-file line history exists (build step 3).
 */
export function FileHistory({ history, file, commit }: { history: History; file: number; commit: number }) {
  const commits = history.commitsOf(file).filter((c) => c <= commit);
  const path = history.pathAt(file, Math.max(commit, history.born(file)));
  const notBorn = commit < history.born(file);
  const c = history.data.commits;

  const detail = (k: number) => {
    const change = history.changeOf(file, k);
    const date = formatDate(c.time[k]!);
    if (change?.kind === ChangeKind.Added) return `${date}. File created.`;
    if (change?.kind === ChangeKind.Deleted) return `${date}. File deleted.`;
    if (change?.kind === ChangeKind.Renamed) {
      const from = history.pathAt(file, k - 1);
      return `${date}. Moved from ${from}.`;
    }
    return c.why[k] ? `${date}. Why: ${c.why[k]}` : `${date}.`;
  };

  return (
    <section className="panel panel-main">
      <div className="panel-head">
        <h2 className="panel-title mono">{path}</h2>
        <span className="caption">Every commit that changed this file, up to the playhead</span>
      </div>
      <div className="well file-history">
        {notBorn ? (
          <p className="empty">Not written yet. It is born on {formatDate(c.time[history.born(file)]!)}.</p>
        ) : (
          <>
            <h3 className="subhead">Changed {plural(commits.length, "time")}</h3>
            <ol className="history-list">
              {[...commits].reverse().map((k) => (
                <li key={k} className="history-item">
                  <AuthorChip history={history} author={c.author[k]!} />
                  <div>
                    <div className="history-subject">{c.subject[k]}</div>
                    <div className="history-detail">{detail(k)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
