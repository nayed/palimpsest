import { describe, expect, it } from "vitest";
import { day, fixture } from "../data/fixture";
import { History } from "../data/history";
import { Playback, historyRate, playDuration } from "./playback";

describe("Playback", () => {
  const h = new History(fixture());

  it("plays the whole history in 90 seconds at 4x and scales with speed", () => {
    expect(playDuration(4)).toBe(90);
    expect(playDuration(1)).toBe(360);
    expect(playDuration(16)).toBe(22.5);
    expect(historyRate(h, 4) * 90).toBeCloseTo(h.end - h.start);
  });

  it("advances along calendar time and stops at the end", () => {
    const p = new Playback(h);
    p.store.set({ playing: true });
    p.advance(45);
    expect(p.state.time).toBeCloseTo((h.start + h.end) / 2);
    p.advance(100);
    expect(p.state.time).toBe(h.end);
    expect(p.state.playing).toBe(false);
  });

  it("steps between commits", () => {
    const p = new Playback(h);
    p.step(1);
    expect(p.commit()).toBe(1);
    p.step(1);
    p.step(1);
    expect(p.commit()).toBe(3);
    p.step(1);
    expect(p.commit()).toBe(3);
    p.step(-1);
    expect(p.commit()).toBe(2);
    expect(p.state.time).toBe(day(400));
  });

  it("clamps seeking to the history", () => {
    const p = new Playback(h);
    p.seek(0);
    expect(p.state.time).toBe(h.start);
    p.seek(day(5000));
    expect(p.state.time).toBe(h.end);
  });

  it("notifies subscribers only on real changes", () => {
    const p = new Playback(h);
    let calls = 0;
    p.store.subscribe(() => calls++);
    p.seek(h.start);
    p.seek(day(10));
    expect(calls).toBe(1);
  });
});
