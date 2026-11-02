// Reading settings, kept in localStorage and applied as data attributes on <html>. public/theme-init.js applies the same
// attributes before first paint (a test keeps the two in step); this module owns them afterwards.
import { useSyncExternalStore } from "react";

export const SETTINGS_KEY = "news-reader:settings";

export const THEMES = ["endfield", "light", "dark", "sepia"] as const;
export const SIZES = ["s", "m", "l", "xl"] as const;
export const FONTS = ["serif", "sans"] as const;
export const WIDTHS = ["narrow", "medium", "wide"] as const;

export type Theme = (typeof THEMES)[number];
export type Size = (typeof SIZES)[number];
export type Font = (typeof FONTS)[number];
export type Width = (typeof WIDTHS)[number];

export interface Settings {
  /** null: the default, "follow the system". For now that resolves to Endfield (it has no dark variant yet). */
  theme: Theme | null;
  size: Size;
  font: Font;
  width: Width;
}

export const DEFAULT_SETTINGS: Settings = { theme: null, size: "m", font: "serif", width: "medium" };

const pick = <T extends string>(list: readonly T[], v: unknown, dflt: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : dflt;

/** Parse stored JSON; anything unreadable falls back to the defaults, field by field. */
export function parseSettings(raw: string | null): Settings {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // keep defaults
  }
  return {
    theme: typeof o.theme === "string" && (THEMES as readonly string[]).includes(o.theme) ? (o.theme as Theme) : null,
    size: pick(SIZES, o.size, DEFAULT_SETTINGS.size),
    font: pick(FONTS, o.font, DEFAULT_SETTINGS.font),
    width: pick(WIDTHS, o.width, DEFAULT_SETTINGS.width),
  };
}

/** What "follow the system" means: Endfield until it has a dark variant, then light/dark by the system preference. */
export function systemTheme(): Theme {
  return "endfield";
}

export function resolvedTheme(s: Settings): Theme {
  return s.theme ?? systemTheme();
}

export function applySettings(root: HTMLElement, s: Settings): void {
  root.dataset.theme = resolvedTheme(s);
  root.dataset.size = s.size;
  root.dataset.font = s.font;
  root.dataset.width = s.width;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let current: Settings = parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null);
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // private mode or full: still applied for this page
  }
  if (typeof document !== "undefined") applySettings(document.documentElement, current);
  for (const l of listeners) l();
}

/** Re-read storage (another tab changed it, or tests). */
export function reloadSettings(): void {
  current = parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null);
  if (typeof document !== "undefined") applySettings(document.documentElement, current);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Follow other tabs. Call once at start. */
export function watchSettings(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_KEY) reloadSettings();
  });
}
