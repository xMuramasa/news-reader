// The Markdown contract appended to each job prompt. Generated from the same lists as the validator, so prompt and
// validator can't drift.
import { FEEDS, REGIONS, SCHEMA_ID, STATUSES, VERIFICATIONS, type FeedId } from "./feeds.ts";
import { LIMITS } from "./edition.ts";
import { MAX_ORG_TAGS } from "./tags.ts";

/** One compact, valid example edition per feed. */
export const PROMPT_EXAMPLES: Record<FeedId, Record<string, unknown>> = {
  chile: {
    schema: SCHEMA_ID,
    feed: "chile",
    edition_date: "2026-10-21",
    title: "Chile — Wednesday, 21 October 2026",
    lead: "Congress passed the faster migrant-expulsion law; AFP Fondo E fallout reaches the Senate.",
    language: "en",
    stories: [
      {
        slug: "afp-fondo-e-sanctions",
        section: "top",
        rank: 2,
        headline: "AFP Fondo E: regulator opens cases, Senate sets a session",
        summary:
          "On 20 Oct the Superintendencia de Pensiones opened sanction proceedings against all 7 AFPs after Fondo E fell 10.4% in real terms Jan–Sep.",
        event_date: "2026-10-20",
        is_update: true,
        thread: "afp-fondo-e-losses",
        verification: "confirmed",
        action: null,
        details: [{ label: "Next", text: "Senate special session on Tue 27 Oct." }],
        coverage: [
          { group: "right", covered: true, outlets: ["Emol", "La Tercera"] },
          { group: "center", covered: true, outlets: ["T13", "DF"] },
          { group: "left", covered: true, outlets: ["El Mostrador"] },
          { group: "independent", covered: false, outlets: [] },
        ],
        framing: [
          { group: "right", text: "Quiroz wants 'máxima severidad' and blames years of inaction." },
          { group: "left", text: "Unpunished abuse that echoes 18-O." },
        ],
        blindspot: null,
        sources: [{ outlet: "El País", url: "https://elpais.com/chile/2026-10-20/example.html" }],
        tags: ["topic:pensions", "topic:markets", "region:chile", "org:superintendencia-de-pensiones"],
      },
    ],
    markets: { as_of: "2026-10-20", items: [{ name: "IPSA", value: "10,926.50", change: "-0.42%" }] },
    gaps: ["Full articles unavailable; based on search snippets."],
  },
  cyber: {
    schema: SCHEMA_ID,
    feed: "cyber",
    edition_date: "2026-10-21",
    title: "Cyber — Wednesday, 21 October 2026",
    lead: "PHP shipped emergency fixes for PHP2Shell, two critical remote code execution bugs in the PHP core.",
    language: "en",
    stories: [
      {
        slug: "php2shell-patches",
        section: "patch_now",
        rank: 1,
        headline: "PHP2Shell: emergency PHP patches for CVE-2026-109618 and CVE-2026-109619",
        summary:
          "On 21 Oct PHP released fixes for two critical remote code execution bugs in the PHP core. Cloudflare reports early exploitation attempts.",
        event_date: "2026-10-21",
        is_update: false,
        thread: "php2shell",
        verification: "confirmed",
        action: "Update PHP to 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35, then restart FPM/Apache.",
        details: [
          { label: "Who's affected", text: "PHP 5.4 through 8.5.11 serving web requests." },
          { label: "Status", text: "Patched; early exploitation attempts; not in KEV yet." },
        ],
        coverage: [
          { group: "gov_vendor", covered: true, outlets: ["CISA", "php.net"] },
          { group: "press", covered: true, outlets: ["BleepingComputer", "The Record"] },
          { group: "independent", covered: true, outlets: ["Krebs on Security"] },
          { group: "research", covered: true, outlets: ["Cisco Talos", "Unit 42"] },
        ],
        framing: [],
        blindspot: null,
        sources: [
          {
            outlet: "CISA",
            url: "https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching",
          },
        ],
        tags: ["topic:vulnerability", "topic:exploited", "status:patched", "region:global", "org:php"],
      },
    ],
    gaps: [],
  },
  ai: {
    schema: SCHEMA_ID,
    feed: "ai",
    edition_date: "2026-10-19",
    title: "AI weekly — 12–19 October 2026",
    lead: "Meta released an open-weight frontier model that runs on a pair of Mac Studios.",
    language: "en",
    stories: [
      {
        slug: "reflection-beam-open-weights",
        section: "open_source",
        rank: 1,
        headline: "Reflection publishes Beam's weights under Apache 2.0",
        summary:
          "A 501B mixture-of-experts model (23B active) with a 1M-token context, supported from launch day in vLLM, SGLang and Ollama.",
        event_date: null,
        is_update: false,
        thread: "reflection-beam",
        verification: "confirmed",
        action: null,
        details: [{ label: "Why it matters", text: "A truly permissive license, unlike Meta's." }],
        coverage: [
          { group: "lab", covered: true, outlets: ["Reflection"] },
          { group: "independent", covered: true, outlets: ["Hugging Face"] },
        ],
        framing: [],
        blindspot: null,
        sources: [{ outlet: "Reflection", url: "https://reflection.ai/blog/beam-is-available" }],
        tags: ["topic:open-weights", "topic:model-release", "region:us", "org:reflection-ai"],
      },
    ],
    gaps: [],
  },
};

