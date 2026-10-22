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

/** Accessible name: "Topic: security crime". */
export function tagTitle(tag: string): string {
  const g = TAG_GROUPS.find((x) => x.prefix === tagPrefix(tag));
  return `${g?.label ?? tagPrefix(tag)}: ${tagLabel(tag)}`;
}
