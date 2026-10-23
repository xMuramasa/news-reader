import { MongoServerError, type Collection, type Db, type IndexDescription } from "mongodb";
import { editionsValidator, storiesValidator, type EnrichedSource, type FeedId, type Markets, type Story } from "@news/schema";
import type { JevStored } from "./jev.ts";

export interface EditionDoc {
  _id: string;
  schema: string;
  feed: FeedId;
  edition_date: string;
  title: string;
  lead: string;
  language: string;
  markets: Markets | null;
  gaps: string[];
  source_run: { job_id: string; file: string };
  run_at: Date;
  generated_at: Date;
  ingested_at: Date;
  /** "ingesting" while its stories are being written; hidden from public reads until "ready". */
  state: "ingesting" | "ready";
  story_ids: string[];
  story_count: number;
  section_counts: Record<string, number>;
  warnings: string[];
}

export type StoryDoc = Omit<Story, "sources"> & {
  _id: string;
  edition_id: string;
  feed: FeedId;
  edition_date: string;
  run_at: Date;
  sort_date: string;
  position: number;
  sources: EnrichedSource[];
  cves: string[];
  /** Jev's topic probabilities (absent on stories stored before Jev, null when Jev was unavailable). */
  jev?: JevStored | null;
};

export interface FavoriteDoc {
  _id: string;
  created_at: Date;
  snapshot: { headline: string; feed: FeedId; edition_id: string; edition_date: string; sort_date: string };
}

export interface MetaDoc {
  _id: string;
  [key: string]: unknown;
}

export interface Collections {
  editions: Collection<EditionDoc>;
  stories: Collection<StoryDoc>;
  favorites: Collection<FavoriteDoc>;
  meta: Collection<MetaDoc>;
}

export function collections(db: Db): Collections {
  return {
    editions: db.collection<EditionDoc>("editions"),
    stories: db.collection<StoryDoc>("stories"),
    favorites: db.collection<FavoriteDoc>("favorites"),
    meta: db.collection<MetaDoc>("meta"),
  };
}

const INDEXES: Record<keyof Collections, IndexDescription[]> = {
  editions: [
    { key: { feed: 1, edition_date: -1 }, name: "feed_edition_date" },
    { key: { "source_run.job_id": 1, "source_run.file": 1 }, name: "source_run_unique", unique: true },
    { key: { feed: 1, run_at: -1 }, name: "feed_run_at" },
    { key: { run_at: -1 }, name: "run_at" },
  ],
  stories: [
    { key: { edition_id: 1, section: 1, rank: 1 }, name: "edition_section_rank" },
    { key: { feed: 1, sort_date: -1 }, name: "feed_sort_date" },
    { key: { tags: 1, sort_date: -1 }, name: "tags_sort_date" },
    { key: { thread: 1, sort_date: -1 }, name: "thread_sort_date" },
    { key: { sort_date: -1, run_at: -1, position: 1 }, name: "sort_order" },
    {
      key: { headline: "text", summary: "text", "details.label": "text", "details.text": "text", tags: "text" },
      name: "stories_text",
      default_language: "none",
      language_override: "text_language",
      weights: { headline: 5, summary: 3, tags: 2, "details.label": 1, "details.text": 1 },
    },
  ],
  favorites: [{ key: { created_at: -1 }, name: "created_at" }],
  meta: [],
};

const VALIDATED = {
  editions: editionsValidator,
  stories: storiesValidator,
} as const;

/** Create collections or update their validators, then create indexes. Safe to run on every start. */
export async function ensureSchema(db: Db): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of Object.keys(INDEXES) as (keyof Collections)[]) {
    const validator = name in VALIDATED ? VALIDATED[name as keyof typeof VALIDATED]() : undefined;
    const options = validator ? { validator, validationLevel: "strict", validationAction: "error" } : {};
    if (existing.has(name)) {
      if (validator) await db.command({ collMod: name, ...options });
    } else {
      try {
        await db.createCollection(name, options);
      } catch (err) {
        // another instance created it first
        if (!(err instanceof MongoServerError && err.code === 48)) throw err;
        if (validator) await db.command({ collMod: name, ...options });
      }
    }
    for (const index of INDEXES[name]) {
      try {
        await db.collection(name).createIndexes([index]);
      } catch (err) {
        // same name, different definition (e.g. after an upgrade): replace it
        if (err instanceof MongoServerError && (err.code === 85 || err.code === 86) && index.name) {
          await db.collection(name).dropIndex(index.name);
          await db.collection(name).createIndexes([index]);
        } else {
          throw err;
        }
      }
    }
  }
}
