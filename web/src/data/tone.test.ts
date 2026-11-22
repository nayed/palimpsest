import { describe, expect, it } from "vitest";
import { syntaxOf, tones } from "./tone";

const t = (text: string, path: string) => tones(text, syntaxOf(path)).map((p) => [p.tone, p.text]);

describe("quiet tones of code", () => {
  it("mutes line comments, after the code before them", () => {
    expect(t('    let x = 1; // the "answer"', "a.rs")).toEqual([
      ["code", "    let x = 1; "],
      ["comment", '// the "answer"'],
    ]);
    expect(t("name = 'x'  # why", "a.py")).toEqual([
      ["code", "name = "],
      ["string", "'x'"],
      ["code", "  "],
      ["comment", "# why"],
    ]);
  });

  it("does not see comments inside strings", () => {
    expect(t('fetch("http://a/b") // go', "a.ts")).toEqual([
      ["code", "fetch("],
      ["string", '"http://a/b"'],
      ["code", ") "],
      ["comment", "// go"],
    ]);
  });

  it("knows block comments on one line, and doc-comment lines starting with *", () => {
    expect(t("a /* b */ c", "a.c")).toEqual([
      ["code", "a "],
      ["comment", "/* b */"],
      ["code", " c"],
    ]);
    expect(t("   * Loads the file.", "a.java")).toEqual([["comment", "   * Loads the file."]]);
    expect(t("  */", "a.js")).toEqual([["comment", "  */"]]);
    expect(t("*ptr = 5;", "a.c")).toEqual([["code", "*ptr = 5;"]]);
  });

  it("leaves Rust lifetimes alone, but reads char literals", () => {
    expect(t("fn f<'a>(x: &'a str) -> char { 'x' }", "a.rs")).toEqual([
      ["code", "fn f<'a>(x: &'a str) -> char { "],
      ["string", "'x'"],
      ["code", " }"],
    ]);
    expect(t("let c = '\\n';", "a.rs")).toEqual([
      ["code", "let c = "],
      ["string", "'\\n'"],
      ["code", ";"],
    ]);
  });

  it("keeps an unclosed quote as code, and handles escapes", () => {
    expect(t("it's fine", "a.sh")).toEqual([["code", "it's fine"]]);
    expect(t('"a \\" b" c', "a.go")).toEqual([
      ["string", '"a \\" b"'],
      ["code", " c"],
    ]);
  });

  it("knows files by extension or name, and leaves the rest plain", () => {
    expect(syntaxOf("src/Makefile")).not.toBeNull();
    expect(syntaxOf("x/Dockerfile")).not.toBeNull();
    expect(syntaxOf("README.md")).toBeNull();
    expect(syntaxOf("LICENSE")).toBeNull();
    expect(t("# Title", "README.md")).toEqual([["code", "# Title"]]);
    expect(t("<a href='x'> <!-- note --> b", "a.html")).toEqual([
      ["code", "<a href="],
      ["string", "'x'"],
      ["code", "> "],
      ["comment", "<!-- note -->"],
      ["code", " b"],
    ]);
  });
});
