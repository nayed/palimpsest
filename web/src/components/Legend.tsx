import type { History } from "../data/history";
import { AuthorChip, UntouchedChip } from "./AuthorChip";

/** `short` is the phone version: first names, no title. */
export function Legend({ history, short = false }: { history: History; short?: boolean }) {
  return (
    <div className="legend">
      {!short && <span className="legend-title">Colored by who was writing</span>}
      {history.rankedAuthors().map((a) => (
        <span key={a} className="legend-item">
          <AuthorChip history={history} author={a} />
          {short ? history.authorName(a).split(" ")[0] : history.authorName(a)}
        </span>
      ))}
      {history.hasOthers() && (
        <span className="legend-item">
          <span className="chip" style={{ background: "var(--author-others)" }} aria-hidden="true" />
          Others
        </span>
      )}
      {!short && (
        <span className="legend-item">
          <UntouchedChip />
          Untouched
        </span>
      )}
    </div>
  );
}
