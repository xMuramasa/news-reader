// Story filters live in the URL (/stories?feed=cyber&tag=topic:ransomware&q=...), so a view can be bookmarked.
// parse -> serialize is canonical: defaults are omitted and invalid values dropped, in a fixed parameter order.
import { isFeedId, type FeedId } from "@news/schema/feeds";
import { normalizeFilterTag } from "@news/schema/tags";
import { isValidDate } from "./dates.ts";

export const MAX_TAGS = 10;
export const MAX_QUERY = 200;

export type Sort = "newest" | "oldest";

export interface Filters {
  sort: Sort;
  feed: FeedId | null;
  tags: string[];
  q: string;
  from: string | null;
  to: string | null;
  favorites: boolean;
}

export const EMPTY_FILTERS: Filters = { sort: "newest", feed: null, tags: [], q: "", from: null, to: null, favorites: false };

export function parseFilters(sp: URLSearchParams): Filters {
  const feed = sp.get("feed");
  const tags: string[] = [];
  for (const raw of sp.getAll("tag")) {
    const t = raw.length <= 100 ? normalizeFilterTag(raw) : null;
    if (t && !tags.includes(t) && tags.length < MAX_TAGS) tags.push(t);
  }
  const date = (k: string) => {
    const v = sp.get(k);
    return v && isValidDate(v) ? v : null;
  };
  let from = date("from");
  let to = date("to");
  if (from && to && from > to) [from, to] = [to, from];
  return {
    sort: sp.get("sort") === "oldest" ? "oldest" : "newest",
    feed: isFeedId(feed) ? feed : null,
    tags,
    q: (sp.get("q") ?? "").trim().slice(0, MAX_QUERY),
    from,
    to,
    favorites: sp.get("favorites") === "1",
  };
}

export function filtersToSearch(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.feed) sp.set("feed", f.feed);
  for (const t of f.tags) sp.append("tag", t);
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.favorites) sp.set("favorites", "1");
  if (f.sort !== "newest") sp.set("sort", f.sort);
  return sp;
}

/** Query string for GET /api/stories. */
export function storiesQuery(f: Filters, cursor?: string | null, limit = 20): URLSearchParams {
  const sp = filtersToSearch(f);
  sp.set("sort", f.sort);
  sp.set("limit", String(limit));
  if (cursor) sp.set("cursor", cursor);
  return sp;
}

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.feed || f.tags.length || f.q || f.from || f.to || f.favorites);
}

export function toggleTag(f: Filters, tag: string): Filters {
  const tags = f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag].slice(0, MAX_TAGS);
  return { ...f, tags };
}

/** Link to /stories filtered by one tag. */
export function tagHref(tag: string): string {
  return `/stories?${new URLSearchParams({ tag }).toString()}`;
}
