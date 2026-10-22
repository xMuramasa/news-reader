// The news-edition/v1 contract. Strict about structure, forgiving about cosmetics: strings are trimmed and
// cleaned of control characters, ids are lower-cased, tags normalized. Unknown keys and tags outside the fixed lists
// are dropped with a warning; everything else that is wrong is an error.
import { z } from "zod";
import {
  FEEDS,
  FEED_IDS,
  SCHEMA_ID,
  VERIFICATIONS,
  coverageGroupIds,
  isFeedId,
  sectionIds,
  type FeedId,
} from "./feeds.ts";
import { normalizeStoryTags } from "./tags.ts";

export const LIMITS = {
  bodyBytes: 1_000_000,
  storiesMin: 1,
  storiesMax: 40,
  title: 200,
  lead: 600,
  slug: 80,
  thread: 80,
  rank: 100,
  headline: 200,
  summary: 1200,
  action: 600,
  blindspot: 600,
  details: 10,
  detailLabel: 60,
  detailText: 800,
  coverageOutlets: 20,
  outletName: 100,
  framing: 10,
  framingText: 600,
  sourcesMax: 10,
  url: 2048,
  tagsRaw: 40,
  tagRaw: 120,
  gaps: 10,
  gap: 500,
  marketItems: 12,
  marketName: 60,
  marketValue: 40,
} as const;

export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RUN_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/;
export const JOB_ID_RE = /^[0-9a-f]{12}$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// C0/C1 controls except tab and newline, zero-width and bidi override characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

export function cleanText(s: string, multiline: boolean): string {
  const t = s.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "");
  return (multiline ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ")).trim();
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isHttpUrl(s: string): boolean {
  if (/\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "" && !u.username && !u.password;
  } catch {
    return false;
  }
}

function text(max: number, opts: { min?: number; multiline?: boolean } = {}) {
  const min = opts.min ?? 1;
  return z
    .string()
    .overwrite((s) => cleanText(s, opts.multiline ?? false))
    .min(min, min === 1 ? "must not be empty" : `must be at least ${min} characters`)
    .max(max, `must be at most ${max} characters`);
}

/** Missing, null or blank -> null. */
function nullableText(max: number, opts: { multiline?: boolean } = {}) {
  return z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && cleanText(v, false) === "") ? null : v),
    text(max, opts).nullable(),
  );
}

const idLike = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "-");
const enumLike = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

function kebab(max: number) {
  return z
    .string()
    .overwrite(idLike)
    .regex(KEBAB_RE, "must be kebab-case (a-z, 0-9 and single hyphens)")
    .max(max, `must be at most ${max} characters`);
}

function oneOf(values: readonly string[], normalize: (s: string) => string = enumLike) {
  return z
    .string()
    .overwrite(normalize)
    .refine((v) => values.includes(v), { message: `must be one of: ${values.join(", ")}` });
}

const isoDate = z.string().trim().refine(isValidDate, "must be a date YYYY-MM-DD");

