// Tag normalization and the tags the API derives itself. Pure functions: the API and the tests share them.
import { FEEDS, REGIONS, STATUSES, type FeedId } from "./feeds.ts";
import type { OutletConfig, OutletsFile, StackEntry, StackFile } from "./config.ts";

/** Prefixes the AI may use. */
export const AI_TAG_PREFIXES = ["topic", "region", "status", "org"] as const;
/** Prefixes (and the bare `update` tag) only the API may set. */
export const DERIVED_TAG_PREFIXES = ["outlet", "cve", "kev", "stack", "blindspot", "update"] as const;
export const MAX_ORG_TAGS = 5;
export const MAX_TAG_LENGTH = 80;

export const TAG_RE = /^[a-z]+(?::[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/** Lowercase kebab-case slug: accents folded, everything that isn't a letter or digit becomes a single hyphen. */
export function slugify(input: string, maxLength = 60): string {
  const s = input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength).replace(/-+[^-]*$/, "") || s.slice(0, maxLength);
}

/** Split and normalize one raw tag: "Topic : Security Crime" -> {prefix: "topic", value: "security-crime"}. */
export function parseTag(raw: string): { prefix: string; value: string } | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx === -1) {
    const prefix = slugify(trimmed).replace(/-/g, "");
    return prefix ? { prefix, value: "" } : null;
  }
  const prefix = trimmed.slice(0, idx).trim().toLowerCase().replace(/[\s_-]+/g, "");
  const value = slugify(trimmed.slice(idx + 1).replace(/_/g, " "));
  if (!/^[a-z]+$/.test(prefix) || !value) return null;
  return { prefix, value };
}

export function formatTag(prefix: string, value: string): string {
  return value ? `${prefix}:${value}` : prefix;
}

/** Normalize a user-supplied filter tag (query string). Returns null when it can't be a tag. */
export function normalizeFilterTag(raw: string): string | null {
  const t = parseTag(raw);
  if (!t) return null;
  const known = (AI_TAG_PREFIXES as readonly string[]).includes(t.prefix) || (DERIVED_TAG_PREFIXES as readonly string[]).includes(t.prefix);
  // `update` is the only bare tag; everything else needs a value.
  if (!known || (t.prefix === "update") !== (t.value === "")) return null;
  const tag = formatTag(t.prefix, t.value);
  return tag.length <= MAX_TAG_LENGTH && TAG_RE.test(tag) ? tag : null;
}

export interface TagResult {
  tags: string[];
  warnings: string[];
}

/**
 * Normalize the AI's tags for one story. Values outside the fixed lists, unknown prefixes, API-owned prefixes and
 * `org:` tags beyond the fifth are dropped with a warning. Duplicates are removed silently.
 */
