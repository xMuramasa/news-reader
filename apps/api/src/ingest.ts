// POST /ingest/editions: validate, split into stories, derive tags, store. Replace semantics keyed by source_run.
//
// Standalone Mongo has no transactions, so the writes are ordered to heal on a re-POST of the same run:
//   1. upsert the edition document with state "ingesting" (public reads hide it and its stories from now on)
//   2. upsert every story of the new version
//   3. delete stories of this edition that are not in the new version
//   4. mark the edition "ready"
// Every step is idempotent. A failure anywhere leaves the edition hidden; re-posting runs all four steps again.
//
// With Jev configured, story topics are classified before the writes (see jev.ts). Jev being down never fails an
// ingest: those stories keep the briefing model's topics.
import { createHash, timingSafeEqual } from "node:crypto";
import {
  FEEDS,
  LIMITS,
  deriveTags,
  editionIdFor,
  storyIdFor,
  validateEdition,
  type FeedId,
  type OutletIndex,
  type StackMatcher,
} from "@news/schema";
import { MongoServerError } from "mongodb";
import type { Collections, EditionDoc, StoryDoc } from "./db.ts";
import { HttpError, isJsonContentType, json, readBody } from "./http.ts";
import { tagStories, type JevClassifier, type JevStored } from "./jev.ts";
import type { Logger } from "./log.ts";

export type IngestStep = "edition" | "stories" | "prune" | "ready";

export interface IngestDeps {
  cols: Collections;
  outlets: OutletIndex;
  stack: StackMatcher;
  isKev: (cve: string) => boolean;
  now: () => Date;
  /** Topic classifier; null or absent keeps the briefing model's topics. */
  jev?: JevClassifier | null;
  /** Time budget for classifying one edition, so the publisher's POST doesn't time out. */
  jevDeadlineMs?: number;
  log?: Logger;
  /** Test hook, called after each write step. */
  afterStep?: (step: IngestStep, editionId: string) => void | Promise<void>;
}

export interface IngestResult {
  status: 200 | 201;
  edition_id: string;
  stories: number;
  warnings: string[];
}

const MAX_STORED_WARNINGS = 200;

// One ingest at a time per edition, so two overlapping POSTs of the same run can't interleave their writes.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

export async function ingestEdition(deps: IngestDeps, raw: unknown, bodyBytes?: number): Promise<IngestResult> {
  const v = validateEdition(raw, { requireSourceRun: true, ...(bodyBytes === undefined ? {} : { bodyBytes }) });
  if (!v.ok) throw new HttpError(422, { errors: v.errors, warnings: v.warnings });
  const e = v.edition;
  const sr = e.source_run!;
  const feed = FEEDS[e.feed];
  if (sr.job_id !== feed.jobId) {
    throw new HttpError(422, {
      errors: [`source_run.job_id: ${sr.job_id} is not the ${feed.id} job (${feed.jobId})`],
      warnings: v.warnings,
    });
  }
  const editionId = editionIdFor(e.feed, sr.file);
  const runAt = new Date(e.generated_at!);
  const now = deps.now();

  const stories: StoryDoc[] = e.stories.map((s, position) => {
    const d = deriveTags(s, { feed: e.feed, outlets: deps.outlets, stack: deps.stack, isKev: deps.isKev });
    // A story about something coming up (a deadline, a scheduled vote) is still news of the edition's day.
    const sortDate = s.event_date && s.event_date <= e.edition_date ? s.event_date : e.edition_date;
    return {
      ...s,
      _id: storyIdFor(editionId, s.slug),
      edition_id: editionId,
      feed: e.feed,
      edition_date: e.edition_date,
      run_at: runAt,
      sort_date: sortDate,
      position,
      sources: d.sources,
      tags: [...new Set([...s.tags, ...d.tags])],
      cves: d.cves,
    };
  });
  const sectionCounts: Record<string, number> = {};
  for (const s of stories) sectionCounts[s.section] = (sectionCounts[s.section] ?? 0) + 1;

  const editionDoc: EditionDoc = {
    _id: editionId,
    schema: e.schema,
    feed: e.feed,
    edition_date: e.edition_date,
    title: e.title,
    lead: e.lead,
    language: e.language,
    markets: e.markets ?? null,
    gaps: e.gaps,
    source_run: { job_id: sr.job_id, file: sr.file },
    run_at: runAt,
    generated_at: runAt,
    ingested_at: now,
    state: "ingesting",
    story_ids: stories.map((s) => s._id),
    story_count: stories.length,
    section_counts: sectionCounts,
    warnings: v.warnings.slice(0, MAX_STORED_WARNINGS).map((w) => w.slice(0, 300)),
  };

  return withLock(editionId, async () => {
    const { cols } = deps;
    const existing = await cols.editions.findOne({ _id: editionId }, { projection: { state: 1 } });
    if (deps.jev) await classifyTopics(deps, deps.jev, editionId, e.feed, e.stories, stories);
    try {
      await cols.editions.replaceOne({ _id: editionId }, editionDoc, { upsert: true });
      await deps.afterStep?.("edition", editionId);
      await cols.stories.bulkWrite(
        stories.map((s) => ({ replaceOne: { filter: { _id: s._id }, replacement: s, upsert: true } })),
        { ordered: false },
      );
      await deps.afterStep?.("stories", editionId);
      await cols.stories.deleteMany({ edition_id: editionId, _id: { $nin: editionDoc.story_ids } });
      await deps.afterStep?.("prune", editionId);
      await cols.editions.updateOne({ _id: editionId }, { $set: { state: "ready" } });
      await deps.afterStep?.("ready", editionId);
    } catch (err) {
      // The database's own validator is the backstop: report it like any other validation failure.
      if (err instanceof MongoServerError && err.code === 121) {
        throw new HttpError(422, { errors: ["(edition): rejected by the database validator"], warnings: v.warnings });
      }
      throw err;
    }
    return {
      status: existing?.state === "ready" ? 200 : 201,
      edition_id: editionId,
      stories: stories.length,
      warnings: v.warnings,
    } satisfies IngestResult;
  });
}

