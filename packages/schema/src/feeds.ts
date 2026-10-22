// Feed definitions shared by the validator, the prompt generator, the API, the UI and (mirrored by hand) the
// Python publisher. Order matters: sections are listed in reading order.

export const SCHEMA_ID = "news-edition/v1" as const;

export const FEED_IDS = ["chile", "cyber", "ai"] as const;
export type FeedId = (typeof FEED_IDS)[number];

export const REGIONS = [
  "chile",
  "latam",
  "us",
  "europe",
  "asia-pacific",
  "middle-east",
  "africa",
  "global",
] as const;

export const STATUSES = ["exploited", "poc-public", "patched", "no-patch", "claimed", "disputed"] as const;

export const VERIFICATIONS = ["confirmed", "claimed", "unverified", "mixed"] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export interface SectionDef {
  id: string;
  title: string;
  /** What belongs in the section; goes into the job prompt. */
  guide: string;
}

export interface CoverageGroupDef {
  id: string;
  title: string;
  /** Example outlets for the prompt; the full map lives in config/outlets.json and the job prompt. */
  guide: string;
}

export interface FeedDef {
  id: FeedId;
  label: string;
  emoji: string;
  jobId: string;
  cadence: "daily" | "weekly";
  sections: readonly SectionDef[];
  coverageGroups: readonly CoverageGroupDef[];
  topics: readonly string[];
  /** Whether `status:` tags are allowed. */
  statusTags: boolean;
  /** Whether the edition may carry `markets`. */
  markets: boolean;
  /** Suggested `details` labels. */
  detailLabels: readonly string[];
  /** Feed-specific writing rules for the prompt. */
  notes: readonly string[];
}

