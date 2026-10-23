# News pipeline + reader: spec v2 (draft for review)

## Goal

An experiment with a NoSQL store: briefings become structured JSON, an API stores them in MongoDB, and a web UI shows
them sorted by date, with tags and per-story favorites. Telegram gets a short notice with a link.

## Decisions so far

- Telegram: short message (lead line, story titles, link).
- Favorites: per story.
- Tags: predefined lists, plus tags added by code (see Tags).
- UI: its own container.
- Backfill: the first test run of each new job is kept as the starting data. Markdown editions from before the
  switch are not imported.
- The AI digest moves to the new system too (daily since 2026-10-23, was weekly).

## Flow

```
briefing job (AI, web search only) -> final answer = edition JSON -> saved by Hermes in ~/.hermes/cron/output/<job>/
publisher job (script, no AI, every 5 min) -> reads new runs -> POST 127.0.0.1:8787/ingest/editions (token)
news-api (Bun) -> validates, splits, tags -> MongoDB (editions, stories, favorites)
news-ui (Bun, static) <- browser at https://news.lab.x-muramasa.dev   (/api/* -> news-api via Caddy)
publisher -> after a successful store, prints the short Telegram message (Hermes delivers it)
```

### Briefing jobs

- Same research as today: same RSS pre-run scripts for Chile and Cyber, same search rules, same outlet map.
- The final answer is one JSON object following `news-edition/v1`. No Markdown, no code fences (the publisher strips
  fences anyway).
- `deliver: local` (the run is saved, nothing sent) and `failure_deliver: origin` (a failed run still alerts in Telegram).
- Toolsets unchanged: `web` only. The AI never posts, writes files or runs commands.
- Continuity stays on: each run sees its previous JSON and marks continuing stories `is_update` with the same `thread`.
- Prompts live in the repo under `jobs/` (`chile.md`, `cyber.md`, `ai.md`). Their schema section is generated from the
  schema package, so prompt and validator can't drift. I apply them to the cron jobs.
- Schedules: Chile, Cyber and AI every day at 03:00 America/Santiago (since 2026-10-23; was Chile 08:00, Cyber 08:30, AI Monday 09:00).

### Publisher (`news_publisher.py`)

- Hermes cron job with `no_agent` (script only, no tokens), every 5 minutes. Empty output means no Telegram message.
- Finds runs of the three jobs not yet published (state in `~/.hermes/news-publisher/state.json`).
- Extracts the answer with Hermes' length frames (same logic as `_archive_answer`), strips code fences, parses the JSON,
  adds `source_run` (job id + file name) and `generated_at` (run time), then POSTs it.
- Outcomes:
  - 200/201: prints the short message and marks the run published.
  - 422 (bad JSON or schema): prints one alert, e.g. "⚠️ Chile 21 Oct failed validation: <first 3 errors>", marks the
    run failed, no retry. The raw run stays on disk for inspection.
  - API down or 5xx: silent retry on the next tick. If a run is still unpublished after 2 hours, it sends the short
    message built locally with "⚠️ reader unavailable, will store later" and keeps retrying the POST. When that run
    is finally stored it prints one line ("✅ … is in the reader now: <link>") instead of repeating the message.
  - Details settled in phase 1: 400 and 413 are treated like 422 (alert once); 401, 403 and other 4xx retry silently
    like 5xx (usually a token or config problem). A silent answer (`[SILENT]` etc.) is recorded and prints nothing. An
    archive whose length frame is still truncated 15 minutes after it was written alerts once. The very first run
    (no state file) marks every archive already on disk `skipped_legacy`, so old Markdown runs never alert.
    `generated_at` uses the America/Santiago offset of the run time (−03:00 in summer, −04:00 in winter).
- Python stdlib only. Source in the repo's `publisher/`, copied into `~/.hermes/scripts/` by `bun run install:publisher`
  (Hermes refuses scripts outside that folder, symlinks included).
- Reads the ingest token from `~/Projects/homelab/news/.env` (mode 600).

Short message:

```
🇨🇱 Chile · Wed 21 Oct
Congress passed the faster migrant-expulsion law; AFP Fondo E fallout reaches the Senate.
1. Faster migrant-expulsion law clears Congress
2. AFP Fondo E: regulator opens cases (update)
3. ...
📖 https://news.lab.x-muramasa.dev/e/chile-20261021-080412
```