/** One field per line, nested values inline: short enough for a prompt, still valid JSON. */
export function compactJson(edition: Record<string, unknown>): string {
  const field = (k: string, v: unknown, indent: string) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  const top = Object.entries(edition).map(([k, v]) => {
    if (k !== "stories" || !Array.isArray(v)) return field(k, v, " ");
    const stories = v.map(
      (s: Record<string, unknown>) =>
        `  {\n${Object.entries(s)
          .map(([sk, sv]) => field(sk, sv, "   "))
          .join(",\n")}\n  }`,
    );
    return ` "stories": [\n${stories.join(",\n")}\n ]`;
  });
  return `{\n${top.join(",\n")}\n}`;
}

const code = (s: string) => `\`${s}\``;
const list = (xs: readonly string[]) => xs.map(code).join(", ");

export function promptSection(feed: FeedId): string {
  const def = FEEDS[feed];
  const L = LIMITS;
  const lines: string[] = [];
  const p = (...xs: string[]) => lines.push(...xs);

  p(
    `## OUTPUT: one JSON object (${SCHEMA_ID})`,
    "",
    "Your final answer is exactly one JSON object and nothing else: no Markdown, no code fences, no text before or after it. A reader app validates and stores it, and sends a short notice to Telegram. If there is genuinely nothing new to report, answer exactly `[SILENT]` instead (nothing else).",
    "",
    "Every text field is plain text: no Markdown, no HTML, no links inside text (links go in `sources`). Write in English.",
    "",
    ...def.notes.map((n) => `- ${n}`),
    "",
    "### Edition fields",
    "",
    `- ${code("schema")}: ${code(`"${SCHEMA_ID}"`)}`,
    `- ${code("feed")}: ${code(`"${feed}"`)}`,
    `- ${code("edition_date")}: today's date in Santiago, YYYY-MM-DD`,
    `- ${code("title")}: e.g. ${code(String(PROMPT_EXAMPLES[feed].title))} (max ${L.title} characters)`,
    `- ${code("lead")}: one sentence on the biggest story (max ${L.lead})`,
    `- ${code("language")}: ${code('"en"')}`,
    `- ${code("stories")}: ${L.storiesMin}-${L.storiesMax} stories, in reading order (fields below)`,
  );
  if (def.markets) {
    p(
      `- ${code("markets")}: ${code('{"as_of": "YYYY-MM-DD", "items": [{"name": ..., "value": ..., "change": ...}]}')} or null (max ${L.marketItems} items; values as strings, e.g. "10,926.50", "-0.42%")`,
    );
  }
  p(
    `- ${code("gaps")}: short lines on coverage gaps, only if something failed (failed feeds, "based on search snippets"); ${code("[]")} otherwise (max ${L.gaps})`,
    "",
    "### Story fields",
    "",
    "Include every field; use null or [] when there is nothing to say.",
    "",
    `- ${code("slug")}: kebab-case id (a-z, 0-9, single hyphens; max ${L.slug}), unique within the edition`,
    `- ${code("section")}: one of the sections below; ${code("rank")}: 1, 2, 3… within the section, most important first`,
    `- ${code("headline")}: max ${L.headline} characters`,
    `- ${code("summary")}: 1-3 sentences on what happened, with explicit dates (max ${L.summary})`,
    `- ${code("event_date")}: YYYY-MM-DD of the event, or null if unclear`,
    `- ${code("is_update")}, ${code("thread")}: see CONTINUITY`,
    `- ${code("verification")}: ${list(VERIFICATIONS)}. A claim reported only by partisan, alternative or leak sources is ${code("unverified")} or ${code("claimed")}; say so in the summary.`,
    `- ${code("action")}: what the reader should do, or null`,
    `- ${code("details")}: extra labelled lines ${code('[{"label": ..., "text": ...}]')} (max ${L.details}); suggested labels: ${def.detailLabels.map((l) => `"${l}"`).join(", ")}`,
    `- ${code("coverage")}: one entry per coverage group you checked: ${code('{"group": ..., "covered": true|false, "outlets": [names]}')}. Use ${code("covered: false")} for a group you checked that did not cover the story; leave out groups you didn't check.`,
    `- ${code("framing")}: ${code('[{"group": ..., "text": ...}]')}, one short line per group when framing differs; ${code("[]")} when it is similar`,
    `- ${code("blindspot")}: one line when one side largely ignored the story, else null`,
    `- ${code("sources")}: 1-3 ${code('{"outlet": ..., "url": ...}')} with the full http(s) URL of the page you used (max ${L.sourcesMax}). Never invent or shorten URLs; use ${code("[]")} only when you have no link.`,
    `- ${code("tags")}: see TAGS`,
    "",
    "### Sections",
    "",
    ...def.sections.map((s) => `- ${code(s.id)} (${s.title}): ${s.guide}`),
    "",
    "Skip sections with nothing in them. Each story appears in exactly one section.",
    "",
    "### Coverage groups",
    "",
    ...def.coverageGroups.map((g) => `- ${code(g.id)}: ${g.guide}`),
    "",
    "### TAGS",
    "",
    `Format ${code("prefix:value")}, lowercase kebab-case. Use only these:`,
    "",
    `- ${code("topic:")} (1-3 per story): ${def.topics.join(", ")}`,
    `- ${code("region:")}: ${REGIONS.join(", ")}`,
  );
  if (def.statusTags) p(`- ${code("status:")}: ${STATUSES.join(", ")}`);
  p(
    `- ${code("org:")}: named companies and institutions, max ${MAX_ORG_TAGS} per story, e.g. ${code("org:superintendencia-de-pensiones")}, ${code("org:palo-alto-networks")}`,
    "",
    "Don't add outlet:, cve:, kev:, stack:, blindspot: or update tags: the reader adds those itself. Values outside these lists are dropped.",
    "",
    "### CONTINUITY",
    "",
    "Your previous edition is provided as JSON. Don't repeat its stories unless there is a material new development. For a continuing story, set `is_update` to true and reuse the previous story's `thread` value exactly, so the reader can link the days together; the headline says what is new. A new story's `thread` is a new kebab-case key, usually its slug.",
    "",
    "### Example (one story, trimmed; your answer has no code fence)",
    "",
    "```json",
    compactJson(PROMPT_EXAMPLES[feed]),
    "```",
    "",
  );
  return lines.join("\n");
}
