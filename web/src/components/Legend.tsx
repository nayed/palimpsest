import type { History } from "../data/history";
import { AuthorChip, UntouchedChip } from "./AuthorChip";

export function Legend({ history }: { history: History }) {
  return (
    <div className="legend">
      <span className="legend-title">Colored by who was writing</span>
      {history.rankedAuthors().map((a) => (
        <span key={a} className="legend-item">
          <AuthorChip history={history} author={a} />
          {history.authorName(a)}
        </span>
      ))}
      {history.hasOthers() && (
        <span className="legend-item">
          <span className="chip" style={{ background: "var(--author-others)" }} aria-hidden="true" />
          Others
        </span>
      )}
      <span className="legend-item">
        <UntouchedChip />
        Untouched
      </span>
    </div>
  );
}
