import { describe, expect, it } from "vitest";
import { nameAtPlayhead } from "../components/FileFinder";
import { findFiles } from "./find";
import { fixture } from "./fixture";
import { History } from "./history";

describe("finding a file", () => {
  const h = new History(fixture());

  it("matches part of the latest path, ignoring case", () => {
    expect(findFiles(h, "LEXER")).toEqual([{ file: 1, path: "src/parser/lexer.rs" }]);
    expect(findFiles(h, "  ")).toEqual([]);
    expect(findFiles(h, "nothing")).toEqual([]);
  });

  it("matches a path the file had before", () => {
    expect(findFiles(h, "core/")).toEqual([{ file: 1, path: "src/parser/lexer.rs", was: "src/core/lexer.rs" }]);
  });

  it("puts busier files and file-name matches first", () => {
    // a.rs: 3 commits, name match. lexer.rs: 2, name match. vendor/x.go: 1, folder match.
    expect(findFiles(h, "r").map((f) => f.file)).toEqual([0, 1, 2]);
    expect(findFiles(h, "r", 2)).toHaveLength(2);
  });

  it("say what a file is called at the playhead when that is not its latest path", () => {
    expect(nameAtPlayhead(h, 1, 0)).toBe("src/core/lexer.rs on this date");
    expect(nameAtPlayhead(h, 1, 2)).toBe("");
    expect(nameAtPlayhead(h, 2, 0)).toBe("created in Mar 2022");
  });
});
