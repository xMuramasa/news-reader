// Today's data: every story of one Santiago day (all pages), grouped per feed in reading order, plus the edition
// answers (lead, markets) the desktop panels need.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { EditionView, StoryView } from "@news/schema";
import { useApi } from "@/lib/api";
import { EMPTY_FILTERS } from "@/lib/filters";
import { FEEDS, FEED_IDS, type FeedId } from "@/lib/feeds";

const PAGE = 100;
const MAX_PAGES = 10;

export interface FeedDay {
  id: FeedId;
  stories: StoryView[];
  editionId: string;
  runAt: string;
}

export interface DayData {
  all: StoryView[];
  feeds: FeedDay[];
  patchNow: StoryView[];
  stack: StoryView[];
}

/** The API lists only the latest run per feed and day, so this is that run's stories. */
export function useDayStories(day: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["today", "stories", day],
    queryFn: async (): Promise<DayData> => {
      const filters = { ...EMPTY_FILTERS, from: day, to: day };
      const all: StoryView[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await api.stories(filters, cursor, PAGE);
        all.push(...page.stories);
        cursor = page.next;
        if (!cursor) break;
      }
      return groupDay(all);
    },
  });
}

function groupDay(all: StoryView[]): DayData {
  const feeds: FeedDay[] = [];
  for (const id of FEED_IDS) {
    const order = FEEDS[id].sections.map((s) => s.id);
    const at = (s: StoryView) => (order.includes(s.section) ? order.indexOf(s.section) : order.length);
    const stories = all.filter((s) => s.feed === id).sort((a, b) => at(a) - at(b) || a.rank - b.rank);
    if (stories.length) feeds.push({ id, stories, editionId: stories[0]!.edition_id, runAt: stories[0]!.run_at });
  }
  const flat = feeds.flatMap((f) => f.stories);
  return {
    all: flat,
    feeds,
    patchNow: flat.filter((s) => s.section === "patch_now"),
    stack: flat.filter((s) => s.section === "your_stack"),
  };
}

/** Edition answers by feed; a failed or pending one is simply missing (the panel shows no lead). */
export function useEditions(feeds: FeedDay[]): Partial<Record<FeedId, EditionView>> {
  const api = useApi();
  const results = useQueries({
    queries: feeds.map((f) => ({
      queryKey: ["today", "edition", f.editionId],
      queryFn: () => api.edition(f.editionId).then((r) => r.edition),
    })),
  });
  const out: Partial<Record<FeedId, EditionView>> = {};
  feeds.forEach((f, i) => {
    const d = results[i]?.data;
    if (d) out[f.id] = d;
  });
  return out;
}

export const storyHref = (id: string) => `/s/${encodeURIComponent(id)}`;

/** Consecutive stories of one section, in reading order. */
export function sectionsOf(feed: FeedId, stories: StoryView[]): { id: string; title: string; stories: StoryView[] }[] {
  const out: { id: string; title: string; stories: StoryView[] }[] = [];
  for (const s of stories) {
    const last = out[out.length - 1];
    if (last?.id === s.section) last.stories.push(s);
    else out.push({ id: s.section, title: FEEDS[feed].sections.find((x) => x.id === s.section)?.title ?? s.section.replace(/_/g, " "), stories: [s] });
  }
  return out;
}
