import { useEffect, useId, useRef, useState } from "react";
import { formatCount } from "../app/format";
import { ago, getRecent, type Recent } from "../app/recent";
import { parseRepoInput } from "../app/url";
import { DEMOS } from "../data/load";
import { ChevronDownIcon } from "./Icons";

interface Row {
  name: string;
  note: string;
}

/**
 * The repository field. Focusing it opens suggestions (the demos), recently
 * opened repositories, and the paste hint. Arrow keys move through the rows,
 * Enter opens, Escape closes. On a phone it is a compact button that opens
 * the same panel.
 */
export function RepoField({ repo, phone, onOpen }: { repo: string; phone: boolean; onOpen: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(`github.com/${repo}`);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => setText(`github.com/${repo}`), [repo]);

  const demos: Row[] = DEMOS.map((d, i) => ({
    name: d.name,
    note: i === 0 ? "the demo, loads instantly" : `${formatCount(d.commits)} commits`,
  }));
  const recents: Row[] = recent
    .filter((r) => !DEMOS.some((d) => d.name === r.name))
    .map((r) => ({ name: r.name, note: ago(r.at) }));
  const rows = [...demos, ...recents];

  const show = () => {
    setRecent(getRecent());
    setOpen(true);
    setActive(-1);
    setError("");
  };
  const close = () => {
    setOpen(false);
    setText(`github.com/${repo}`);
    setError("");
  };
  const choose = (name: string) => {
    setOpen(false);
    inputRef.current?.blur();
    onOpen(name);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) show();
      const n = rows.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) return choose(row.name);
      const name = parseRepoInput(text);
      if (name) choose(name);
      else setError("That does not look like a GitHub repository. Try owner/name.");
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      if (phone) setOpen(false);
    }
  };

  const panel = open && (
    <div className="menu repo-menu" id={listId} role="listbox" aria-label="Repositories">
      {phone && (
        <input
          ref={inputRef}
          className="repo-input"
          type="text"
          aria-label="Repository"
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <div className="menu-group">Try one of these</div>
      {demos.map((r, i) => (
        <MenuRow key={r.name} id={`${listId}-${i}`} row={r} active={active === i} onChoose={choose} />
      ))}
      {recents.length > 0 && (
        <>
          <div className="menu-separator" />
          <div className="menu-group">Recently opened</div>
          {recents.map((r, i) => (
            <MenuRow
              key={r.name}
              id={`${listId}-${demos.length + i}`}
              row={r}
              active={active === demos.length + i}
              onChoose={choose}
            />
          ))}
        </>
      )}
      <div className="menu-separator" />
      <div className={error ? "menu-hint error" : "menu-hint"}>
        {error || "Or paste any public GitHub URL and press Enter."}
      </div>
    </div>
  );

  if (phone) {
    return (
      <div className="repo-field phone" ref={rootRef}>
        <button type="button" className="repo-button" aria-expanded={open} onClick={() => (open ? close() : show())}>
          <span className="mono">{repo}</span>
          <ChevronDownIcon />
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div className="repo-field" ref={rootRef}>
      <label htmlFor="repo">Repository</label>
      <input
        ref={inputRef}
        id="repo"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={text}
        spellCheck={false}
        autoComplete="off"
        onFocus={show}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          setError("");
          if (!open) show();
        }}
        onKeyDown={onKeyDown}
      />
      {panel}
    </div>
  );
}

function MenuRow(props: { id: string; row: Row; active: boolean; onChoose: (name: string) => void }) {
  const { row, active, onChoose } = props;
  return (
    <button
      id={props.id}
      type="button"
      role="option"
      aria-selected={active}
      className={active ? "menu-row active" : "menu-row"}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onChoose(row.name)}
    >
      <span className="mono">github.com/{row.name}</span>
      <span className="menu-note">{row.note}</span>
    </button>
  );
}
