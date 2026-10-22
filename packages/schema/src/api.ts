// Response shapes of the public API (/api/*). The API builds them (apps/api/src/public.ts is typed against these) and
// the UI reads them, so the two can't drift. Types only: importing this file costs the UI bundle nothing.
import type { FeedId } from "./feeds.ts";
import type { Markets } from "./edition.ts";
import type { EnrichedSource } from "./tags.ts";

export interface StoryView {
  id: string;
  edition_id: string;
  feed: FeedId;
  edition_date: string;
  /** ISO date-time of the run. */
  run_at: string;
  /** Event date, else edition date (never after the edition date). */
  sort_date: string;
  section: string;
  rank: number;
  slug: string;
  headline: string;
  summary: string;
  event_date: string | null;
  is_update: boolean;
  thread: string;
  /** One of VERIFICATIONS (validated on ingest). */
  verification: string;
  action: string | null;
  details: { label: string; text: string }[];
  coverage: { group: string; covered: boolean; outlets: string[] }[];
  framing: { group: string; text: string }[];
  blindspot: string | null;
  sources: EnrichedSource[];
  tags: string[];
  cves: string[];
  favorite: boolean;
}

export interface EditionSummary {
  id: string;
  feed: FeedId;
  edition_date: string;
  run_at: string;
  title: string;
  lead: string;
  language: string;
  story_count: number;
  section_counts: Record<string, number>;
}

export interface SameDayRun {
  id: string;
  run_at: string;
  /** The run lists show for that day. */
  latest: boolean;
}

export interface EditionView extends EditionSummary {
  markets: Markets | null;
  gaps: string[];
  stories: StoryView[];
  prev: string | null;
  next: string | null;
  same_day: SameDayRun[];
}

export interface FeedInfo {
  id: FeedId;
  label: string;
  emoji: string;
  cadence: "daily" | "weekly";
  sections: { id: string; title: string }[];
  coverage_groups: { id: string; title: string }[];
  latest: EditionSummary | null;
  counts: { editions: number; stories: number };
}

export interface FavoriteSnapshot {
  headline: string;
  feed: FeedId;
  edition_id: string;
  edition_date: string;
  sort_date: string;
}

export interface FavoriteView {
  story_id: string;
  created_at: string;
  snapshot: FavoriteSnapshot;
  /** null when the story is no longer stored. */
  story: StoryView | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface FeedsResponse {
  feeds: FeedInfo[];
}
export interface EditionsResponse {
  editions: EditionSummary[];
  next: string | null;
}
export interface EditionResponse {
  edition: EditionView;
}
export interface StoriesResponse {
  stories: StoryView[];
  next: string | null;
}
export interface StoryResponse {
  story: StoryView;
  thread: { earlier: StoryView[]; later: StoryView[] };
}
export interface TagsResponse {
  tags: TagCount[];
}
export interface FavoritesResponse {
  favorites: FavoriteView[];
  next: string | null;
}
export interface FavoriteWriteResponse {
  story_id: string;
  favorite: boolean;
  created_at?: string;
}
export interface ApiErrorBody {
  error?: string;
  errors?: string[];
}
