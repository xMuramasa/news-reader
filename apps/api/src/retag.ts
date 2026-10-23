// Re-tag stored stories with Jev. For stories stored before Jev was switched on, or after a change of threshold.
//
//   bun apps/api/src/retag.ts                 classify stories that have no Jev result yet
//   bun apps/api/src/retag.ts --reapply       no API calls: re-apply stored probabilities with the current threshold
//   bun apps/api/src/retag.ts --force         classify every story again (costs credit)
//   bun apps/api/src/retag.ts --feed chile    limit to one feed (combines with the above)
//
// Uses the same environment as the server (MONGO_URL, MONGO_DB, TYPESAFE_AI_API_KEY, JEV_*); in the container:
//   docker exec news-api bun apps/api/src/retag.ts
import { FEED_IDS, type FeedId } from "@news/schema";
import { MongoClient, type Filter } from "mongodb";
import { ConfigError, loadConfig } from "./config.ts";
import { collections, type Collections, type StoryDoc } from "./db.ts";
import { applyTopics, tagStories, typesafeClassifier, type JevClassifier } from "./jev.ts";

export interface RetagOptions {
  feed?: FeedId;
  mode: "missing" | "force" | "reapply";
  now?: () => Date;
}

export interface RetagSummary {
  stories: number;
  classified: number;
  reapplied: number;
  failed: number;
  changed: number;
  inputTokens: number;
  errors: string[];
}

/** The briefing model's own topics: kept on the Jev record once Jev has replaced them. */
function aiTopicTags(s: StoryDoc): string[] {
  const own = s.jev?.ai_topics ?? s.tags.filter((t) => t.startsWith("topic:")).map((t) => t.slice("topic:".length));
  return own.map((t) => `topic:${t}`);
}

export async function retag(cols: Collections, jev: JevClassifier | null, o: RetagOptions): Promise<RetagSummary> {
  const filter: Filter<StoryDoc> = o.feed ? { feed: o.feed } : {};
  if (o.mode === "missing") filter.jev = { $not: { $type: "object" } };
  if (o.mode === "reapply") filter.jev = { $type: "object" };
  const docs = await cols.stories.find(filter).sort({ _id: 1 }).toArray();
  const sum: RetagSummary = { stories: docs.length, classified: 0, reapplied: 0, failed: 0, changed: 0, inputTokens: 0, errors: [] };
  const threshold = jev?.threshold;

  const write = async (s: StoryDoc, tags: string[], update: Partial<StoryDoc>) => {
    const unchanged = tags.length === s.tags.length && tags.every((t, i) => t === s.tags[i]);
    if (!unchanged) sum.changed++;
    await cols.stories.updateOne({ _id: s._id }, { $set: { tags, ...update } });
  };

  for (const feed of FEED_IDS) {
    const batch = docs.filter((d) => d.feed === feed);
    if (!batch.length) continue;

    if (o.mode === "reapply") {
      if (threshold === undefined) throw new Error("reapply needs TYPESAFE_AI_API_KEY (for the configured threshold)");
      for (const s of batch) {
        const own = aiTopicTags(s);
        const base = [...own, ...s.tags.filter((t) => !t.startsWith("topic:"))];
        const r = applyTopics(feed, base, s.jev!.probabilities, threshold);
        await write(s, r.tags, { jev: { ...s.jev!, threshold, applied: r.applied } });
        sum.reapplied++;
      }
      continue;
    }

    if (!jev) throw new Error("TYPESAFE_AI_API_KEY is not set");
    // Classify on the briefing model's topics; everything else on the story (region, org, outlet, cve…) stays.
    const input = batch.map((s) => ({
      headline: s.headline,
      summary: s.summary,
      details: s.details,
      tags: [...aiTopicTags(s), ...s.tags.filter((t) => !t.startsWith("topic:"))],
    }));
    const r = await tagStories(jev, feed, input, { deadlineMs: 120_000, concurrency: 4, ...(o.now ? { now: o.now } : {}) });
    sum.classified += r.classified;
    sum.failed += r.failed;
    sum.inputTokens += r.inputTokens;
    sum.errors.push(...r.errors.slice(0, 5 - sum.errors.length));
    for (const [i, s] of batch.entries()) {
      const out = r.outcomes[i]!;
      if (out.jev) await write(s, out.tags, { jev: out.jev });
    }
  }
  return sum;
}

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const feedIdx = argv.indexOf("--feed");
  const feed = feedIdx >= 0 ? argv[feedIdx + 1] : undefined;
  const known = new Set(["--reapply", "--force", "--feed"]);
  const unknown = [...flags].filter((f) => !known.has(f));
  if (unknown.length || (feed !== undefined && !(FEED_IDS as readonly string[]).includes(feed)) || (flags.has("--reapply") && flags.has("--force"))) {
    console.error("usage: retag.ts [--reapply | --force] [--feed chile|cyber|ai]");
    return 2;
  }
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : String(err));
    return 1;
  }
  const jev = config.jev ? typesafeClassifier({ apiKey: config.jev.apiKey, url: config.jev.url, model: config.jev.model, threshold: config.jev.threshold }) : null;
  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 10_000, appName: "news-retag" });
  try {
    await client.connect();
    const mode = flags.has("--reapply") ? "reapply" : flags.has("--force") ? "force" : "missing";
    const sum = await retag(collections(client.db(config.mongoDb)), jev, { mode, ...(feed ? { feed: feed as FeedId } : {}) });
    console.log(JSON.stringify({ mode, ...(feed ? { feed } : {}), threshold: jev?.threshold ?? null, ...sum }));
    return sum.failed ? 1 : 0;
  } catch (err) {
    console.error(`retag failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await client.close();
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
