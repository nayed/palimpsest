// Screens for a pasted repository: the progress panel shown while it loads,
// and the layout used before anything is loaded (connecting, too big, or a
// failure), with the play controls disabled and empty dashed rows.

import { formatCount } from "../app/format";
import { NextCommitIcon, PlayIcon, PreviousCommitIcon } from "../components/Icons";
import type { History } from "../data/history";
import type { RemoteRepo } from "../data/remote";
import { useStore } from "../store/store";
import { COMMIT_LIMIT, type HistoryWindow, type LoadStatus } from "../worker/protocol";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthYear(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/** Still loading: anything before reading has finished. */
export function isLoading(s: LoadStatus): boolean {
  return ["connecting", "counting", "downloading", "indexing", "reading"].includes(s.step);
}

function BackToDemo({ onBack }: { onBack: () => void }) {
  return (
    <a
      href="/"
      className="text-link"
      onClick={(e) => {
        e.preventDefault();
        onBack();
      }}
    >
      Back to the demo repo
    </a>
  );
}

/** The upper half while a repository loads. */
export function LoadingPanel(props: { remote: RemoteRepo; history: History | null; onBack: () => void }) {
  const s = useStore(props.remote.status, (x) => x);
  const readFrom = props.history?.readFrom ?? null;
  if (s.step === "failed" && s.failure) {
    return (
      <main className="upper loading-upper">
        <section className="panel loading-main" aria-live="polite">
          <h1 className="display">Reading stopped</h1>
          <p className="caption-strong">
            {s.failure.kind === "network"
              ? "The connection to GitHub failed. What has been read so far is shown below."
              : `Part of the history could not be read (${s.failure.message}). What has been read so far is shown below.`}
          </p>
          <div className="loading-actions">
            <BackToDemo onBack={props.onBack} />
          </div>
        </section>
      </main>
    );
  }
  const headline =
    s.step === "connecting"
      ? "Connecting"
      : s.step === "counting"
        ? "Counting commits"
        : s.total === null
          ? "Downloading"
          : s.step === "reading"
            ? `${formatCount(s.read)} of ${formatCount(s.total)} commits`
            : `${formatCount(s.total)} commits`;
  const detail =
    s.step === "connecting"
      ? "Asking GitHub for the repository."
      : s.step === "counting"
        ? s.over !== null
          ? `${formatCount(s.over)} commits, more than Palimpsest reads at once. Looking for a recent part that fits.`
          : "Checking how big the history is before downloading it."
        : s.step === "downloading"
          ? `Downloading the repository: ${mb(s.bytes)} so far.`
          : s.step === "indexing"
            ? "Unpacking the download."
            : readFrom !== null
              ? `Reading history newest first. Back to ${monthYear(readFrom)} so far.`
              : "Reading history newest first.";
  const progress = s.step === "reading" && s.total ? s.read / s.total : s.step === "indexing" ? 0.01 : 0;
  const reading = s.step === "reading";

  const steps: { label: string; state: string; active: boolean }[] = [
    {
      label: "Download the repository",
      state: s.downloaded ? (s.fromCache ? "done, from this browser" : `done, ${mb(s.bytes)}`) : s.step === "downloading" ? mb(s.bytes) : "",
      active: !s.downloaded && s.step !== "connecting",
    },
    {
      label: "Read every commit",
      state: reading && s.total ? `${Math.floor((100 * s.read) / s.total)}%` : s.step === "indexing" ? "starting" : "",
      active: reading || s.step === "indexing",
    },
    { label: "Work out line history", state: "when you open a file", active: false },
  ];

  return (
    <main className="upper loading-upper">
      <section className="panel loading-main" aria-live="polite">
        <h1 className="display">{headline}</h1>
        <p className="caption-strong">{detail}</p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Reading history"
        >
          <div className="progress-done" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="loading-actions">
          <button type="button" className="outlined-button" onClick={() => props.remote.stop()}>
            Stop loading
          </button>
          <BackToDemo onBack={props.onBack} />
        </div>
      </section>
      <section className="panel loading-steps">
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.label} className={step.active ? "step active" : "step"}>
              <span>{step.label}</span>
              <span className={step.active && reading && step.label.startsWith("Read") ? "step-state highlight" : "step-state"}>
                {step.state}
              </span>
            </li>
          ))}
        </ol>
        {props.history && <p className="caption">You can already scrub and play the part that has loaded.</p>}
      </section>
    </main>
  );
}

/** "the last year", "the last 6 months". */
export function windowName(months: number): string {
  if (months % 12 === 0) return months === 12 ? "the last year" : `the last ${months / 12} years`;
  return months === 1 ? "the last month" : `the last ${months} months`;
}

