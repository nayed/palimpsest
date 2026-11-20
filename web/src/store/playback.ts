// The shared playhead and playback. The playhead is a time (seconds since the
// epoch), the same in every view; the current commit is the last one at or
// before it.

import type { History } from "../data/history";
import { Store } from "./store";

export const SPEEDS = [1, 2, 4, 8, 16] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 4;
/** At the default speed, the whole history plays in this many seconds. */
export const SECONDS_AT_DEFAULT_SPEED = 90;

export type View = "overview" | "tracks" | "lines";

export interface PlayState {
  view: View;
  /** The playhead, in seconds since the epoch. */
  time: number;
  playing: boolean;
  speed: Speed;
  /** Folder shown in Tracks: "" for the whole repository. */
  folder: string;
  selectedFile: number;
  /** A line of the selected file, by its line-history id, or -1. */
  selectedLine: number;
  /** A line number from the URL, resolved once the file's lines load. */
  lineNumber: number | null;
  /** Overview's selected folder row, or -1. */
  selectedRow: number;
  /** True while the user drags the playhead. */
  scrubbing: boolean;
}

/** How long the whole history takes to play at a speed, in seconds. */
export function playDuration(speed: Speed): number {
  return (SECONDS_AT_DEFAULT_SPEED * DEFAULT_SPEED) / speed;
}

/**
 * Seconds of history per second of playback. Playback follows calendar time,
 * not commit count, so busy periods do not crawl.
 */
export function historyRate(history: History, speed: Speed): number {
  return (history.end - history.start) / playDuration(speed);
}

export class Playback {
  readonly store: Store<PlayState>;
  readonly history: History;
  private frame = 0;
  private last = 0;

  constructor(history: History, initial: Partial<PlayState> = {}) {
    this.history = history;
    this.store = new Store<PlayState>({
      view: "tracks",
      time: history.start,
      playing: false,
      speed: DEFAULT_SPEED,
      folder: "",
      selectedFile: 0,
      selectedLine: -1,
      selectedRow: -1,
      lineNumber: null,
      scrubbing: false,
      ...initial,
    });
  }

  get state(): PlayState {
    return this.store.get();
  }

  commit(): number {
    return this.history.commitAt(this.state.time);
  }

  seek(time: number): void {
    this.store.set({ time: Math.min(this.history.end, Math.max(this.history.start, time)) });
  }

  play(): void {
    // Playing from the end starts over.
    if (this.state.time >= this.history.end) this.seek(this.history.start);
    this.store.set({ playing: true });
    this.loop();
  }

  pause(): void {
    this.store.set({ playing: false });
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed): void {
    this.store.set({ speed });
  }

  /** Steps to the previous or next commit, pausing playback. */
  step(direction: -1 | 1): void {
    this.pause();
    const c = this.commit();
    const t = this.history.data.commits.time;
    if (direction > 0) {
      // The next commit later in time (several can share a second).
      let n = c + 1;
      while (n < this.history.commitCount && t[n]! <= this.state.time) n++;
      if (n < this.history.commitCount) this.seek(t[n]!);
    } else {
      // Back to the commit before the current one.
      let p = c - 1;
      while (p > 0 && t[p] === t[c]) p--;
      if (p >= 0) this.seek(t[p]!);
    }
  }

  /** Moves the playhead by whole months, pausing playback. */
  stepMonths(months: number): void {
    this.pause();
    const d = new Date(this.state.time * 1000);
    d.setUTCMonth(d.getUTCMonth() + months);
    this.seek(d.getTime() / 1000);
  }

  /** Advances the playhead by `dt` seconds of real time. */
  advance(dt: number): void {
    const next = this.state.time + dt * historyRate(this.history, this.state.speed);
    if (next >= this.history.end) {
      this.seek(this.history.end);
      this.pause();
    } else {
      this.seek(next);
    }
  }

  private loop(): void {
    if (this.frame) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.frame = 0;
      if (!this.state.playing) return;
      // Clamp long gaps (a background tab) so the playhead does not leap.
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.state.scrubbing) this.advance(dt);
      if (this.state.playing) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }
}
