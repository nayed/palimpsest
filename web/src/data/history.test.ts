import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { day, fixture } from "./fixture";
import type { Data } from "./format";
import { History } from "./history";

describe("History", () => {
  const h = new History(fixture());

  it("rejects other formats and versions", () => {
    expect(() => new History({ ...fixture(), version: 2 })).toThrow(/Unsupported/);
  });

  it("finds the commit at a time", () => {
    expect(h.commitAt(day(0) - 1)).toBe(-1);
    expect(h.commitAt(day(0))).toBe(0);
    expect(h.commitAt(day(39))).toBe(0);
    expect(h.commitAt(day(40))).toBe(1);
    expect(h.commitAt(day(10_000))).toBe(3);
  });

  it("follows a file across a move", () => {
    expect(h.pathAt(1, 1)).toBe("src/core/lexer.rs");
    expect(h.pathAt(1, 2)).toBe("src/parser/lexer.rs");
    expect(h.latestPath(1)).toBe("src/parser/lexer.rs");
    expect(h.commitsOf(1)).toEqual([0, 2]);
  });

  it("knows when a file exists", () => {
    expect(h.existsAt(0, 0)).toBe(true);
    expect(h.existsAt(0, 3)).toBe(false);
    expect(h.existsAt(2, 2)).toBe(false);
  });

  it("summarizes a commit", () => {
    expect(h.commitSummary(3)).toEqual({ files: 2, added: 500, deleted: 10 });
    expect(h.soleFile(1)).toBe(0);
    expect(h.soleFile(0)).toBeNull();
  });

  it("picks the most-committed files, leaving out vendored ones, in order of birth", () => {
    expect(h.pickFiles("", 10)).toEqual([0, 1]);
    expect(h.pickFiles("", 1)).toEqual([0]);
    expect(h.pickFiles("src", 10)).toEqual([1]);
    expect(h.pickFiles("src/parser/", 10)).toEqual([1]);
    expect(h.pickFiles("docs", 10)).toEqual([]);
  });

  it("lists ranked authors and whether there are Others", () => {
    expect(h.rankedAuthors()).toEqual([0, 1]);
    expect(h.hasOthers()).toBe(false);
  });
});

describe("the alacritty demo data", () => {
  const data = JSON.parse(readFileSync("public/data/alacritty/history.json", "utf8")) as Data;
  const h = new History(data);

  it("loads", () => {
    expect(h.data.repo.name).toBe("alacritty/alacritty");
    expect(h.rankedAuthors()).toHaveLength(5);
  });

  it("keeps the Tracks file list stable and free of lock files", () => {
    const files = h.pickFiles("", 12);
    expect(files).toHaveLength(12);
    expect(files.map((f) => h.latestPath(f))).not.toContain("Cargo.lock");
    expect(h.pickFiles("", 12)).toEqual(files);
  });

  it("finds every commit by its own time", () => {
    const t = h.data.commits.time;
    for (let c = 0; c < h.commitCount; c++) {
      // The last commit sharing this second.
      let last = c;
      while (t[last + 1] === t[c]) last++;
      expect(h.commitAt(t[c]!)).toBe(last);
    }
  });
});

describe("a window of history", () => {
  /** The fixture as if only its history from the first commit on were loaded. */
  function windowed(): History {
    const d = fixture();
    d.authors.name.push("Earlier history");
    d.authors.initials.push("");
    d.authors.commits.push(0);
    d.authors.rank.push(6);
    d.authors.bot.push(false);
    d.repo.earlierAuthor = 2;
    d.commits.author[0] = 2;
    return new History(d);
  }

  it("names the code already there by when the window starts", () => {
    const h = windowed();
    expect(h.earlierAuthor).toBe(2);
    expect(h.authorName(2)).toBe("Before Jan 2020");
    expect(h.rank(2)).toBe(6);
    expect(h.rankedAuthors()).toEqual([0, 1]);
  });

  it("says what the first commit stands for", () => {
    const h = windowed();
    expect(h.isWindowStart(0)).toBe(true);
    expect(h.isWindowStart(1)).toBe(false);
    expect(h.commitSubject(0)).toBe("The loaded history starts here");
    expect(h.commitSubject(1)).toBe("Edit a");
    expect(new History(fixture()).isWindowStart(0)).toBe(false);
  });
});

describe("who wrote a change", () => {
  it("is the change's own author when the data has one, else the commit's", () => {
    const d = fixture();
    expect(new History(d).changeAuthor(1, 2)).toBe(1);
    // Commit 2 (by Bo) moved file 1; say a merge credited Ann with it.
    d.changes.author = d.changes.file.map((_, k) => (k === 3 ? 0 : d.commits.author[d.changes.start.findIndex((s) => s > k) - 1]!));
    const h = new History(d);
    expect(h.changeAuthor(1, 2)).toBe(0);
    expect(h.changesIn(2)[0]!.author).toBe(0);
    expect(h.changeAuthor(0, 0)).toBe(0);
  });
});
