// API tests against a throwaway mongo:9.0.4 container (see mongo.ts). Each describe block gets its own database.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, MongoServerError, type Db } from "mongodb";
import { FEEDS, LIMITS } from "@news/schema";
import { createApp, startServers, type Servers } from "../src/app.ts";
import { DEFAULT_CONFIG_DIR, loadReferenceData } from "../src/config.ts";
import { collections, ensureSchema } from "../src/db.ts";
import type { IngestStep } from "../src/ingest.ts";
import { typesafeClassifier, type JevClassifier } from "../src/jev.ts";
import { KevService } from "../src/kev.ts";
import { retag } from "../src/retag.ts";
import { memoryLogger } from "../src/log.ts";
import { startMongo, type TestMongo } from "./mongo.ts";

const TOKEN = randomBytes(32).toString("hex");
const ORIGIN = "https://news.lab.x-muramasa.dev";
const FIXTURES = join(import.meta.dir, "..", "..", "..", "test", "fixtures", "editions");
const reference = loadReferenceData(DEFAULT_CONFIG_DIR);
const KEV = ["CVE-2026-96652", "CVE-2026-96654", "CVE-2026-96655", "CVE-2026-96656", "CVE-2026-106931", "CVE-2026-110936"];

const fx = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const clone = <T>(x: T): T => structuredClone(x);

let mongo: TestMongo;
let client: MongoClient;

beforeAll(async () => {
  mongo = await startMongo();
  client = new MongoClient(mongo.url);
  await client.connect();
}, 90_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  mongo?.stop();
}, 30_000);

interface Ctx {
  db: Db;
  log: ReturnType<typeof memoryLogger>;
  kev: KevService;
  setKev(cves: string[] | Error): void;
  failAfter: { step: IngestStep | null };
  post(body: unknown, opts?: { token?: string | null; contentType?: string }): Promise<Response>;
  get(path: string, init?: RequestInit): Promise<Response>;
  getJson(path: string): Promise<{ status: number; body: any }>;
  fav(method: "PUT" | "DELETE", id: string, headers?: Record<string, string>): Promise<Response>;
  app: ReturnType<typeof createApp>;
}

