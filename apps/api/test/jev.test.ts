import { describe, expect, test } from "bun:test";
import { FEEDS, FEED_IDS } from "@news/schema";
import {
  MAX_JEV_TOPICS,
  TOPIC_DESCRIPTIONS,
  applyTopics,
  inputHash,
  jevRequest,
  parseJevResponse,
  tagStories,
  typesafeClassifier,
  type JevClassifier,
} from "../src/jev.ts";

const KEY = "tsk_test_0123456789abcdef0123456789";
const story = {
  headline: "Senate approves faster migrant expulsions",
  summary: "The PDI can now enter homes with a judge's approval.",
  details: [{ label: "Vote", text: "37-0-1" }],
};

/** A System One answer giving each topic the probability in `p` (others 0.01). */
function answer(feed: keyof typeof FEEDS, p: Record<string, number>, model = "jev-1.14.0") {
  const answers: Record<string, unknown> = {};
  for (const t of FEEDS[feed].topics) answers[`topic_${t.replace(/-/g, "_")}`] = { type: "noul", noul: p[t] ?? 0.01 };
  return { model, answers, usage: { input_tokens: 1100 } };
}

describe("topic descriptions", () => {
  test("cover exactly each feed's topic list", () => {
    for (const f of FEED_IDS) expect(Object.keys(TOPIC_DESCRIPTIONS[f]).sort()).toEqual([...FEEDS[f].topics].sort());
  });
});

describe("request and response", () => {
  test("one noul question per topic, story text in the state", () => {
    const r = jevRequest("jev-latest", "chile", story);
    expect(r.model).toBe("jev-latest");
    expect(r.state).toEqual({ headline: story.headline, summary: story.summary, details: ["Vote: 37-0-1"] });
    expect(Object.keys(r.questions)).toHaveLength(FEEDS.chile.topics.length);
    expect(r.questions.topic_security_crime).toEqual({
      type: "noul",
      instructions: "Is this Chilean news story about security crime (crime, policing, violence, public security)?",
    });
  });

  test("parses probabilities and rejects incomplete answers", () => {
    const r = parseJevResponse("chile", answer("chile", { migration: 0.9876 }));
    expect(r).toMatchObject({ model: "jev-1.14.0", inputTokens: 1100 });
    expect(r.probabilities.migration).toBe(0.988);
    const missing = answer("chile", {});
    delete (missing.answers as Record<string, unknown>).topic_media;
    expect(() => parseJevResponse("chile", missing)).toThrow("no valid answer for media");
    const bad = answer("chile", {});
    (bad.answers as Record<string, unknown>).topic_labor = { type: "noul", noul: 1.5 };
    expect(() => parseJevResponse("chile", bad)).toThrow("labor");
    expect(() => parseJevResponse("chile", { error: "x" })).toThrow("no answers");
  });

  test("input hash changes with the text and the model", () => {
    const h = inputHash("jev-latest", "chile", story);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(inputHash("jev-latest", "chile", { ...story })).toBe(h);
    expect(inputHash("jev-latest", "chile", { ...story, summary: "changed" })).not.toBe(h);
    expect(inputHash("jev-preview", "chile", story)).not.toBe(h);
  });
});

describe("applyTopics", () => {
  const tags = ["topic:congress", "region:chile", "org:senado"];

  test("Jev's topics at or above the threshold replace the model's, highest first", () => {
    expect(applyTopics("chile", tags, { migration: 0.97, congress: 0.85, politics: 0.84 }, 0.85)).toEqual({
      tags: ["topic:migration", "topic:congress", "region:chile", "org:senado"],
      applied: true,
    });
  });

  test("keeps the model's tags when nothing clears the threshold", () => {
    expect(applyTopics("chile", tags, { migration: 0.6 }, 0.85)).toEqual({ tags, applied: false });
  });

  test(`at most ${MAX_JEV_TOPICS} topics`, () => {
    const p = { politics: 0.9, government: 0.91, congress: 0.92, economy: 0.93, markets: 0.94, pensions: 0.95 };
    const r = applyTopics("chile", [], p, 0.85);
    expect(r.tags).toEqual(["topic:pensions", "topic:markets", "topic:economy", "topic:congress"]);
  });
});