const nullableDate = z.preprocess(
  (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
  isoDate.nullable(),
);

const httpUrl = z
  .string()
  .trim()
  .max(LIMITS.url, `must be at most ${LIMITS.url} characters`)
  .refine(isHttpUrl, "must be an absolute http(s) URL");

export const sourceRunSchema = z.object({
  job_id: z.string().trim().regex(JOB_ID_RE, "must be a 12-character hex Hermes job id"),
  file: z
    .string()
    .trim()
    .regex(RUN_FILE_RE, "must be a run file name YYYY-MM-DD_HH-MM-SS.md")
    .refine((f) => isValidDate(f.slice(0, 10)), "must contain a valid date"),
});

const generatedAt = z
  .string()
  .trim()
  .refine((s) => DATETIME_RE.test(s) && !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time with offset");

const detailSchema = z.object({
  label: text(LIMITS.detailLabel),
  text: text(LIMITS.detailText, { multiline: true }),
});

const sourceSchema = z.object({
  outlet: text(LIMITS.outletName),
  url: httpUrl,
});

const marketsSchema = z.object({
  as_of: nullableDate,
  items: z
    .array(
      z.object({
        name: text(LIMITS.marketName),
        value: text(LIMITS.marketValue),
        change: nullableText(LIMITS.marketValue),
      }),
    )
    .max(LIMITS.marketItems, `must have at most ${LIMITS.marketItems} items`),
});

function storySchema(feed: FeedId) {
  const groups = coverageGroupIds(feed);
  return z
    .object({
      slug: kebab(LIMITS.slug),
      section: oneOf(sectionIds(feed)),
      rank: z.number().int("must be an integer").min(1, "must be at least 1").max(LIMITS.rank, `must be at most ${LIMITS.rank}`),
      headline: text(LIMITS.headline),
      summary: text(LIMITS.summary, { multiline: true }),
      event_date: nullableDate,
      is_update: z.boolean().default(false),
      thread: z.preprocess((v) => (v === "" ? null : v), kebab(LIMITS.thread).nullable().optional()),
      verification: oneOf(VERIFICATIONS),
      action: nullableText(LIMITS.action, { multiline: true }),
      details: z.array(detailSchema).max(LIMITS.details, `must have at most ${LIMITS.details} items`).default([]),
      coverage: z
        .array(
          z.object({
            group: oneOf(groups),
            covered: z.boolean(),
            outlets: z
              .array(text(LIMITS.outletName))
              .max(LIMITS.coverageOutlets, `must have at most ${LIMITS.coverageOutlets} outlets`)
              .default([]),
          }),
        )
        .max(groups.length, `must have at most ${groups.length} groups`)
        .default([])
        .superRefine((cov, ctx) => {
          const seen = new Set<string>();
          cov.forEach((c, i) => {
            if (seen.has(c.group)) ctx.addIssue({ code: "custom", message: `duplicate group "${c.group}"`, path: [i, "group"] });
            seen.add(c.group);
          });
        }),
      framing: z
        .array(z.object({ group: oneOf(groups), text: text(LIMITS.framingText, { multiline: true }) }))
        .max(LIMITS.framing, `must have at most ${LIMITS.framing} items`)
        .default([]),
      blindspot: nullableText(LIMITS.blindspot, { multiline: true }),
      sources: z.array(sourceSchema).max(LIMITS.sourcesMax, `must have at most ${LIMITS.sourcesMax} sources`),
      tags: z
        .array(z.string().max(LIMITS.tagRaw, `must be at most ${LIMITS.tagRaw} characters`))
        .max(LIMITS.tagsRaw, `must have at most ${LIMITS.tagsRaw} tags`)
        .default([]),
    })
    .transform((s) => ({ ...s, thread: s.thread ?? s.slug }));
}

function editionSchema(feed: FeedId) {
  return z.object({
    schema: z.literal(SCHEMA_ID, `must be "${SCHEMA_ID}"`),
    feed: z.literal(feed),
    edition_date: isoDate,
    title: text(LIMITS.title),
    lead: text(LIMITS.lead, { multiline: true }),
    language: z
      .string()
      .overwrite((s) => s.trim().toLowerCase())
      .regex(/^[a-z]{2}$/, "must be a two-letter language code")
      .default("en"),
    stories: z
      .array(storySchema(feed))
      .min(LIMITS.storiesMin, `must have ${LIMITS.storiesMin}-${LIMITS.storiesMax} stories`)
      .max(LIMITS.storiesMax, `must have ${LIMITS.storiesMin}-${LIMITS.storiesMax} stories`)
      .superRefine((stories, ctx) => {
        const seen = new Set<string>();
        stories.forEach((s, i) => {
          if (seen.has(s.slug)) ctx.addIssue({ code: "custom", message: `duplicate slug "${s.slug}"`, path: [i, "slug"] });
          seen.add(s.slug);
        });
      }),
    markets: marketsSchema.nullable().optional(),
    gaps: z
      .array(text(LIMITS.gap, { multiline: true }))
      .max(LIMITS.gaps, `must have at most ${LIMITS.gaps} items`)
      .default([]),
    source_run: sourceRunSchema.optional(),
    generated_at: generatedAt.optional(),
  });
}

const schemaCache = new Map<FeedId, ReturnType<typeof editionSchema>>();
function schemaFor(feed: FeedId) {
  let s = schemaCache.get(feed);
  if (!s) {
    s = editionSchema(feed);
    schemaCache.set(feed, s);
  }
  return s;
}

export type Edition = z.output<ReturnType<typeof editionSchema>>;
export type Story = Edition["stories"][number];
export type SourceRun = z.output<typeof sourceRunSchema>;
export type Markets = z.output<typeof marketsSchema>;

// Known keys, for "unknown field" warnings (zod strips unknown keys silently).
const KEYS = {
  edition: Object.keys(editionSchema("chile").shape),
  story: [
    "slug",
    "section",
    "rank",
    "headline",
    "summary",
    "event_date",
    "is_update",
    "thread",
    "verification",
    "action",
    "details",
    "coverage",
    "framing",
    "blindspot",
    "sources",
    "tags",
  ],
  detail: Object.keys(detailSchema.shape),
  coverage: ["group", "covered", "outlets"],
  framing: ["group", "text"],
  source: Object.keys(sourceSchema.shape),
  markets: Object.keys(marketsSchema.shape),
  marketItem: ["name", "value", "change"],
  sourceRun: Object.keys(sourceRunSchema.shape),
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function unknownKeys(obj: unknown, known: readonly string[], path: string, out: string[]): void {
  if (!isPlainObject(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!known.includes(k)) out.push(`${path ? path + "." : ""}${k.slice(0, 60)}: dropped unknown field`);
  }
}

function eachItem(arr: unknown, known: readonly string[], path: string, out: string[]): void {
  if (!Array.isArray(arr)) return;
  arr.forEach((item, i) => unknownKeys(item, known, `${path}[${i}]`, out));
}

function collectUnknownKeys(edition: Record<string, unknown>, out: string[]): void {
  unknownKeys(edition, KEYS.edition, "", out);
  unknownKeys(edition.source_run, KEYS.sourceRun, "source_run", out);
  if (isPlainObject(edition.markets)) {
    unknownKeys(edition.markets, KEYS.markets, "markets", out);
    eachItem(edition.markets.items, KEYS.marketItem, "markets.items", out);
  }
  if (!Array.isArray(edition.stories)) return;
  edition.stories.forEach((s, i) => {
    const p = `stories[${i}]`;
    unknownKeys(s, KEYS.story, p, out);
    if (!isPlainObject(s)) return;
    eachItem(s.details, KEYS.detail, `${p}.details`, out);
    eachItem(s.coverage, KEYS.coverage, `${p}.coverage`, out);
    eachItem(s.framing, KEYS.framing, `${p}.framing`, out);
    eachItem(s.sources, KEYS.source, `${p}.sources`, out);
  });
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += (out ? "." : "") + String(p);
  }
  return out || "(edition)";
}

function formatIssue(issue: z.core.$ZodIssue): string {
  let msg = issue.message;
  if (issue.code === "invalid_type" && /received undefined/.test(msg)) msg = "is required";
  else if (issue.code === "invalid_type") msg = `must be ${issue.expected}`;
  return `${formatPath(issue.path)}: ${msg}`;
}

export const MAX_REPORTED_ERRORS = 50;

export interface ValidateOptions {
  /** The API requires `source_run` and `generated_at`, which the publisher adds. */
  requireSourceRun?: boolean;
  /** Size of the raw body in bytes, when known. Otherwise the size of the re-serialized JSON is used. */
  bodyBytes?: number;
}

export type ValidationResult =
  | { ok: true; edition: Edition; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function validateEdition(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const warnings: string[] = [];
  const bytes = opts.bodyBytes ?? utf8Length(JSON.stringify(input) ?? "");
  if (bytes > LIMITS.bodyBytes) {
    return { ok: false, errors: [`(edition): larger than ${LIMITS.bodyBytes} bytes`], warnings };
  }
  if (!isPlainObject(input)) return { ok: false, errors: ["(edition): must be a JSON object"], warnings };

  const errors: string[] = [];
  if (input.schema !== SCHEMA_ID) errors.push(`schema: must be "${SCHEMA_ID}"`);
  const feedRaw = typeof input.feed === "string" ? input.feed.trim().toLowerCase() : input.feed;
  if (!isFeedId(feedRaw)) {
    errors.push(
      input.feed === undefined ? "feed: is required" : `feed: unknown feed, must be one of: ${FEED_IDS.join(", ")}`,
    );
    return { ok: false, errors, warnings };
  }
  const feed = feedRaw;
  const data: Record<string, unknown> = { ...input, feed };
  if (!FEEDS[feed].markets && data.markets !== undefined && data.markets !== null) {
    warnings.push(`markets: dropped, feed ${feed} has no markets`);
    delete data.markets;
  }
  collectUnknownKeys(data, warnings);

  const parsed = schemaFor(feed).safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const line = formatIssue(issue);
      if (!errors.includes(line)) errors.push(line);
    }
  }
  if (opts.requireSourceRun) {
    if (data.source_run === undefined) errors.push("source_run: is required");
    if (data.generated_at === undefined) errors.push("generated_at: is required");
  }
  if (errors.length || !parsed.success) {
    return { ok: false, errors: errors.slice(0, MAX_REPORTED_ERRORS), warnings };
  }

  const edition = parsed.data;
  edition.stories = edition.stories.map((s, i) => {
    const r = normalizeStoryTags(feed, s.tags, `stories[${i}].tags`);
    warnings.push(...r.warnings);
    return { ...s, tags: r.tags };
  });
  return { ok: true, edition, warnings };
}

/** `<feed>-<YYYYMMDD>-<HHMMSS>` from the run file name `YYYY-MM-DD_HH-MM-SS.md`. */
export function editionIdFor(feed: FeedId, runFile: string): string {
  const m = RUN_FILE_RE.exec(runFile);
  if (!m) throw new Error(`not a run file name: ${runFile}`);
  return `${feed}-${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}

export const EDITION_ID_RE = new RegExp(`^(?:${FEED_IDS.join("|")})-\\d{8}-\\d{6}$`);
export const STORY_ID_RE = new RegExp(`^(?:${FEED_IDS.join("|")})-\\d{8}-\\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
export const MAX_STORY_ID_LENGTH = 24 + LIMITS.slug;

export function storyIdFor(editionId: string, slug: string): string {
  return `${editionId}-${slug}`;
}

export function isEditionId(s: string): boolean {
  return s.length <= 24 && EDITION_ID_RE.test(s);
}

export function isStoryId(s: string): boolean {
  return s.length <= MAX_STORY_ID_LENGTH && STORY_ID_RE.test(s);
}
