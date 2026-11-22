// Panels about lines: the file as it was at the playhead (Tracks), and the
// history of the selected line (Tracks and Lines).

import { useEffect, useRef, useState } from "react";
import { formatDate, plural } from "../app/format";
import { AuthorChip } from "../components/AuthorChip";
import { CodeText } from "../components/CodeText";
import { syntaxOf } from "../data/tone";
import type { History } from "../data/history";
import { lineEvents, type LineHistory } from "../data/lines";

const CODE_ROW = 27;

/** The line to show when none is chosen: the most recently written one. */
export function effectiveLine(lines: LineHistory, selected: number, commit: number): number {
  if (selected >= 0 && selected < lines.count) return selected;
  return lines.latestChangedAt(commit);
}

/** The author of a line's version at a commit. */
export function lineAuthor(h: History, lines: LineHistory, line: number, commit: number): number {
  const c = lines.versionCommits[line]![lines.versionAt(line, commit)]!;
  return h.data.commits.author[c]!;
}

export function CodeViewer(props: {
  history: History;
  lines: LineHistory | null | undefined;
  commit: number;
  line: number;
  onSelect: (line: number) => void;
}) {
  const { history: h, lines, commit, line } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 300 });
  const ids = lines ? lines.linesAt(commit) : [];
  const index = ids.indexOf(line);

  // Bring the selected line into view, a few lines from the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || index < 0) return;
    const y = index * CODE_ROW;
    if (y < el.scrollTop || y + CODE_ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, y - 3 * CODE_ROW);
    }
  }, [index, lines]);

  if (lines === undefined) return <div className="well code empty">Reading the file’s history…</div>;
  if (lines === null) return <div className="well code empty">No line history for this file (binary or vendored).</div>;
  if (ids.length === 0) return <div className="well code empty">The file has no lines at this moment.</div>;

  const first = Math.max(0, Math.floor(scroll.top / CODE_ROW) - 5);
  const last = Math.min(ids.length, Math.ceil((scroll.top + scroll.height) / CODE_ROW) + 5);
  const width = String(ids.length).length;
  const syntax = syntaxOf(h.latestPath(lines.file));
  return (
    <div
      ref={scrollRef}
      className="well code"
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
    >
      <ol className="code-lines" style={{ height: ids.length * CODE_ROW }}>
        {ids.slice(first, last).map((id, k) => {
          const n = first + k;
          return (
            <li
              key={id}
              className={id === line ? "code-row selected" : "code-row"}
              style={{ top: n * CODE_ROW }}
              onClick={() => props.onSelect(id)}
            >
              <span className="code-number" style={{ minWidth: `${Math.max(2, width)}ch` }}>
                {n + 1}
              </span>
              <AuthorChip history={h} author={lineAuthor(h, lines, id, commit)} />
              <CodeText text={lines.textAt(id, commit)} syntax={syntax} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function LineHistoryPanel(props: {
  history: History;
  lines: LineHistory;
  line: number;
  commit: number;
  columns?: boolean;
}) {
  const { history: h, lines, line, commit } = props;
  if (line < 0) return null;
  const c = h.data.commits;
  const events = lineEvents(h, lines, line, commit);
  const number = lines.linesAt(commit).indexOf(line) + 1;
  const heading =
    lines.born[line]! > commit
      ? "This line is not written yet"
      : number > 0
        ? `Line ${number} has been touched ${plural(events.length, "time")}`
        : `This line was touched ${plural(events.length, "time")}`;

  const detail = (e: (typeof events)[number]) => {
    const date = formatDate(c.time[e.commit]!);
    switch (e.kind) {
      case "born":
        return h.isWindowStart(e.commit)
          ? `${date}. Already there when the loaded history starts.`
          : `${date}. Line first written.`;
      case "moved":
        return `${date}. Line unchanged, the file moved from ${e.from}.`;
      case "deleted":
        return `${date}. Line deleted.`;
      default:
        return c.why[e.commit] ? `${date}. Why: ${c.why[e.commit]}` : `${date}.`;
    }
  };

  return (
    <div className="line-history">
      <h3 className="subhead">{heading}</h3>
      <ol className={props.columns ? "history-list columns" : "history-list"}>
        {events.map((e) => (
          <li key={`${e.commit}-${e.kind}`} className="history-item">
            <AuthorChip history={h} author={c.author[e.commit]!} />
            <div>
              <div className="history-subject">{h.commitSubject(e.commit)}</div>
              <div className="history-detail">{detail(e)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