async function setup(opts: { jev?: JevClassifier | null; jevDeadlineMs?: number } = {}): Promise<Ctx> {
  const db = client.db(`t_${randomBytes(4).toString("hex")}`);
  await ensureSchema(db);
  const log = memoryLogger();
  let kevAnswer: string[] | Error = KEV;
  const kev = new KevService({
    cols: collections(db),
    url: "https://kev.invalid/known_exploited_vulnerabilities.json",
    refreshHours: 24,
    fetcher: async () => {
      if (kevAnswer instanceof Error) throw kevAnswer;
      return { catalogVersion: "2026.10.21", vulnerabilities: kevAnswer.map((cveID) => ({ cveID })) };
    },
    log,
  });
  await kev.refresh();
  const failAfter: { step: IngestStep | null } = { step: null };
  const app = createApp({
    db,
    ingestToken: TOKEN,
    publicOrigin: ORIGIN,
    reference,
    kev,
    log,
    jev: opts.jev ?? null,
    ...(opts.jevDeadlineMs === undefined ? {} : { jevDeadlineMs: opts.jevDeadlineMs }),
    afterIngestStep: (step) => {
      if (failAfter.step === step) throw new Error(`simulated crash after ${step}`);
    },
  });
  const post = (body: unknown, opts: { token?: string | null; contentType?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json" };
    const token = opts.token === undefined ? TOKEN : opts.token;
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return app.ingest(
      new Request("http://127.0.0.1:8787/ingest/editions", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  };
  const get = (path: string, init?: RequestInit) => app.public(new Request(`http://news-api:8080${path}`, init));
  const getJson = async (path: string) => {
    const r = await get(path);
    return { status: r.status, body: await r.json() };
  };
  const fav = (method: "PUT" | "DELETE", id: string, headers: Record<string, string> = {}) =>
    get(`/api/favorites/${id}`, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      body: method === "PUT" ? "{}" : null,
    });
  return {
    db,
    log,
    kev,
    setKev: (c) => {
      kevAnswer = c;
    },
    failAfter,
    post,
    get,
    getJson,
    fav,
    app,
  };
}

async function ingestAll(c: Ctx) {
  for (const f of ["chile", "cyber", "ai"]) {
    const r = await c.post(fx(`${f}.valid.json`));
    expect(r.status).toBe(201);
  }
}

/** A Chile edition from another run, shifted to `date` (YYYY-MM-DD) and `time` (HH-MM-SS). */
function chileRun(date: string, time: string, mutate?: (e: any) => void) {
  const e = clone(fx("chile.valid.json"));
  e.edition_date = date;
  e.source_run.file = `${date}_${time}.md`;
  e.generated_at = `${date}T${time.replace(/-/g, ":")}-03:00`;
  mutate?.(e);
  return e;
}

// -----------------------------------------------------------------------------------------------------------------

describe("startup", () => {
  test("ensureSchema is idempotent and installs validators and indexes", async () => {
    const db = client.db(`t_${randomBytes(4).toString("hex")}`);
    await db.createCollection("stories"); // created by an older version, without a validator
    await ensureSchema(db);
    await ensureSchema(db);
    const infos = await db.listCollections().toArray();
    const opts = (n: string) => (infos.find((i) => i.name === n) as any)?.options;
    expect(opts("editions").validator.$jsonSchema.bsonType).toBe("object");
    expect(opts("stories").validator.$jsonSchema.bsonType).toBe("object");
    expect(opts("stories").validationAction).toBe("error");
    expect(infos.map((i) => i.name).sort()).toEqual(["editions", "favorites", "meta", "stories"]);
    const idx = await db.collection("stories").indexes();
    const text = idx.find((i) => i.name === "stories_text") as any;
    expect(text.default_language).toBe("none");
    expect(Object.keys(text.weights).sort()).toEqual(["details.label", "details.text", "headline", "summary", "tags"]);
    for (const n of ["edition_section_rank", "feed_sort_date", "tags_sort_date", "thread_sort_date"]) {
      expect(idx.map((i) => i.name)).toContain(n);
    }
    const eidx = await db.collection("editions").indexes();
    expect(eidx.find((i) => i.name === "source_run_unique")?.unique).toBe(true);
    expect(eidx.map((i) => i.name)).toContain("feed_edition_date");
    expect((await db.collection("favorites").indexes()).map((i) => i.name)).toContain("created_at");
  });

  test("the database validator is a backstop for bad documents", async () => {
    const c = await setup();
    const err = await c.db
      .collection("stories")
      .insertOne({ _id: "chile-20261021-115606-x", headline: "no other fields" } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MongoServerError);
    expect((err as MongoServerError).code).toBe(121);
    const err2 = await c.db
      .collection("editions")
      .insertOne({ _id: "../etc/passwd" } as any)
      .catch((e) => e);
    expect((err2 as MongoServerError).code).toBe(121);
  });
});

describe("ingest", () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await setup();
  });

  test("401 without or with a wrong token", async () => {
    for (const token of [null, "wrong", TOKEN.slice(0, -1), `${TOKEN} extra`]) {
      const r = await c.post(fx("chile.valid.json"), { token });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBe("Bearer");
      expect(await r.json()).toEqual({ error: "unauthorized" });
    }
    expect(await c.db.collection("editions").countDocuments()).toBe(0);
  });

  test("415 without a JSON content type", async () => {
    const r = await c.post(fx("chile.valid.json"), { contentType: "text/plain" });
    expect(r.status).toBe(415);
  });

  test("422 on a body that is not JSON", async () => {
    for (const body of ["**🇨🇱 Chile — Wednesday**\nnot json", "{\"schema\": ", ""]) {
      const r = await c.post(body);
      expect(r.status).toBe(422);
      expect(((await r.json()) as any).errors).toEqual(["body is not valid JSON"]);
    }
  });

  const cases = Object.entries(fx("invalid.cases.json") as Record<string, { error: string }>);
  test("every invalid fixture is in the manifest", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.startsWith("invalid.") && f !== "invalid.cases.json");
    expect(files.sort()).toEqual(cases.map(([f]) => f).sort());
  });
  for (const [file, { error }] of cases) {
    test(`422 for ${file}`, async () => {
      const r = await c.post(fx(file));
      expect(r.status).toBe(422);
      const body: any = await r.json();
      expect(body.errors).toContain(error);
    });
  }

  test("201 for each valid fixture, then 200 when re-posted", async () => {
    const expected = { chile: 11, cyber: 22, ai: 15 } as const;
    for (const feed of ["chile", "cyber", "ai"] as const) {
      const e = fx(`${feed}.valid.json`);
      const r = await c.post(e);
      expect(r.status).toBe(201);
      const body: any = await r.json();
      const id = e.source_run.file.replace(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/, `${feed}-$1$2$3-$4$5$6`);
      expect(body).toEqual({ edition_id: id, stories: expected[feed], warnings: [] });
      const again = await c.post(e);
      expect(again.status).toBe(200);
    }
    expect(await c.db.collection("editions").countDocuments()).toBe(3);
    expect(await c.db.collection("stories").countDocuments()).toBe(48);
    const ed = await c.db.collection("editions").findOne({ _id: "chile-20261021-115606" as any });
    expect(ed).toMatchObject({
      feed: "chile",
      state: "ready",
      source_run: { job_id: FEEDS.chile.jobId, file: "2026-10-21_11-56-06.md" },
      story_count: 11,
      section_counts: { top: 6, quick_hit: 5 },
    });
    expect(ed!.run_at).toEqual(new Date("2026-10-21T14:56:06Z"));
    expect(ed!.story_ids[0]).toBe("chile-20261021-115606-migrant-expulsion-law-clears-congress");
  });

  test("stories carry derived tags, sort_date and enriched sources", async () => {
    const s = (id: string) => c.db.collection("stories").findOne({ _id: id as any });
    const plex = await s("cyber-20261021-132150-plex2shell-exploited-kev");
    expect(plex!.tags).toEqual(
      expect.arrayContaining([
        "topic:exploited",
        "status:exploited",
        "org:plex",
        "outlet:plex",
        "outlet:boredhackerblog",
        "cve:cve-2026-96652",
        "cve:cve-2026-96656",
        "kev:yes",
        "blindspot:research",
      ]),
    );
    expect(plex!.cves).toHaveLength(4);
    expect(plex!.sort_date).toBe("2026-10-20");
    const php = await s("cyber-20261021-132150-php2shell-emergency-patches");
    expect(php!.tags).not.toContain("kev:yes");
    expect(php!.sources[0]).toEqual({
      outlet: "CISA",
      url: "https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching",
      outlet_slug: "cisa",
      group: "gov_vendor",
      lean: "US government",
    });
    const node = await s("cyber-20261021-132150-nodejs-october-security-releases");
    expect(node!.tags).toContain("stack:node");
    expect(node!.sort_date).toBe("2026-10-21"); // no event date -> edition date
    const anci = await s("cyber-20261021-132150-anci-national-cybersecurity-exercise");
    expect(anci!.event_date).toBe("2026-10-29");
    expect(anci!.sort_date).toBe("2026-10-21"); // future event -> edition date
    const afp = await s("chile-20261021-115606-afp-fondo-e-sanctions");
    expect(afp!.tags).toEqual([
      "topic:pensions",
      "topic:markets",
      "region:chile",
      "org:superintendencia-de-pensiones",
      "org:senado",
      "outlet:el-pais",
      "outlet:ex-ante",
      "update",
    ]);
    const quiroz = await s("chile-20261021-115606-quiroz-welfare-states-francia");
    expect(quiroz!.tags).toContain("blindspot:left");
  });

  test("tag normalization and unknown tags as warnings", async () => {
    const e = chileRun("2026-10-22", "08-00-04", (x) => {
      x.stories = [x.stories[0]];
      x.stories[0].tags = ["Topic: Migration", "region:CHILE", "topic:football", "org:Policía de Investigaciones", "kev:yes"];
      x.stories[0].unexpected = true;
    });
    const r = await c.post(e);
    expect(r.status).toBe(201);
    const body: any = await r.json();
    expect(body.warnings).toEqual([
      "stories[0].unexpected: dropped unknown field",
      'stories[0].tags[2]: dropped unknown topic "football" for feed chile',
      'stories[0].tags[4]: dropped "kev:yes", kev tags are added by the reader',
    ]);
    const s = await c.db.collection("stories").findOne({ _id: "chile-20261022-080004-migrant-expulsion-law-clears-congress" as any });
    expect(s!.tags.slice(0, 3)).toEqual(["topic:migration", "region:chile", "org:policia-de-investigaciones"]);
    expect(s).not.toHaveProperty("unexpected");
    const ed = await c.db.collection("editions").findOne({ _id: "chile-20261022-080004" as any });
    expect(ed!.warnings).toHaveLength(3);
  });

  test("replace by source_run drops removed stories and keeps favorites", async () => {
    const e = fx("chile.valid.json");
    const removed = "chile-20261021-115606-fuel-prices-expected-to-rise";
    expect((await c.fav("PUT", removed)).status).toBe(200);
    e.stories = e.stories.filter((s: any) => s.slug !== "fuel-prices-expected-to-rise");
    e.stories[0].headline = "Faster migrant-expulsion law clears Congress (corrected)";
    const r = await c.post(e);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).stories).toBe(10);
    const ids = (await c.db.collection("stories").find({ edition_id: "chile-20261021-115606" }).toArray()).map((s) => s._id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(removed);
    const first = await c.db.collection("stories").findOne({ _id: "chile-20261021-115606-migrant-expulsion-law-clears-congress" as any });
    expect(first!.headline).toContain("(corrected)");
    const favs = await c.getJson("/api/favorites");
    expect(favs.body.favorites).toEqual([
      expect.objectContaining({
        story_id: removed,
        story: null,
        snapshot: {
          headline: "Fuel prices expected to rise on Thu 22 Oct",
          feed: "chile",
          edition_id: "chile-20261021-115606",
          edition_date: "2026-10-21",
          sort_date: "2026-10-21",
        },
      }),
    ]);
  });

  test("413 by Content-Length and by actual bytes, over real listeners", async () => {
    const servers: Servers = startServers(c.app, {
      ingestHost: "127.0.0.1",
      ingestPort: 0,
      publicHost: "127.0.0.1",
      publicPort: 0,
    });
    try {
      const url = `http://127.0.0.1:${servers.ingest.port}/ingest/editions`;
      const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
      const big = JSON.stringify({ ...fx("chile.valid.json"), gaps: ["x".repeat(LIMITS.bodyBytes)] });
      const r1 = await fetch(url, { method: "POST", headers, body: big });
      expect(r1.status).toBe(413);
      expect(await r1.json()).toEqual({ error: `body larger than ${LIMITS.bodyBytes} bytes` });

      const chunk = new TextEncoder().encode("x".repeat(256 * 1024));
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(ctl) {
          if (sent >= 6) return ctl.close();
          sent++;
          ctl.enqueue(chunk);
        },
      });
      const r2 = await fetch(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
      expect(r2.status).toBe(413);

      // Under the limit it works over HTTP too.
      const ok = await fetch(url, { method: "POST", headers, body: JSON.stringify(fx("ai.valid.json")) });
      expect(ok.status).toBe(200);

      // The listeners don't serve each other's routes.
      expect((await fetch(`http://127.0.0.1:${servers.ingest.port}/api/feeds`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${servers.public.port}/ingest/editions`, { method: "POST", headers, body: "{}" })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${servers.ingest.port}/ingest/editions`)).status).toBe(405);
      expect((await fetch(`http://127.0.0.1:${servers.public.port}/healthz`)).status).toBe(200);
    } finally {
      await servers.stop();
    }
  });
});

