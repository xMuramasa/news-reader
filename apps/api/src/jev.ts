// Topic tagging with Jev (TypeSafe's System One classifier) at ingest time.
//
// One request per story: one Noul (yes/no probability) per topic of the story's feed. Topics at or above the threshold
// replace the briefing model's own `topic:` tags; region, status, org and the derived tags are untouched. When Jev
// can't be reached, times out, or no topic clears the threshold, the model's topics stay. Results are stored on the
// story (`jev`) with an input hash, so re-posting the same run reuses them instead of paying again.
//
// The API key is only ever put in the Authorization header: never in errors, logs or stored documents.
import { createHash } from "node:crypto";
import { FEEDS, type FeedId } from "@news/schema";

export const DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_JEV_THRESHOLD = 0.85;
/** At most this many topics per story (highest probability first). */
export const MAX_JEV_TOPICS = 4;

/** What each topic means, sent to Jev with the question. Must cover exactly each feed's topic list (tested). */
export const TOPIC_DESCRIPTIONS: Record<FeedId, Record<string, string>> = {
  chile: {
    politics: "party politics, coalitions, elections, political conflict",
    government: "actions or appointments of the national government or its ministries",
    congress: "the Senate or Chamber of Deputies, bills, votes, committees",
    economy: "economic policy, growth, budget, taxes, central bank, inflation",
    markets: "stock market, currency, interest rates, financial markets, investors",
    pensions: "pension funds (AFP), retirement savings, pension reform",
    "security-crime": "crime, policing, violence, public security",
    courts: "courts, judges, prosecutors, lawsuits, rulings",
    corruption: "corruption, bribery, misuse of public funds, influence peddling",
    migration: "immigration, migrants, expulsions, borders",
    environment: "environment, pollution, water, climate, environmental permits",
    disasters: "storms, earthquakes, fires, floods, avalanches, emergencies",
    health: "health system, hospitals, diseases, medical care",
    education: "schools, universities, teachers, students",
    labor: "jobs, unemployment, wages, unions, strikes",
    housing: "housing, rent, home ownership, construction of homes",
    indigenous: "Mapuche or other indigenous peoples, their rights or conflicts",
    "foreign-relations": "relations with other countries, diplomacy, trade agreements",
    media: "news media, journalism, press freedom, misinformation, fact-checks",
    society: "social issues, culture, protests, gender, religion, everyday life",
  },
  cyber: {
    vulnerability: "software or hardware vulnerabilities, CVEs, security patches",
    exploited: "vulnerabilities being actively exploited in attacks",
    ransomware: "ransomware attacks or ransomware gangs",
    "data-breach": "data breaches, leaks or stolen personal data",
    malware: "malware, trojans, botnets, cryptominers, infostealers",
    phishing: "phishing, social engineering, scam campaigns, ClickFix lures",
    "supply-chain": "software supply chain attacks, compromised packages, vendors or update channels",
    apt: "state-sponsored or advanced persistent threat groups, espionage",
    "ai-security": "security of AI systems, or attackers using AI",
    "pki-crypto": "certificates, certificate authorities, encryption, cryptography",
    cloud: "cloud services and platforms (AWS, Azure, Google Cloud, SaaS)",
    mobile: "phones, Android, iOS, mobile apps",
    "ics-ot": "industrial control systems, operational technology, critical infrastructure equipment",
    identity: "authentication, passwords, MFA, single sign-on, identity providers",
    privacy: "privacy, surveillance, tracking, personal data protection",
    "law-enforcement": "arrests, takedowns, sanctions or indictments of cybercriminals",
    policy: "government cybersecurity policy, laws, regulation, official guidance",
    research: "security research findings, new attack techniques or analyses",
  },
  ai: {
    "model-release": "release of a new AI model or model version",
    "open-weights": "AI models whose weights are published for download",
    "local-ai": "running AI models locally on personal hardware",
    agents: "AI agents that take actions, use tools or run tasks on their own",
    research: "AI research papers, benchmarks, scientific findings",
    safety: "AI safety, alignment, misuse risks, AI incidents",
    security: "security of AI systems, attacks on or with AI",
    "policy-regulation": "AI laws, regulation, government policy, lawsuits",
    "funding-business": "AI company funding, revenue, deals, IPOs, business strategy",
    hardware: "chips, GPUs, computers or data centers for AI",
    product: "AI products, apps or features for users or developers",
    "open-source-tools": "open-source AI software, libraries, frameworks, tools",
  },
};

