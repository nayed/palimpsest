import { describe, expect, it } from "vitest";
import { parseRepoInput, parseRoute, routeUrl } from "./url";

describe("routes", () => {
  it("parses the full form", () => {
    const r = parseRoute("/alacritty/alacritty", "?at=2026-03-12&view=lines&folder=src&file=src/lexer.ts&line=43");
    expect(r).toEqual({
      repo: "alacritty/alacritty",
      at: Date.UTC(2026, 2, 12) / 1000,
      view: "lines",
      folder: "src",
      file: "src/lexer.ts",
      line: 43,
    });
    expect(routeUrl(r)).toBe("/alacritty/alacritty?at=2026-03-12&view=lines&folder=src&file=src/lexer.ts&line=43");
  });

  it("defaults to the demo in Tracks and ignores nonsense", () => {
    expect(parseRoute("/", "")).toEqual({ repo: null, at: null, view: "tracks", folder: "", file: null, line: null });
    const r = parseRoute("/a/b", "?at=yesterday&view=map&line=-3");
    expect([r.at, r.view, r.line]).toEqual([null, "tracks", null]);
    expect(routeUrl({ ...r, repo: null })).toBe("/");
  });
});

describe("repository input", () => {
  it("accepts the common forms", () => {
    for (const s of [
      "github.com/BurntSushi/ripgrep",
      "https://github.com/BurntSushi/ripgrep",
      "https://github.com/BurntSushi/ripgrep.git",
      "BurntSushi/ripgrep",
      " https://github.com/BurntSushi/ripgrep/tree/master/crates ",
    ]) {
      expect(parseRepoInput(s)).toBe("BurntSushi/ripgrep");
    }
  });

  it("rejects what is not a repository", () => {
    for (const s of ["", "ripgrep", "https://gitlab.com/a/b", "a b/c"]) expect(parseRepoInput(s)).toBeNull();
  });
});
