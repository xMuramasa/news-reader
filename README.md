# news-reader

Hermes news briefings (Chile daily, Cyber daily, AI weekly) as structured JSON editions, stored in MongoDB and read in
a web UI. `SPEC.md` is the source of truth for decisions; this file is about the code.

Phase 1: schema, job prompts, API, publisher. Phase 2: the web UI (`apps/ui`), its static server, the Docker images and a
container smoke test. The production compose file lives in the homelab repo (see [Deploy](#deploy)).

## Data flow

```
briefing job (Hermes, web search only)  final answer = one news-edition/v1 JSON object
  -> Hermes saves the run archive        ~/.hermes/cron/output/<job_id>/<YYYY-MM-DD_HH-MM-SS>.md
publisher (Hermes script job, 5 min)     extracts the answer, adds source_run + generated_at
  -> POST 127.0.0.1:8787/ingest/editions (bearer token)
news-api                                 validates, splits into stories, adds tags -> MongoDB
  -> public API on :8080 (/api/*)        read by the UI through Caddy
publisher stdout                          short Telegram notice with a link (Hermes delivers it)
```

## Layout

| Path | What it is |
| --- | --- |
| `packages/schema` (`@news/schema`) | Feed definitions (labels, emoji, Hermes job ids, sections, coverage groups, topics), the zod schema for `news-edition/v1` (`validateEdition`), tag normalization and derived tags (outlet, cve, kev, stack, blindspot, update), the Mongo `$jsonSchema` validators, `promptSection(feed)` (the JSON contract appended to each job prompt), and the public API response types (`api.ts`, types only). The UI imports the zod-free subpaths `@news/schema/feeds` and `@news/schema/tags`, so zod stays out of the browser bundle. |
| `apps/api` (`@news/api`) | news-api: Bun + the `mongodb` driver. Ingest listener (bearer token) and public listener (`/api/*`, `/healthz`). Creates collections, validators and indexes on start; keeps the CISA KEV list. |
| `apps/ui` (`@news/ui`) | news-ui: Vite + React 19 + TypeScript, Tailwind CSS 4, shadcn/ui components (generated into `src/components/ui`, Radix primitives), React Router, TanStack Query. Fonts are bundled with `@fontsource-variable` (Newsreader for headlines and reading text, Inter for the interface). `server.ts` is the Bun static server for `dist/`. All its packages are devDependencies: the image ships only `dist/` and `server.ts`. |
| `docker/` | `api.Dockerfile`, `ui.Dockerfile`, `compose.test.yml` (the throwaway smoke stack) and `mongo-init/01-app-user.js` (creates `news_app`). |
| `publisher/news_publisher.py` | Hermes script job (Python 3 stdlib only). Finds new runs of the three jobs, POSTs them, prints the Telegram notice or an alert. |
| `jobs/chile.md`, `cyber.md`, `ai.md` | Job prompts, **generated** by `bun run gen:prompts` from `jobs/legacy/<feed>.md` (research, sourcing and outlet-map instructions) plus the generated JSON contract. Don't edit by hand. |
| `jobs/legacy/` | Today's Markdown prompts and RSS pre-run scripts, kept for rollback. |
| `config/outlets.json` | Every outlet in the prompts' outlet maps: slug, name, aliases, domains, feeds, coverage group per feed, lean. Used for `outlet:` tags and source groups. |
| `config/stack.json` | The reader's software (from the cyber prompt) with aliases and context rules, for `stack:` tags. Short or common words (Bun, Homepage, sudo, MCP, Intel, Node…) only match with nearby context. |
| `test/fixtures/archives/` | Three real Hermes run archives (old Markdown format). |
| `test/fixtures/editions/` | `<feed>.valid.json`: those three runs converted by hand to `news-edition/v1`; `invalid.*.json`: one per hard error, with expected errors in `invalid.cases.json`. |
| `scripts/` | `gen-prompts.ts`, `typecheck.ts`, `install-publisher.ts`, `smoke.ts`. |

## Commands

Requires Bun 1.4.3, Python 3, and Docker with the `mongo:9.0.4` image already pulled (API tests never pull).

```sh
bun install
bun run typecheck          # tsc on the root scripts and every workspace with a tsconfig.json (UI included)
bun run test               # schema + API tests (API tests start a throwaway Mongo container)
bun run test:ui            # UI component/unit tests (happy-dom), then the static server tests
bun run build:ui           # vite build -> apps/ui/dist
bun run test:publisher     # python3 -I -m unittest discover -s publisher/tests -t .
bun run gen:prompts        # rewrite jobs/*.md
bun run gen:prompts:check  # exit 1 if jobs/*.md are stale
bun run check              # all of the above checks
bun run smoke              # build both images, run the container smoke stack, tear it down (needs Docker)
bun run install:publisher  # copy the publisher to ~/.hermes/scripts/ (maintainer only, after review)
```

Use `bun run test`, not a bare `bun test`, at the root: the UI's DOM tests need happy-dom preloaded and the static
server tests must run without it, so `test` skips `apps/ui` (`--path-ignore-patterns`) and `test:ui` runs the two UI
sets as separate processes. A bare `bun test` picks up the UI files too and they fail with a message saying so.

API tests start `mongo:9.0.4` as `news-reader-test-<random>` on a random `127.0.0.1` port with data on tmpfs, and
remove it in teardown (plus an exit hook, plus a 15-minute self-destruct inside the container). Without Docker they
fail; they are never skipped. They use no network: the KEV download is faked. Check for leftovers with
`docker ps -a --filter label=news-reader-test=1`.

Run the API locally: `MONGO_URL=... INGEST_TOKEN=... bun apps/api/src/main.ts`.

## news-api environment

| Variable | Default | Notes |
| --- | --- | --- |
| `MONGO_URL` | (required) | `mongodb://news_app:…@news-mongo:27017/news` |
| `MONGO_DB` | `news` | |
| `INGEST_TOKEN` | (required) | at least 32 characters; compared in constant time |
| `INGEST_HOST` / `INGEST_PORT` | `0.0.0.0` / `8787` | compose publishes it on host loopback only |
| `PUBLIC_HOST` / `PUBLIC_PORT` | `0.0.0.0` / `8080` | reached through Caddy at `/api` |
| `PUBLIC_ORIGIN` | `https://news.lab.x-muramasa.dev` | required `Origin` for favorite writes |
| `KEV_URL` | CISA's `known_exploited_vulnerabilities.json` | |
| `KEV_REFRESH_HOURS` | `24` | refresh failures are logged, never fatal |
| `CONFIG_DIR` | `<repo>/config` | holds `outlets.json` and `stack.json` |

Bad configuration fails at start with every problem listed (secrets are never echoed). Logs are JSON lines on stderr.

## API

Ingest listener: `POST /ingest/editions` → 201 created / 200 replaced `{edition_id, stories, warnings}`; 401, 413 (over
1 MB, by header or by bytes read), 415, 422 `{errors, warnings}`. Requires `source_run {job_id, file}` (job id must be
the feed's job) and `generated_at`. `edition_id` = `<feed>-<YYYYMMDD>-<HHMMSS>` from the run file name. Replace
semantics keyed by `source_run`; writes are ordered so a failed ingest heals on re-POST.

Public listener (GET unless noted; JSON everywhere, including 404/405):

- `GET /api/feeds` – feeds with their latest edition and counts
- `GET /api/editions?feed=&before=&limit=` – newest first, latest run per day, `next` cursor
- `GET /api/editions/:id` – edition with ordered stories, `prev`, `next`, `same_day` runs
- `GET /api/stories?feed=&tag=&tag=&q=&from=&to=&sort=newest|oldest&favorites=1&cursor=&limit=`
- `GET /api/stories/:id` – story plus its thread (`earlier`, `later`)
- `GET /api/tags?feed=&prefix=` – tag counts
- `GET /api/favorites?cursor=&limit=`, `PUT|DELETE /api/favorites/:storyId` (need `Origin` = `PUBLIC_ORIGIN` and a JSON
  content type; idempotent)
- `GET /healthz` – Mongo ping (also on the ingest listener)

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a `default-src 'none'` CSP.

## Publisher environment

| Variable | Default |
| --- | --- |
| `HERMES_CRON_OUTPUT` | `~/.hermes/cron/output` |
| `NEWS_PUBLISHER_STATE` | `~/.hermes/news-publisher/state.json` (dir 700, file 600, written atomically) |
| `NEWS_ENV_FILE` | `~/Projects/homelab/news/.env` (reads `INGEST_TOKEN=`) |
| `NEWS_INGEST_URL` | `http://127.0.0.1:8787/ingest/editions` |
| `NEWS_PUBLIC_URL` | `https://news.lab.x-muramasa.dev` |

The feed ↔ job map is built in and checked against `@news/schema` by a test. On its very first run (no state file)
the publisher marks every archive already on disk as `skipped_legacy` and prints nothing. Outcomes per run: published
(short notice), failed (one alert with the first 3 errors, never repeated), silent, or pending (silent retry; after 2
hours a locally built notice with "⚠️ reader unavailable, will store later"). One `fcntl` lock prevents overlapping
ticks.

## UI

Routes: `/` (latest edition per feed, then the last 7 days), `/stories` (sort, feed, tag chips grouped by prefix with
counts, date range, favorites only, debounced search; all in the URL; "Load more" plus auto-load near the end),
`/e/:editionId` (contents as a sticky sidebar from `lg`, a sheet below; sections in feed order; markets strip; gaps;
prev/next; same-day runs; "mark edition read"), `/s/:storyId` (story plus thread timeline), `/favorites` (saved order;
filters apply to the loaded favorites; snapshots for stories that are gone), `/f/:feed` (archive by month). Anything
else is a 404 page.

- One API client (`src/lib/api.ts`, base `/api`, same origin), typed with `@news/schema`'s `api.ts`.
- Briefing text is plain text only (React escapes it; no `dangerouslySetInnerHTML`, no Markdown). Every link built from
  briefing content goes through `safeUrl()` (`src/lib/safe-url.ts`): absolute http(s) with a host and no credentials,
  otherwise plain text. External links use `target="_blank" rel="noopener noreferrer"`.
- ★ favorites update every cached copy of the story at once and roll back if the write fails (`src/lib/favorites.ts`).
- Reading settings (text size in 4 steps, serif/sans, line width, light/dark/sepia; system light/dark until chosen) and
  read/unread state live in localStorage. `public/theme-init.js` applies the settings before first paint (a classic
  same-origin script, so the CSP needs no inline script).
- Keyboard: `j`/`k` next/previous story, `s` star the focused story, `/` search, `?` help; off while typing.
- Text keeps 4.5:1 contrast (coverage-bar colours 3:1) in all three themes; `test/dom/contrast.test.ts` checks the tokens
  in `src/index.css`. Motion is limited to short fades and slides and respects `prefers-reduced-motion`.

Local development against a running API: `VITE_API_PROXY=http://127.0.0.1:8080 bun run --cwd apps/ui dev`. Favorite
writes need the API's `PUBLIC_ORIGIN` to match the dev origin (e.g. `PUBLIC_ORIGIN=http://localhost:5173`).

UI tests: `test/dom/` (happy-dom + Testing Library: story card, coverage bar, `safeUrl` and link rendering, tag grouping,
URL filter round-trip, favorites optimistic rollback, settings persistence and `theme-init.js` parity, theme contrast,
routes and 404, keyboard, the three fixture editions) and `test/server/` (the static server against a fixture build).

## news-ui environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `DIST_DIR` | `dist/` next to `server.ts` | `/app/dist` in the image |

`server.ts` serves `dist/` (GET/HEAD only): hashed files under `/assets/` with `Cache-Control: public, max-age=31536000,
immutable`, everything else `no-cache` with an ETag; paths without a file extension get `index.html` (SPA fallback);
missing files with an extension are 404; encoded traversal (`..%2f`, `%5c`, NUL) is 400 and dotfiles are 404; `/api/*`
is 404 (Caddy routes it to news-api); `GET /healthz` is 200 while `index.html` exists. Every response carries the CSP
`default-src 'self'; script-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src
'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, plus `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and COOP/CORP same-origin. Inline styles stay allowed
because Radix dialogs inject a `<style>` element for scroll locking; the build needs no `data:` URIs.

## Docker images

Both build from the repo root (`.dockerignore` keeps out node_modules, dist, tests and fixtures, publisher, jobs, `.git`
and `.env*`): multi-stage on `oven/bun:1.4.3`, final stage `oven/bun:1.4.3-slim`, running as uid 1000, nothing written
outside `/tmp` (works with `read_only: true` plus a tmpfs on `/tmp`), `HEALTHCHECK` with bun's own `fetch` (no curl).

```sh
docker build -f docker/api.Dockerfile -t news-api .   # production deps only; config/ at /app/config (CONFIG_DIR)
docker build -f docker/ui.Dockerfile -t news-ui .     # dist/ + server.ts, no node_modules
```

| Image | Ports | Healthcheck | Command |
| --- | --- | --- | --- |
| news-api | 8787 ingest, 8080 public | `GET 127.0.0.1:$PUBLIC_PORT/healthz` (includes a Mongo ping) | `bun apps/api/src/main.ts` |
| news-ui | 3000 | `GET 127.0.0.1:$PORT/healthz` | `bun server.ts` |

## Smoke test

`bun run smoke` (Docker required) builds both images as `news-reader-test-{api,ui}:<random>` and starts
`docker/compose.test.yml` as project `news-reader-test-<random>`: mongo:9.0.4 with auth and the init script on an
internal network; api and ui read-only as uid 1000; ingest, public API and UI published on random 127.0.0.1 ports;
random secrets; the KEV URL points at a closed local port so nothing leaves the machine. It waits for health, POSTs the
three valid fixtures, checks the UI (`/` references a hashed asset, the asset is immutable, SPA fallback, `/api` is 404),
the public API (`/api/feeds`, `/api/stories?feed=cyber`, `/api/editions/<id>`), a favorite PUT with the right Origin
(200) and a wrong one (403), restarts the API against the existing database, prints the image sizes, and always runs
`down -v` and removes the images, also on failure or Ctrl-C (`--keep-images` keeps the images).

## Deploy

The production compose file lives in the homelab repo (`~/Projects/homelab/news/docker-compose.yml`). What it needs:

- **news-mongo**: `mongo:9.0.4`, command `mongod --wiredTigerCacheSizeGB 0.25`, a persistent volume on `/data/db`, only
  on the `news-internal` network, no published ports. Env: `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`,
  `MONGO_APP_PASSWORD` (optional: `MONGO_APP_USER`, default `news_app`; `MONGO_APP_DB`, default `news`). Mount
  `docker/mongo-init/` read-only at `/docker-entrypoint-initdb.d`: on the first start with an empty data directory it
  creates `news_app` with `readWrite` on `news` plus `news_schema`, a role holding only `collMod` there. The API
  re-applies its validators with `collMod` on every start; with `readWrite` alone it starts once and then fails on every
  restart. For a data directory that already exists, run the script once by hand with mongosh as root (with
  `MONGO_APP_PASSWORD` set in that shell's environment). Healthcheck:
  `mongosh --quiet --eval "quit(db.adminCommand('ping').ok ? 0 : 1)"`.
- **news-api**: on `news-internal` and `proxy`; publish `127.0.0.1:8787:8787` for the publisher only; 8080 is reached by
  Caddy over `proxy`. Env as in [news-api environment](#news-api-environment), at least
  `MONGO_URL=mongodb://news_app:<password>@news-mongo:27017/news` and `INGEST_TOKEN` (the publisher reads the same token
  from `news/.env`). `user: "1000:1000"`, `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`,
  `security_opt: ["no-new-privileges:true"]`, `depends_on: {news-mongo: {condition: service_healthy}}`. The image's
  healthcheck applies.
- **news-ui**: on `proxy` only, no published ports, the same hardening. No env needed.
- **Caddy** for `news.lab.x-muramasa.dev`: `handle /api/* { reverse_proxy news-api:8080 }` and
  `handle { reverse_proxy news-ui:3000 }`; `encode zstd gzip` is worth adding (the static server doesn't compress).
  Caddy passes the browser's `Origin` through unchanged by default, which favorite writes rely on.
- **Kuma**: `https://news.lab.x-muramasa.dev/healthz` reaches news-ui's health; the API's `/healthz` is not under `/api`,
  so monitor it through the container healthcheck or a dedicated Caddy route.
