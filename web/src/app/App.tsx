import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "../components/Header";
import { DEFAULT_DEMO, DEMOS, demoBase, demoByName, loadDemo } from "../data/load";
import { precomputedLines, type LinesSource } from "../data/lines";
import { RemoteRepo } from "../data/remote";
import { Playback, type View } from "../store/playback";
import { LinesView } from "../views/LinesView";
import { OverviewView } from "../views/OverviewView";
import { TracksView } from "../views/TracksView";
import { LoadingPanel, RemoteScreen, isLoading } from "../views/RemoteScreens";
import { Store, useStore } from "../store/store";
import { useGlobalKeys } from "./keys";
import { addRecent } from "./recent";
import { PHONE_QUERY, useMediaQuery, type Session } from "./session";
import { parseRoute, routeUrl, type Route } from "./url";

type State =
  | { kind: "loading"; repo: string }
  | { kind: "ready"; repo: string; playback: Playback; lines: LinesSource; remote: RemoteRepo | null }
  /** A pasted repository with nothing to show yet (or that failed). */
  | { kind: "remote"; repo: string; remote: RemoteRepo }
  | { kind: "error"; repo: string; message: string };

const DEFAULT_REPO = DEMOS.find((d) => d.id === DEFAULT_DEMO)!.name;
const NO_LINES: LinesSource = { load: async () => null, peek: () => null };
const IDLE = new Store<object>({});
const IDLE_STATUS = new Store<object>({});
const DAY = 86_400;

/** Puts a route's moment into a playback. */
function applyRoute(playback: Playback, route: Route): void {
  const h = playback.history;
  const time = route.at === null ? h.start : Math.min(h.end, Math.max(h.start, route.at + DAY - 1));
  const commit = h.commitAt(time);
  let file = -1;
  if (route.file) {
    for (let f = 0; f < h.fileCount && file < 0; f++) if (h.pathAt(f, Math.max(commit, h.born(f))) === route.file) file = f;
    for (let f = 0; f < h.fileCount && file < 0; f++) if (h.pathsOf(f).some((p) => p.path === route.file)) file = f;
  }
  playback.pause();
  playback.store.set({
    time,
    view: route.view,
    folder: route.folder,
    selectedFile: file,
    selectedLine: -1,
    lineNumber: route.line,
    selectedRow: h.data.overview.rows.findIndex((r) => (r.folder ?? "") === route.folder && route.folder !== ""),
  });
}

/** The route describing a playback's current moment. */
function currentRoute(repo: string, playback: Playback, lines: LinesSource): Route {
  const s = playback.state;
  const h = playback.history;
  const commit = h.commitAt(s.time);
  const file = s.selectedFile >= 0 && s.view !== "overview" ? h.pathAt(s.selectedFile, Math.max(commit, h.born(s.selectedFile))) : null;
  let line: number | null = s.lineNumber;
  if (file && s.selectedLine >= 0) {
    const known = lines.peek(s.selectedFile);
    const n = known ? known.linesAt(commit).indexOf(s.selectedLine) + 1 : 0;
    line = n > 0 ? n : null;
  }
  // While playing, the address is the repository and view: the moment keeps moving.
  return {
    repo: repo === DEFAULT_REPO && s.playing && s.view === "tracks" ? null : repo,
    at: s.playing ? null : Math.floor(s.time / DAY) * DAY,
    view: s.view,
    folder: s.folder,
    file: s.playing ? null : file,
    line: s.playing ? null : line,
  };
}