export const FEEDS: Record<FeedId, FeedDef> = {
  chile: {
    id: "chile",
    label: "Chile",
    emoji: "🇨🇱",
    jobId: "7a38c16d35fd",
    cadence: "daily",
    sections: [
      {
        id: "top",
        title: "Top stories",
        guide:
          "4-7 major stories, ranked by impact. Each with coverage per group, framing per group when it differs, a blindspot when one side largely ignored it, and 1-3 sources including an independent outlet when one covered it.",
      },
      {
        id: "independent",
        title: "Independent & alternative",
        guide:
          "3-5 stories that independent, investigative, regional, indigenous or movement outlets covered but mainstream outlets largely did not (check with a quick search before claiming that). Flag unconfirmed claims with verification `unverified` or `claimed`.",
      },
      {
        id: "fact_check",
        title: "Fact-checks",
        guide: "New Fast Check CL / Mala Espina Check items on Chilean claims. Omit the section if there are none.",
      },
      {
        id: "quick_hit",
        title: "Quick hits",
        guide: "3-5 one-line items: headline plus a one-sentence summary; coverage and framing may be empty.",
      },
    ],
    coverageGroups: [
      { id: "right", title: "Right", guide: "right / center-right outlets and think tanks (Emol, La Tercera, Ex-Ante, LyD, CEP)" },
      { id: "center", title: "Center", guide: "center / mainstream / public outlets (BioBioChile, Cooperativa, 24 Horas, T13, DF)" },
      { id: "left", title: "Left", guide: "center-left / left outlets (El Mostrador, The Clinic, El Desconcierto, El Siglo)" },
      {
        id: "independent",
        title: "Independent",
        guide: "investigative, alternative, movement and indigenous outlets and fact-checkers (CIPER, Interferencia, Mapuexpress)",
      },
      { id: "foreign", title: "Foreign", guide: "foreign press and wires (Reuters, AP, AFP, EFE, El País, BBC Mundo)" },
    ],
    topics: [
      "politics",
      "government",
      "congress",
      "economy",
      "markets",
      "pensions",
      "security-crime",
      "courts",
      "corruption",
      "migration",
      "environment",
      "disasters",
      "health",
      "education",
      "labor",
      "housing",
      "indigenous",
      "foreign-relations",
      "media",
      "society",
    ],
    statusTags: false,
    markets: true,
    detailLabels: ["Next", "Context", "Numbers"],
    notes: [
      "Write in English but keep outlet names and key Spanish terms (e.g. comisión mixta, dólar observado).",
      "`markets`: IPSA, USD/CLP and copper if available, with `as_of` set to the date of the close. Omit `markets` (or use null) if you found nothing.",
    ],
  },
  cyber: {
    id: "cyber",
    label: "Cyber",
    emoji: "🛡️",
    jobId: "d3a7c91070f7",
    cadence: "daily",
    sections: [
      {
        id: "patch_now",
        title: "Patch now",
        guide:
          "Actively exploited issues (new KEV entries, vendor-confirmed in-the-wild exploitation), most urgent first. `action` says what to do (update X to version Y); put the CISA due date in a `details` line labelled \"CISA due\" when there is one. A patch-now story carries the full story (details, coverage, sources): do not repeat it under `top`.",
      },
      {
        id: "top",
        title: "Top stories",
        guide:
          "4-6 top stories. Use `details` for \"Who's affected\" and \"Status\" (patch or mitigation); `framing` only if sources disagree meaningfully (e.g. vendor downplays vs researchers).",
      },
      {
        id: "your_stack",
        title: "Your stack",
        guide:
          "Items that affect the reader's stack, each with the concrete `action` (update X to version Y, rotate Z). No stories here means nothing new affects the stack.",
      },
      {
        id: "chile_latam",
        title: "Chile & LatAm",
        guide: "1-4 items (CSIRT/ANCI alerts, incidents, regulation). Leave the section empty if nothing turned up after searching.",
      },
      { id: "research", title: "Research & threat intel", guide: "2-3 short items with links." },
      { id: "policy", title: "Policy", guide: "1-3 short items; omit if none." },
    ],
    coverageGroups: [
      { id: "gov_vendor", title: "Gov/vendor", guide: "government, CERTs and vendors (CISA, NCSC, CSIRT Chile, Microsoft, the affected vendor)" },
      { id: "press", title: "Press", guide: "security press (BleepingComputer, The Record, SecurityWeek, Wired)" },
      { id: "independent", title: "Independent", guide: "independent journalists and blogs (Krebs, 404 Media, Risky Business, DataBreaches.net)" },
      { id: "research", title: "Research", guide: "threat research teams (Talos, Unit 42, Securelist, ESET, Project Zero)" },
    ],
    topics: [
      "vulnerability",
      "exploited",
      "ransomware",
      "data-breach",
      "malware",
      "phishing",
      "supply-chain",
      "apt",
      "ai-security",
      "pki-crypto",
      "cloud",
      "mobile",
      "ics-ot",
      "identity",
      "privacy",
      "law-enforcement",
      "policy",
      "research",
    ],
    statusTags: true,
    markets: false,
    detailLabels: ["Who's affected", "Status", "CISA due", "Next"],
    notes: [
      "Write every CVE ID in full (CVE-2026-12345, never \"/-12346\" shorthand) so the reader can link and track it.",
      "Leak-site postings are claims: verification `claimed`, tag `status:claimed`, and say \"claimed by <group>, not confirmed by the victim\".",
    ],
  },
  ai: {
    id: "ai",
    label: "AI",
    emoji: "🤖",
    jobId: "7e15c4016256",
    cadence: "weekly",
    sections: [
      { id: "top", title: "Top stories", guide: "3-5 most important items, each summary saying why it matters." },
      {
        id: "release",
        title: "Model & product releases",
        guide: "Frontier labs: OpenAI, Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Qwen, etc.",
      },
      {
        id: "open_source",
        title: "Open-source & local AI",
        guide:
          "Open-weight models, llama.cpp, MLX, Ollama, Whisper, agent frameworks. The reader favors self-hosted/local AI on Apple Silicon.",
      },
      { id: "research", title: "Research highlights", guide: "2-4 notable papers." },
      { id: "industry", title: "Industry, funding & policy", guide: "Brief items." },
    ],
    coverageGroups: [
      { id: "lab", title: "Lab", guide: "the lab or company itself (official blog, docs, model card)" },
      { id: "press", title: "Press", guide: "news outlets (Reuters, The Verge, Ars Technica, TechCrunch, The Information)" },
      { id: "independent", title: "Independent", guide: "independent writers, community and code hosts (Hugging Face, GitHub)" },
      { id: "research", title: "Research", guide: "papers and academic sources (arXiv)" },
    ],
    topics: [
      "model-release",
      "open-weights",
      "local-ai",
      "agents",
      "research",
      "safety",
      "security",
      "policy-regulation",
      "funding-business",
      "hardware",
      "product",
      "open-source-tools",
    ],
    statusTags: false,
    markets: false,
    detailLabels: ["Why it matters", "Numbers", "Availability"],
    notes: ["Keep it tight: the whole edition should read in a few minutes. Skip empty sections."],
  },
};

export function isFeedId(value: unknown): value is FeedId {
  return typeof value === "string" && (FEED_IDS as readonly string[]).includes(value);
}

export function feedByJobId(jobId: string): FeedDef | undefined {
  return FEED_IDS.map((id) => FEEDS[id]).find((f) => f.jobId === jobId);
}

export function sectionIds(feed: FeedId): string[] {
  return FEEDS[feed].sections.map((s) => s.id);
}

export function coverageGroupIds(feed: FeedId): string[] {
  return FEEDS[feed].coverageGroups.map((g) => g.id);
}

/** Union of every feed's sections, for the Mongo validator. */
export const ALL_SECTIONS: string[] = [...new Set(FEED_IDS.flatMap(sectionIds))];
export const ALL_COVERAGE_GROUPS: string[] = [...new Set(FEED_IDS.flatMap(coverageGroupIds))];