export function normalizeStoryTags(feed: FeedId, raw: readonly string[], path = "tags"): TagResult {
  const def = FEEDS[feed];
  const tags: string[] = [];
  const warnings: string[] = [];
  let orgs = 0;
  raw.forEach((r, i) => {
    const t = parseTag(r);
    const where = `${path}[${i}]`;
    if (!t) {
      warnings.push(`${where}: dropped unreadable tag ${JSON.stringify(r.slice(0, 80))}`);
      return;
    }
    const tag = formatTag(t.prefix, t.value);
    let ok = false;
    switch (t.prefix) {
      case "topic":
        ok = def.topics.includes(t.value);
        if (!ok) warnings.push(`${where}: dropped unknown topic "${t.value}" for feed ${feed}`);
        break;
      case "region":
        ok = (REGIONS as readonly string[]).includes(t.value);
        if (!ok) warnings.push(`${where}: dropped unknown region "${t.value}"`);
        break;
      case "status":
        if (!def.statusTags) {
          warnings.push(`${where}: dropped status tag, feed ${feed} has no status tags`);
        } else {
          ok = (STATUSES as readonly string[]).includes(t.value);
          if (!ok) warnings.push(`${where}: dropped unknown status "${t.value}"`);
        }
        break;
      case "org":
        if (tags.includes(tag)) return;
        if (tag.length > MAX_TAG_LENGTH) {
          warnings.push(`${where}: dropped org tag longer than ${MAX_TAG_LENGTH} characters`);
        } else if (orgs >= MAX_ORG_TAGS) {
          warnings.push(`${where}: dropped "${tag}", more than ${MAX_ORG_TAGS} org tags`);
        } else {
          ok = true;
          orgs++;
        }
        break;
      default:
        if ((DERIVED_TAG_PREFIXES as readonly string[]).includes(t.prefix)) {
          warnings.push(`${where}: dropped "${tag}", ${t.prefix} tags are added by the reader`);
        } else {
          warnings.push(`${where}: dropped tag with unknown prefix "${t.prefix}"`);
        }
    }
    if (ok && !tags.includes(tag)) tags.push(tag);
  });
  return { tags, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Derived tags

export const CVE_RE = /\bCVE-(\d{4})-(\d{4,7})\b/gi;

/** Every CVE ID in the text, canonical upper case, in order of first appearance. */
export function findCves(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CVE_RE)) {
    const id = `CVE-${m[1]}-${m[2]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function cveTag(cve: string): string {
  return `cve:${cve.toLowerCase()}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function nameKey(s: string): string {
  return slugify(s);
}

export interface OutletIndex {
  byDomain: Map<string, OutletConfig>;
  byName: Map<string, OutletConfig>;
}

export function buildOutletIndex(file: OutletsFile): OutletIndex {
  const byDomain = new Map<string, OutletConfig>();
  const byName = new Map<string, OutletConfig>();
  for (const o of file.outlets) {
    for (const d of o.domains) byDomain.set(d, o);
    for (const n of [o.name, o.slug, ...o.aliases]) {
      const k = nameKey(n);
      if (k && !byName.has(k)) byName.set(k, o);
    }
  }
  return { byDomain, byName };
}

/** Find the configured outlet for a source: by URL host (longest matching domain suffix), then by name. */
export function matchOutlet(index: OutletIndex, source: { outlet: string; url: string }): OutletConfig | undefined {
  const host = hostOf(source.url);
  if (host) {
    const parts = host.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const o = index.byDomain.get(parts.slice(i).join("."));
      if (o) return o;
    }
  }
  return index.byName.get(nameKey(source.outlet));
}

export interface CompiledStackEntry {
  slug: string;
  name: string;
  matchers: { re: RegExp; context: RegExp[] | null }[];
  exclude: RegExp[];
}

export interface StackMatcher {
  window: number;
  entries: CompiledStackEntry[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileStack(file: StackFile): StackMatcher {
  const entries = file.software.map((e: StackEntry): CompiledStackEntry => {
    const matchers = e.aliases.map((a) => {
      const alias = typeof a === "string" ? { text: a } : a;
      const cs = alias.case_sensitive ?? e.case_sensitive;
      // A word boundary that also treats hyphens as part of the word, so "sudo" doesn't match "sudo-rs" and
      // "npm" doesn't match "pnpm".
      const re = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(alias.text)}(?![\\p{L}\\p{N}_-])`, cs ? "gu" : "giu");
      const ctx = (typeof a === "string" ? undefined : a.context) ?? e.context;
      return { re, context: ctx ? ctx.map((c) => new RegExp(c, "iu")) : null };
    });
    return { slug: e.slug, name: e.name, matchers, exclude: e.exclude.map((x) => new RegExp(x, "giu")) };
  });
  return { window: file.context_window, entries };
}

/** Slugs of stack software mentioned in the text. */
export function matchStack(matcher: StackMatcher, text: string): string[] {
  const out: string[] = [];
  for (const e of matcher.entries) {
    let t = text;
    for (const x of e.exclude) t = t.replace(x, (m) => " ".repeat(m.length));
    const hit = e.matchers.some(({ re, context }) => {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        if (!context) return true;
        // Context must be in the same sentence, within the window.
        const end = m.index + m[0].length;
        const before = t.slice(Math.max(0, m.index - matcher.window), m.index);
        const after = t.slice(end, end + matcher.window);
        const cut = before.search(/[.!?;:](?:\s[^.!?;:]*)?$|\n[^\n]*$/);
        const around =
          (cut === -1 ? before : before.slice(cut + 1)) + " " + after.split(/[.!?;:](?:\s|$)|\n/)[0];
        if (context.some((c) => c.test(around))) return true;
      }
      return false;
    });
    if (hit) out.push(e.slug);
  }
  return out;
}

export interface DeriveInput {
  headline: string;
  summary: string;
  action: string | null;
  blindspot: string | null;
  is_update: boolean;
  details: readonly { label: string; text: string }[];
  coverage: readonly { group: string; covered: boolean }[];
  sources: readonly { outlet: string; url: string }[];
}

export interface DeriveContext {
  feed: FeedId;
  outlets: OutletIndex;
  stack: StackMatcher;
  isKev: (cve: string) => boolean;
}

export interface EnrichedSource {
  outlet: string;
  url: string;
  outlet_slug: string;
  group: string | null;
  lean: string | null;
}

export interface Derived {
  tags: string[];
  sources: EnrichedSource[];
  cves: string[];
}

/** The text the reader's software and CVEs are searched in. */
export function storyText(s: DeriveInput): string {
  return [s.headline, s.summary, s.action ?? "", s.blindspot ?? "", ...s.details.map((d) => `${d.label}: ${d.text}`)].join(
    "\n",
  );
}

/** outlet:, cve:, kev:yes, stack:, blindspot:<group> and update, in that order. */
export function deriveTags(story: DeriveInput, ctx: DeriveContext): Derived {
  const tags: string[] = [];
  const add = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };
  const sources = story.sources.map((s): EnrichedSource => {
    const o = matchOutlet(ctx.outlets, s);
    const slug = o?.slug ?? slugify(s.outlet);
    return { outlet: s.outlet, url: s.url, outlet_slug: slug, group: o?.group[ctx.feed] ?? null, lean: o?.lean ?? null };
  });
  for (const s of sources) if (s.outlet_slug) add(`outlet:${s.outlet_slug}`);

  const text = storyText(story);
  const cves = findCves([text, ...story.sources.map((s) => s.url)].join("\n"));
  for (const c of cves) add(cveTag(c));
  if (cves.some((c) => ctx.isKev(c))) add("kev:yes");

  for (const slug of matchStack(ctx.stack, text)) add(`stack:${slug}`);

  for (const c of story.coverage) if (!c.covered) add(`blindspot:${c.group.replace(/_/g, "-")}`);
  if (story.is_update) add("update");
  return { tags, sources, cves };
}
