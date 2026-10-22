import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { EditionView, StoryView } from "@news/schema";
import { ApiContext, type Api } from "../../src/lib/api.ts";

export function makeStory(over: Partial<StoryView> = {}): StoryView {
  return {
    id: "cyber-20261021-132150-example-story",
    edition_id: "cyber-20261021-132150",
    feed: "cyber",
    edition_date: "2026-10-21",
    run_at: "2026-10-21T16:21:50.000Z",
    sort_date: "2026-10-20",
    section: "top",
    rank: 1,
    slug: "example-story",
    headline: "Example vendor patches exploited VPN flaw",
    summary: "A vendor shipped fixes on 20 Oct.",
    event_date: "2026-10-20",
    is_update: false,
    thread: "example-story",
    verification: "confirmed",
    action: null,
    details: [],
    coverage: [
      { group: "gov_vendor", covered: true, outlets: ["CISA", "Vendor"] },
      { group: "press", covered: true, outlets: ["BleepingComputer"] },
      { group: "independent", covered: false, outlets: [] },
    ],
    framing: [],
    blindspot: null,
    sources: [{ outlet: "BleepingComputer", url: "https://www.bleepingcomputer.com/news/x", outlet_slug: "bleepingcomputer", group: "press", lean: null }],
    tags: ["topic:vulnerability", "topic:exploited", "region:global", "status:patched", "org:example", "outlet:bleepingcomputer"],
    cves: [],
    favorite: false,
    ...over,
  };
}

export function makeEdition(over: Partial<EditionView> = {}): EditionView {
  const stories = over.stories ?? [makeStory()];
  return {
    id: "cyber-20261021-132150",
    feed: "cyber",
    edition_date: "2026-10-21",
    run_at: "2026-10-21T16:21:50.000Z",
    title: "Cyber — Wednesday, 21 October 2026",
    lead: "Two patch-now items.",
    language: "en",
    story_count: stories.length,
    section_counts: {},
    markets: null,
    gaps: [],
    prev: null,
    next: null,
    same_day: [{ id: "cyber-20261021-132150", run_at: "2026-10-21T16:21:50.000Z", latest: true }],
    ...over,
    stories,
  };
}

const notImplemented = () => Promise.reject(new Error("not stubbed"));

export function fakeApi(over: Partial<Api> = {}): Api {
  return {
    feeds: notImplemented,
    editions: notImplemented,
    edition: notImplemented,
    stories: notImplemented,
    story: notImplemented,
    tags: () => Promise.resolve({ tags: [] }),
    favorites: notImplemented,
    setFavorite: notImplemented,
    ...over,
  };
}

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
}

/** Render inside the API context, a query client and a memory router at `path`. */
export function renderWith(
  ui: React.ReactElement,
  { api = fakeApi(), client = testQueryClient(), path = "/" }: { api?: Api; client?: QueryClient; path?: string } = {},
) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] });
  const result = render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return { ...result, client, router };
}
