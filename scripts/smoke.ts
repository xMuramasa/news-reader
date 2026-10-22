// Smoke test of the built containers (needs Docker; not part of `bun run check`).
//   bun run smoke [--keep-images]
// Builds both images, starts docker/compose.test.yml as a unique project news-reader-test-<random>, waits for health,
// POSTs the three valid fixtures, checks the UI and the public API, restarts the API against the existing database,
// then ALWAYS tears the stack down (`down -v`) and removes the images it built, also on failure or Ctrl-C.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const COMPOSE_FILE = join(ROOT, "docker", "compose.test.yml");
const FIXTURES = join(ROOT, "test", "fixtures", "editions");
const ORIGIN = "https://news.lab.x-muramasa.dev";
const keepImages = process.argv.includes("--keep-images");

const id = randomBytes(5).toString("hex");
const project = `news-reader-test-${id}`;
const apiImage = `news-reader-test-api:${id}`;
const uiImage = `news-reader-test-ui:${id}`;
const env = {
  ...process.env,
  SMOKE_API_IMAGE: apiImage,
  SMOKE_UI_IMAGE: uiImage,
  SMOKE_MONGO_ROOT_PASSWORD: randomBytes(24).toString("hex"),
  SMOKE_MONGO_APP_PASSWORD: randomBytes(24).toString("hex"),
  SMOKE_INGEST_TOKEN: randomBytes(32).toString("hex"),
};

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (msg: string) => console.log(`[smoke ${elapsed()}] ${msg}`);

function run(cmd: string[], opts: { quiet?: boolean; allowFail?: boolean } = {}): string {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString();
  const err = p.stderr.toString();
  if (p.exitCode !== 0 && !opts.allowFail) {
    throw new Error(`${cmd.slice(0, 4).join(" ")} … exited ${p.exitCode}\n${(err || out).trim().split("\n").slice(-30).join("\n")}`);
  }
  if (!opts.quiet && out.trim()) console.log(out.trim());
  return out;
}

const compose = (...args: string[]) => ["docker", "compose", "-p", project, "-f", COMPOSE_FILE, ...args];

let tornDown = false;
function teardown(): void {
  if (tornDown) return;
  tornDown = true;
  log(`tearing down ${project}`);
  run(compose("down", "-v", "--remove-orphans", "--timeout", "5"), { quiet: true, allowFail: true });
  // Belt and braces: anything still labelled with this project.
  const left = run(["docker", "ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { quiet: true, allowFail: true })
    .split("\n")
    .filter(Boolean);
  if (left.length) run(["docker", "rm", "-f", "-v", ...left], { quiet: true, allowFail: true });
  if (!keepImages) run(["docker", "image", "rm", "-f", apiImage, uiImage], { quiet: true, allowFail: true });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    teardown();
    process.exit(130);
  });
}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`check failed: ${msg}`);
}

function hostPort(service: string, port: number): string {
  const out = run(compose("port", service, String(port)), { quiet: true }).trim();
  const m = /^127\.0\.0\.1:(\d+)$/.exec(out.split("\n")[0] ?? "");
  check(m, `${service}:${port} is published on 127.0.0.1 only (got ${JSON.stringify(out)})`);
  return `http://127.0.0.1:${m[1]}`;
}

async function http(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "manual" });
}

async function getJson(url: string): Promise<any> {
  const r = await http(url);
  check(r.ok, `GET ${url} -> ${r.status}`);
  return r.json();
}

