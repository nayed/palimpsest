import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import type { Data } from "./format";
import { History } from "./history";
import { LineHistory, lineEvents, type LineFile } from "./lines";

// File 1 of the fixture: born in commit 0 with three lines, edited in 2.
const lf: LineFile = {
  format: "palimpsest-lines",
  version: 1,
  file: 1,
  commits: [0, 2, 3],
  opsStart: [0, 2, 10, 14],
  // 0: insert 3. 2: keep 1, rewrite 1, delete 1, insert 1. 3: delete 1, keep 2.
  ops: [2, 3, 0, 1, 3, 1, 1, 1, 2, 1, 1, 1, 0, 2],
  texts: ["a", "b", "c", "b2", "d"],
};

describe("LineHistory", () => {
  const lines = new LineHistory(lf);

  it("keeps every line ever, dead ones in place", () => {
    expect(lines.order).toEqual([0, 1, 2, 3]);
    expect(lines.born).toEqual([0, 0, 0, 2]);
    expect(lines.died).toEqual([3, -1, 2, -1]);
  });

  it("gives the file at any commit", () => {
    expect(lines.linesAt(0).map((l) => lines.textAt(l, 0))).toEqual(["a", "b", "c"]);
    expect(lines.linesAt(2).map((l) => lines.textAt(l, 2))).toEqual(["a", "b2", "d"]);
    expect(lines.linesAt(3).map((l) => lines.textAt(l, 3))).toEqual(["b2", "d"]);
  });

  it("tells a line's story, including the file's move", () => {
    const h = new History(fixture());
    expect(lineEvents(h, lines, 1, 3)).toEqual([
      { commit: 2, kind: "rewritten" },
      { commit: 2, kind: "moved", from: "src/core/lexer.rs" },
      { commit: 0, kind: "born" },
    ]);
    expect(lineEvents(h, lines, 0, 3)[0]).toEqual({ commit: 3, kind: "deleted" });
    expect(lines.latestChangedAt(2)).toBe(1);
  });
});

describe("alacritty line history", () => {
  const data = JSON.parse(readFileSync("public/data/alacritty/history.json", "utf8")) as Data;
  const h = new History(data);
  const file = h.pickFiles("", 1)[0]!;

  it("replays to the file's line count", () => {
    const lf = JSON.parse(readFileSync(`public/data/alacritty/lines/${file}.json`, "utf8")) as LineFile;
    const lines = new LineHistory(lf);
    const last = h.commitCount - 1;
    if (h.existsAt(file, last)) expect(lines.linesAt(last)).toHaveLength(data.files.lines[file]!);
    // Every line alive at some point has a text at that point.
    for (const id of lines.order) expect(typeof lines.textAt(id, lines.born[id]!)).toBe("string");
  });
});
