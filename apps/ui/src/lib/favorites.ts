// ★ toggle: patch every cached copy of the story at once (lists, edition, story page), send the write, and put the
// old cache back if the write fails.
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useApi } from "./api.ts";

/** Query keys whose data can contain stories. */
export const STORY_QUERY_ROOTS = ["stories", "edition", "story", "today", "favorites"] as const;

function isStoryLike(v: unknown, id: string): v is { id: string; favorite: boolean } {
  return typeof v === "object" && v !== null && (v as { id?: unknown }).id === id && typeof (v as { favorite?: unknown }).favorite === "boolean";
}

/**
 * Return `data` with `favorite` set on every object `{id: storyId, favorite}` inside it. Unchanged branches keep their
 * identity, so React Query only re-renders what changed. Works on any response shape.
 */
export function setFavoriteInData<T>(data: T, storyId: string, favorite: boolean): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = walk(x);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (typeof v !== "object" || v === null) return v;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = walk(x);
      if (y !== x) changed = true;
      out[k] = y;
    }
    if (isStoryLike(v, storyId) && v.favorite !== favorite) {
      out.favorite = favorite;
      changed = true;
    }
    return changed ? out : v;
  };
  return walk(data) as T;
}

type Snapshot = [QueryKey, unknown][];

export function patchFavoriteEverywhere(qc: QueryClient, storyId: string, favorite: boolean): Snapshot {
  const snapshot: Snapshot = [];
  for (const root of STORY_QUERY_ROOTS) {
    for (const [key, data] of qc.getQueriesData({ queryKey: [root] })) {
      if (data === undefined) continue;
      snapshot.push([key, data]);
      qc.setQueryData(key, setFavoriteInData(data, storyId, favorite));
    }
  }
  return snapshot;
}

export function restoreSnapshot(qc: QueryClient, snapshot: Snapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

export interface ToggleVars {
  storyId: string;
  favorite: boolean;
}

export function useToggleFavorite(opts: { onError?: (err: unknown, vars: ToggleVars) => void } = {}) {
  const qc = useQueryClient();
  const api = useApi();
  return useMutation({
    mutationFn: ({ storyId, favorite }: ToggleVars) => api.setFavorite(storyId, favorite),
    onMutate: async ({ storyId, favorite }) => {
      await Promise.all(STORY_QUERY_ROOTS.map((root) => qc.cancelQueries({ queryKey: [root] })));
      return { snapshot: patchFavoriteEverywhere(qc, storyId, favorite) };
    },
    onError: (err, vars, ctx) => {
      if (ctx) restoreSnapshot(qc, ctx.snapshot);
      opts.onError?.(err, vars);
    },
    onSettled: () => {
      // Saved-time order and "favorites only" lists come from the server.
      void qc.invalidateQueries({ queryKey: ["favorites"] });
      void qc.invalidateQueries({ queryKey: ["stories"], predicate: (q) => JSON.stringify(q.queryKey).includes('"favorites":true') });
    },
  });
}
