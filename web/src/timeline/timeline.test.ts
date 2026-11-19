import { describe, expect, it } from "vitest";
import { shortenPath } from "../app/format";
import { day, fixture } from "../data/fixture";
import { History } from "../data/history";
import { clipTexts, spanText } from "./notes";
import { rowAt, rowTop } from "./renderer";
import { timeToX, xToTime, yearSegments } from "./scale";

describe("scale", () => {
  const s = { start: Date.UTC(2020, 0, 1) / 1000, end: Date.UTC(2022, 6, 1) / 1000, width: 1000 };

  it("maps time to x and back", () => {
    expect(timeToX(s, s.start)).toBe(0);
    expect(timeToX(s, s.end)).toBe(1000);
    expect(xToTime(s, timeToX(s, day(300)))).toBeCloseTo(day(300));
    expect(xToTime(s, -50)).toBe(s.start);
    expect(xToTime(s, 5000)).toBe(s.end);
  });

  it("splits the ruler into years, the last one partial", () => {
    const years = yearSegments(s);
    expect(years.map((y) => y.year)).toEqual([2020, 2021, 2022]);
    expect(years.every((y) => y.tick)).toBe(true);
    expect(years[2]!.width).toBeLessThan(years[0]!.width / 1.9);
    const mid = yearSegments({ ...s, start: Date.UTC(2020, 5, 1) / 1000 });
    expect(mid[0]!.tick).toBe(false);
  });
});

describe("rows", () => {
  it("hits rows but not the gaps between them", () => {
    expect(rowAt(rowTop(0) + 1, 3)).toBe(0);
    expect(rowAt(rowTop(2) + 29, 3)).toBe(2);
    expect(rowAt(rowTop(1) - 2, 3)).toBe(-1);
    expect(rowAt(rowTop(3) + 1, 3)).toBe(-1);
    expect(rowAt(0, 3)).toBe(-1);
  });
});

describe("clip notes", () => {
  const h = new History(fixture());

  it("notes a move once, on the clip where it happened", () => {
    const [clip] = h.clipsOf(1);
    expect(clipTexts(h, 1, clip!)).toEqual(["moved to src/parser/ · BK", "BK", ""]);
  });

  it("says how long a file was untouched before it was deleted", () => {
    const untouched = h.clipsOf(0)[1]!;
    expect(clipTexts(h, 0, untouched)[0]).toBe("untouched for 2 years, then deleted");
  });

  it("writes spans in years or months", () => {
    expect(spanText(400 * 86_400)).toBe("1 year");
    expect(spanText(100 * 86_400)).toBe("3 months");
  });

  it("shortens paths from the left", () => {
    expect(shortenPath("a/b.rs", 20)).toBe("a/b.rs");
    expect(shortenPath("alacritty_terminal/src/term/mod.rs", 21)).toBe("…/src/term/mod.rs");
  });
});