describe("Jev topic tagging at ingest", () => {
  const KEY = "tsk_" + "k".repeat(40);
  // A fake System One: every story is "about" migration (0.97) and congress (0.9); politics stays under the threshold.
  function fakeJev(mode: { fail?: boolean; hang?: boolean }) {
    const requests: any[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body: any = await req.json();
        requests.push({ auth: req.headers.get("authorization"), body });
        if (mode.hang) await Bun.sleep(2_000);
        if (mode.fail) return new Response("upstream down", { status: 503 });
        const answers: Record<string, unknown> = {};
        for (const q of Object.keys(body.questions)) {
          const p = q === "topic_migration" ? 0.97 : q === "topic_congress" ? 0.9 : q === "topic_politics" ? 0.84 : 0.02;
          answers[q] = { type: "noul", noul: p };
        }
        return Response.json({ id: "x", model: "jev-1.14.0", answers, usage: { input_tokens: 1000 } });
      },
    });
    const classifier = typesafeClassifier({
      apiKey: KEY,
      url: `http://127.0.0.1:${server.port}/v1/systemone`,
      retryDelayMs: 1,
      timeoutMs: 500,
    });
    return { server, requests, classifier };
  }

  test("replaces the model's topics, stores probabilities, keeps other tags; a re-POST reuses the results", async () => {
    const jev = fakeJev({});
    try {
      const c = await setup({ jev: jev.classifier });
      const edition = fx("chile.valid.json");
      expect((await c.post(edition)).status).toBe(201);
      const n = edition.stories.length;
      expect(jev.requests).toHaveLength(n);
      expect(jev.requests[0].auth).toBe(`Bearer ${KEY}`);
      expect(jev.requests[0].body.model).toBe("jev-latest");

      const doc = await c.db.collection("stories").findOne({ slug: "migrant-expulsion-law-clears-congress" });
      expect(doc!.tags.filter((t: string) => t.startsWith("topic:"))).toEqual(["topic:migration", "topic:congress"]);
      expect(doc!.tags).toContain("region:chile");
      expect(doc!.tags).toContain("org:pdi");
      expect(doc!.tags.some((t: string) => t.startsWith("outlet:"))).toBe(true);
      expect(doc!.jev).toMatchObject({ model: "jev-1.14.0", threshold: 0.85, applied: true, ai_topics: ["migration", "congress"] });
      expect(doc!.jev.probabilities.politics).toBe(0.84);
      const pensions = await c.db.collection("stories").findOne({ slug: "afp-fondo-e-sanctions" });
      expect(pensions!.tags.filter((t: string) => t.startsWith("topic:"))).toEqual(["topic:migration", "topic:congress"]);
      expect(pensions!.jev.ai_topics).toEqual(["pensions", "markets"]);

      // public API: tags updated, probabilities not exposed
      const pub = await c.getJson(`/api/stories/${doc!._id}`);
      expect(pub.body.story.tags).toContain("topic:migration");
      expect(pub.body.story.jev).toBeUndefined();
      expect(c.log.lines.some((l: any) => l.msg === "jev: tagged" && l.fields.classified === n)).toBe(true);

      // same run again: nothing re-classified
      expect((await c.post(edition)).status).toBe(200);
      expect(jev.requests).toHaveLength(n);
      expect(c.log.lines.some((l: any) => l.msg === "jev: tagged" && l.fields.reused === n && l.fields.classified === 0)).toBe(true);
      expect(JSON.stringify(c.log.lines)).not.toContain(KEY);
    } finally {
      await jev.server.stop(true);
    }
  });

  test("Jev down: ingest still succeeds with the model's topics and logs a warning", async () => {
    const jev = fakeJev({ fail: true });
    try {
      const c = await setup({ jev: jev.classifier });
      expect((await c.post(fx("chile.valid.json"))).status).toBe(201);
      const doc = await c.db.collection("stories").findOne({ slug: "afp-fondo-e-sanctions" });
      expect(doc!.tags.filter((t: string) => t.startsWith("topic:"))).toEqual(["topic:pensions", "topic:markets"]);
      expect(doc!.jev).toBeUndefined();
      const warn = c.log.lines.find((l: any) => l.msg === "jev: some stories kept the briefing topics") as any;
      expect(warn.fields.failed).toBe(fx("chile.valid.json").stories.length);
      expect(warn.fields.errors[0]).toContain("HTTP 503");
      expect(JSON.stringify(c.log.lines)).not.toContain(KEY);
    } finally {
      await jev.server.stop(true);
    }
  });

  test("retag: classifies stories stored before Jev, then re-applies a new threshold without calling Jev", async () => {
    const jev = fakeJev({});
    try {
      const c = await setup();
      expect((await c.post(fx("chile.valid.json"))).status).toBe(201);
      const n = fx("chile.valid.json").stories.length;
      const cols = collections(c.db);

      const first = await retag(cols, jev.classifier, { mode: "missing" });
      // the migrant-expulsion story already had exactly migration + congress, so its tags don't change
      expect(first).toMatchObject({ stories: n, classified: n, failed: 0, changed: n - 1 });
      expect(jev.requests).toHaveLength(n);
      let doc = await cols.stories.findOne({ slug: "afp-fondo-e-sanctions" });
      expect(doc!.tags.filter((t) => t.startsWith("topic:"))).toEqual(["topic:migration", "topic:congress"]);
      expect(doc!.tags).toContain("region:chile");
      expect(doc!.tags.some((t) => t.startsWith("outlet:"))).toBe(true);
      expect(doc!.jev!.ai_topics).toEqual(["pensions", "markets"]);

      // nothing left to classify
      expect(await retag(cols, jev.classifier, { mode: "missing" })).toMatchObject({ stories: 0, classified: 0 });

      // stricter threshold: congress (0.9) drops out, migration (0.97) stays; no new requests
      const strict = { ...jev.classifier, threshold: 0.95 };
      expect(await retag(cols, strict, { mode: "reapply" })).toMatchObject({ reapplied: n, changed: n });
      doc = await cols.stories.findOne({ slug: "afp-fondo-e-sanctions" });
      expect(doc!.tags.filter((t) => t.startsWith("topic:"))).toEqual(["topic:migration"]);
      expect(doc!.jev!.threshold).toBe(0.95);

      // nothing clears 0.99: the briefing model's own topics come back
      await retag(cols, { ...jev.classifier, threshold: 0.99 }, { mode: "reapply" });
      doc = await cols.stories.findOne({ slug: "afp-fondo-e-sanctions" });
      expect(doc!.tags.filter((t) => t.startsWith("topic:"))).toEqual(["topic:pensions", "topic:markets"]);
      expect(doc!.jev!.applied).toBe(false);
      expect(jev.requests).toHaveLength(n);
    } finally {
      await jev.server.stop(true);
    }
  });

  test("a slow Jev can't hold an ingest past the deadline", async () => {
    const jev = fakeJev({ hang: true });
    try {
      const c = await setup({ jev: jev.classifier, jevDeadlineMs: 300 });
      const t0 = Date.now();
      expect((await c.post(fx("cyber.valid.json"))).status).toBe(201);
      expect(Date.now() - t0).toBeLessThan(1_500);
      const doc = await c.db.collection("stories").findOne({ slug: "plex2shell-exploited-kev" });
      expect(doc!.tags).toContain("kev:yes");
      expect(doc!.jev).toBeUndefined();
    } finally {
      await jev.server.stop(true);
    }
  });
});