/**
 * Replace each story's `topic:` tags with Jev's (in place). Results already stored for this edition are reused when
 * the story text is unchanged, so re-posting a run costs nothing.
 */
async function classifyTopics(
  deps: IngestDeps,
  jev: JevClassifier,
  editionId: string,
  feed: FeedId,
  raw: { tags: string[] }[],
  stories: StoryDoc[],
): Promise<void> {
  const cached = new Map<string, JevStored>();
  const prior = await deps.cols.stories
    .find({ edition_id: editionId, jev: { $type: "object" } }, { projection: { jev: 1 } })
    .toArray();
  for (const p of prior) if (p.jev) cached.set(p.jev.input_hash, p.jev);

  // Classify on the briefing model's tags only; the derived tags (outlet, cve, stack…) are added back afterwards.
  const input = stories.map((s, i) => ({ headline: s.headline, summary: s.summary, details: s.details, tags: raw[i]!.tags }));
  const r = await tagStories(jev, feed, input, {
    cached,
    now: deps.now,
    ...(deps.jevDeadlineMs === undefined ? {} : { deadlineMs: deps.jevDeadlineMs }),
  });
  stories.forEach((s, i) => {
    const o = r.outcomes[i]!;
    if (!o.jev) return;
    const derived = s.tags.filter((t) => !raw[i]!.tags.includes(t));
    s.tags = [...new Set([...o.tags, ...derived])];
    s.jev = o.jev;
  });
  const fields = {
    edition_id: editionId,
    classified: r.classified,
    reused: r.reused,
    failed: r.failed,
    input_tokens: r.inputTokens,
    replaced: stories.filter((s) => s.jev?.applied).length,
  };
  if (r.failed) deps.log?.warn("jev: some stories kept the briefing topics", { ...fields, errors: r.errors });
  else deps.log?.info("jev: tagged", fields);
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time bearer token check (hashing first makes the comparison length-independent). */
export function checkBearer(header: string | null, token: string): boolean {
  const m = header ? /^Bearer ([^\s]+)$/.exec(header.trim()) : null;
  const given = m?.[1] ?? "";
  return timingSafeEqual(sha256(given), sha256(token)) && given.length > 0;
}

export function ingestHandler(deps: IngestDeps, token: string) {
  return async (req: Request): Promise<Response> => {
    if (!checkBearer(req.headers.get("authorization"), token)) {
      throw new HttpError(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }
    if (!isJsonContentType(req)) throw new HttpError(415, { error: "Content-Type must be application/json" });
    const bytes = await readBody(req, LIMITS.bodyBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (err) {
      const why = err instanceof SyntaxError ? "body is not valid JSON" : "body is not valid UTF-8";
      throw new HttpError(422, { errors: [why], warnings: [] });
    }
    const r = await ingestEdition(deps, parsed, bytes.byteLength);
    return json(r.status, { edition_id: r.edition_id, stories: r.stories, warnings: r.warnings });
  };
}
