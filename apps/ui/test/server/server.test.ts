// news-ui static server against a small fixture build (test/server/fixture/site; not "dist", which is gitignored).
// Runs without happy-dom.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CSP, IMMUTABLE, NO_CACHE, createHandler } from "../../server.ts";

const FIXTURE = join(import.meta.dir, "fixture", "site");
const handler = createHandler({ distDir: FIXTURE });
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.stop(true);
});

const get = (path: string, init?: RequestInit) => fetch(base + path, { redirect: "manual", ...init });
/** Bypass the client's URL normalization: hand the raw path straight to the handler. */
const raw = (path: string) => handler(new Request(`http://localhost${path}`));

describe("SPA and files", () => {
  test("/ serves index.html, no-cache", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe(NO_CACHE);
    expect(await r.text()).toContain("/assets/index-AbCdEf12.js");
  });

  test.each(["/stories", "/stories?tag=topic:apt", "/e/chile-20261021-115606", "/s/cyber-20261021-132150-x", "/favorites", "/f/ai", "/no/such/route/"])(
    "client route %p falls back to index.html",
    async (p) => {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe(NO_CACHE);
      expect(await r.text()).toContain('<div id="root">');
    },
  );

  test("hashed assets: right type, cached for a year, immutable", async () => {
    for (const [p, type] of [
      ["/assets/index-AbCdEf12.js", "text/javascript; charset=utf-8"],
      ["/assets/index-ZyXwVu98.css", "text/css; charset=utf-8"],
      ["/assets/font-latin-Qw3rTy45.woff2", "font/woff2"],
    ] as const) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe(type);
      expect(r.headers.get("cache-control")).toBe(IMMUTABLE);
      await r.arrayBuffer();
    }
  });

  test("unhashed files are revalidated; ETag gives 304", async () => {
    const r = await get("/theme-init.js");
    expect(r.headers.get("cache-control")).toBe(NO_CACHE);
    expect(r.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const etag = r.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const again = await get("/theme-init.js", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect((await get("/favicon.svg")).headers.get("content-type")).toBe("image/svg+xml");
  });

  test("missing files with an extension are 404, not the SPA shell", async () => {
    const r = await get("/assets/missing-AbCdEf12.js");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  test("HEAD works, other methods are 405", async () => {
    const h = await get("/", { method: "HEAD" });
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("");
    const p = await get("/", { method: "POST", body: "x" });
    expect(p.status).toBe(405);
    expect(p.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("security", () => {
  test.each(["/", "/stories", "/assets/index-AbCdEf12.js", "/nope.js", "/healthz", "/api/feeds"])("headers on %p", async (p) => {
    const r = await get(p);
    expect(r.headers.get("content-security-policy")).toBe(CSP);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    await r.arrayBuffer();
  });

  test("CSP allows only this origin, no inline scripts, no framing", () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("base-uri 'none'");
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).not.toMatch(/https?:/);
  });

  test.each([
    "/..%2fsecret.txt",
    "/..%2Fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/assets%2f..%2f..%2fsecret.txt",
    "/..%5csecret.txt",
    "/assets/%5c..%5c..%5csecret.txt",
    "/index.html%00.js",
    "/%",
  ])("traversal or malformed path %p is rejected", async (p) => {
    for (const r of [await get(p), await raw(p)]) {
      expect([400, 404]).toContain(r.status);
      const body = await r.text();
      expect(body).not.toContain("must never be served");
    }
  });

  test("dot-segment paths are normalized by the URL parser and stay inside dist", async () => {
    for (const p of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"]) {
      const r = await raw(p);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain("must never be served");
    }
  });

  test("dotfiles are not served", async () => {
    expect((await get("/.hidden")).status).toBe(404);
  });
});

describe("/api and /healthz", () => {
  test.each(["/api", "/api/", "/api/feeds", "/api/stories?feed=cyber", "/api/favorites/x"])("%p is 404 JSON (Caddy routes /api)", async (p) => {
    const r = await get(p);
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await r.json()).toEqual({ error: "not found" });
  });

  test("PUT /api/... is 405 here as well, never proxied", async () => {
    expect((await get("/api/favorites/x", { method: "PUT" })).status).toBe(405);
  });

  test("healthz reports ok with a build, 503 without", async () => {
    const r = await get("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    const missing = await createHandler({ distDir: join(import.meta.dir, "no-such-dist") })(new Request("http://localhost/healthz"));
    expect(missing.status).toBe(503);
  });
});