const STORY_KIND: Record<FeedId, string> = {
  chile: "Chilean news story",
  cyber: "cybersecurity news story",
  ai: "AI news story",
};

export interface JevInput {
  headline: string;
  summary: string;
  details: { label: string; text: string }[];
}

export interface JevResult {
  /** The model that answered (the alias resolves to a version, e.g. jev-1.14.0). */
  model: string;
  /** Probability per topic of the feed, 0-1. */
  probabilities: Record<string, number>;
  inputTokens: number;
}

export interface JevClassifier {
  readonly model: string;
  readonly threshold: number;
  classify(feed: FeedId, story: JevInput, signal?: AbortSignal): Promise<JevResult>;
}

/** What is stored on the story document. */
export interface JevStored {
  model: string;
  threshold: number;
  probabilities: Record<string, number>;
  /** true when Jev's topics replaced the briefing model's. */
  applied: boolean;
  /** The briefing model's own topics, kept so the story can be re-tagged later. */
  ai_topics: string[];
  input_hash: string;
  classified_at: Date;
}

const questionId = (topic: string) => `topic_${topic.replace(/-/g, "_")}`;

export function jevRequest(model: string, feed: FeedId, story: JevInput) {
  const questions: Record<string, { type: "noul"; instructions: string }> = {};
  for (const topic of FEEDS[feed].topics) {
    const desc = TOPIC_DESCRIPTIONS[feed][topic];
    questions[questionId(topic)] = {
      type: "noul",
      instructions: `Is this ${STORY_KIND[feed]} about ${topic.replace(/-/g, " ")}${desc ? ` (${desc})` : ""}?`,
    };
  }
  return {
    model,
    state: {
      headline: story.headline,
      summary: story.summary,
      details: story.details.map((d) => `${d.label}: ${d.text}`),
    },
    questions,
  };
}

/** Validate a System One response and pull out one probability per topic. Throws on anything unexpected. */
export function parseJevResponse(feed: FeedId, body: unknown): JevResult {
  const b = body as { model?: unknown; answers?: Record<string, { type?: unknown; noul?: unknown }>; usage?: { input_tokens?: unknown } };
  if (!b || typeof b !== "object" || !b.answers || typeof b.answers !== "object") throw new Error("jev: response has no answers");
  const probabilities: Record<string, number> = {};
  for (const topic of FEEDS[feed].topics) {
    const a = b.answers[questionId(topic)];
    const p = a?.noul;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw new Error(`jev: no valid answer for ${topic}`);
    probabilities[topic] = Math.round(p * 1000) / 1000;
  }
  return {
    model: typeof b.model === "string" && b.model ? b.model.slice(0, 80) : "unknown",
    probabilities,
    inputTokens: typeof b.usage?.input_tokens === "number" ? b.usage.input_tokens : 0,
  };
}

/** Stable hash of everything that decides Jev's answer, so an unchanged story isn't classified twice. */
export function inputHash(model: string, feed: FeedId, story: JevInput): string {
  const payload = JSON.stringify([model, feed, FEEDS[feed].topics, TOPIC_DESCRIPTIONS[feed], story.headline, story.summary, story.details]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Replace the briefing model's `topic:` tags with Jev's topics at or above the threshold (highest first, at most
 * MAX_JEV_TOPICS, placed first). If no topic clears the threshold, the model's tags are kept unchanged.
 */
export function applyTopics(
  feed: FeedId,
  tags: string[],
  probabilities: Record<string, number>,
  threshold: number,
): { tags: string[]; applied: boolean } {
  const picked = FEEDS[feed].topics
    .filter((t) => (probabilities[t] ?? 0) >= threshold)
    .sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0))
    .slice(0, MAX_JEV_TOPICS);
  if (!picked.length) return { tags, applied: false };
  return { tags: [...picked.map((t) => `topic:${t}`), ...tags.filter((t) => !t.startsWith("topic:"))], applied: true };
}

class JevHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`jev: HTTP ${status}${detail ? `: ${detail}` : ""}`);
  }
}