describe("typesafeClassifier", () => {
  function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next();
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  test("sends the bearer key and the request, returns probabilities", async () => {
    const { f, calls } = fakeFetch([() => Response.json(answer("chile", { migration: 0.97 }))]);
    const c = typesafeClassifier({ apiKey: KEY, fetch: f });
    expect(c.threshold).toBe(0.85);
    const r = await c.classify("chile", story);
    expect(r.probabilities.migration).toBe(0.97);
    expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body)).model).toBe("jev-latest");
  });

  test("retries once on 429 and 5xx, not on 401; errors never contain the key", async () => {
    const ok = () => Response.json(answer("chile", { migration: 0.97 }));
    const a = fakeFetch([() => new Response("slow down", { status: 429 }), ok]);
    expect((await typesafeClassifier({ apiKey: KEY, fetch: a.f, retryDelayMs: 1 }).classify("chile", story)).model).toBe("jev-1.14.0");
    expect(a.calls).toHaveLength(2);

    const b = fakeFetch([() => new Response("bad gateway", { status: 502 }), () => new Response("still bad", { status: 503 })]);
    const err = await typesafeClassifier({ apiKey: KEY, fetch: b.f, retryDelayMs: 1 }).classify("chile", story).catch((e) => e);
    expect(String(err)).toContain("HTTP 503");
    expect(b.calls).toHaveLength(2);

    const d = fakeFetch([() => new Response(JSON.stringify({ error: "Must supply a valid API key" }), { status: 401 })]);
    const e401 = await typesafeClassifier({ apiKey: KEY, fetch: d.f, retryDelayMs: 1 }).classify("chile", story).catch((e) => e);
    expect(String(e401)).toContain("HTTP 401");
    expect(d.calls).toHaveLength(1);
    for (const e of [err, e401]) expect(String(e)).not.toContain(KEY);
  });

  test("times out a slow answer", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    const c = typesafeClassifier({ apiKey: KEY, fetch: hang as unknown as typeof fetch, timeoutMs: 30, retryDelayMs: 1 });
    expect(String(await c.classify("chile", story).catch((e) => e))).toContain("request failed");
  });
});

describe("tagStories", () => {
  const fixed = new Date("2026-10-23T12:00:00Z");
  const classifier = (impl: JevClassifier["classify"]): JevClassifier => ({ model: "jev-latest", threshold: 0.85, classify: impl });

  test("tags each story, keeps the model's topics for failures, reuses cached results", async () => {
    const stories = [
      { ...story, tags: ["topic:congress", "region:chile"] },
      { ...story, headline: "Storm red alert in Arauco", tags: ["topic:disasters", "region:chile"] },
      { ...story, headline: "Cached", tags: ["topic:media"] },
    ];
    const cachedHash = inputHash("jev-latest", "chile", stories[2]!);
    const cached = new Map([
      [
        cachedHash,
        {
          model: "jev-1.14.0",
          threshold: 0.85,
          probabilities: { media: 0.95 },
          applied: true,
          ai_topics: ["media"],
          input_hash: cachedHash,
          classified_at: new Date("2026-10-22T00:00:00Z"),
        },
      ],
    ]);
    const seen: string[] = [];
    const r = await tagStories(
      classifier(async (_f, s) => {
        seen.push(s.headline);
        if (s.headline.startsWith("Storm")) throw new Error("jev: HTTP 503");
        return { model: "jev-1.14.0", probabilities: { migration: 0.97, congress: 0.9 }, inputTokens: 1000 };
      }),
      "chile",
      stories,
      { cached, now: () => fixed },
    );
    expect(seen.sort()).toEqual([story.headline, "Storm red alert in Arauco"]);
    expect(r).toMatchObject({ classified: 1, reused: 1, failed: 1, inputTokens: 1000, errors: ["jev: HTTP 503"] });
    expect(r.outcomes[0]).toEqual({
      tags: ["topic:migration", "topic:congress", "region:chile"],
      jev: {
        model: "jev-1.14.0",
        threshold: 0.85,
        probabilities: { migration: 0.97, congress: 0.9 },
        applied: true,
        ai_topics: ["congress"],
        input_hash: inputHash("jev-latest", "chile", stories[0]!),
        classified_at: fixed,
      },
    });
    expect(r.outcomes[1]).toEqual({ tags: ["topic:disasters", "region:chile"], jev: null });
    expect(r.outcomes[2]!.tags).toEqual(["topic:media"]);
    expect(r.outcomes[2]!.jev!.classified_at).toEqual(new Date("2026-10-22T00:00:00Z"));
  });

  test("stories not done by the edition deadline keep the model's topics", async () => {
    const stories = Array.from({ length: 4 }, (_, i) => ({ ...story, headline: `s${i}`, tags: ["topic:labor"] }));
    const r = await tagStories(
      classifier(
        (_f, _s, signal) =>
          new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("jev: request failed (TimeoutError)")))),
      ),
      "chile",
      stories,
      { deadlineMs: 40, concurrency: 2 },
    );
    expect(r.failed).toBe(4);
    expect(r.outcomes.every((o) => o.jev === null && o.tags[0] === "topic:labor")).toBe(true);
  });
});
