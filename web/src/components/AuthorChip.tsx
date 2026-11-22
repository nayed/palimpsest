import type { History } from "../data/history";
import { authorColor } from "./authorColor";

/** The author's initials on their color. Color is never the only cue. */
export function AuthorChip({ history, author }: { history: History; author: number }) {
  const rank = history.rank(author);
  return (
    <span
      className="chip"
      style={{ background: authorColor(rank) }}
      title={history.authorName(author)}
    >
      {history.initials(author)}
    </span>
  );
}

export function UntouchedChip() {
  return <span className="chip chip-untouched" aria-hidden="true" />;
}
