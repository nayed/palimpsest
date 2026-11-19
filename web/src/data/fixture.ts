// A small hand-made history for tests. Times are days after 1 January 2020.

import type { Data } from "./format";

const DAY = 86_400;
export const T0 = Date.UTC(2020, 0, 1) / 1000;
export const day = (n: number) => T0 + n * DAY;

/**
 * Commits: 0 Ann adds a.rs and src/core/lexer.rs (day 0); 1 Bo edits a.rs
 * (day 40); 2 Bo moves lexer.rs to src/parser/ (day 400); 3 Ann adds
 * vendor/x.go and deletes a.rs (day 800). Ann has 2 commits, Bo 2.
 */
export function fixture(): Data {
  return {
    format: "palimpsest",
    version: 1,
    repo: { name: "test/repo", head: "f".repeat(40), commitCount: 4, start: day(0), end: day(800) },
    authors: {
      name: ["Ann Lee", "Bo Kim"],
      initials: ["AL", "BK"],
      commits: [2, 2],
      rank: [1, 2],
      bot: [false, false],
    },
    commits: {
      time: [day(0), day(40), day(400), day(800)],
      author: [0, 1, 1, 0],
      hash: ["aaaaaaa", "bbbbbbb", "ccccccc", "ddddddd"],
      subject: ["Start", "Edit a", "Move lexer", "Vendor and drop a"],
      why: ["", "Because.", "", ""],
    },
    paths: ["a.rs", "src/core/lexer.rs", "src/parser/lexer.rs", "vendor/x.go"],
    files: {
      born: [0, 0, 3],
      died: [3, -1, -1],
      commits: [3, 2, 1],
      lines: [10, 20, 500],
      vendored: [false, false, true],
      pathStart: [0, 1, 3, 4],
      pathCommit: [0, 0, 2, 3],
      path: [0, 1, 2, 3],
    },
    changes: {
      start: [0, 2, 3, 4, 6],
      file: [0, 1, 0, 1, 0, 2],
      kind: [0, 0, 1, 3, 2, 0],
      added: [10, 20, 2, 0, 0, 500],
      deleted: [0, 0, 1, 0, 10, 0],
    },
    clips: {
      start: [0, 2, 3, 4],
      from: [day(0), day(31), day(0), day(800)],
      to: [day(31), day(800), day(800), day(800)],
      author: [0, -1, 1, 0],
    },
    overview: { rows: [], firstMonthStart: day(0), monthStarts: [day(0)], moments: [] },
  };
}