async function waitHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await http(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} not healthy after ${timeoutMs} ms`);
    await Bun.sleep(500);
  }
}

const results: string[] = [];
const ok = (msg: string) => {
  results.push(msg);
  log(`ok  ${msg}`);
};

async function main(): Promise<void> {
  run(["docker", "ps", "-q"], { quiet: true }); // fails loudly without Docker

  log(`building ${apiImage}`);
  run(["docker", "build", "-q", "-f", "docker/api.Dockerfile", "-t", apiImage, "."], { quiet: true });
  log(`building ${uiImage}`);
  run(["docker", "build", "-q", "-f", "docker/ui.Dockerfile", "-t", uiImage, "."], { quiet: true });

  log(`starting ${project}`);
  run(compose("up", "-d", "--wait", "--wait-timeout", "180"), { quiet: true });
  ok("stack healthy (mongo with auth, api and ui as uid 1000 on read-only root filesystems)");

  const ingest = hostPort("api", 8787);
  let api = hostPort("api", 8080);
  const ui = hostPort("ui", 3000);

  // Ingest the three valid fixtures.
  const editions: Record<string, string> = {};
  for (const feed of ["chile", "cyber", "ai"]) {
    const body = readFileSync(join(FIXTURES, `${feed}.valid.json`), "utf8");
    const r = await http(`${ingest}/ingest/editions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SMOKE_INGEST_TOKEN}`, "Content-Type": "application/json" },
      body,
    });
    const j: any = await r.json();
    check(r.status === 201, `POST ${feed} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    editions[feed] = j.edition_id;
    ok(`ingest ${feed}: 201 ${j.edition_id}, ${j.stories} stories, ${j.warnings.length} warnings`);
  }
  const noToken = await http(`${ingest}/ingest/editions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check(noToken.status === 401, `ingest without token -> ${noToken.status}`);
  ok("ingest without token: 401");

  // UI: HTML shell referencing a hashed asset, the asset itself, SPA fallback, /api not served here.
  const home = await http(`${ui}/`);
  const html = await home.text();
  check(home.status === 200 && /text\/html/.test(home.headers.get("content-type") ?? ""), `GET / -> ${home.status}`);
  check(home.headers.get("cache-control") === "no-cache", "index.html is no-cache");
  check((home.headers.get("content-security-policy") ?? "").includes("default-src 'self'"), "CSP on /");
  const asset = /\/assets\/index-[A-Za-z0-9_-]{8,}\.js/.exec(html)?.[0];
  check(asset, "index.html references a hashed JS asset");
  ok(`ui GET /: 200 html, CSP, references ${asset}`);
  const js = await http(ui + asset);
  check(js.status === 200, `GET ${asset} -> ${js.status}`);
  check(/javascript/.test(js.headers.get("content-type") ?? ""), `asset content-type ${js.headers.get("content-type")}`);
  check(js.headers.get("cache-control") === "public, max-age=31536000, immutable", "asset is immutable");
  ok(`ui GET ${asset}: 200 ${(await js.arrayBuffer()).byteLength} bytes, immutable`);
  const css = /\/assets\/index-[A-Za-z0-9_-]{8,}\.css/.exec(html)?.[0];
  check(css && (await http(ui + css)).status === 200, "stylesheet served");
  const deep = await http(`${ui}/e/${editions.cyber}`);
  check(deep.status === 200 && (await deep.text()).includes('id="root"'), "SPA fallback for /e/:id");
  const uiApi = await http(`${ui}/api/feeds`);
  check(uiApi.status === 404, `ui /api/feeds -> ${uiApi.status} (must not proxy)`);
  check((await http(`${ui}/healthz`)).status === 200, "ui healthz");
  ok("ui SPA fallback 200, /api/* 404, /healthz 200");

  // Public API through the api container's public port.
  const feeds = await getJson(`${api}/api/feeds`);
  check(feeds.feeds.length === 3 && feeds.feeds.every((f: any) => f.latest), "three feeds with a latest edition");
  ok(`api /api/feeds: ${feeds.feeds.map((f: any) => `${f.id}=${f.latest.id}`).join(", ")}`);
  const cyber = await getJson(`${api}/api/stories?feed=cyber&limit=100`);
  check(cyber.stories.length > 0 && cyber.stories.every((s: any) => s.feed === "cyber"), "cyber stories");
  ok(`api /api/stories?feed=cyber: ${cyber.stories.length} stories`);
  const ed = await getJson(`${api}/api/editions/${editions.cyber}`);
  check(ed.edition.id === editions.cyber && ed.edition.stories.length === cyber.stories.length, "cyber edition with its stories");
  ok(`api /api/editions/${editions.cyber}: ${ed.edition.stories.length} stories in order`);
  const health = await getJson(`${api}/healthz`);
  check(health.status === "ok" && health.mongo === "ok", "api healthz");

  // Favorites: Origin check.
  const storyId: string = cyber.stories[0].id;
  const fav = (origin: string, method = "PUT") =>
    http(`${api}/api/favorites/${encodeURIComponent(storyId)}`, { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
  const good = await fav(ORIGIN);
  check(good.status === 200, `PUT favorite with the right Origin -> ${good.status}`);
  const bad = await fav("https://evil.example");
  check(bad.status === 403, `PUT favorite with a wrong Origin -> ${bad.status}`);
  const favs = await getJson(`${api}/api/favorites`);
  check(favs.favorites.some((f: any) => f.story_id === storyId), "favorite listed");
  ok("favorite PUT right Origin 200, wrong Origin 403, listed in /api/favorites");

  // The API restarts against an existing database (collections, validators and indexes already there).
  log("restarting api");
  run(compose("restart", "api"), { quiet: true });
  api = hostPort("api", 8080); // random host ports are reassigned on restart
  await waitHealthy(`${api}/healthz`, 60_000);
  const after = await getJson(`${api}/api/feeds`);
  check(after.feeds.every((f: any) => f.latest), "data still there after the restart");
  ok("api restarted against the existing database, healthy, data intact");

  const images = JSON.parse(run(compose("images", "--format", "json"), { quiet: true }) || "[]") as {
    Repository?: string;
    Tag?: string;
    Size?: number;
  }[];
  for (const img of images) {
    if (img.Repository?.startsWith("news-reader-test-")) {
      ok(`image ${img.Repository}: ${((img.Size ?? 0) / 1e6).toFixed(1)} MB`);
    }
  }
}

let failed = false;
let failure = "";
try {
  await main();
} catch (err) {
  failed = true;
  failure = (err as Error).message;
  if (!tornDown) {
    for (const [service, tail] of [["api", "60"], ["ui", "30"], ["mongo", "8"]] as const) {
      console.error(`--- ${service} logs (last ${tail} lines) ---`);
      const logs = Bun.spawnSync(compose("logs", "--no-color", "--no-log-prefix", "--tail", tail, service), { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
      console.error((logs.stdout.toString() + logs.stderr.toString()).trim());
    }
  }
} finally {
  teardown();
}
const leftovers = run(["docker", "ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { quiet: true, allowFail: true }).trim();
if (leftovers) {
  console.error(`containers left behind: ${leftovers}`);
  failed = true;
}
if (failure) console.error(`\nSMOKE FAILED: ${failure}`);
console.log(`\n${failed ? "SMOKE FAILED" : "SMOKE PASSED"} (${elapsed()}), ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
