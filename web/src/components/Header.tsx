import type { View } from "../store/playback";
import { RepoField } from "./RepoField";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tracks", label: "Tracks" },
  { id: "lines", label: "Lines" },
];

/** Wordmark, repository field and view tabs. The tabs are links. */
export function Header(props: {
  repo: string;
  view: View | null;
  phone: boolean;
  href: (view: View) => string;
  onView: (view: View) => void;
  onOpenRepo: (name: string) => void;
}) {
  return (
    <header className="header">
      <div className="wordmark">Palimpsest</div>
      <RepoField repo={props.repo} phone={props.phone} onOpen={props.onOpenRepo} />
      {props.view && (
        <nav className="tabs" aria-label="Views">
          {VIEWS.map((v) => (
            <a
              key={v.id}
              href={props.href(v.id)}
              aria-current={v.id === props.view ? "page" : undefined}
              className="tab"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                props.onView(v.id);
              }}
            >
              {v.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
