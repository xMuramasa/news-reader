// Feed definitions come from @news/schema (the same lists the validator uses), imported from the zod-free subpath.
import { FEEDS, FEED_IDS, isFeedId, type FeedDef, type FeedId } from "@news/schema/feeds";

export { FEEDS, FEED_IDS, isFeedId, type FeedDef, type FeedId };

export function sectionTitle(feed: FeedId, section: string): string {
  return FEEDS[feed].sections.find((s) => s.id === section)?.title ?? section.replace(/_/g, " ");
}

export function groupTitle(feed: FeedId, group: string): string {
  return FEEDS[feed].coverageGroups.find((g) => g.id === group)?.title ?? group.replace(/_/g, " ");
}

/** CSS colour for a coverage group (see --g-* in index.css). */
export function groupColor(group: string): string {
  return /^[a-z_]+$/.test(group) ? `var(--g-${group}, var(--border-strong))` : "var(--border-strong)";
}

export const VERIFICATION_NOTES: Record<string, { label: string; text: string }> = {
  claimed: { label: "Claimed", text: "A claim by one party, not independently confirmed." },
  unverified: { label: "Unverified", text: "Not verified yet; treat with care." },
  mixed: { label: "Mixed reports", text: "Sources disagree on the facts." },
};
