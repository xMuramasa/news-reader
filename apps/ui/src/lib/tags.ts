// Tag chips: grouping by prefix for the filter panel, and readable labels.
import type { TagCount } from "@news/schema";

export interface TagGroup {
  prefix: string;
  label: string;
  tags: TagCount[];
}

/** Filter panel order; prefixes not listed here go last, alphabetically. */
export const TAG_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "topic", label: "Topic" },
  { prefix: "region", label: "Region" },
  { prefix: "status", label: "Status" },
  { prefix: "org", label: "Organisation" },
  { prefix: "outlet", label: "Outlet" },
  { prefix: "stack", label: "Your stack" },
  { prefix: "cve", label: "CVE" },
  { prefix: "kev", label: "CISA KEV" },
  { prefix: "blindspot", label: "Blindspot" },
  { prefix: "update", label: "Updates" },
];

export function tagPrefix(tag: string): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

export function tagValue(tag: string): string {
  const i = tag.indexOf(":");
  return i === -1 ? "" : tag.slice(i + 1);
}

/** Group counts by prefix in TAG_GROUPS order; inside a group by count (desc), then name. Empty groups are left out. */
export function groupTags(counts: readonly TagCount[]): TagGroup[] {
  const by = new Map<string, TagCount[]>();
  for (const c of counts) {
    if (!c.tag) continue;
    const p = tagPrefix(c.tag);
    const list = by.get(p) ?? [];
    list.push(c);
    by.set(p, list);
  }
  const known = TAG_GROUPS.map((g) => g.prefix);
  const extra = [...by.keys()].filter((p) => !known.includes(p)).sort();
  return [...TAG_GROUPS, ...extra.map((p) => ({ prefix: p, label: p }))]
    .filter((g) => by.has(g.prefix))
    .map((g) => ({
      ...g,
      tags: by.get(g.prefix)!.slice().sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    }));
}

/** "topic:security-crime" -> "security crime", "cve:cve-2026-1234" -> "CVE-2026-1234". */
export function tagLabel(tag: string): string {
  const p = tagPrefix(tag);
  const v = tagValue(tag);
  if (p === "update") return "update";
  if (p === "kev") return "CISA KEV";
  if (p === "cve") return v.toUpperCase();
  if (p === "blindspot") return `missing ${v.replace(/-/g, " ")}`;
  return v.replace(/-/g, " ");
}

export type RowTagKind = "danger" | "stack" | "warn" | "cve" | "blind" | "update" | "patched" | "plain";

export interface RowTag {
  /** The stored tag the chip links to (the first one for a merged chip). */
  tag: string;
  kind: RowTagKind;
  /** Uppercase chip text, including the "+N" of a merged chip. */
  label: string;
  /** How many more tags of the same kind the chip stands for. */
  more?: number;
}

const upper = (v: string) => v.replace(/[-_]/g, " ").toUpperCase();

/**
 * The few chips a story row shows, in the agreed order (#6 "Tag order"): exploited, your stack, no patch / PoC, CVE,
 * blindspot, update, patched (only next to exploited or a CVE), then topic, region and org. outlet:* never appears.
 */
export function rowTags(tags: readonly string[], feed: string, max = 4): RowTag[] {
  const by = (prefix: string) => tags.filter((t) => tagPrefix(t) === prefix);
  const out: RowTag[] = [];
  const merged = (list: string[], kind: RowTagKind, text: (v: string) => string): RowTag[] =>
    list.length ? [{ tag: list[0]!, kind, label: text(tagValue(list[0]!)) + (list.length > 1 ? ` +${list.length - 1}` : ""), ...(list.length > 1 && { more: list.length - 1 }) }] : [];

  const kev = tags.includes("kev:yes");
  const exploited = kev || tags.includes("status:exploited");
  if (kev) out.push({ tag: "kev:yes", kind: "danger", label: "KEV EXPLOITED" });
  else if (exploited) out.push({ tag: "status:exploited", kind: "danger", label: "EXPLOITED" });
  out.push(...merged(by("stack"), "stack", upper));
  if (tags.includes("status:no-patch")) out.push({ tag: "status:no-patch", kind: "warn", label: "NO PATCH" });
  if (tags.includes("status:poc-public")) out.push({ tag: "status:poc-public", kind: "warn", label: "POC PUBLIC" });
  const cves = by("cve");
  out.push(...merged(cves, "cve", (v) => v.toUpperCase()));
  const blind = by("blindspot");
  if (blind.length) out.push({ tag: blind[0]!, kind: "blind", label: `BLINDSPOT ${blind.map((t) => upper(tagValue(t))).join(" · ")}` });
  if (tags.includes("update")) out.push({ tag: "update", kind: "update", label: "UPDATE" });
  if (tags.includes("status:patched") && (exploited || cves.length)) out.push({ tag: "status:patched", kind: "patched", label: "PATCHED" });
  for (const t of by("topic")) {
    if ((t === "topic:exploited" && exploited) || (t === "topic:vulnerability" && cves.length)) continue;
    out.push({ tag: t, kind: "plain", label: upper(tagValue(t)) });
  }
  for (const t of by("region")) {
    if (t === "region:global" || t === `region:${feed}`) continue;
    out.push({ tag: t, kind: "plain", label: upper(tagValue(t)) });
  }
  for (const t of by("org")) out.push({ tag: t, kind: "plain", label: upper(tagValue(t)) });
  return out.slice(0, max);
}

/** Accessible name: "Topic: security crime". */
export function tagTitle(tag: string): string {
  const g = TAG_GROUPS.find((x) => x.prefix === tagPrefix(tag));
  return `${g?.label ?? tagPrefix(tag)}: ${tagLabel(tag)}`;
}
