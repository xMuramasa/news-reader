// MongoDB $jsonSchema validators for the stored `editions` and `stories` documents (Mongo dialect: bsonType, no
// $schema, no formats). Built from the same lists and limits as the zod schema. The API's validation is the main
// check; these are the backstop.
import { ALL_COVERAGE_GROUPS, ALL_SECTIONS, FEED_IDS, SCHEMA_ID, VERIFICATIONS } from "./feeds.ts";
import { EDITION_ID_RE, JOB_ID_RE, LIMITS, RUN_FILE_RE, STORY_ID_RE, MAX_STORY_ID_LENGTH } from "./edition.ts";
import { MAX_TAG_LENGTH, TAG_RE } from "./tags.ts";

export type MongoJsonSchema = { [key: string]: unknown };

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const URL_PATTERN = "^[Hh][Tt][Tt][Pp][Ss]?://";
const KEBAB_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

const str = (maxLength: number, minLength = 1): MongoJsonSchema => ({ bsonType: "string", minLength, maxLength });
const nullableStr = (maxLength: number): MongoJsonSchema => ({ bsonType: ["string", "null"], maxLength });
const int = (minimum: number, maximum?: number): MongoJsonSchema => ({
  bsonType: ["int", "long"],
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const arr = (items: MongoJsonSchema, maxItems?: number, minItems = 0): MongoJsonSchema => ({
  bsonType: "array",
  items,
  minItems,
  ...(maxItems === undefined ? {} : { maxItems }),
});
const obj = (properties: Record<string, MongoJsonSchema>, required: string[] = Object.keys(properties)): MongoJsonSchema => ({
  bsonType: "object",
  required,
  additionalProperties: false,
  properties,
});
const nullableObj = (properties: Record<string, MongoJsonSchema>): MongoJsonSchema => ({
  ...obj(properties),
  bsonType: ["object", "null"],
});
const enumOf = (values: readonly string[]): MongoJsonSchema => ({ bsonType: "string", enum: [...values] });
const pattern = (re: RegExp, maxLength?: number): MongoJsonSchema => ({
  bsonType: "string",
  pattern: re.source,
  ...(maxLength === undefined ? {} : { maxLength }),
});

export function editionsValidator(): { $jsonSchema: MongoJsonSchema } {
  return {
    $jsonSchema: obj({
      _id: pattern(EDITION_ID_RE, 24),
      schema: enumOf([SCHEMA_ID]),
      feed: enumOf(FEED_IDS),
      edition_date: { bsonType: "string", pattern: DATE_PATTERN },
      title: str(LIMITS.title),
      lead: str(LIMITS.lead),
      language: { bsonType: "string", pattern: "^[a-z]{2}$" },
      markets: nullableObj({
        as_of: { bsonType: ["string", "null"], pattern: DATE_PATTERN },
        items: arr(
          obj({ name: str(LIMITS.marketName), value: str(LIMITS.marketValue), change: nullableStr(LIMITS.marketValue) }),
          LIMITS.marketItems,
        ),
      }),
      gaps: arr(str(LIMITS.gap), LIMITS.gaps),
      source_run: obj({ job_id: pattern(JOB_ID_RE), file: pattern(RUN_FILE_RE) }),
      run_at: { bsonType: "date" },
      generated_at: { bsonType: "date" },
      ingested_at: { bsonType: "date" },
      state: enumOf(["ingesting", "ready"]),
      story_ids: arr(pattern(STORY_ID_RE, MAX_STORY_ID_LENGTH), LIMITS.storiesMax),
      story_count: int(0, LIMITS.storiesMax),
      section_counts: { bsonType: "object", additionalProperties: int(0, LIMITS.storiesMax) },
      warnings: arr({ bsonType: "string" }, 500),
    }),
  };
}

/** Fields a story may lack: `jev` is absent on stories stored before Jev tagging and when it is switched off. */
const OPTIONAL_STORY_FIELDS = new Set(["jev"]);

export function storiesValidator(): { $jsonSchema: MongoJsonSchema } {
  const properties: Record<string, MongoJsonSchema> = {
    _id: pattern(STORY_ID_RE, MAX_STORY_ID_LENGTH),
    edition_id: pattern(EDITION_ID_RE, 24),
    feed: enumOf(FEED_IDS),
    edition_date: { bsonType: "string", pattern: DATE_PATTERN },
    run_at: { bsonType: "date" },
    sort_date: { bsonType: "string", pattern: DATE_PATTERN },
    position: int(0, LIMITS.storiesMax),
    slug: { bsonType: "string", pattern: KEBAB_PATTERN, maxLength: LIMITS.slug },
    section: enumOf(ALL_SECTIONS),
    rank: int(1, LIMITS.rank),
    headline: str(LIMITS.headline),
    summary: str(LIMITS.summary),
    event_date: { bsonType: ["string", "null"], pattern: DATE_PATTERN },
    is_update: { bsonType: "bool" },
    thread: { bsonType: "string", pattern: KEBAB_PATTERN, maxLength: LIMITS.thread },
    verification: enumOf(VERIFICATIONS),
    action: nullableStr(LIMITS.action),
    details: arr(obj({ label: str(LIMITS.detailLabel), text: str(LIMITS.detailText) }), LIMITS.details),
    coverage: arr(
      obj({
        group: enumOf(ALL_COVERAGE_GROUPS),
        covered: { bsonType: "bool" },
        outlets: arr(str(LIMITS.outletName), LIMITS.coverageOutlets),
      }),
      ALL_COVERAGE_GROUPS.length,
    ),
    framing: arr(obj({ group: enumOf(ALL_COVERAGE_GROUPS), text: str(LIMITS.framingText) }), LIMITS.framing),
    blindspot: nullableStr(LIMITS.blindspot),
    sources: arr(
      obj({
        outlet: str(LIMITS.outletName),
        url: { bsonType: "string", pattern: URL_PATTERN, maxLength: LIMITS.url },
        outlet_slug: { bsonType: "string", maxLength: 80 },
        group: { bsonType: ["string", "null"] },
        lean: { bsonType: ["string", "null"] },
      }),
      LIMITS.sourcesMax,
    ),
    tags: arr(pattern(TAG_RE, MAX_TAG_LENGTH), 200),
    cves: arr({ bsonType: "string", pattern: "^CVE-\\d{4}-\\d{4,7}$" }, 200),
    jev: {
      ...obj({
        model: str(80),
        threshold: { bsonType: ["double", "int", "long"], minimum: 0, maximum: 1 },
        probabilities: {
          bsonType: "object",
          additionalProperties: { bsonType: ["double", "int", "long"], minimum: 0, maximum: 1 },
        },
        applied: { bsonType: "bool" },
        ai_topics: arr({ bsonType: "string", pattern: KEBAB_PATTERN, maxLength: 60 }, 40),
        input_hash: { bsonType: "string", pattern: "^[0-9a-f]{64}$" },
        classified_at: { bsonType: "date" },
      }),
      bsonType: ["object", "null"],
    },
  };
  return { $jsonSchema: obj(properties, Object.keys(properties).filter((k) => !OPTIONAL_STORY_FIELDS.has(k))) };
}
