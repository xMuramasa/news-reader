// Read/unread per story, in this browser only (localStorage). Capped so the list can't grow without bound.
import { useSyncExternalStore } from "react";

export const READ_KEY = "news-reader:read";
export const MAX_READ = 5000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): string[] {
  try {
    const v: unknown = JSON.parse(storage()?.getItem(READ_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MAX_READ) : [];
  } catch {
    return [];
  }
}

let ids: string[] = load();
let set = new Set(ids);
let version = 0;
const listeners = new Set<() => void>();

function save(): void {
  try {
    storage()?.setItem(READ_KEY, JSON.stringify(ids));
  } catch {
    // full or private mode: kept in memory for this page
  }
  version++;
  for (const l of listeners) l();
}

export function isRead(id: string): boolean {
  return set.has(id);
}

export function markRead(storyIds: string | readonly string[]): void {
  const list = typeof storyIds === "string" ? [storyIds] : storyIds;
  const fresh = list.filter((id) => !set.has(id));
  if (!fresh.length) return;
  ids = [...ids, ...fresh].slice(-MAX_READ);
  set = new Set(ids);
  save();
}

export function markUnread(id: string): void {
  if (!set.has(id)) return;
  ids = ids.filter((x) => x !== id);
  set = new Set(ids);
  save();
}

export function reloadReadState(): void {
  ids = load();
  set = new Set(ids);
  version++;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getVersion = () => version;

/** Re-renders when anything is marked; returns the checker. */
export function useReadState(): (id: string) => boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return isRead;
}

export function watchReadState(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key === READ_KEY) reloadReadState();
  });
}
