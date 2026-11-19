import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { DEMOS, loadDemo, type DemoId } from "../data/load";
import { Playback } from "../store/playback";
import { TracksView } from "../views/TracksView";

const DEFAULT_DEMO: DemoId = "alacritty";

type State = { kind: "loading" } | { kind: "ready"; playback: Playback } | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let playback: Playback | null = null;
    let cancelled = false;
    loadDemo(DEFAULT_DEMO)
      .then((history) => {
        if (cancelled) return;
        playback = new Playback(history, { selectedFile: -1 });
        setState({ kind: "ready", playback });
        // The demo is already playing when the page opens.
        playback.play();
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      playback?.dispose();
    };
  }, []);

  const repo = state.kind === "ready" ? state.playback.history.data.repo.name : DEMOS[DEFAULT_DEMO].name;
  return (
    <div className="app">
      <Header repo={repo} view="tracks" />
      {state.kind === "ready" && <TracksView playback={state.playback} />}
      {state.kind === "error" && (
        <main className="message">
          <h1>Could not open {repo}</h1>
          <p>{state.message}</p>
        </main>
      )}
    </div>
  );
}
