// Public API (behind Caddy at /api). GET only, apart from favorites. Responses never include internal fields such as
// the run file, warnings or ingest state.
import {
  FEEDS,
  FEED_IDS,
  AI_TAG_PREFIXES,
  DERIVED_TAG_PREFIXES,
  isEditionId,
  isFeedId,
  isStoryId,
  isValidDate,
  normalizeFilterTag,
  type EditionSummary,
  type EditionView,
  type FavoriteView,
  type FeedInfo,
  type FeedId,
  type StoryView,
} from "@news/schema";
import type { Document, Filter } from "mongodb";
import type { Collections, EditionDoc, FavoriteDoc, StoryDoc } from "./db.ts";
import {
  EDITIONS_SORT,
  FAVORITES_SORT,
  STORIES_SORT,
  afterCursor,
  decodeCursor,
  encodeCursor,
  mongoSort,
  type SortSpec,
} from "./cursor.ts";
import {
  HttpError,
  badRequest,
  intParam,
  isJsonContentType,
  json,
  notFound,
  readBody,
  singleParam,
  type Route,
} from "./http.ts";

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;
export const MAX_QUERY_LENGTH = 200;
export const MAX_TAG_FILTERS = 10;

export interface PublicDeps {
  cols: Collections;
  publicOrigin: string;
  now: () => Date;
  ping: () => Promise<void>;
  kevStatus: () => { cves: number; fetched_at: string | null };
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes

export function storyView(s: StoryDoc, favorite: boolean): StoryView {
  return {
    id: s._id,
    edition_id: s.edition_id,
    feed: s.feed,
    edition_date: s.edition_date,
    run_at: s.run_at.toISOString(),
    sort_date: s.sort_date,
    section: s.section,
    rank: s.rank,
    slug: s.slug,
    headline: s.headline,
    summary: s.summary,
    event_date: s.event_date,
    is_update: s.is_update,
    thread: s.thread,
    verification: s.verification,
    action: s.action,
    details: s.details,
    coverage: s.coverage,
    framing: s.framing,
    blindspot: s.blindspot,
    sources: s.sources,
    tags: s.tags,
    cves: s.cves,
    favorite,
  };
}

export function editionSummary(e: EditionDoc): EditionSummary {
  return {
    id: e._id,
    feed: e.feed,
    edition_date: e.edition_date,
    run_at: e.run_at.toISOString(),
    title: e.title,
    lead: e.lead,
    language: e.language,
    story_count: e.story_count,
    section_counts: e.section_counts,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Visibility: editions still being ingested are hidden everywhere; when a feed has several runs on one day, lists show
// only the latest (the others stay reachable by id and through the same-day switcher).

interface Visibility {
  /** Editions that lists must skip (not ready, or superseded by a later run of the same day). */
  hidden: string[];
  /** Editions that are not ready: hidden even by id. */
  notReady: Set<string>;
}

async function visibility(cols: Collections, feed?: FeedId): Promise<Visibility> {
  const groups = await cols.editions
    .aggregate<{ ids: { id: string; state: string }[] }>([
      { $match: feed ? { feed } : {} },
      { $sort: { run_at: -1, _id: -1 } },
      { $group: { _id: { feed: "$feed", d: "$edition_date" }, ids: { $push: { id: "$_id", state: "$state" } } } },
    ])
    .toArray();
  const hidden: string[] = [];
  const notReady = new Set<string>();
  for (const g of groups) {
    let shown = false;
    for (const { id, state } of g.ids) {
      if (state !== "ready") notReady.add(id);
      if (state === "ready" && !shown) shown = true;
      else hidden.push(id);
    }
  }
  return { hidden, notReady };
}

async function favoriteSet(cols: Collections, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const favs = await cols.favorites.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  return new Set(favs.map((f) => f._id));
}

async function page<T extends Document>(
  find: (filter: Filter<T>, sort: Record<string, 1 | -1>, limit: number) => Promise<T[]>,
  base: Filter<T>,
  spec: SortSpec,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: T[]; next: string | null }> {
  const filter = cursor ? ({ $and: [base, afterCursor(spec, decodeCursor(spec, cursor))] } as Filter<T>) : base;
  const docs = await find(filter, mongoSort(spec), limit + 1);
  const items = docs.slice(0, limit);
  return { items, next: docs.length > limit ? encodeCursor(spec, items[items.length - 1]!) : null };
}

function feedParam(url: URL): FeedId | undefined {
  const f = singleParam(url, "feed");
  if (f === undefined || f === "") return undefined;
  if (!isFeedId(f)) throw badRequest(`feed must be one of: ${FEED_IDS.join(", ")}`);
  return f;
}

function dateParam(url: URL, name: string): string | undefined {
  const d = singleParam(url, name);
  if (d === undefined || d === "") return undefined;
  if (!isValidDate(d)) throw badRequest(`${name} must be a date YYYY-MM-DD`);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Routes

export function publicRoutes(deps: PublicDeps): Route[] {
  const { cols } = deps;

  const getFeeds = async () => {
    const vis = await visibility(cols);
    const feeds = await Promise.all(
      FEED_IDS.map(async (id) => {
        const def = FEEDS[id];
        const visible: Filter<EditionDoc> = { feed: id, state: "ready", _id: { $nin: vis.hidden } };
        const [latest, editions, stories] = await Promise.all([
          cols.editions.find(visible).sort(mongoSort(EDITIONS_SORT)).limit(1).next(),
          cols.editions.countDocuments(visible),
          cols.stories.countDocuments({ feed: id, edition_id: { $nin: vis.hidden } }),
        ]);
        const info: FeedInfo = {
          id,
          label: def.label,
          emoji: def.emoji,
          cadence: def.cadence,
          sections: def.sections.map((s) => ({ id: s.id, title: s.title })),
          coverage_groups: def.coverageGroups.map((g) => ({ id: g.id, title: g.title })),
          latest: latest ? editionSummary(latest) : null,
          counts: { editions, stories },
        };
        return info;
      }),
    );
    return json(200, { feeds });
  };

  const listEditions = async (_req: Request, _p: string[], url: URL) => {
    const feed = feedParam(url);
    const limit = intParam(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const vis = await visibility(cols, feed);
    const base: Filter<EditionDoc> = { state: "ready", _id: { $nin: vis.hidden }, ...(feed ? { feed } : {}) };
    const { items, next } = await page<EditionDoc>(
      (f, s, l) => cols.editions.find(f).sort(s).limit(l).toArray(),
      base,
      EDITIONS_SORT,
      singleParam(url, "before") || undefined,
      limit,
    );
    return json(200, { editions: items.map(editionSummary), next });
  };

  const getEdition = async (_req: Request, [id]: string[]) => {
    if (!id || !isEditionId(id)) throw badRequest("invalid edition id");
    const e = await cols.editions.findOne({ _id: id, state: "ready" });
    if (!e) throw notFound("edition not found");
    const vis = await visibility(cols, e.feed);
    const order = new Map(FEEDS[e.feed].sections.map((s, i) => [s.id, i]));
    const stories = (await cols.stories.find({ edition_id: id }).toArray()).sort(
      (a, b) =>
        (order.get(a.section) ?? 99) - (order.get(b.section) ?? 99) || a.rank - b.rank || a.position - b.position,
    );
    const favs = await favoriteSet(
      cols,
      stories.map((s) => s._id),
    );
    const listed: Filter<EditionDoc> = { feed: e.feed, state: "ready", _id: { $nin: vis.hidden } };
    const [prev, next, sameDay] = await Promise.all([
      cols.editions
        .find({ ...listed, $or: [{ run_at: { $lt: e.run_at } }, { run_at: e.run_at, _id: { $lt: e._id } }] })
        .sort({ run_at: -1, _id: -1 })
        .limit(1)
        .project<{ _id: string }>({ _id: 1 })
        .next(),
      cols.editions
        .find({ ...listed, $or: [{ run_at: { $gt: e.run_at } }, { run_at: e.run_at, _id: { $gt: e._id } }] })
        .sort({ run_at: 1, _id: 1 })
        .limit(1)
        .project<{ _id: string }>({ _id: 1 })
        .next(),
      cols.editions
        .find({ feed: e.feed, edition_date: e.edition_date, state: "ready" })
        .sort({ run_at: 1, _id: 1 })
        .project<{ _id: string; run_at: Date }>({ _id: 1, run_at: 1 })
        .toArray(),
    ]);
    const edition: EditionView = {
      ...editionSummary(e),
      markets: e.markets,
      gaps: e.gaps,
      stories: stories.map((s) => storyView(s, favs.has(s._id))),
      prev: prev?._id ?? null,
      next: next?._id ?? null,
      same_day: sameDay.map((r) => ({ id: r._id, run_at: r.run_at.toISOString(), latest: !vis.hidden.includes(r._id) })),
    };
    return json(200, { edition });
  };

  const listStories = async (_req: Request, _p: string[], url: URL) => {
    const feed = feedParam(url);
    const limit = intParam(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const sortName = singleParam(url, "sort") || "newest";
    if (sortName !== "newest" && sortName !== "oldest") throw badRequest("sort must be newest or oldest");
    const rawTags = url.searchParams.getAll("tag").filter((t) => t !== "");
    if (rawTags.length > MAX_TAG_FILTERS) throw badRequest(`at most ${MAX_TAG_FILTERS} tag filters`);
    const tags = rawTags.map((t) => {
      const n = t.length <= 100 ? normalizeFilterTag(t) : null;
      if (!n) throw badRequest("invalid tag");
      return n;
    });
    const q = (singleParam(url, "q") ?? "").trim();
    if (q.length > MAX_QUERY_LENGTH) throw badRequest(`q must be at most ${MAX_QUERY_LENGTH} characters`);
    const from = dateParam(url, "from");
    const to = dateParam(url, "to");
    if (from && to && from > to) throw badRequest("from must not be after to");
    const favParam = singleParam(url, "favorites");
    if (favParam !== undefined && favParam !== "" && favParam !== "0" && favParam !== "1") {
      throw badRequest("favorites must be 1 or 0");
    }

    const vis = await visibility(cols, feed);
    const and: Filter<StoryDoc>[] = [{ edition_id: { $nin: vis.hidden } }];
    if (feed) and.push({ feed });
    if (tags.length) and.push({ tags: { $all: tags } });
    if (from || to) and.push({ sort_date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
    if (favParam === "1") {
      const favIds = (await cols.favorites.find({}, { projection: { _id: 1 } }).toArray()).map((f) => f._id);
      and.push({ _id: { $in: favIds } });
    }
    const base: Filter<StoryDoc> = q ? { $text: { $search: q }, $and: and } : { $and: and };
    const spec = STORIES_SORT[sortName];
    const { items, next } = await page<StoryDoc>(
      (f, s, l) => cols.stories.find(f).sort(s).limit(l).toArray(),
      base,
      spec,
      singleParam(url, "cursor") || undefined,
      limit,
    );
    const favs = await favoriteSet(
      cols,
      items.map((s) => s._id),
    );
    return json(200, { stories: items.map((s) => storyView(s, favs.has(s._id))), next });
  };

  const getStory = async (_req: Request, [id]: string[]) => {
    if (!id || !isStoryId(id)) throw badRequest("invalid story id");
    const s = await cols.stories.findOne({ _id: id });
    if (!s) throw notFound("story not found");
    const vis = await visibility(cols, s.feed);
    if (vis.notReady.has(s.edition_id)) throw notFound("story not found");
    const thread: Filter<StoryDoc> = { feed: s.feed, thread: s.thread, edition_id: { $nin: vis.hidden }, _id: { $ne: s._id } };
    const [earlier, later] = await Promise.all([
      cols.stories
        .find({ ...thread, run_at: { $lt: s.run_at } })
        .sort({ run_at: -1, position: 1 })
        .limit(30)
        .toArray(),
      cols.stories
        .find({ ...thread, run_at: { $gt: s.run_at } })
        .sort({ run_at: 1, position: 1 })
        .limit(30)
        .toArray(),
    ]);
    const favs = await favoriteSet(cols, [s._id, ...earlier.map((x) => x._id), ...later.map((x) => x._id)]);
    return json(200, {
      story: storyView(s, favs.has(s._id)),
      thread: {
        earlier: earlier.map((x) => storyView(x, favs.has(x._id))),
        later: later.map((x) => storyView(x, favs.has(x._id))),
      },
    });
  };

  const PREFIXES = [...AI_TAG_PREFIXES, ...DERIVED_TAG_PREFIXES] as string[];
  const listTags = async (_req: Request, _p: string[], url: URL) => {
    const feed = feedParam(url);
    const prefix = singleParam(url, "prefix") || undefined;
    if (prefix !== undefined && !PREFIXES.includes(prefix)) throw badRequest(`prefix must be one of: ${PREFIXES.join(", ")}`);
    const vis = await visibility(cols, feed);
    const match: Document = { edition_id: { $nin: vis.hidden }, ...(feed ? { feed } : {}) };
    const tagMatch = prefix ? (prefix === "update" ? { tags: "update" } : { tags: { $regex: `^${prefix}:` } }) : {};
    const rows = await cols.stories
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...match, ...tagMatch } },
        { $unwind: "$tags" },
        { $match: tagMatch },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 500 },
      ])
      .toArray();
    return json(200, { tags: rows.map((r) => ({ tag: r._id, count: r.count })) });
  };

  const listFavorites = async (_req: Request, _p: string[], url: URL) => {
    const limit = intParam(url, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    const { items, next } = await page<FavoriteDoc>(
      (f, s, l) => cols.favorites.find(f).sort(s).limit(l).toArray(),
      {},
      FAVORITES_SORT,
      singleParam(url, "cursor") || undefined,
      limit,
    );
    const stories = await cols.stories.find({ _id: { $in: items.map((f) => f._id) } }).toArray();
    const byId = new Map(stories.map((s) => [s._id, s]));
    return json(200, {
      favorites: items.map((f): FavoriteView => {
        const s = byId.get(f._id);
        return {
          story_id: f._id,
          created_at: f.created_at.toISOString(),
          snapshot: f.snapshot,
          story: s ? storyView(s, true) : null,
        };
      }),
      next,
    });
  };

  const checkFavoriteWrite = async (req: Request, id: string | undefined): Promise<string> => {
    if (req.headers.get("origin") !== deps.publicOrigin) throw new HttpError(403, { error: "origin not allowed" });
    if (!isJsonContentType(req)) throw new HttpError(415, { error: "Content-Type must be application/json" });
    const body = await readBody(req, 1024);
    if (body.byteLength) {
      try {
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      } catch {
        throw badRequest("body must be JSON");
      }
    }
    if (!id || !isStoryId(id)) throw badRequest("invalid story id");
    return id;
  };

  const putFavorite = async (req: Request, [rawId]: string[]) => {
    const id = await checkFavoriteWrite(req, rawId);
    const existing = await cols.favorites.findOne({ _id: id });
    if (existing) return json(200, { story_id: id, favorite: true, created_at: existing.created_at.toISOString() });
    const s = await cols.stories.findOne({ _id: id });
    if (!s) throw notFound("story not found");
    const doc: FavoriteDoc = {
      _id: id,
      created_at: deps.now(),
      snapshot: {
        headline: s.headline,
        feed: s.feed,
        edition_id: s.edition_id,
        edition_date: s.edition_date,
        sort_date: s.sort_date,
      },
    };
    // Upsert so two concurrent PUTs both succeed and keep the first created_at.
    await cols.favorites.updateOne({ _id: id }, { $setOnInsert: doc }, { upsert: true });
    const saved = await cols.favorites.findOne({ _id: id });
    return json(200, { story_id: id, favorite: true, created_at: (saved ?? doc).created_at.toISOString() });
  };

  const deleteFavorite = async (req: Request, [rawId]: string[]) => {
    const id = await checkFavoriteWrite(req, rawId);
    await cols.favorites.deleteOne({ _id: id });
    return json(200, { story_id: id, favorite: false });
  };

  return [
    { pattern: /^\/api\/feeds$/, methods: { GET: getFeeds } },
    { pattern: /^\/api\/editions$/, methods: { GET: listEditions } },
    { pattern: /^\/api\/editions\/([^/]+)$/, methods: { GET: getEdition } },
    { pattern: /^\/api\/stories$/, methods: { GET: listStories } },
    { pattern: /^\/api\/stories\/([^/]+)$/, methods: { GET: getStory } },
    { pattern: /^\/api\/tags$/, methods: { GET: listTags } },
    { pattern: /^\/api\/favorites$/, methods: { GET: listFavorites } },
    { pattern: /^\/api\/favorites\/([^/]+)$/, methods: { PUT: putFavorite, DELETE: deleteFavorite } },
    { pattern: /^\/healthz$/, methods: { GET: healthHandler(deps) } },
  ];
}

export function healthHandler(deps: Pick<PublicDeps, "ping" | "kevStatus">) {
  return async () => {
    try {
      await deps.ping();
      return json(200, { status: "ok", mongo: "ok", kev: deps.kevStatus() });
    } catch {
      return json(503, { status: "error", mongo: "unreachable" });
    }
  };
}
