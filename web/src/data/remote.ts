// A pasted repository, read by a Web Worker. Holds the latest snapshot of
// its history, the loading status, and line histories fetched from the worker.

import { Store } from "../store/store";
import { COMMIT_LIMIT, INITIAL_STATUS, type FromWorker, type LoadStatus, type ToWorker } from "../worker/protocol";
import type { Data } from "./format";
import { History } from "./history";
import { LineHistory, type LineFile, type LinesSource } from "./lines";

/** Where git requests go: the Cloudflare Worker in production, Vite in development. */
export const GIT_PROXY: string = import.meta.env.VITE_GIT_PROXY ?? "/git-proxy";

export class RemoteRepo implements LinesSource {
  readonly name: string;
  readonly status = new Store<LoadStatus>(INITIAL_STATUS);
  /** The latest snapshot, or null before the first one. */
  readonly history = new Store<{ history: History | null }>({ history: null });
  private readonly worker: Worker;
  private version = 0;
  private nextId = 0;
  private readonly waiting = new Map<number, (m: { json: string | null; version: number }) => void>();
  private readonly lines = new Map<string, Promise<LineHistory | null>>();
  private readonly ready = new Map<string, LineHistory | null>();

  constructor(name: string) {
    this.name = name;
    this.worker = new Worker(new URL("../worker/reader.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) =>
      this.status.set({ step: "failed", failure: { kind: "internal", message: e.message || "The reader stopped." } });
    this.send({ type: "open", repo: name, proxy: GIT_PROXY, limit: COMMIT_LIMIT });
    // For debugging in development: the open repository, on window.
    if (import.meta.env.DEV) (globalThis as { palimpsestRemote?: RemoteRepo }).palimpsestRemote = this;
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker) {
    if (m.type === "status") this.status.set(m.status);
    else if (m.type === "data") {
      this.version = m.version;
      this.lines.clear();
      this.ready.clear();
      this.history.set({ history: new History(JSON.parse(m.json) as Data) });
    } else if (m.type === "lines") {
      this.waiting.get(m.id)?.(m);
      this.waiting.delete(m.id);
    }
  }

  load(file: number): Promise<LineHistory | null> {
    const key = `${this.version}#${file}`;
    let p = this.lines.get(key);
    if (!p) {
      const version = this.version;
      const id = this.nextId++;
      p = new Promise<{ json: string | null; version: number }>((resolve) => {
        this.waiting.set(id, resolve);
        this.send({ type: "lines", id, file, version });
      }).then((m) => {
        // A newer snapshot arrived meanwhile: file ids may have changed, so
        // ask again in terms of the new one.
        if (m.version !== version) return this.load(file);
        const lines = m.json ? new LineHistory(JSON.parse(m.json) as LineFile) : null;
        if (this.version === version) this.ready.set(key, lines);
        return lines;
      });
      this.lines.set(key, p);
    }
    return p;
  }

  peek(file: number): LineHistory | null | undefined {
    return this.ready.get(`${this.version}#${file}`);
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
