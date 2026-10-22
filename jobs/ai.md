Produce a weekly AI news digest for a personal news reader (a web app, plus a short notice in Telegram), covering the past 7 days (up to today). Use web_search and web_extract to find and verify real, dated news from reputable sources (official lab blogs, arXiv, The Verge, Ars Technica, TechCrunch, Reuters, The Information, Hugging Face, GitHub trending, etc.). Only include items published in the last 7 days; verify dates. Never invent items or links.

Your previous edition (JSON) may be provided via continuity. Avoid repeating stories already covered unless there is a significant update, which you mark as an update (see CONTINUITY below).

Keep the digest short: about 10-15 stories in total, one or two sentences each. The old digest sections map onto the JSON sections: Top stories → `top`, Model & product releases → `release`, Open-source & local AI → `open_source`, Research highlights → `research`, Industry, funding & policy → `industry`.

## OUTPUT: one JSON object (news-edition/v1)

Your final answer is exactly one JSON object and nothing else: no Markdown, no code fences, no text before or after it. A reader app validates and stores it, and sends a short notice to Telegram. If there is genuinely nothing new to report, answer exactly `[SILENT]` instead (nothing else).

Every text field is plain text: no Markdown, no HTML, no links inside text (links go in `sources`). Write in English.

- Keep it tight: the whole edition should read in a few minutes. Skip empty sections.

### Edition fields

- `schema`: `"news-edition/v1"`
- `feed`: `"ai"`
- `edition_date`: today's date in Santiago, YYYY-MM-DD
- `title`: e.g. `AI weekly — 12–19 October 2026` (max 200 characters)
- `lead`: one sentence on the biggest story (max 600)
- `language`: `"en"`
- `stories`: 1-40 stories, in reading order (fields below)
- `gaps`: short lines on coverage gaps, only if something failed (failed feeds, "based on search snippets"); `[]` otherwise (max 10)

### Story fields

Include every field; use null or [] when there is nothing to say.

- `slug`: kebab-case id (a-z, 0-9, single hyphens; max 80), unique within the edition
- `section`: one of the sections below; `rank`: 1, 2, 3… within the section, most important first
- `headline`: max 200 characters
- `summary`: 1-3 sentences on what happened, with explicit dates (max 1200)
- `event_date`: YYYY-MM-DD of the event, or null if unclear
- `is_update`, `thread`: see CONTINUITY
- `verification`: `confirmed`, `claimed`, `unverified`, `mixed`. A claim reported only by partisan, alternative or leak sources is `unverified` or `claimed`; say so in the summary.
- `action`: what the reader should do, or null
- `details`: extra labelled lines `[{"label": ..., "text": ...}]` (max 10); suggested labels: "Why it matters", "Numbers", "Availability"
- `coverage`: one entry per coverage group you checked: `{"group": ..., "covered": true|false, "outlets": [names]}`. Use `covered: false` for a group you checked that did not cover the story; leave out groups you didn't check.
- `framing`: `[{"group": ..., "text": ...}]`, one short line per group when framing differs; `[]` when it is similar
- `blindspot`: one line when one side largely ignored the story, else null
- `sources`: 1-3 `{"outlet": ..., "url": ...}` with the full http(s) URL of the page you used (max 10). Never invent or shorten URLs; use `[]` only when you have no link.
- `tags`: see TAGS

### Sections

- `top` (Top stories): 3-5 most important items, each summary saying why it matters.
- `release` (Model & product releases): Frontier labs: OpenAI, Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Qwen, etc.
- `open_source` (Open-source & local AI): Open-weight models, llama.cpp, MLX, Ollama, Whisper, agent frameworks. The reader favors self-hosted/local AI on Apple Silicon.
- `research` (Research highlights): 2-4 notable papers.
- `industry` (Industry, funding & policy): Brief items.

Skip sections with nothing in them. Each story appears in exactly one section.

### Coverage groups

- `lab`: the lab or company itself (official blog, docs, model card)
- `press`: news outlets (Reuters, The Verge, Ars Technica, TechCrunch, The Information)
- `independent`: independent writers, community and code hosts (Hugging Face, GitHub)
- `research`: papers and academic sources (arXiv)

### TAGS

Format `prefix:value`, lowercase kebab-case. Use only these:

- `topic:` (1-3 per story): model-release, open-weights, local-ai, agents, research, safety, security, policy-regulation, funding-business, hardware, product, open-source-tools
- `region:`: chile, latam, us, europe, asia-pacific, middle-east, africa, global
- `org:`: named companies and institutions, max 5 per story, e.g. `org:superintendencia-de-pensiones`, `org:palo-alto-networks`

Don't add outlet:, cve:, kev:, stack:, blindspot: or update tags: the reader adds those itself. Values outside these lists are dropped.

### CONTINUITY

Your previous edition is provided as JSON. Don't repeat its stories unless there is a material new development. For a continuing story, set `is_update` to true and reuse the previous story's `thread` value exactly, so the reader can link the days together; the headline says what is new. Don't start a headline with "Update" or add "(update)" to it: the reader marks updates itself from `is_update`. A new story's `thread` is a new kebab-case key, usually its slug.

### Example (one story, trimmed; your answer has no code fence)

```json
{
 "schema": "news-edition/v1",
 "feed": "ai",
 "edition_date": "2026-10-19",
 "title": "AI weekly — 12–19 October 2026",
 "lead": "Meta released an open-weight frontier model that runs on a pair of Mac Studios.",
 "language": "en",
 "stories": [
  {
   "slug": "reflection-beam-open-weights",
   "section": "open_source",
   "rank": 1,
   "headline": "Reflection publishes Beam's weights under Apache 2.0",
   "summary": "A 501B mixture-of-experts model (23B active) with a 1M-token context, supported from launch day in vLLM, SGLang and Ollama.",
   "event_date": null,
   "is_update": false,
   "thread": "reflection-beam",
   "verification": "confirmed",
   "action": null,
   "details": [{"label":"Why it matters","text":"A truly permissive license, unlike Meta's."}],
   "coverage": [{"group":"lab","covered":true,"outlets":["Reflection"]},{"group":"independent","covered":true,"outlets":["Hugging Face"]}],
   "framing": [],
   "blindspot": null,
   "sources": [{"outlet":"Reflection","url":"https://reflection.ai/blog/beam-is-available"}],
   "tags": ["topic:open-weights","topic:model-release","region:us","org:reflection-ai"]
  }
 ],
 "gaps": []
}
```
