import { formatDate, plural, shortenPath } from "../app/format";
import { AuthorChip } from "../components/AuthorChip";
import type { History } from "../data/history";

const FADE = [1, 1, 0.85, 0.7, 0.55, 0.4];

/** While history plays: the current commit on top, older ones fading below. */
export function CommitFeed({ history, commit }: { history: History; commit: number }) {
  const rows: number[] = [];
  for (let c = commit; c >= 0 && rows.length < FADE.length; c--) rows.push(c);
  const commits = history.data.commits;
  return (
    <section className="panel panel-main">
      <div className="panel-head">
        <h2 className="panel-title">Commits going by</h2>
        <span className="caption">While history plays, this shows commits. Pause to read a file.</span>
      </div>
      <ol className="feed">
        {rows.map((c, i) => {
          const sole = history.soleFile(c);
          const what =
            sole === null ? plural(history.changesIn(c).length, "file") : shortenPath(history.pathAt(sole, c), 36);
          return (
            <li key={c} className={i === 0 ? "feed-row current" : "feed-row"} style={{ opacity: FADE[i] }}>
              <span className="feed-date">{formatDate(commits.time[c]!)}</span>
              <AuthorChip history={history} author={commits.author[c]!} />
              <span className="feed-subject">{commits.subject[c]}</span>
              <span className="feed-files">{what}</span>
            </li>
          );
        })}
        {rows.length === 0 && <li className="feed-row empty">No commits yet.</li>}
      </ol>
    </section>
  );
}
