// Keyboard shortcuts. One global listener; the active view can claim a key
// first (arrows up and down, Enter), and menus claim Escape by calling
// preventDefault in a capturing listener. Ignored while typing in a field.

import { useEffect, useRef } from "react";

export type KeyHandler = (e: KeyboardEvent) => boolean;

let viewHandler: KeyHandler | null = null;

/** Lets the active view handle keys before the global shortcuts. */
export function useViewKeys(handler: KeyHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: KeyHandler = (e) => ref.current(e);
    viewHandler = h;
    return () => {
      if (viewHandler === h) viewHandler = null;
    };
  }, []);
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useGlobalKeys(handler: KeyHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      if (viewHandler?.(e) || ref.current(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
