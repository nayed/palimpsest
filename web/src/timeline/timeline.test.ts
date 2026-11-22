import { describe, expect, it } from "vitest";
import { shortenPath } from "../app/format";
import { day, fixture } from "../data/fixture";
import { History } from "../data/history";
import { LineHistory } from "../data/lines";
import { lineClipDetails, lineClips } from "../views/LinesView";
import { clipAt, clipDates, clipTexts, fileClipDetails, spanText } from "./notes";
import { rowHeights, shareAt } from "../views/OverviewView";
import { timeToX, xToTime, yearSegments } from "./scale";
import { releases, versionOf } from "./tags";
import { currentRelease } from "./renderer";

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

describe("overview rows", () => {
  it("are proportional to size, never under 44px", () => {
    const h = rowHeights([800, 150, 50, 0], 600);
    expect(h.every((x) => x >= 44)).toBe(true);
    expect(h[0]).toBeGreaterThan(h[1]!);
    expect(h[3]).toBe(44);
    expect(h.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600);
  });

  it("splits who wrote the code alive in a month, Others last", () => {
    const data = fixture();
    data.authors.rank = [1, 0];
    data.overview.share = { start: [0, 2], author: [1, 0], lines: [25, 75] };
    expect(shareAt(new History(data), 0)).toEqual([
      { author: 0, rank: 1, share: 0.75 },
      { author: null, rank: 0, share: 0.25 },
    ]);
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

describe("hover cards", () => {
  const h = new History(fixture());

  it("find the clip under the pointer", () => {
    const clips = h.clipsOf(0);
    expect(clipAt(clips, day(10))).toBe(clips[0]);
    expect(clipAt(clips, day(31))).toBe(clips[1]);
    expect(clipAt(clips, day(800))).toBe(clips[1]);
    expect(clipAt(clips, day(900))).toBeUndefined();
  });

  it("give a clip's months", () => {
    expect(clipDates(h.clipsOf(0)[0]!)).toBe("Jan 2020");
    expect(clipDates(h.clipsOf(1)[0]!)).toBe("Jan 2020 – Mar 2022");
  });

  it("count a file's commits in the clip, and note a move", () => {
    expect(fileClipDetails(h, 1, h.clipsOf(1)[0]!)).toEqual(["2 commits, 1 by Bo", "Moved to src/parser/"]);
    expect(fileClipDetails(h, 0, h.clipsOf(0)[0]!)).toEqual(["1 commit"]);
    expect(fileClipDetails(h, 0, h.clipsOf(0)[1]!)).toEqual(["No commits for 2 years, then deleted"]);
  });

  it("say who wrote or rewrote a line, and why", () => {
    const lines = new LineHistory({
      format: "palimpsest-lines",
      version: 1,
      file: 1,
      commits: [0, 2, 3],
      opsStart: [0, 2, 10, 14],
      ops: [2, 3, 0, 1, 3, 1, 1, 1, 2, 1, 1, 1, 0, 2],
      texts: ["a", "b", "c", "b2", "d"],
    });
    const [written, rewritten] = lineClips(h, lines, 1);
    expect(lineClipDetails(h, lines, 1, written!)).toEqual(["Wrote the line", "“Start”"]);
    expect(lineClipDetails(h, lines, 1, rewritten!)).toEqual(["Rewrote the line", "“Move lexer”"]);
  });
});

describe("release tags", () => {
  it("rank releases by the first number that changed", () => {
    const names = ["v0.1.0", "v0.1.1", "v0.2.0", "v1.0.0", "v1.1.0", "v1.1.1", "v2.0"];
    const r = releases({ name: names, time: names.map((_, i) => i) });
    expect(r.map((x) => x.level)).toEqual([0, 1, 0, 0, 1, 2, 0]);
    expect(versionOf("ignore-0.4.34")).toEqual([0, 4, 34]);
    expect(releases(undefined)).toEqual([]);
  });

  it("find the release current at the playhead", () => {
    const r = releases({ name: ["1.0", "2.0"], time: [10, 20] });
    expect(currentRelease(r, 5)).toBe(-1);
    expect(currentRelease(r, 10)).toBe(0);
    expect(currentRelease(r, 25)).toBe(1);
  });
});
