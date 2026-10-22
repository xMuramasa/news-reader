# news-reader

Hermes news briefings (Chile daily, Cyber daily, AI weekly) as structured JSON editions, stored in MongoDB and read in
a web UI. `SPEC.md` is the source of truth for decisions; this file is about the code.

Phase 1 (this repo today): schema, job prompts, API, publisher. Phase 2: the web UI (`apps/ui`) and Docker/deploy.

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
| `packages/schema` (`@news/schema`) | Feed definitions (labels, emoji, Hermes job ids, sections, coverage groups, topics), the zod schema for `news-edition/v1` (`validateEdition`), tag normalization and derived tags (outlet, cve, kev, stack, blindspot, update), the Mongo `$jsonSchema` validators, and `promptSection(feed)`, the JSON contract appended to each job prompt. Shared by the API, the tests and (phase 2) the UI. |
| `apps/api` (`@news/api`) | news-api: Bun + the `mongodb` driver. Ingest listener (bearer token) and public listener (`/api/*`, `/healthz`). Creates collections, validators and indexes on start; keeps the CISA KEV list. |
| `publisher/news_publisher.py` | Hermes script job (Python 3 stdlib only). Finds new runs of the three jobs, POSTs them, prints the Telegram notice or an alert. |
| `jobs/chile.md`, `cyber.md`, `ai.md` | Job prompts, **generated** by `bun run gen:prompts` from `jobs/legacy/<feed>.md` (research, sourcing and outlet-map instructions) plus the generated JSON contract. Don't edit by hand. |
| `jobs/legacy/` | Today's Markdown prompts and RSS pre-run scripts, kept for rollback. |
| `config/outlets.json` | Every outlet in the prompts' outlet maps: slug, name, aliases, domains, feeds, coverage group per feed, lean. Used for `outlet:` tags and source groups. |
| `config/stack.json` | The reader's software (from the cyber prompt) with aliases and context rules, for `stack:` tags. Short or common words (Bun, Homepage, sudo, MCP, Intel, Node…) only match with nearby context. |
| `test/fixtures/archives/` | Three real Hermes run archives (old Markdown format). |
| `test/fixtures/editions/` | `<feed>.valid.json`: those three runs converted by hand to `news-edition/v1`; `invalid.*.json`: one per hard error, with expected errors in `invalid.cases.json`. |
| `scripts/` | `gen-prompts.ts`, `typecheck.ts`, `install-publisher.ts`. |

## Commands

Requires Bun 1.4.3, Python 3, and Docker with the `mongo:9.0.4` image already pulled (API tests never pull).

```sh
bun install
bun run typecheck          # tsc on the root scripts and every workspace with a tsconfig.json
bun test                   # schema + API tests (API tests start a throwaway Mongo container)
bun run test:publisher     # python3 -I -m unittest discover -s publisher/tests -t .
bun run gen:prompts        # rewrite jobs/*.md
bun run gen:prompts:check  # exit 1 if jobs/*.md are stale
bun run check              # all of the above checks
bun run install:publisher  # copy the publisher to ~/.hermes/scripts/ (maintainer only, after review)
```

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
