// "Find a file": type part of a path, pick a file from the list, and Tracks
// pins and selects it. Matches any path the file ever had.

import { forwardRef, useId, useMemo, useState, type ReactNode } from "react";
import { formatDate, plural } from "../app/format";
import { findFiles } from "../data/find";
import type { History } from "../data/history";

/** The path with the matched part marked. */
function marked(path: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  const i = path.toLowerCase().lastIndexOf(q);
  if (!q || i < 0) return path;
  return (
    <>
      {path.slice(0, i)}
      <mark>{path.slice(i, i + q.length)}</mark>
      {path.slice(i + q.length)}
    </>
  );
}

/** "Apr 2019". */
function month(seconds: number): string {
  return formatDate(seconds).split(" ").slice(1).join(" ");
}

/**
 * What the file is called at the playhead, when that is not its latest path:
 * Tracks labels files by that name.
 */
export function nameAtPlayhead(h: History, file: number, commit: number): string {
  const born = h.born(file);
  const path = h.pathAt(file, Math.max(commit, born));
  if (born > commit) return `created in ${month(h.commitTime(born))}${path === h.latestPath(file) ? "" : ` as ${path}`}`;
  return path === h.latestPath(file) ? "" : `${path} on this date`;
}

export const FileFinder = forwardRef<
  HTMLInputElement,
  { history: History; commit: number; onPick: (file: number) => void }
>(function FileFinder({ history: h, commit, onPick }, ref) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  // Open the list upward when the window has no room for it below.
  const [up, setUp] = useState(false);
  const id = useId();
  const found = useMemo(() => findFiles(h, query), [h, query]);
  const shown = open && query.trim() !== "";

  const pick = (file: number, input: HTMLInputElement | null) => {
    onPick(file);
    setQuery("");
    setOpen(false);
    input?.blur();
  };

  return (
    <div className="file-finder">
      <input
        ref={ref}
        className="file-finder-input"
        type="search"
        placeholder="Find a file…"
        aria-label="Find a file"
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && found[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 340);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (found.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
          } else if (e.key === "Enter") {
            const f = found[active];
            if (f) pick(f.file, e.currentTarget);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
            e.currentTarget.blur();
          }
        }}
      />
      {shown && (
        <ul className={up ? "menu file-finder-list up" : "menu file-finder-list"} id={`${id}-list`} role="listbox" aria-label="Files found">
          {found.length === 0 && <li className="file-finder-empty">No file has “{query.trim()}” in its path.</li>}
          {found.map((f, i) => {
            const died = h.died(f.file);
            const now = nameAtPlayhead(h, f.file, commit);
            return (
              <li
                key={f.file}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "file-finder-option active" : "file-finder-option"}
                // Pick on press, before the field loses focus and closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(f.file, null);
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="file-finder-path">{marked(f.path, f.was ? "" : query)}</span>
                <span className="file-finder-meta">
                  {plural(h.data.files.commits[f.file]!, "commit")}
                  {died >= 0 && `, deleted in ${new Date(h.commitTime(died) * 1000).getUTCFullYear()}`}
                  {now && ` · ${now}`}
                  {f.was && !now.includes(f.was) && <> · was {marked(f.was, query)}</>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
