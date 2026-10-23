import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULT_CONFIG_DIR, loadConfig, loadReferenceData } from "../src/config.ts";
import { STORIES_SORT, EDITIONS_SORT, afterCursor, decodeCursor, encodeCursor } from "../src/cursor.ts";
import { HttpError, readBody, router } from "../src/http.ts";
import { checkBearer } from "../src/ingest.ts";
import { parseKevCatalog } from "../src/kev.ts";
import { silentLogger } from "../src/log.ts";

const TOKEN = "t".repeat(40);
const base = { MONGO_URL: "mongodb://127.0.0.1:27017", INGEST_TOKEN: TOKEN };

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe("config", () => {
  test("defaults", () => {
    expect(loadConfig(base)).toEqual({
      mongoUrl: "mongodb://127.0.0.1:27017",
      mongoDb: "news",
      ingestToken: TOKEN,
      ingestHost: "0.0.0.0",
      ingestPort: 8787,
      publicHost: "0.0.0.0",
      publicPort: 8080,
      publicOrigin: "https://news.lab.x-muramasa.dev",
      kevUrl: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      kevRefreshHours: 24,
      configDir: DEFAULT_CONFIG_DIR,
      jev: null,
    });
  });

  test("Jev is off without a key, on with defaults when TYPESAFE_AI_API_KEY is set", () => {
    const key = "tsk_" + "a".repeat(40);
    expect(loadConfig(base).jev).toBeNull();
    expect(loadConfig({ ...base, TYPESAFE_AI_API_KEY: key }).jev).toEqual({
      apiKey: key,
      url: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      threshold: 0.85,
    });
    expect(loadConfig({ ...base, TYPESAFE_AI_API_KEY: key, JEV_THRESHOLD: "0.9", JEV_MODEL: "jev-preview" }).jev).toMatchObject({
      model: "jev-preview",
      threshold: 0.9,
    });
    const p = problems({ ...base, TYPESAFE_AI_API_KEY: "short key", JEV_URL: "http://evil.example/x", JEV_THRESHOLD: "1.5", JEV_MODEL: "a b" });
    expect(p).toEqual([
      "TYPESAFE_AI_API_KEY must be at least 16 characters without whitespace",
      "JEV_URL must be an https URL",
      "JEV_MODEL must be a model name like jev-latest",
      "JEV_THRESHOLD must be a number between 0 and 1",
    ]);
    expect(p.join(" ")).not.toContain("short key");
  });

  test("fails fast with every problem listed and without echoing the token", () => {
    const p = problems({
      INGEST_TOKEN: "short-secret",
      MONGO_DB: "bad name",
      INGEST_PORT: "99999",
      PUBLIC_PORT: "http",
      PUBLIC_ORIGIN: "https://news.example.org/path",
      KEV_URL: "file:///etc/passwd",
      KEV_REFRESH_HOURS: "0",
    });
    expect(p).toEqual([
      "MONGO_URL is required",
      "MONGO_DB must be 1-63 letters, digits, _ or -",
      "INGEST_TOKEN must be at least 32 characters",
      "INGEST_PORT must be a port number 1-65535",
      "PUBLIC_PORT must be a port number 1-65535",
      "PUBLIC_ORIGIN must be an origin like https://news.example.org (scheme and host, no path)",
      "KEV_URL must be an http(s) URL",
      "KEV_REFRESH_HOURS must be a number of hours between 1 and 720",
    ]);
    expect(p.join(" ")).not.toContain("short-secret");
    expect(problems({ MONGO_URL: "mongodb://x" })).toEqual(["INGEST_TOKEN is required"]);
    expect(problems({ ...base, INGEST_PORT: "8080" })).toEqual(["INGEST_PORT and PUBLIC_PORT must differ"]);
    expect(problems({ ...base, MONGO_URL: "http://mongo" })).toEqual(["MONGO_URL must start with mongodb:// or mongodb+srv://"]);
  });

  test("reference data loads from the repo and bad files fail fast", () => {
    const ref = loadReferenceData(DEFAULT_CONFIG_DIR);
    expect(ref.outlets.byDomain.get("emol.com")?.slug).toBe("emol");
    expect(ref.stack.entries.length).toBeGreaterThan(30);
    const dir = mkdtempSync(join(tmpdir(), "news-config-"));
    try {
      expect(() => loadReferenceData(dir)).toThrow(ConfigError);
      writeFileSync(join(dir, "outlets.json"), JSON.stringify({ outlets: [] }));
      writeFileSync(join(dir, "stack.json"), JSON.stringify({ software: [{ slug: "Bad Slug", name: "x", aliases: ["x"] }] }));
      expect(() => loadReferenceData(dir)).toThrow(/stack\.json: software\.0\.slug/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("entrypoint", () => {
  test("bad configuration exits 1 before connecting, without echoing secrets", () => {
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts")], {
      env: { PATH: process.env.PATH ?? "", INGEST_TOKEN: "too-short-secret-value" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(1);
    const err = p.stderr.toString();
    expect(err).toContain("MONGO_URL is required");
    expect(err).toContain("INGEST_TOKEN must be at least 32 characters");
    expect(err).not.toContain("too-short-secret-value");
  });
});

describe("bearer token", () => {
  test("constant-time check", () => {
    expect(checkBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(checkBearer(`  Bearer ${TOKEN} `, TOKEN)).toBe(true);
    expect(checkBearer(`bearer ${TOKEN}`, TOKEN)).toBe(false);
    expect(checkBearer(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(checkBearer(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(checkBearer("Bearer ", TOKEN)).toBe(false);
    expect(checkBearer(TOKEN, TOKEN)).toBe(false);
    expect(checkBearer(null, TOKEN)).toBe(false);
  });
});

describe("cursors", () => {
  const doc = { sort_date: "2026-10-21", run_at: new Date("2026-10-21T14:56:06Z"), position: 3, _id: "chile-20261021-115606-x" };

  test("round trip", () => {
    const c = encodeCursor(STORIES_SORT.newest, doc);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(STORIES_SORT.newest, c)).toEqual([doc.run_at, 3, doc._id]);
  });

  test("tampered, foreign or garbage cursors are 400", () => {
    const c = encodeCursor(STORIES_SORT.newest, doc);
    const bad = (spec = STORIES_SORT.newest, s: string) => {
      try {
        decodeCursor(spec, s);
      } catch (err) {
        return err instanceof HttpError && err.status === 400;
      }
      return false;
    };
    expect(bad(STORIES_SORT.oldest, c)).toBe(true);
    expect(bad(EDITIONS_SORT, c)).toBe(true);
    expect(bad(undefined, "not a cursor!")).toBe(true);
    expect(bad(undefined, Buffer.from('{"s":"stories-newest","v":[1,2,3,4]}').toString("base64url"))).toBe(true);
    expect(bad(undefined, Buffer.from('{"s":"stories-newest","v":["a","x",1,"b"]}').toString("base64url"))).toBe(true);
    expect(bad(undefined, Buffer.from('{"s":"stories-newest","v":["a",{"$gt":""},1,"b"]}').toString("base64url"))).toBe(true);
    expect(bad(undefined, "A".repeat(2000))).toBe(true);
  });

  test("keyset filter", () => {
    const f = afterCursor(EDITIONS_SORT, [new Date(0), "x"]);
    expect(f).toEqual({ $or: [{ run_at: { $lt: new Date(0) } }, { run_at: new Date(0), _id: { $lt: "x" } }] });
  });
});

describe("http", () => {
  test("body limit by header and by bytes read", async () => {
    const req = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
      new Request("http://x/", { method: "POST", body, headers });
    expect((await readBody(req("abc"), 3)).byteLength).toBe(3);
    await expect(readBody(req("abcd"), 3)).rejects.toMatchObject({ status: 413 });
    await expect(readBody(req("a", { "content-length": "4" }), 3)).rejects.toMatchObject({ status: 413 });
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(2));
        c.enqueue(new Uint8Array(2));
        c.close();
      },
    });
    await expect(readBody(req(stream), 3)).rejects.toMatchObject({ status: 413 });
  });

  test("router: 404, 405 with Allow, HEAD, JSON errors and security headers", async () => {
    const r = router(
      [
        { pattern: /^\/a$/, methods: { GET: () => new Response("ok") } },
        { pattern: /^\/b\/([^/]+)$/, methods: { PUT: (_q, [id]) => Response.json({ id }) } },
        {
          pattern: /^\/boom$/,
          methods: {
            GET: () => {
              throw new Error("secret internal detail /home/x");
            },
          },
        },
      ],
      silentLogger,
    );
    const nf = await r(new Request("http://x/nope"));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "not found" });
    expect(nf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(nf.headers.get("referrer-policy")).toBe("no-referrer");
    expect(nf.headers.get("content-security-policy")).toContain("default-src 'none'");
    const na = await r(new Request("http://x/a", { method: "DELETE" }));
    expect(na.status).toBe(405);
    expect(na.headers.get("allow")).toBe("GET, HEAD");
    const head = await r(new Request("http://x/a", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(await (await r(new Request("http://x/b/a%20b", { method: "PUT" }))).json()).toEqual({ id: "a b" });
    expect((await r(new Request("http://x/b/%E0%A4%A", { method: "PUT" }))).status).toBe(400);
    const boom = await r(new Request("http://x/boom"));
    expect(boom.status).toBe(500);
    expect(await boom.text()).toBe('{"error":"internal error"}');
  });
});

describe("KEV catalog parsing", () => {
  test("extracts CVE ids", () => {
    expect(
      parseKevCatalog({
        catalogVersion: "2026.10.21",
        vulnerabilities: [{ cveID: "CVE-2026-96652" }, { cveID: "cve-2026-0257 " }, { cveID: 5 }, null, { cveID: "nope" }],
      }),
    ).toEqual({ cves: ["CVE-2026-0257", "CVE-2026-96652"], catalogVersion: "2026.10.21" });
    expect(() => parseKevCatalog({ vulnerabilities: [] })).toThrow();
    expect(() => parseKevCatalog("<html>")).toThrow();
  });
});