Cyber adds one line: "🚨 4 patch now · ⚠️ 2 affect your stack" (the number of stories in `patch_now` and in
`your_stack`). Listed titles: Chile and AI `top`, Cyber `patch_now` then `top`, at most 7 plus "+N more". Messages are
plain text (no Markdown characters Telegram could misparse), each under 3500 characters.

## Edition JSON (`news-edition/v1`)

Example, trimmed to one story:

```json
{
  "schema": "news-edition/v1",
  "feed": "chile",
  "edition_date": "2026-10-21",
  "title": "Chile — Wednesday, 21 October 2026",
  "lead": "Congress passed the faster migrant-expulsion law; AFP Fondo E fallout reaches the Senate.",
  "language": "en",
  "stories": [
    {
      "slug": "afp-fondo-e-sanctions",
      "section": "top",
      "rank": 2,
      "headline": "AFP Fondo E: regulator opens cases, Senate sets a session",
      "summary": "On 20 Oct the Superintendencia de Pensiones opened sanction proceedings against all 7 AFPs after Fondo E fell 10.4% in real terms Jan–Sep.",
      "event_date": "2026-10-20",
      "is_update": true,
      "thread": "afp-fondo-e-losses",
      "verification": "confirmed",
      "action": null,
      "details": [{ "label": "Next", "text": "Senate special session on Tue 27 Oct." }],
      "coverage": [
        { "group": "right", "covered": true, "outlets": ["Emol", "La Tercera", "Ex-Ante"] },
        { "group": "center", "covered": true, "outlets": ["T13", "DF"] },
        { "group": "left", "covered": true, "outlets": ["El Mostrador", "El Ciudadano"] },
        { "group": "independent", "covered": true, "outlets": ["CIPER"] }
      ],
      "framing": [
        { "group": "right", "text": "Quiroz wants 'máxima severidad' and blames years of inaction." },
        { "group": "left", "text": "Unpunished abuse that echoes 18-O." }
      ],
      "blindspot": null,
      "sources": [{ "outlet": "El País", "url": "https://elpais.com/chile/2026-10-20/..." }],
      "tags": ["topic:pensions", "topic:markets", "region:chile", "org:superintendencia-de-pensiones"]
    }
  ],
  "markets": { "as_of": "2026-10-20", "items": [{ "name": "IPSA", "value": "10,926.50", "change": "-0.42%" }] },
  "gaps": ["Full articles unavailable; based on search snippets."]
}
```

Edition fields: `schema`, `feed`, `edition_date` (Santiago date), `title`, `lead`, `language`, `stories` (1–40),
optional `markets` (Chile), `gaps`. The publisher adds `source_run` and `generated_at`.

Story fields:

- `slug`: kebab-case, unique within the edition.
- `section` and `rank`: where the story sits in the edition (section lists below).
- `headline`, `summary` (1–3 sentences), `event_date` (may be null).
- `is_update`, `thread`: a kebab-case key that stays the same while a story continues across days.
- `verification`: `confirmed`, `claimed`, `unverified` or `mixed`.
- `action`: what to do, mainly for Cyber "patch now" and "your stack" items; otherwise null.
- `details`: extra labelled lines ("Who's affected", "Status", "Next").
- `coverage`, `framing`: per group, using the feed's group list.
- `blindspot`: text or null.
- `sources`: outlet and http(s) URL, up to 10. May be empty when the briefing had no link (e.g. quick hits).
- `tags`: see below.

Each story sits in exactly one section; a Cyber patch-now story carries the full story and is not repeated under
`top`. Validation is strict about structure (wrong or missing required fields, unknown feed, section or coverage
group, duplicate slugs, non-http(s) URLs, size caps such as 1–40 stories and a 1 MB body are errors) and forgiving
about cosmetics (strings trimmed, ids lower-cased, tags normalized; unknown keys and tags outside the lists are
dropped with a warning). Optional story fields default to null / [] / false; `thread` defaults to the slug.

Per feed:

- Chile: sections `top`, `independent`, `fact_check`, `quick_hit`. Coverage groups `right`, `center`, `left`,
  `independent`, `foreign`.
- Cyber: sections `patch_now`, `top`, `your_stack`, `chile_latam`, `research`, `policy`. Coverage groups `gov_vendor`,
  `press`, `independent`, `research`.
- AI: sections `top`, `release`, `open_source`, `research`, `industry`. Coverage groups `lab`, `press`,
  `independent`, `research`.