/** "41,000" for 40,812: a count that is about right is easier to read. */
function about(n: number): string {
  const step = n >= 10_000 ? 1000 : n >= 1000 ? 100 : 10;
  return formatCount(Math.max(step, Math.round(n / step) * step));
}

function failureText(s: LoadStatus, repo: string, since: number | null): { title: string; text: string; retry: boolean } {
  const f = s.failure!;
  switch (f.kind) {
    case "tooBig": {
      const what = since === null ? "This repository has" : `Its history since ${monthYear(since)} has`;
      return {
        title: "Too big for one browser tab",
        text: `${what} ${formatCount(Number(f.message))} commits. Palimpsest reads history inside your browser, and it stops at ${formatCount(COMMIT_LIMIT)} so the tab stays responsive.`,
        retry: false,
      };
    }
    case "notFound":
      return {
        title: "Repository not found",
        text: `GitHub has no public repository at github.com/${repo}. It may be private or misspelled: Palimpsest reads public repositories only.`,
        retry: false,
      };
    case "network":
      return {
        title: "Could not reach GitHub",
        text: "The connection to GitHub, through Palimpsest’s proxy, failed. Check your connection and try again.",
        retry: true,
      };
    default:
      return { title: "Could not read this repository", text: `Something in it could not be read: ${f.message}`, retry: true };
  }
}

/**
 * For a repository too big to read whole: windows of recent history that
 * fit, the longest first (the main choice), then a short, quick one.
 */
function WindowChoices({ windows, onWindow }: { windows: HistoryWindow[]; onWindow: (since: number) => void }) {
  return (
    <section className="panel failure-side">
      <h2 className="panel-title">Load part of it instead</h2>
      {windows.length === 0 ? (
        <p className="caption">Even its last month has more than {formatCount(COMMIT_LIMIT)} commits.</p>
      ) : (
        <>
          <ul className="windows">
            {windows.map((w, i) => {
              const name = windowName(w.months);
              return (
                <li key={w.months} className="window-choice">
                  <div>
                    <div className="window-name">{name.charAt(0).toUpperCase() + name.slice(1)}</div>
                    <div className="caption">
                      About {about(w.commits)} commits, back to {monthYear(w.since)}.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={i === 0 ? "now-button" : "outlined-button"}
                    onClick={() => onWindow(w.since)}
                  >
                    Load {name}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="caption">
            The download holds every file as it was when the window starts, plus each change since, so it can be large.
          </p>
        </>
      )}
    </section>
  );
}

/** Before anything is loaded: progress, or why nothing will be. */
export function RemoteScreen(props: {
  remote: RemoteRepo;
  onBack: () => void;
  onRetry: () => void;
  onWindow: (since: number) => void;
}) {
  const s = useStore(props.remote.status, (x) => x);
  const f =
    s.step === "failed" && s.failure
      ? failureText(s, props.remote.name, props.remote.since)
      : s.step === "stopped"
        ? { title: "Stopped", text: "Loading stopped before any history was read.", retry: true }
        : null;
  return (
    <>
      {f ? (
        <main className="upper failure-upper">
          <section className="panel failure-main">
            <h1 className="display">{f.title}</h1>
            <p className="failure-text">{f.text}</p>
            <div className="loading-actions">
              {f.retry && (
                <button type="button" className="outlined-button" onClick={props.onRetry}>
                  Try again
                </button>
              )}
              <BackToDemo onBack={props.onBack} />
            </div>
          </section>
          {s.failure?.kind === "tooBig" && s.failure.windows ? (
            <WindowChoices windows={s.failure.windows} onWindow={props.onWindow} />
          ) : (
            <section className="panel failure-side" />
          )}
        </main>
      ) : (
        <LoadingPanel remote={props.remote} history={null} onBack={props.onBack} />
      )}
      <section className="transport" aria-label="Playback">
        <button type="button" className="icon-button" aria-label="Previous commit" disabled>
          <PreviousCommitIcon />
        </button>
        <button type="button" className="play-button disabled" aria-label="Play history" disabled>
          <PlayIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Next commit" disabled>
          <NextCommitIcon />
        </button>
      </section>
      <div className="lower empty-lower">
        <p className="caption">Nothing is loaded yet. Tracks will appear here.</p>
        {[1, 0.85, 0.7, 0.55, 0.4, 0.25].map((o) => (
          <div key={o} className="empty-row" style={{ opacity: o }} />
        ))}
      </div>
    </>
  );
}