describe("no transactions: a failed write heals on re-POST", () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await setup();
  });

  for (const step of ["edition", "stories", "prune"] as const) {
    test(`crash after "${step}" on a first ingest`, async () => {
      const e = chileRun("2026-10-25", `08-00-0${["edition", "stories", "prune"].indexOf(step)}`);
      const id = `chile-20261025-08000${["edition", "stories", "prune"].indexOf(step)}`;
      c.failAfter.step = step;
      const r = await c.post(e);
      c.failAfter.step = null;
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "internal error" });
      // Nothing of the half-written edition is visible.
      expect((await c.get(`/api/editions/${id}`)).status).toBe(404);
      expect((await c.getJson("/api/stories?limit=100")).body.stories.filter((s: any) => s.edition_id === id)).toEqual([]);
      expect((await c.get(`/api/stories/${id}-afp-fondo-e-sanctions`)).status).toBe(404);
      // Re-post heals.
      const again = await c.post(e);
      expect(again.status).toBe(201);
      const ed = await c.getJson(`/api/editions/${id}`);
      expect(ed.status).toBe(200);
      expect(ed.body.edition.stories).toHaveLength(11);
      expect(await c.db.collection("stories").countDocuments({ edition_id: id })).toBe(11);
    });
  }

  test("crash while replacing an edition with fewer stories", async () => {
    const v1 = chileRun("2026-10-26", "08-00-00");
    expect((await c.post(v1)).status).toBe(201);
    const v2 = chileRun("2026-10-26", "08-00-00", (e) => {
      e.stories = e.stories.slice(0, 4);
    });
    c.failAfter.step = "stories";
    expect((await c.post(v2)).status).toBe(500);
    c.failAfter.step = null;
    expect((await c.get("/api/editions/chile-20261026-080000")).status).toBe(404);
    const healed = await c.post(v2);
    expect(healed.status).toBe(201); // the stored copy never became ready again
    const ed = await c.getJson("/api/editions/chile-20261026-080000");
    expect(ed.body.edition.stories.map((s: any) => s.slug)).toEqual(v2.stories.map((s: any) => s.slug));
    expect(await c.db.collection("stories").countDocuments({ edition_id: "chile-20261026-080000" })).toBe(4);
    expect((await c.post(v2)).status).toBe(200);
  });
});