## Tags

Format `prefix:value`, lowercase, kebab-case values.

Chosen by the AI from fixed lists:

- `topic:`
  - Chile: politics, government, congress, economy, markets, pensions, security-crime, courts, corruption, migration,
    environment, disasters, health, education, labor, housing, indigenous, foreign-relations, media, society.
  - Cyber: vulnerability, exploited, ransomware, data-breach, malware, phishing, supply-chain, apt, ai-security,
    pki-crypto, cloud, mobile, ics-ot, identity, privacy, law-enforcement, policy, research.
  - AI: model-release, open-weights, local-ai, agents, research, safety, security, policy-regulation,
    funding-business, hardware, product, open-source-tools.
- `region:` chile, latam, us, europe, asia-pacific, middle-east, africa, global.
- `status:` (Cyber) exploited, poc-public, patched, no-patch, claimed, disputed.
- `org:` the one open list: named companies and institutions can't be listed in advance. Max 5 per story; the API
  normalizes them to slugs.

Added by the API, not the AI:

- `outlet:<slug>` from the sources, with the outlet's lean from `config/outlets.json`.
- `cve:<id>` for CVE IDs found in the text.
- `kev:yes` when the CVE is in CISA's exploited list (the API refreshes the list daily).
- `stack:<software>` for matches with your software list in `config/stack.json`.
- `blindspot:<group>` when a coverage group is missing, i.e. the AI listed it with `covered: false` (groups it didn't
  check are not counted). Underscores become hyphens: `blindspot:gov-vendor`.
- `update` when `is_update` is true.

Unknown values for the fixed lists are dropped and returned as warnings; the edition still saves.

### Topic tagging with Jev

