import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "../components/Header";
import { DEFAULT_DEMO, DEMOS, demoBase, demoByName, loadDemo } from "../data/load";
import { peekLines } from "../data/lines";
import { Playback, type View } from "../store/playback";
import { LinesView } from "../views/LinesView";
import { OverviewView } from "../views/OverviewView";
import { TracksView } from "../views/TracksView";
import { useGlobalKeys } from "./keys";
import { addRecent } from "./recent";
import { PHONE_QUERY, useMediaQuery, type Session } from "./session";
import { parseRoute, routeUrl, type Route } from "./url";

type State =
  | { kind: "loading"; repo: string }
  | { kind: "ready"; repo: string; playback: Playback; base: string }
  | { kind: "unavailable"; repo: string }
  | { kind: "error"; repo: string; message: string };

const DEFAULT_REPO = DEMOS.find((d) => d.id === DEFAULT_DEMO)!.name;
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
function currentRoute(repo: string, playback: Playback, base: string): Route {
  const s = playback.state;
  const h = playback.history;
  const commit = h.commitAt(s.time);
  const file = s.selectedFile >= 0 && s.view !== "overview" ? h.pathAt(s.selectedFile, Math.max(commit, h.born(s.selectedFile))) : null;
  let line: number | null = s.lineNumber;
  if (file && s.selectedLine >= 0) {
    const lines = peekLines(h, base, s.selectedFile);
    const n = lines ? lines.linesAt(commit).indexOf(s.selectedLine) + 1 : 0;
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

  // Open the repository named by the route.
  useEffect(() => {
    const demo = demoByName(repo);
    if (!demo) {
      setState({ kind: "unavailable", repo });
      return;
    }
    let playback: Playback | null = null;
    let cancelled = false;
    setState({ kind: "loading", repo });
    loadDemo(demo).then(
      (history) => {
        if (cancelled) return;
        playback = new Playback(history, { selectedFile: -1 });
        const r = routeRef.current;
        applyRoute(playback, r);
        setState({ kind: "ready", repo, playback, base: demoBase(demo) });
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
  }, [repo]);

  const playback = state.kind === "ready" ? state.playback : null;
  const base = state.kind === "ready" ? state.base : "";

  // Keep the address in step with the moment: a new history entry when the
  // view changes, a quiet replacement otherwise, at most a few times a second.
  useEffect(() => {
    if (!playback) return;
    let timer = 0;
    let lastView = playback.state.view;
    const sync = () => {
      timer = 0;
      const url = routeUrl(currentRoute(repo, playback, base));
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
  }, [playback, repo, base]);

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

  const session: Session | null = playback ? { playback, history: playback.history, base, phone } : null;
  const href = (v: View) => (playback ? routeUrl({ ...currentRoute(repo, playback, base), repo, view: v }) : "/");

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
      {state.kind === "unavailable" && (
        <main className="message">
          <h1>Not available yet</h1>
          <p>
            Palimpsest can open its three demo repositories for now. Reading {state.repo} and any other public GitHub
            repository inside your browser comes next.
          </p>
          <p>
            <a href="/" onClick={(e) => (e.preventDefault(), openRepo(DEFAULT_REPO))}>
              Back to the demo repo
            </a>
          </p>
        </main>
      )}
      {state.kind === "error" && (
        <main className="message">
          <h1>Could not open {state.repo}</h1>
          <p>{state.message}</p>
          <p>
            <a href="/">Back to the demo repo</a>
          </p>
        </main>
      )}
    </div>
  );
}
