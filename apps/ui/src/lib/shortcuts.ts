// Keyboard: j/k next/previous story, s star the focused story, / search, ? help. Ignored while typing or with
// modifier keys, so browser and screen-reader shortcuts keep working.
import { useEffect } from "react";
import { markRead } from "./read-state.ts";

export const SHORTCUTS: { keys: string; text: string }[] = [
  { keys: "j", text: "Next story" },
  { keys: "k", text: "Previous story" },
  { keys: "s", text: "Star or unstar the focused story" },
  { keys: "/", text: "Go to the search field" },
  { keys: "?", text: "Show this help" },
  { keys: "Esc", text: "Close a dialog or panel" },
];

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return false;
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-story-card]"));
}

function currentIndex(list: HTMLElement[]): number {
  const active = document.activeElement?.closest<HTMLElement>("[data-story-card]");
  if (active) return list.indexOf(active);
  return -1;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Move focus to the next (+1) or previous (-1) story card. Without a focused card, start from the viewport. */
export function moveStory(dir: 1 | -1): HTMLElement | null {
  const list = cards();
  if (!list.length) return null;
  let i = currentIndex(list);
  if (i === -1 && !list.some((c) => c.getBoundingClientRect().height > 0)) {
    // nothing laid out (yet): start at the top
    i = 0;
  } else if (i === -1) {
    // first card whose top is below the header
    const first = list.findIndex((c) => c.getBoundingClientRect().top >= 56);
    i = dir === 1 ? (first === -1 ? list.length - 1 : first) : Math.max(0, (first === -1 ? list.length : first) - 1);
  } else {
    i = Math.min(list.length - 1, Math.max(0, i + dir));
  }
  const el = list[i]!;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  const id = el.dataset.storyId;
  if (id) markRead(id);
  return el;
}

export function starFocused(): boolean {
  const card = document.activeElement?.closest<HTMLElement>("[data-story-card]");
  const btn = card?.querySelector<HTMLButtonElement>("[data-star-button]");
  if (!btn) return false;
  btn.click();
  return true;
}

export interface ShortcutHandlers {
  onSearch: () => void;
  onHelp: () => void;
}

export function useShortcuts({ onSearch, onHelp }: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      // Leave keys alone while a dialog or sheet is open.
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      switch (e.key) {
        case "j":
          if (moveStory(1)) e.preventDefault();
          break;
        case "k":
          if (moveStory(-1)) e.preventDefault();
          break;
        case "s":
          if (starFocused()) e.preventDefault();
          break;
        case "/":
          e.preventDefault();
          onSearch();
          break;
        case "?":
          e.preventDefault();
          onHelp();
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSearch, onHelp]);
}