When `TYPESAFE_AI_API_KEY` is set, news-api asks Jev (TypeSafe's System One classifier, `jev-latest`) about each
story at ingest: one yes/no probability per topic of the feed (headline, summary and details only). See
`apps/api/src/jev.ts`.

- Topics at or above `JEV_THRESHOLD` (0.85) replace the AI's `topic:` tags, highest first, at most 4. If none clears
  the threshold, the AI's topics stay. `region:`, `status:`, `org:` and the API's own tags are not touched.
- Never blocks an ingest: if Jev fails or times out (6 s per edition, one retry per story), that story keeps the AI's
  topics and a warning is logged.
- Stored on the story as `jev` (not served by the public API): model, threshold, all probabilities, whether it was
  applied, the AI's own topics, an input hash and the time. A re-POST of the same run reuses unchanged results.
- `docker exec news-api bun apps/api/src/retag.ts` classifies stories stored without Jev; `--reapply` re-applies a
  new threshold from the stored probabilities with no API calls; `--force` classifies everything again.
- Cost: about 1,000 input tokens per story at $0.042 per million (output is free), about $0.06 a month.

## MongoDB

- Image `mongo:9.0.4`, `--wiredTigerCacheSizeGB 0.25`, auth on: a root user plus `news_app` with readWrite on db
  `news` and `news_schema`, a role holding only `collMod` on `news` (the API re-applies its validators with `collMod` on
  every start, which readWrite doesn't allow; without it the API starts once and then fails on every restart). Both are
  created by `docker/mongo-init/01-app-user.js` on first start. Credentials in `news/.credentials` (mode 600).
- Own Docker network `news-internal`, shared only with news-api. No ports, not on `proxy`.
- Collections:
  - `editions`: `_id` = `<feed>-<YYYYMMDD>-<HHMMSS>` (run time), `source_run` (unique), feed, dates, title, lead,
    markets, gaps, story ids, `ingested_at`, schema version.
  - `stories`: `_id` = `<edition_id>-<slug>`, edition and feed info, `sort_date` (event date, else edition date; an
    event date after the edition date, such as an upcoming deadline, uses the edition date so it doesn't pin the
    story to the top), all story fields, tags.
  - `favorites`: `_id` = story id, `created_at`, and a snapshot (headline, feed, date) so a favorite still shows if its
    story is removed.
- `$jsonSchema` validators on `editions` and `stories`, generated from the schema package. The API's validation is the
  main check; Mongo's is the backstop.
- Indexes: `editions` {feed, edition_date}; `stories` {edition_id, section, rank}, {feed, sort_date}, {tags, sort_date},
  {thread, sort_date}, and a text index; `favorites` {created_at}.
- Re-posting the same `source_run` replaces that edition and its stories; favorites are untouched. Several runs on one
  day are all kept: lists show the latest per day, and the edition page has a switcher.
- No transactions (standalone Mongo), so ingest writes in an order that heals on re-POST: edition upserted with
  `state: "ingesting"`, stories upserted, stale stories of that edition deleted, edition set `"ready"`. Public reads
  hide editions that aren't ready, and their stories.
- Search: text index over headline, summary, details and tags, `default_language: "none"` (mixed English/Spanish, no
  stemming). Mongo's text index ignores accents and case, so "filtracion" finds "filtración".
- Backups: `dump-databases.sh` adds a `mongodump --archive --gzip` to `~/backups/dumps/news-mongo.archive.gz`, checked
  with `mongorestore --dryRun`. The live data dir is excluded from Backrest.
- Memory: about 300 MB for Mongo and about 400 MB for the whole stack; about 3.9 GB is free today.

## API (news-api)

Bun, the official `mongodb` driver and zod. One process, two listeners.

Ingest: port 8787, published on the host's `127.0.0.1` only, bearer token required.

- `POST /ingest/editions`: 201 created / 200 replaced, `{edition_id, stories, warnings}`. Errors: 401, 413 (over
  1 MB), 422 `{errors}`.

Public: port 8080 on the `proxy` network, reached through Caddy at `/api`. GET only, apart from favorites.

- `GET /api/feeds`: feeds with their latest edition and counts.
- `GET /api/editions?feed=&before=&limit=`: newest first, cursor-paged.
- `GET /api/editions/:id`: edition with stories in order, prev/next ids and same-day runs.
- `GET /api/stories?feed=&tag=&q=&from=&to=&sort=newest|oldest&favorites=1&cursor=&limit=`: `tag` repeatable (AND).
  Sorted by publish date-time (the edition's `run_at`), then reading order within the edition. `from`/`to` filter
  on the published date (`edition_date`, Santiago), inclusive.
- `GET /api/stories/:id`: the story plus earlier stories in its thread (and later ones, for the timeline).
- `GET /api/tags?prefix=` plus the same filters as `/api/stories` (feed, tag, q, from, to, favorites): tag counts over
  the matching stories, so each chip's count is what adding that tag would give.
- `GET /api/favorites`, `PUT /api/favorites/:storyId`, `DELETE /api/favorites/:storyId` (both idempotent).
- `GET /healthz`: app and Mongo ping.

Favorite writes require `Origin: https://news.lab.x-muramasa.dev` and a JSON content type. Limits: `limit` ≤ 100, `q` ≤
200 chars, ids checked by regex. Errors are JSON.

Phase 1 details: cursors are opaque (`next` in list responses, passed back as `cursor`, or `before` for editions).
`tag` filters accept only the known prefixes (and the bare `update`), at most 10. `PUT` answers 200 whether or not the
favorite existed (404 if the story was never stored); `DELETE` always 200. KEV: the CVE list is kept in memory and in
the `meta` collection, refreshed every `KEV_REFRESH_HOURS`; a refresh also adds `kev:yes` to stored stories whose CVE
joined the catalog later. Env adds `PUBLIC_HOST` (default `0.0.0.0`) next to `INGEST_HOST`.

## UI (news-ui)

Routes:

- `/` Today: the latest edition of each feed as a card (title, lead, counts, Cyber's patch-now count), then all stories
  from the last 7 days.
- `/stories`: every story. Sort newest or oldest (event date, else edition date). Filters: feed, tag chips grouped by
  prefix (topic, region, status, org, outlet, stack, cve), date range, favorites only, search. Filters live in the URL,
  so a view can be bookmarked.
- `/e/:editionId`: the reading view from spec v1: table of contents, sections, coverage bar, framing, callouts for
  blindspot / patch now / your stack, source chips, CVE chips linking to NVD, prev/next, same-day run switcher.
- `/s/:storyId`: one story plus its thread timeline (earlier days of the same story).
- `/favorites`: saved stories, most recently saved first, with the same filters.
- `/f/:feed`: the feed's archive by month.

Story card: feed color strip, headline, date, summary, first 4 tags plus "more", coverage bar, and a ★ button (updates
at once, rolls back on error).

Also: reading settings (text size, font, width, light/dark/sepia), read/unread in the browser, keyboard shortcuts (`j`/`k`
move, `s` star, `/` search), built for the phone as much as the desktop. shadcn/ui and Tailwind, editorial look,
per-feed accent colors, bundled fonts, no CDNs.

Rendering: every field is plain text (React escapes it), no Markdown and no raw HTML. Links must be http(s) and open in
a new tab with `rel="noopener noreferrer"`. CSP with no external origins. A Bun static server serves the Vite build
with SPA fallback and long cache headers for hashed assets.

Phase 2 details: the UI reads the API shapes from `@news/schema` (`api.ts`, types only; the API is typed against the
same file). `/favorites` lists favorites in saved order from `GET /api/favorites`; its feed, tag, date and search
filters apply in the browser to the loaded favorites (the endpoint has no filters), and a favorite whose story is gone
shows its snapshot. A story counts as read once its page is opened, it is reached with `j`/`k`, or its edition is
marked read. Reading settings default to the system light/dark theme until one is chosen. The static server sends
`default-src 'self'` with `script-src 'self'` and `img-src 'self'` (no inline scripts; inline styles stay allowed for
Radix's scroll lock), `/api/*` answers 404 there (Caddy routes it), and the theme is applied before first paint by a
same-origin `theme-init.js`.

## Repo layout

```
news-reader/
  packages/schema/   zod schema, TS types, JSON Schema export, prompt-section generator, per-feed lists
  apps/api/          news-api
  apps/ui/           news-ui
  publisher/         news_publisher.py + tests
  jobs/              chile.md, cyber.md, ai.md; legacy/ keeps today's Markdown prompts for rollback
  config/            outlets.json (outlet -> lean), stack.json (your software)
  scripts/           gen-prompts, typecheck, install-publisher, smoke
  test/fixtures/     real run archives and hand-converted edition fixtures (valid + one per hard error)
  docker/            api/ui Dockerfiles, compose.test.yml (smoke stack), mongo-init/ (app user)
```

Bun workspaces. Private repo `xMuramasa/news-reader`, direct commits to `main`.

## Deploy (homelab)

`~/Projects/homelab/news/docker-compose.yml` with news-mongo, news-api and news-ui: pinned images, `restart:
unless-stopped`, app containers as uid 1000 with read-only root filesystems, healthchecks. Caddy routes
`news.lab.x-muramasa.dev`: `/api/*` to news-api:8080, everything else to news-ui. Then a Homepage tile, a Kuma monitor
on `/healthz`, the backup dump, README, gitleaks, and push the homelab repo.

## Tests

- Schema: valid and invalid fixtures for each feed; JSON Schema export; generated prompt section.
- API, against a throwaway `mongo:9.0.4` container on a random loopback port: ingest, replace by `source_run`,
  401/413/422, tag normalization, derived tags, unknown tags as warnings, story queries (filters, sort, cursor), search
  with and without accents, favorites (Origin check, idempotent PUT/DELETE, snapshot), id validation.
- Publisher (Python unittest): framed and old-format archives, fenced JSON, invalid JSON, a 422 alerts only once, API
  down (silent, then the 2-hour fallback), short message format.
- UI: typecheck, build, component tests for the story card, coverage bar and link sanitizing.
- Smoke (`bun run smoke`): built containers in a temporary compose project `news-reader-test-<random>` (Mongo with auth,
  app containers read-only as uid 1000); POST the three fixtures, then fetch `/`, one asset and the public API, check the
  favorite Origin rule, restart the API against the existing database, and always `down -v`.

## Rollout

1. Build and test: Claude Code builds, then I re-run every test and build myself and review the diff.
2. Deploy the stack and wire it up (Caddy, Homepage, Kuma, backups).
3. Install the publisher job.
4. Switch the three jobs to JSON and run each once. Those runs are the backfill. Check the Telegram messages and pages.
5. Old Markdown runs stay on disk and are not imported.

Until step 4, briefings keep arriving in Telegram as they do today. Rollback: restore the legacy prompts and
`deliver: origin`.

## How it gets built

Claude Code (Opus) in `~/Projects/news-reader` with file edits auto-accepted. Shell access is limited to `bun`
(including the test script that starts the throwaway Mongo) and read-only `git`. No push, no long-running servers.

## Out of scope for v1

Accounts, notes on favorites, read status synced across devices, PWA/offline, push notifications, editing or
regenerating editions, Chilean region tags.