describe("public reads", () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await setup();
    await ingestAll(c);
    // A later run of the same Chile day (manual re-run) and the next day's edition, continuing the AFP thread.
    expect(
      (
        await c.post(
          chileRun("2026-10-21", "18-30-00", (e) => {
            e.stories = e.stories.slice(0, 3);
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await c.post(
          chileRun("2026-10-22", "08-00-04", (e) => {
            e.stories = [e.stories[1]];
            e.stories[0].slug = "afp-senate-session-scheduled";
            e.stories[0].rank = 1;
            e.stories[0].event_date = "2026-10-22";
            e.stories[0].headline = "AFP Fondo E: Senate session confirmed";
            e.stories[0].summary =
              "A filtración of internal emails shows the Superintendencia knew of the derivative losses in August.";
          }),
        )
      ).status,
    ).toBe(201);
  });

  test("security headers on every response and no internal fields", async () => {
    for (const path of [
      "/api/feeds",
      "/api/editions",
      "/api/editions/chile-20261021-115606",
      "/api/stories",
      "/api/stories/cyber-20261021-132150-plex2shell-exploited-kev",
      "/api/tags",
      "/api/favorites",
      "/healthz",
      "/api/nope",
    ]) {
      const r = await c.get(path);
      expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      expect(r.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      const text = await r.text();
      for (const leak of ["source_run", ".md\"", '"_id"', "ingesting", "warnings", "/home/", "hermes"]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  test("404 and 405 are JSON", async () => {
    const nf = await c.get("/api/editions/chile-20991231-000000");
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "edition not found" });
    const na = await c.get("/api/stories", { method: "POST", body: "{}" });
    expect(na.status).toBe(405);
    expect(na.headers.get("allow")).toBe("GET, HEAD");
    expect(await na.json()).toEqual({ error: "method not allowed" });
    expect((await c.get("/api/favorites/x", { method: "GET" })).status).toBe(405);
    expect((await c.get("/")).status).toBe(404);
  });

  test("GET /api/feeds: latest edition and counts per feed", async () => {
    const { status, body } = await c.getJson("/api/feeds");
    expect(status).toBe(200);
    expect(body.feeds.map((f: any) => f.id)).toEqual(["chile", "cyber", "ai"]);
    const [chile, cyber, ai] = body.feeds;
    expect(chile.latest.id).toBe("chile-20261022-080004");
    expect(chile.counts).toEqual({ editions: 2, stories: 4 }); // 21 Oct shows only its latest run (3 stories)
    expect(cyber.latest).toMatchObject({ id: "cyber-20261021-132150", section_counts: { patch_now: 5, your_stack: 6 } });
    expect(cyber.counts).toEqual({ editions: 1, stories: 22 });
    expect(ai.latest.title).toBe("AI weekly — 12–19 October 2026");
    expect(cyber.sections[0]).toEqual({ id: "patch_now", title: "Patch now" });
    expect(cyber.emoji).toBe("🛡️");
  });

  test("GET /api/editions: newest first, latest run per day, cursor paging", async () => {
    const all = await c.getJson("/api/editions");
    expect(all.body.editions.map((e: any) => e.id)).toEqual([
      "chile-20261022-080004",
      "chile-20261021-183000",
      "cyber-20261021-132150",
      "ai-20261019-090352",
    ]);
    expect(all.body.next).toBeNull();
    const seen: string[] = [];
    let before: string | null = "";
    do {
      const p: { body: any } = await c.getJson(`/api/editions?limit=1${before ? `&before=${before}` : ""}`);
      expect(p.body.editions).toHaveLength(1);
      seen.push(p.body.editions[0].id);
      before = p.body.next;
    } while (before);
    expect(seen).toEqual(all.body.editions.map((e: any) => e.id));
    const chile = await c.getJson("/api/editions?feed=chile");
    expect(chile.body.editions.map((e: any) => e.id)).toEqual(["chile-20261022-080004", "chile-20261021-183000"]);
    expect((await c.get("/api/editions?feed=sports")).status).toBe(400);
    expect((await c.get("/api/editions?before=garbage!")).status).toBe(400);
    expect((await c.get("/api/editions?limit=101")).status).toBe(400);
  });

  test("GET /api/editions/:id: stories in order, prev/next, same-day runs", async () => {
    const { status, body } = await c.getJson("/api/editions/chile-20261021-115606");
    expect(status).toBe(200);
    const e = body.edition;
    expect(e.stories.map((s: any) => `${s.section}:${s.rank}`)).toEqual([
      "top:1", "top:2", "top:3", "top:4", "top:5", "top:6",
      "quick_hit:1", "quick_hit:2", "quick_hit:3", "quick_hit:4", "quick_hit:5",
    ]);
    expect(e.markets.items[0]).toEqual({ name: "IPSA", value: "10,926.50", change: "-0.42%" });
    expect(e.gaps).toHaveLength(3);
    expect(e.same_day).toEqual([
      { id: "chile-20261021-115606", run_at: "2026-10-21T14:56:06.000Z", latest: false },
      { id: "chile-20261021-183000", run_at: "2026-10-21T21:30:00.000Z", latest: true },
    ]);
    expect(e.prev).toBeNull();
    expect(e.next).toBe("chile-20261021-183000");
    const latest = (await c.getJson("/api/editions/chile-20261021-183000")).body.edition;
    expect(latest.prev).toBeNull();
    expect(latest.next).toBe("chile-20261022-080004");
    const cyber = (await c.getJson("/api/editions/cyber-20261021-132150")).body.edition;
    expect(cyber.stories.slice(0, 5).every((s: any) => s.section === "patch_now")).toBe(true);
    expect(cyber.stories.at(-1).section).toBe("policy");
    expect((await c.get("/api/editions/chile-2026")).status).toBe(400);
    expect((await c.get("/api/editions/..%2F..%2Fetc")).status).toBe(400);
  });

  test("GET /api/stories: sort, cursor paging covers everything exactly once", async () => {
    for (const sort of ["newest", "oldest"] as const) {
      const ids: string[] = [];
      const dates: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: { status: number; body: any } = await c.getJson(
          `/api/stories?sort=${sort}&limit=7${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(r.status).toBe(200);
        ids.push(...r.body.stories.map((s: any) => s.id));
        dates.push(...r.body.stories.map((s: any) => s.sort_date));
        cursor = r.body.next;
        pages++;
      } while (cursor);
      expect(ids).toHaveLength(3 + 1 + 22 + 15);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pages).toBe(6);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sort === "oldest" ? sorted : sorted.reverse());
      expect(ids.some((id) => id.startsWith("chile-20261021-115606"))).toBe(false); // superseded run
    }
    const newest = await c.getJson("/api/stories?limit=1");
    expect(newest.body.stories[0].id).toBe("chile-20261022-080004-afp-senate-session-scheduled");
    const c1 = (await c.getJson("/api/stories?limit=2")).body.next;
    expect((await c.get(`/api/stories?sort=oldest&cursor=${c1}`)).status).toBe(400);
  });

  test("GET /api/stories: feed, tags (AND, normalized), dates", async () => {
    const tag = async (q: string) => (await c.getJson(`/api/stories?limit=100&${q}`)).body.stories.map((s: any) => s.slug);
    expect(await tag("feed=cyber&tag=kev:yes")).toEqual([
      "plex2shell-exploited-kev",
      "siteguard-server-edition-kev",
      "siemens-software-center-kev",
    ]);
    expect(await tag("tag=stack:chrome&tag=topic:pki-crypto")).toEqual(["emudhra-ca-keys-computable"]);
    expect(await tag("tag=Region:%20Chile&tag=Topic:Pensions")).toEqual(["afp-senate-session-scheduled", "afp-fondo-e-sanctions"]);
    expect(await tag("tag=cve:CVE-2026-109618")).toEqual(["php2shell-emergency-patches"]);
    expect(await tag("tag=update&feed=chile")).toEqual(["afp-senate-session-scheduled", "afp-fondo-e-sanctions"]);
    expect(await tag("feed=ai&from=2026-10-15&to=2026-10-16")).toEqual([
      "replit-anthropic-split",
      "anthropic-q3-revenue",
      "white-house-ai-task-force-charter",
    ]);
    expect(await tag("feed=chile&from=2026-10-22")).toEqual(["afp-senate-session-scheduled"]);
    for (const bad of ["from=2026-13-01", "from=2026-10-22&to=2026-10-21", "tag=%24where", `${"tag=a&".repeat(11)}`, "sort=random", "limit=0", "limit=abc", "favorites=yes", "feed=chile&feed=ai"]) {
      expect((await c.get(`/api/stories?${bad}`)).status).toBe(400);
    }
  });

  test("GET /api/stories: search ignores case and accents", async () => {
    const q = async (s: string) =>
      (await c.getJson(`/api/stories?limit=100&q=${encodeURIComponent(s)}`)).body.stories.map((x: any) => x.slug);
    expect(await q("camara")).toEqual(["migrant-expulsion-law-clears-congress"]);
    expect(await q("Cámara")).toEqual(["migrant-expulsion-law-clears-congress"]);
    expect(await q("filtracion")).toEqual(["afp-senate-session-scheduled"]);
    expect(await q("FILTRACIÓN")).toEqual(["afp-senate-session-scheduled"]);
    expect(await q("eMudhra")).toEqual(expect.arrayContaining(["emudhra-ca-keys-computable", "python-certifi-update"]));
    // A quoted phrase must match (details labels and text are indexed); extra terms only change the score.
    expect(await q('"Plex Media Server"')).toEqual(["plex2shell-exploited-kev"]);
    expect((await q("\"Who's affected\" Plex")).sort()).toEqual(
      ["emudhra-ca-keys-computable", "php2shell-emergency-patches"].sort(),
    );
    const scoped = await c.getJson(`/api/stories?q=anthropic&feed=ai&limit=2`);
    expect(scoped.body.stories).toHaveLength(2);
    const rest = await c.getJson(`/api/stories?q=anthropic&feed=ai&limit=100&cursor=${scoped.body.next}`);
    expect(rest.body.stories.length).toBeGreaterThan(0);
    expect((await c.get(`/api/stories?q=${"a".repeat(201)}`)).status).toBe(400);
    expect((await c.getJson("/api/stories?q=zzzznothing")).body.stories).toEqual([]);
  });

  test("GET /api/stories/:id: the story plus earlier stories of its thread", async () => {
    const { status, body } = await c.getJson("/api/stories/chile-20261022-080004-afp-senate-session-scheduled");
    expect(status).toBe(200);
    expect(body.story).toMatchObject({ thread: "afp-fondo-e-losses", is_update: true, feed: "chile" });
    expect(body.thread.earlier.map((s: any) => s.id)).toEqual(["chile-20261021-183000-afp-fondo-e-sanctions"]);
    expect(body.thread.later).toEqual([]);
    const older = await c.getJson("/api/stories/chile-20261021-183000-afp-fondo-e-sanctions");
    expect(older.body.thread.later.map((s: any) => s.id)).toEqual(["chile-20261022-080004-afp-senate-session-scheduled"]);
    // superseded runs are still readable by id
    expect((await c.get("/api/stories/chile-20261021-115606-afp-fondo-e-sanctions")).status).toBe(200);
    expect((await c.get("/api/stories/chile-20261021-115606-nope")).status).toBe(404);
    for (const bad of ["chile-20261021-115606", "CHILE-20261021-115606-x", "chile-20261021-115606-a%2Fb", "x".repeat(300)]) {
      expect((await c.get(`/api/stories/${bad}`)).status).toBe(400);
    }
  });

  test("GET /api/tags: counts for the filter chips", async () => {
    const topics = (await c.getJson("/api/tags?feed=chile&prefix=topic")).body.tags;
    // ties are sorted by tag
    expect(topics.slice(0, 2)).toEqual([
      { tag: "topic:markets", count: 2 },
      { tag: "topic:pensions", count: 2 },
    ]);
    expect(topics.every((t: any) => t.tag.startsWith("topic:"))).toBe(true);
    const kev = (await c.getJson("/api/tags?prefix=kev")).body.tags;
    expect(kev).toEqual([{ tag: "kev:yes", count: 3 }]);
    const upd = (await c.getJson("/api/tags?prefix=update")).body.tags;
    expect(upd).toEqual([{ tag: "update", count: 2 }]);
    const all = (await c.getJson("/api/tags")).body.tags;
    expect(all.length).toBeGreaterThan(50);
    expect((await c.get("/api/tags?prefix=evil")).status).toBe(400);
    expect((await c.get("/api/tags?prefix=.*")).status).toBe(400);
  });

  test("GET /healthz pings Mongo", async () => {
    const r = await c.getJson("/healthz");
    expect(r).toEqual({ status: 200, body: { status: "ok", mongo: "ok", kev: { cves: KEV.length, fetched_at: expect.any(String) } } });
    const dead = new MongoClient("mongodb://127.0.0.1:1/?directConnection=true", { serverSelectionTimeoutMS: 300 });
    const app = createApp({
      db: dead.db("x"),
      ingestToken: TOKEN,
      publicOrigin: ORIGIN,
      reference,
      kev: c.kev,
      log: memoryLogger(),
    });
    const res = await app.public(new Request("http://x/healthz"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", mongo: "unreachable" });
    await dead.close();
  });
});

describe("favorites", () => {
  let c: Ctx;
  const id = "cyber-20261021-132150-plex2shell-exploited-kev";
  beforeAll(async () => {
    c = await setup();
    await ingestAll(c);
  });

  test("writes need the public Origin and a JSON content type", async () => {
    expect((await c.fav("PUT", id, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await c.get(`/api/favorites/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
    expect(noOrigin.status).toBe(403);
    expect((await c.fav("PUT", id, { origin: `${ORIGIN}.evil.example` })).status).toBe(403);
    expect((await c.fav("PUT", id, { "content-type": "text/plain" })).status).toBe(415);
    expect((await c.fav("PUT", id, { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await c.fav("DELETE", id, { origin: "null" })).status).toBe(403);
    expect(await c.db.collection("favorites").countDocuments()).toBe(0);
  });

  test("ids are validated", async () => {
    expect((await c.fav("PUT", "not-an-id")).status).toBe(400);
    expect((await c.fav("PUT", "cyber-20261021-132150-%24where")).status).toBe(400);
    expect((await c.fav("PUT", "cyber-20261021-132150-unknown-story")).status).toBe(404);
    const badBody = await c.get(`/api/favorites/${id}`, {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{nope",
    });
    expect(badBody.status).toBe(400);
  });

  test("PUT and DELETE are idempotent; GET lists newest first with a snapshot", async () => {
    const r1 = await c.fav("PUT", id);
    expect(r1.status).toBe(200);
    const b1: any = await r1.json();
    expect(b1).toMatchObject({ story_id: id, favorite: true });
    await Bun.sleep(5);
    const r2 = await c.fav("PUT", id);
    expect(((await r2.json()) as any).created_at).toBe(b1.created_at);
    await Bun.sleep(5);
    expect((await c.fav("PUT", "ai-20261019-090352-reflection-beam-apache-weights")).status).toBe(200);
    expect(await c.db.collection("favorites").countDocuments()).toBe(2);

    const list = (await c.getJson("/api/favorites")).body;
    expect(list.favorites.map((f: any) => f.story_id)).toEqual(["ai-20261019-090352-reflection-beam-apache-weights", id]);
    expect(list.favorites[1].snapshot).toEqual({
      headline: "Plex2Shell: four Plex Media Server flaws exploited, added to KEV",
      feed: "cyber",
      edition_id: "cyber-20261021-132150",
      edition_date: "2026-10-21",
      sort_date: "2026-10-20",
    });
    expect(list.favorites[1].story.favorite).toBe(true);
    const paged = await c.getJson("/api/favorites?limit=1");
    expect(paged.body.favorites).toHaveLength(1);
    expect((await c.getJson(`/api/favorites?limit=1&cursor=${paged.body.next}`)).body.favorites[0].story_id).toBe(id);

    expect((await c.getJson(`/api/stories/${id}`)).body.story.favorite).toBe(true);
    const favOnly = (await c.getJson("/api/stories?favorites=1")).body.stories.map((s: any) => s.id);
    expect(favOnly).toEqual([id, "ai-20261019-090352-reflection-beam-apache-weights"]);
    expect((await c.getJson("/api/stories?favorites=1&feed=ai")).body.stories).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      const d = await c.fav("DELETE", id);
      expect(d.status).toBe(200);
      expect(await d.json()).toEqual({ story_id: id, favorite: false });
    }
    expect((await c.getJson(`/api/stories/${id}`)).body.story.favorite).toBe(false);
    expect((await c.getJson("/api/stories?favorites=1")).body.stories).toHaveLength(1);
  });
});

describe("entrypoint (main.ts) end to end", () => {
  async function freePort(): Promise<number> {
    const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = s.port!;
    await s.stop(true);
    return port;
  }

  test("starts both listeners, ingests, serves, and stops on SIGTERM", async () => {
    const kevServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ catalogVersion: "test", vulnerabilities: KEV.map((cveID) => ({ cveID })) }),
    });
    const [ingestPort, publicPort] = [await freePort(), await freePort()];
    const dbName = `t_${randomBytes(4).toString("hex")}`;
    const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "main.ts")], {
      env: {
        PATH: process.env.PATH ?? "",
        MONGO_URL: mongo.url,
        MONGO_DB: dbName,
        INGEST_TOKEN: TOKEN,
        INGEST_HOST: "127.0.0.1",
        INGEST_PORT: String(ingestPort),
        PUBLIC_HOST: "127.0.0.1",
        PUBLIC_PORT: String(publicPort),
        KEV_URL: `http://127.0.0.1:${kevServer.port}/kev.json`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const ok = await fetch(`http://127.0.0.1:${publicPort}/healthz`).then((r) => r.ok, () => false);
        if (ok) break;
        if (Date.now() > deadline || proc.exitCode !== null) throw new Error("news-api did not start");
        await Bun.sleep(100);
      }
      // the background KEV refresh used the local fake
      for (let i = 0; i < 50 && !(await client.db(dbName).collection("meta").findOne({ _id: "kev" as any })); i++) {
        await Bun.sleep(100);
      }
      const r = await fetch(`http://127.0.0.1:${ingestPort}/ingest/editions`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(fx("cyber.valid.json")),
      });
      expect(r.status).toBe(201);
      const stories: any = await (await fetch(`http://127.0.0.1:${publicPort}/api/stories?tag=kev:yes`)).json();
      expect(stories.stories.map((s: any) => s.slug)).toContain("plex2shell-exploited-kev");
      proc.kill("SIGTERM");
      expect(await proc.exited).toBe(0);
      const log = await new Response(proc.stderr).text();
      expect(log).toContain('"msg":"news-api listening"');
      expect(log).toContain('"msg":"kev: refreshed"');
      expect(log).not.toContain(TOKEN);
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      await proc.exited;
      await kevServer.stop(true);
    }
  }, 60_000);
});

