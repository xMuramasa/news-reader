import "./dom-guard.ts";
import { describe, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { StoriesResponse } from "@news/schema";
import { StoryCard } from "../../src/components/StoryCard.tsx";
import { ApiError, useApi } from "../../src/lib/api.ts";
import { setFavoriteInData } from "../../src/lib/favorites.ts";
import { matchesFavorite } from "../../src/routes/Favorites.tsx";
import { EMPTY_FILTERS } from "../../src/lib/filters.ts";
import { fakeApi, makeStory, renderWith, testQueryClient } from "./helpers.tsx";

describe("setFavoriteInData", () => {
  test("flips the story wherever it appears and keeps untouched branches", () => {
    const a = makeStory({ id: "ai-20261019-090352-a" });
    const b = makeStory({ id: "ai-20261019-090352-b" });
    const data = { pages: [{ stories: [a, b], next: null }], pageParams: [null] };
    const out = setFavoriteInData(data, a.id, true);
    expect(out.pages[0]!.stories[0]!.favorite).toBe(true);
    expect(out.pages[0]!.stories[1]).toBe(b);
    expect(data.pages[0]!.stories[0]!.favorite).toBe(false);
    expect(setFavoriteInData(data, "nope", true)).toBe(data);
  });

  test("works on story-page and favorites shapes", () => {
    const s = makeStory();
    const page = { story: s, thread: { earlier: [makeStory({ id: "x" })], later: [] } };
    expect(setFavoriteInData(page, s.id, true).story.favorite).toBe(true);
    const fav = { favorites: [{ story_id: s.id, story: s, snapshot: {} }] };
    expect(setFavoriteInData(fav, s.id, true).favorites[0]!.story.favorite).toBe(true);
  });
});

function ListProbe() {
  const api = useApi();
  const q = useQuery({ queryKey: ["stories", "probe"], queryFn: () => api.stories(EMPTY_FILTERS) });
  if (!q.data) return <p>loading</p>;
  return (
    <>
      {q.data.stories.map((s) => (
        <StoryCard key={s.id} story={s} />
      ))}
    </>
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("★ toggle", () => {
  test("updates at once, then rolls back when the write fails", async () => {
    const s = makeStory();
    const write = deferred<never>();
    const calls: [string, boolean][] = [];
    const api = fakeApi({
      stories: () => Promise.resolve<StoriesResponse>({ stories: [s], next: null }),
      setFavorite: (id, fav) => {
        calls.push([id, fav]);
        return write.promise;
      },
    });
    const client = testQueryClient();
    renderWith(<ListProbe />, { api, client });
    const star = await screen.findByRole("button", { name: `Save to favorites: ${s.headline}` });
    await act(async () => fireEvent.click(star));

    // optimistic: pressed before the server answers, and the cache says so too
    const pressed = await screen.findByRole("button", { name: `Remove from favorites: ${s.headline}` });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(client.getQueryData<StoriesResponse>(["stories", "probe"])!.stories[0]!.favorite).toBe(true);
    expect(calls).toEqual([[s.id, true]]);

    await act(async () => write.reject(new ApiError(503, "down")));
    const back = await screen.findByRole("button", { name: `Save to favorites: ${s.headline}` });
    expect(back.getAttribute("aria-pressed")).toBe("false");
    expect(client.getQueryData<StoriesResponse>(["stories", "probe"])!.stories[0]!.favorite).toBe(false);
  });

  test("stays toggled when the write succeeds", async () => {
    const s = makeStory({ favorite: true });
    const api = fakeApi({
      stories: () => Promise.resolve({ stories: [s], next: null }),
      setFavorite: (id, favorite) => Promise.resolve({ story_id: id, favorite }),
    });
    const client = testQueryClient();
    renderWith(<ListProbe />, { api, client });
    const star = await screen.findByRole("button", { name: `Remove from favorites: ${s.headline}` });
    await act(async () => fireEvent.click(star));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByRole("button", { name: `Save to favorites: ${s.headline}` }).getAttribute("aria-pressed")).toBe("false");
    expect(client.getQueryData<StoriesResponse>(["stories", "probe"])!.stories[0]!.favorite).toBe(false);
  });
});

describe("favorites filters", () => {
  const story = makeStory({ feed: "chile", headline: "Filtración en el Servel", tags: ["topic:politics"], sort_date: "2026-10-20" });
  const fav = { story_id: story.id, created_at: "2026-10-21T00:00:00Z", snapshot: { headline: story.headline, feed: "chile" as const, edition_id: story.edition_id, edition_date: "2026-10-21", sort_date: "2026-10-20" }, story };
  const gone = { ...fav, story: null };

  test("feed, tag, date and accent-insensitive text", () => {
    expect(matchesFavorite(fav, EMPTY_FILTERS)).toBe(true);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, feed: "cyber" })).toBe(false);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, tags: ["topic:politics"] })).toBe(true);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, tags: ["topic:courts"] })).toBe(false);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, q: "filtracion servel" })).toBe(true);
    // dates are the published (edition) date, 21 Oct here; the event was on the 20th
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, from: "2026-10-22" })).toBe(false);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, from: "2026-10-21", to: "2026-10-21" })).toBe(true);
    expect(matchesFavorite(fav, { ...EMPTY_FILTERS, to: "2026-10-20" })).toBe(false);
  });

  test("a snapshot matches on feed and headline only", () => {
    expect(matchesFavorite(gone, { ...EMPTY_FILTERS, feed: "chile", q: "servel" })).toBe(true);
    expect(matchesFavorite(gone, { ...EMPTY_FILTERS, tags: ["topic:politics"] })).toBe(false);
  });
});
