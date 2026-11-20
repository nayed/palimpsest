import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { History } from "../data/history";
import type { LineHistory, LinesSource } from "../data/lines";
import type { Playback } from "../store/playback";

/** One open repository: its history, playback, and where its lines come from. */
export interface Session {
  playback: Playback;
  history: History;
  lines: LinesSource;
  phone: boolean;
  /** Replaces the views' upper half (the loading panel of a pasted repository). */
  upper?: ReactNode;
}

/** A file's line history: undefined while loading, null when it has none. */
export function useLineHistory(session: Session, file: number): LineHistory | null | undefined {
  const [state, setState] = useState<{ file: number; lines: LineHistory | null | undefined }>({
    file,
    lines: undefined,
  });
  useEffect(() => {
    if (file < 0) return;
    let live = true;
    session.lines.load(file).then(
      (lines) => {
        if (!live) return;
        // A line number from the URL becomes a line once the lines are in.
        const store = session.playback.store;
        const n = store.get().lineNumber;
        if (lines && n !== null && store.get().selectedFile === file) {
          const id = lines.linesAt(session.history.commitAt(store.get().time))[n - 1];
          store.set({ selectedLine: id ?? -1, lineNumber: null });
        }
        setState({ file, lines });
      },
      () => live && setState({ file, lines: null }),
    );
    return () => {
      live = false;
    };
  }, [session.history, session.lines, session.playback, file]);
  return state.file === file ? state.lines : undefined;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export const PHONE_QUERY = "(max-width: 640px)";