describe("KEV", () => {
  test("persisted list survives a restart without the network; failures are logged, never fatal", async () => {
    const c = await setup();
    await ingestAll(c);
    const meta = await c.db.collection("meta").findOne({ _id: "kev" as any });
    expect(meta!.cves).toHaveLength(KEV.length);

    const log = memoryLogger();
    const offline = new KevService({
      cols: collections(c.db),
      url: "https://kev.invalid/",
      refreshHours: 24,
      fetcher: async () => {
        throw new Error("network is down");
      },
      log,
    });
    expect(await offline.load()).toBe(false); // fresh enough, no refresh needed
    expect(offline.has("CVE-2026-96652")).toBe(true);
    expect(await offline.refresh()).toBe(false);
    expect(offline.has("CVE-2026-96652")).toBe(true);
    expect(log.lines).toContainEqual(expect.objectContaining({ level: "warn", msg: "kev: refresh failed, keeping the previous list" }));

    const stale = new KevService({
      cols: collections(c.db),
      url: "https://kev.invalid/",
      refreshHours: 24,
      fetcher: async () => ({ html: true }),
      log,
      now: () => new Date(Date.now() + 25 * 3_600_000),
    });
    expect(await stale.load()).toBe(true);
    expect(await stale.refresh()).toBe(false);
  });

  test("a refresh tags stories whose CVE was added after they were stored", async () => {
    const c = await setup();
    await ingestAll(c);
    const php = "cyber-20261021-132150-php2shell-emergency-patches";
    expect((await c.getJson(`/api/stories/${php}`)).body.story.tags).not.toContain("kev:yes");
    c.setKev([...KEV, "CVE-2026-109618"]);
    expect(await c.kev.refresh()).toBe(true);
    expect((await c.getJson(`/api/stories/${php}`)).body.story.tags).toContain("kev:yes");
    expect(c.log.lines).toContainEqual(expect.objectContaining({ msg: "kev: tagged existing stories", fields: { stories: 1 } }));
    // New ingests use the refreshed list right away.
    const e = fx("cyber.valid.json");
    e.source_run.file = "2026-10-22_08-30-00.md";
    e.generated_at = "2026-10-22T08:30:00-03:00";
    expect((await c.post(e)).status).toBe(201);
    expect((await c.getJson("/api/stories/cyber-20261022-083000-php2shell-emergency-patches")).body.story.tags).toContain(
      "kev:yes",
    );
  });
});
