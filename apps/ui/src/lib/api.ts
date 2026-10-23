// The one API client. Same origin, base /api (Caddy routes it to news-api). Typed against the shapes in @news/schema.
import { createContext, useContext } from "react";
import type {
  ApiErrorBody,
  EditionResponse,
  EditionsResponse,
  FavoritesResponse,
  FavoriteWriteResponse,
  FeedsResponse,
  FeedId,
  StoriesResponse,
  StoryResponse,
  TagsResponse,
} from "@news/schema";
import { storiesQuery, tagsQuery, type Filters } from "./filters.ts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get notFound(): boolean {
    return this.status === 404 || this.status === 400;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Api {
  feeds(): Promise<FeedsResponse>;
  editions(p: { feed?: FeedId | null; before?: string | null; limit?: number }): Promise<EditionsResponse>;
  edition(id: string): Promise<EditionResponse>;
  stories(f: Filters, cursor?: string | null, limit?: number): Promise<StoriesResponse>;
  story(id: string): Promise<StoryResponse>;
  /** Tag counts over the stories matching `f` (its sort is ignored). */
  tags(f: Filters): Promise<TagsResponse>;
  favorites(cursor?: string | null, limit?: number): Promise<FavoritesResponse>;
  setFavorite(storyId: string, favorite: boolean): Promise<FavoriteWriteResponse>;
}

export function createApi(fetchImpl: FetchLike = (i, init) => fetch(i, init), base = "/api"): Api {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(base + path, { credentials: "same-origin", ...init, headers: { Accept: "application/json", ...init?.headers } });
    } catch {
      throw new ApiError(0, "The reader is unreachable. Check your connection.");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error page (proxy down, etc.)
    }
    if (!res.ok) {
      const b = (body ?? {}) as ApiErrorBody;
      throw new ApiError(res.status, typeof b.error === "string" ? b.error : `Request failed (HTTP ${res.status})`);
    }
    if (body === null) throw new ApiError(res.status, "Unexpected response from the reader.");
    return body as T;
  }
  const qs = (p: Record<string, string | number | null | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
    const s = sp.toString();
    return s ? `?${s}` : "";
  };
  const id = (s: string) => encodeURIComponent(s);

  return {
    feeds: () => request("/feeds"),
    editions: ({ feed, before, limit }) => request(`/editions${qs({ feed, before, limit })}`),
    edition: (editionId) => request(`/editions/${id(editionId)}`),
    stories: (f, cursor, limit) => request(`/stories?${storiesQuery(f, cursor, limit).toString()}`),
    story: (storyId) => request(`/stories/${id(storyId)}`),
    tags: (f) => {
      const s = tagsQuery(f).toString();
      return request(`/tags${s ? `?${s}` : ""}`);
    },
    favorites: (cursor, limit = 50) => request(`/favorites${qs({ cursor, limit })}`),
    // The browser adds the Origin header the API checks; the API also wants a JSON content type.
    setFavorite: (storyId, favorite) =>
      request(`/favorites/${id(storyId)}`, {
        method: favorite ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
  };
}

export const defaultApi = createApi();
export const ApiContext = createContext<Api>(defaultApi);

export function useApi(): Api {
  return useContext(ApiContext);
}
