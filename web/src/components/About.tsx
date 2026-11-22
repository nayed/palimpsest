// The About button at the right of the header, and its panel: what this is,
// how to read the timeline, the keyboard shortcuts (not on phones), and where
// it comes from.

import { useEffect, useRef, useState } from "react";
import { formatBytes, formatCount, plural } from "../app/format";
import { clearStored, listStored, type StoredRepo } from "../worker/cache";
import { InfoIcon } from "./Icons";

const SOURCE = "https://github.com/nayed/palimpsest";
const AUTHOR = { name: "Nayed Saïd Ali", url: "https://github.com/nayed" };

const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Previous or next commit"],
  [["Shift", "←", "→"], "Back or forward a month"],
  [["1", "2", "3"], "Overview, Tracks, Lines"],
  [["↑", "↓"], "Move between rows"],
  [["Enter"], "Open the selected folder or file"],
  [["Esc"], "Back up one view"],
  [["/"], "Find a file in Tracks"],
];

/** How many lines of kept repositories are listed before "and n more". */
const LISTED = 4;

/**
 * Repositories downloaded and kept in this browser, so they open again
 * without a download, and a way to delete them.
 */
function KeptRepos() {
  const [kept, setKept] = useState<StoredRepo[] | null>(null);
  useEffect(() => {
    let live = true;
    void listStored().then((k) => live && setKept(k));
    return () => {
      live = false;
    };
  }, []);
  if (kept === null) return null;
  const total = kept.reduce((n, k) => n + k.bytes, 0);
  return (
    <>
      <h2 className="about-heading">Kept in this browser</h2>
      {kept.length === 0 ? (
        <p className="about-kept-none">No downloaded repositories are kept in this browser.</p>
      ) : (
        <div className="about-kept">
          <p>
            {plural(kept.length, "downloaded repository", "downloaded repositories")}, {formatBytes(total)}, so they open
            again without downloading. Only this browser has them.
          </p>
          <ul className="about-kept-list">
            {kept.slice(0, LISTED).map((k) => (
              <li key={k.repo}>
                <span className="mono">{k.repo}</span>
                <span>{formatBytes(k.bytes)}</span>
              </li>
            ))}
            {kept.length > LISTED && <li className="about-kept-more">and {formatCount(kept.length - LISTED)} more</li>}
          </ul>
          <button
            type="button"
            className="outlined-button"
            onClick={async () => {
              await clearStored();
              setKept(await listStored());
            }}
          >
            Delete them
          </button>
        </div>
      )}
    </>
  );
}

export function About({ phone }: { phone: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    // Captured, so Escape closes the panel rather than going up a view.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape, true);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div className="about">
      <button
        ref={buttonRef}
        type="button"
        className={open ? "about-button open" : "about-button"}
        aria-expanded={open}
        aria-controls="about-panel"
        aria-label={phone ? "About Palimpsest" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {phone ? <InfoIcon /> : "About"}
      </button>
      {open && (
        <div
          id="about-panel"
          ref={panelRef}
          className="menu about-panel"
          role="dialog"
          aria-label="About Palimpsest"
          tabIndex={-1}
        >
          <p className="about-lead">
            A git time machine: scrub through a repository’s history like a video, down to the single line.
          </p>

          <h2 className="about-heading">Reading it</h2>
          <ul className="about-list">
            <li>
              Each track is colored by who was writing it then. Authors after the top five share the{" "}
              <span className="chip about-chip" style={{ background: "var(--author-others)" }} aria-hidden="true" />{" "}
              Others gray.
            </li>
            <li>
              <span className="chip chip-untouched about-chip" aria-hidden="true" /> Hatched means nobody touched it for a
              year or more.
            </li>
            <li>The ticks under the years are releases. Everything right of the playhead is still to come.</li>
          </ul>

          {!phone && (
            <>
              <h2 className="about-heading">Keyboard</h2>
              <dl className="about-keys">
                {SHORTCUTS.map(([keys, action]) => (
                  <div key={action} className="about-key">
                    <dt>
                      {keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <KeptRepos />

          <p className="about-foot">
            Everything runs in your browser; nothing is stored on a server. Made by{" "}
            <a href={AUTHOR.url} target="_blank" rel="noreferrer">
              {AUTHOR.name}
            </a>
            .{" "}
            <a href={SOURCE} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            , MIT licensed.
          </p>
        </div>
      )}
    </div>
  );
}
