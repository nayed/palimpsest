export type View = "overview" | "tracks" | "lines";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tracks", label: "Tracks" },
  { id: "lines", label: "Lines" },
];

/**
 * Wordmark, repository field and view tabs. Overview and Lines, and opening
 * other repositories, come in the next build step; until then their controls
 * are shown but inactive.
 */
export function Header({ repo, view }: { repo: string; view: View }) {
  return (
    <header className="header">
      <div className="wordmark">Palimpsest</div>
      <div className="repo-field">
        <label htmlFor="repo">Repository</label>
        <input id="repo" type="text" value={`github.com/${repo}`} readOnly spellCheck={false} />
      </div>
      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) =>
          v.id === view ? (
            <a key={v.id} href="/" aria-current="page" className="tab">
              {v.label}
            </a>
          ) : (
            <span key={v.id} className="tab" aria-disabled="true" title="Coming soon">
              {v.label}
            </span>
          ),
        )}
      </nav>
    </header>
  );
}
