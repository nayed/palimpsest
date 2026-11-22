// The quiet tones of code: comments muted, strings a little dimmer, no other
// color, so author colors keep the page to themselves. Lines are drawn one at
// a time, so this reads one line at a time: inside a block comment, only lines
// starting with "*" (the usual doc-comment style) are known to be comment;
// other multi-line comments and strings stay plain.

export type Tone = "code" | "comment" | "string";
export interface Piece {
  text: string;
  tone: Tone;
}

interface Syntax {
  line: string[];
  block?: [string, string];
  quotes: string;
  /** Single quotes only around one character (Rust lifetimes are not strings). */
  charQuotes?: boolean;
  /** A line starting with "*" inside a block comment. */
  starLines?: boolean;
}

const C: Syntax = { line: ["//"], block: ["/*", "*/"], quotes: `"'`, starLines: true };
const SYNTAX: Record<string, Syntax> = {};
const add = (exts: string, s: Syntax) => exts.split(" ").forEach((e) => (SYNTAX[e] = s));
add("c h cc cpp cxx hpp hh java kt kts swift cs scala dart php groovy gradle proto zig glsl wgsl css scss less", C);
add("js jsx mjs cjs ts tsx mts cts go", { ...C, quotes: "\"'`" });
add("rs", { ...C, charQuotes: true });
add("py pyi rb sh bash zsh fish yml yaml toml pl pm r nix cmake ps1 tf hcl conf cfg mk", { line: ["#"], quotes: `"'` });
add("ex exs", { line: ["#"], quotes: `"` });
add("sql lua hs elm", { line: ["--"], quotes: `"'` });
add("ini", { line: [";", "#"], quotes: `"` });
add("clj cljs el lisp scm", { line: [";"], quotes: `"` });
add("html htm xml svg vue", { line: [], block: ["<!--", "-->"], quotes: `"'` });

const NAMES: Record<string, Syntax> = {
  makefile: SYNTAX.mk!,
  dockerfile: SYNTAX.sh!,
  "cmakelists.txt": SYNTAX.cmake!,
  ".gitignore": SYNTAX.sh!,
  ".editorconfig": SYNTAX.ini!,
};

/** The comment and string rules for a file, by its name, or null for none. */
export function syntaxOf(path: string): Syntax | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (NAMES[name]) return NAMES[name]!;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (SYNTAX[name.slice(dot + 1)] ?? null);
}

/** Splits a line into code, comments and strings. */
export function tones(text: string, syntax: Syntax | null): Piece[] {
  if (!syntax || !text) return [{ text, tone: "code" }];
  const trimmed = text.trimStart();
  if (syntax.starLines && /^\*(\s|\/|$)/.test(trimmed)) return [{ text, tone: "comment" }];

  const out: Piece[] = [];
  const push = (t: string, tone: Tone) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.tone === tone) last.text += t;
    else out.push({ text: t, tone });
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (syntax.line.some((m) => rest.startsWith(m))) {
      push(rest, "comment");
      break;
    }
    if (syntax.block && rest.startsWith(syntax.block[0])) {
      const end = text.indexOf(syntax.block[1], i + syntax.block[0].length);
      const stop = end < 0 ? text.length : end + syntax.block[1].length;
      push(text.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const q = text[i]!;
    if (syntax.quotes.includes(q)) {
      const close = closing(text, i, q, q === "'" && !!syntax.charQuotes);
      if (close > i) {
        push(text.slice(i, close + 1), "string");
        i = close + 1;
        continue;
      }
    }
    push(q, "code");
    i++;
  }
  return out;
}

/** Where a string opened at `start` closes on this line, or -1. */
function closing(text: string, start: number, quote: string, oneChar: boolean): number {
  if (oneChar) {
    const m = /^'(\\.[^']*|[^\\'])'/.exec(text.slice(start));
    return m ? start + m[0].length - 1 : -1;
  }
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}
