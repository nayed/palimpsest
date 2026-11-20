import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../app/format";
import { SPEEDS, playDuration, type Playback } from "../store/playback";
import { useStore } from "../store/store";
import { NextCommitIcon, PauseIcon, PlayIcon, PreviousCommitIcon } from "./Icons";

export function Transport({ playback }: { playback: Playback }) {
  const playing = useStore(playback.store, (s) => s.playing);
  const speed = useStore(playback.store, (s) => s.speed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    menuRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menuOpen]);

  return (
    <section className="transport" aria-label="Playback">
      <button type="button" className="icon-button" aria-label="Previous commit" onClick={() => playback.step(-1)}>
        <PreviousCommitIcon />
      </button>
      <button
        type="button"
        className="play-button"
        aria-label={playing ? "Pause" : "Play history"}
        onClick={() => playback.toggle()}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button type="button" className="icon-button" aria-label="Next commit" onClick={() => playback.step(1)}>
        <NextCommitIcon />
      </button>
      <div className="speed">
        <button
          ref={buttonRef}
          type="button"
          className={menuOpen ? "speed-button open" : "speed-button"}
          aria-expanded={menuOpen}
          aria-controls="speed-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {speed}×<span className="speed-word"> speed</span>
        </button>
        {menuOpen && (
          <div id="speed-menu" ref={menuRef} className="menu speed-menu" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === speed}
                onClick={() => {
                  playback.setSpeed(s);
                  setMenuOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className="speed-value">{s}×</span>
                <span className="speed-note">whole history in {formatDuration(playDuration(s))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
