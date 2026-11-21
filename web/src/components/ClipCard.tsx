// The card shown while a mouse rests on a clip: who was writing, when, and
// what happened in it.

import type { Clip, History } from "../data/history";
import { clipDates } from "../timeline/notes";
import { AuthorChip, UntouchedChip } from "./AuthorChip";

export function ClipCard({ history, clip, details }: { history: History; clip: Clip; details: string[] }) {
  const untouched = clip.author < 0;
  return (
    <>
      <div className="hover-card-head">
        {untouched ? <UntouchedChip /> : <AuthorChip history={history} author={clip.author} />}
        <span className="hover-card-name">{untouched ? "Untouched" : history.authorName(clip.author)}</span>
      </div>
      <div className="hover-card-dates">{clipDates(clip)}</div>
      {details.map((d, i) => (
        <p key={i} className={d.startsWith("“") ? "hover-card-detail quote" : "hover-card-detail"}>
          {d}
        </p>
      ))}
    </>
  );
}