export function App() {
  const phone = useMediaQuery(PHONE_QUERY);
  const [route, setRoute] = useState(() => parseRoute(location.pathname, location.search));
  const repo = route.repo ?? DEFAULT_REPO;
  const [state, setState] = useState<State>({ kind: "loading", repo });
  const [view, setView] = useState<View>(route.view);
  const routeRef = useRef(route);
  routeRef.current = route;

  // Open the repository named by the route: a precomputed demo, or any
  // other public repository read in the browser.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let playback: Playback | null = null;
    let cancelled = false;
    const demo = demoByName(repo);
    setState({ kind: "loading", repo });
    if (!demo) {
      const remote = new RemoteRepo(repo);
      setState({ kind: "remote", repo, remote });
      const unsubscribe = remote.history.subscribe(() => {
        const history = remote.history.get().history;
        if (!history || cancelled) return;
        if (!playback) {
          playback = new Playback(history, { selectedFile: -1 });
          const r = routeRef.current;
          applyRoute(playback, r);
          // Without a moment in the address, start at the newest commit.
          if (r.at === null) playback.seek(history.end);
          setState({ kind: "ready", repo, playback, lines: remote, remote });
        } else {
          playback.setHistory(history);
        }
      });
      return () => {
        cancelled = true;
        unsubscribe();
        remote.dispose();
        playback?.dispose();
      };
    }
    loadDemo(demo).then(
      (history) => {
        if (cancelled) return;
        playback = new Playback(history, { selectedFile: -1 });
        const r = routeRef.current;
        applyRoute(playback, r);
        setState({ kind: "ready", repo, playback, lines: precomputedLines(history, demoBase(demo)), remote: null });
        // With no moment in the address, history is already playing.
        if (r.at === null) playback.play();
      },
      (e: unknown) => {
        if (!cancelled) setState({ kind: "error", repo, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
      playback?.dispose();
    };
  }, [repo, attempt]);

  const playback = state.kind === "ready" ? state.playback : null;
  const lines: LinesSource = state.kind === "ready" ? state.lines : NO_LINES;
  const remote = state.kind === "ready" || state.kind === "remote" ? state.remote : null;
  // Re-render on each new snapshot of a pasted repository, and as it loads.
  useStore(playback?.store ?? IDLE, (s) => ("historyVersion" in s ? s.historyVersion : 0));
  const loadStatus = useStore(remote?.status ?? IDLE_STATUS, (s) => ("step" in s ? s.step : "done"));

  // Keep the address in step with the moment: a new history entry when the
  // view changes, a quiet replacement otherwise, at most a few times a second.
  useEffect(() => {
    if (!playback) return;
    let timer = 0;
    let lastView = playback.state.view;
    const sync = () => {
      timer = 0;
      const url = routeUrl(currentRoute(repo, playback, lines));
      const s = playback.state;
      if (url === location.pathname + location.search) return;
      if (s.view !== lastView) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
      lastView = s.view;
    };
    const unsubscribe = playback.store.subscribe(() => {
      setView(playback.state.view);
      if (!timer) timer = window.setTimeout(sync, 300);
    });
    setView(playback.state.view);
    sync();
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [playback, repo, lines]);

  // Back and forward restore the moment from the address.
  useEffect(() => {
    const onPop = () => {
      const r = parseRoute(location.pathname, location.search);
      if ((r.repo ?? DEFAULT_REPO) !== repo) setRoute(r);
      else if (playback) applyRoute(playback, r);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [playback, repo]);

  const openRepo = useCallback(
    (name: string) => {
      if (name.toLowerCase() === repo.toLowerCase()) return;
      const r: Route = { repo: name, at: null, view: "tracks", folder: "", file: null, line: null };
      history.pushState(null, "", routeUrl(r));
      if (demoByName(name) === null) addRecent(name);
      setRoute(r);
    },
    [repo],
  );

  useGlobalKeys((e) => {
    if (!playback) return false;
    const s = playback.state;
    switch (e.key) {
      case " ":
        playback.toggle();
        return true;
      case "ArrowLeft":
      case "ArrowRight": {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) playback.stepMonths(dir);
        else playback.step(dir);
        return true;
      }
      case "1":
      case "2":
      case "3":
        playback.store.set({ view: (["overview", "tracks", "lines"] as const)[Number(e.key) - 1] });
        return true;
      case "Escape":
        if (s.view === "lines") playback.store.set({ view: "tracks" });
        else if (s.view === "tracks") playback.store.set({ view: "overview" });
        else return false;
        return true;
    }
    return false;
  });

  const backToDemo = () => openRepo(DEFAULT_REPO);
  const loadingPanel =
    remote && playback && (isLoading(remote.status.get()) || remote.status.get().step === "failed") ? (
      <LoadingPanel remote={remote} history={playback.history} onBack={backToDemo} />
    ) : undefined;
  void loadStatus;
  const session: Session | null = playback
    ? { playback, history: playback.history, lines, phone, upper: loadingPanel }
    : null;
  const href = (v: View) => (playback ? routeUrl({ ...currentRoute(repo, playback, lines), repo, view: v }) : "/");

  return (
    <div className={phone ? "app phone" : "app"}>
      <Header
        repo={repo}
        view={session ? view : null}
        phone={phone}
        href={href}
        onView={(v) => playback?.store.set({ view: v })}
        onOpenRepo={openRepo}
      />
      {session && view === "tracks" && <TracksView session={session} />}
      {session && view === "overview" && <OverviewView session={session} />}
      {session && view === "lines" && <LinesView session={session} />}
      {state.kind === "loading" && <main className="message" aria-busy="true" />}
      {state.kind === "remote" && (
        <RemoteScreen remote={state.remote} onBack={backToDemo} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {state.kind === "error" && (
        <main className="message">
          <h1>Could not open {state.repo}</h1>
          <p>{state.message}</p>
          <p>
            <a href="/" onClick={(e) => (e.preventDefault(), backToDemo())}>
              Back to the demo repo
            </a>
          </p>
        </main>
      )}
    </div>
  );
}