export interface TypeSafeOptions {
  apiKey: string;
  url?: string;
  model?: string;
  threshold?: number;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

/** Jev over HTTP. One retry for rate limits, overload, 5xx and network errors. */
export function typesafeClassifier(o: TypeSafeOptions): JevClassifier {
  const url = o.url ?? DEFAULT_JEV_URL;
  const model = o.model ?? DEFAULT_JEV_MODEL;
  const timeoutMs = o.timeoutMs ?? 5_000;
  const retryDelayMs = o.retryDelayMs ?? 400;
  const doFetch = o.fetch ?? fetch;
  const auth = `Bearer ${o.apiKey}`;

  async function attempt(feed: FeedId, story: JevInput, signal?: AbortSignal): Promise<JevResult> {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(jevRequest(model, feed, story)),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      // Network errors and timeouts. Only the error's name and message, never the request.
      throw new Error(`jev: request failed (${(err as Error).name}: ${(err as Error).message.slice(0, 120)})`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new JevHttpError(res.status, detail);
    }
    return parseJevResponse(feed, await res.json());
  }

  return {
    model,
    threshold: o.threshold ?? DEFAULT_JEV_THRESHOLD,
    async classify(feed, story, signal) {
      try {
        return await attempt(feed, story, signal);
      } catch (err) {
        const retryable = !(err instanceof JevHttpError) || err.status === 429 || err.status === 529 || err.status >= 500;
        if (!retryable || signal?.aborted) throw err;
        await Bun.sleep(retryDelayMs);
        if (signal?.aborted) throw err;
        return attempt(feed, story, signal);
      }
    },
  };
}

export interface TagOutcome {
  tags: string[];
  jev: JevStored | null;
}

export interface TagSummary {
  outcomes: TagOutcome[];
  classified: number;
  reused: number;
  failed: number;
  inputTokens: number;
  errors: string[];
}

/**
 * Tag every story of an edition. `cached` maps input hashes to earlier results for this edition (re-posts).
 * Stories not finished before `deadlineMs` keep the model's topics.
 */
export async function tagStories(
  classifier: JevClassifier,
  feed: FeedId,
  stories: (JevInput & { tags: string[] })[],
  opts: { cached?: Map<string, JevStored>; concurrency?: number; deadlineMs?: number; now?: () => Date } = {},
): Promise<TagSummary> {
  const now = opts.now ?? (() => new Date());
  const deadline = AbortSignal.timeout(opts.deadlineMs ?? 8_000);
  const summary: TagSummary = { outcomes: [], classified: 0, reused: 0, failed: 0, inputTokens: 0, errors: [] };
  const outcomes: TagOutcome[] = stories.map((s) => ({ tags: s.tags, jev: null }));

  const settle = (i: number, hash: string, model: string, probabilities: Record<string, number>, at: Date) => {
    const story = stories[i]!;
    const r = applyTopics(feed, story.tags, probabilities, classifier.threshold);
    const ai_topics = story.tags.filter((t) => t.startsWith("topic:")).map((t) => t.slice("topic:".length));
    outcomes[i] = {
      tags: r.tags,
      jev: { model, threshold: classifier.threshold, probabilities, applied: r.applied, ai_topics, input_hash: hash, classified_at: at },
    };
  };

  const pending: number[] = [];
  stories.forEach((s, i) => {
    const hash = inputHash(classifier.model, feed, s);
    const hit = opts.cached?.get(hash);
    if (hit) {
      settle(i, hash, hit.model, hit.probabilities, hit.classified_at);
      summary.reused++;
    } else {
      pending.push(i);
    }
  });

  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const i = pending[next++]!;
      const s = stories[i]!;
      try {
        if (deadline.aborted) throw new Error("jev: edition deadline reached");
        const r = await classifier.classify(feed, s, deadline);
        settle(i, inputHash(classifier.model, feed, s), r.model, r.probabilities, now());
        summary.classified++;
        summary.inputTokens += r.inputTokens;
      } catch (err) {
        summary.failed++;
        if (summary.errors.length < 5) summary.errors.push((err as Error).message.slice(0, 200));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, pending.length) }, worker));
  summary.outcomes = outcomes;
  return summary;
}
