import "./dom-guard.ts";
import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Api } from "../../src/lib/api.ts";
import { ApiContext, ApiError } from "../../src/lib/api.ts";
import { routes } from "../../src/App.tsx";
import { isRead, reloadReadState } from "../../src/lib/read-state.ts";
import { SEARCH_DEBOUNCE_MS } from "../../src/components/Filters.tsx";
import { fakeApi, makeEdition, makeStory, testQueryClient } from "./helpers.tsx";

function renderApp(path: string, api: Api) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return router;
}

const edition = makeEdition({
  feed: "cyber",
  stories: [
    makeStory({ id: "cyber-20261021-132150-b", slug: "b", section: "top", rank: 1, headline: "Top story B" }),
    makeStory({ id: "cyber-20261021-132150-a", slug: "a", section: "patch_now", rank: 1, headline: "Patch story A", action: "Update now." }),
    makeStory({ id: "cyber-20261021-132150-c", slug: "c", section: "research", rank: 1, headline: "Research C" }),
  ],
  gaps: ["Full articles unavailable; based on search snippets."],
  prev: "cyber-20261020-083000",
  next: null,
  same_day: [
    { id: "cyber-20261021-083001", run_at: "2026-10-21T11:30:01.000Z", latest: false },
    { id: "cyber-20261021-132150", run_at: "2026-10-21T16:21:50.000Z", latest: true },
  ],
});

describe("routes", () => {
  test("unknown route renders the 404 page inside the layout", async () => {
    renderApp("/no/such/page", fakeApi());
    expect(await screen.findByRole("heading", { level: 1, name: "No such page" })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  test("unknown feed and missing edition are 404s too", async () => {
    renderApp("/f/sports", fakeApi());
    expect(await screen.findByRole("heading", { name: "No such feed" })).toBeTruthy();
  });

  test("edition not found from the API", async () => {
    renderApp("/e/chile-20990101-000000", fakeApi({ edition: () => Promise.reject(new ApiError(404, "edition not found")) }));
    expect(await screen.findByRole("heading", { name: "No such edition" })).toBeTruthy();
  });

  test("edition: sections in feed order, contents, gaps, prev/next and same-day runs", async () => {
    renderApp(`/e/${edition.id}`, fakeApi({ edition: () => Promise.resolve({ edition }) }));
    expect(await screen.findByRole("heading", { level: 1, name: edition.title })).toBeTruthy();
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(sections.slice(0, 3)).toEqual(["Patch now1", "Top stories1", "Research & threat intel1"]);
    const toc = screen.getAllByRole("navigation", { name: "Contents" })[0]!;
    expect(within(toc).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Patch now",
      "Patch story A",
      "Top stories",
      "Top story B",
      "Research & threat intel",
      "Research C",
    ]);
    expect(screen.getByText("Full articles unavailable; based on search snippets.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Previous edition/ })[0]!.getAttribute("href")).toBe("/e/cyber-20261020-083000");
    expect(screen.queryByRole("link", { name: /Next edition/ })).toBeNull();
    const runs = screen.getByRole("navigation", { name: "Runs on this day" });
    expect(within(runs).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/e/cyber-20261021-083001",
      "/e/cyber-20261021-132150",
    ]);
    expect(within(runs).getByRole("link", { current: "page" }).textContent).toContain("13:21");
  });

  test("mark edition read", async () => {
    reloadReadState();
    renderApp(`/e/${edition.id}`, fakeApi({ edition: () => Promise.resolve({ edition }) }));
    const btn = await screen.findByRole("button", { name: "Mark edition read (3)" });
    await act(async () => fireEvent.click(btn));
    expect(edition.stories.every((s) => isRead(s.id))).toBe(true);
    expect(screen.getByRole("button", { name: "All read" })).toBeTruthy();
  });
});

describe("keyboard", () => {
  test("j/k move between stories, s stars the focused one, ? opens help; ignored while typing", async () => {
    reloadReadState();
    const writes: [string, boolean][] = [];
    renderApp(
      `/e/${edition.id}`,
      fakeApi({
        edition: () => Promise.resolve({ edition }),
        setFavorite: (id, favorite) => {
          writes.push([id, favorite]);
          return Promise.resolve({ story_id: id, favorite });
        },
      }),
    );
    await screen.findByRole("heading", { level: 1, name: edition.title });
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-story-card]"));
    await act(async () => fireEvent.keyDown(document.body, { key: "j" }));
    const first = document.activeElement as HTMLElement;
    expect(cards()).toContain(first);
    await act(async () => fireEvent.keyDown(first, { key: "j" }));
    const second = document.activeElement as HTMLElement;
    expect(cards().indexOf(second)).toBe(cards().indexOf(first) + 1);
    await act(async () => fireEvent.keyDown(second, { key: "k" }));
    expect(document.activeElement).toBe(first);
    expect(isRead(first.dataset.storyId!)).toBe(true);

    await act(async () => fireEvent.keyDown(first, { key: "s" }));
    await waitFor(() => expect(writes).toEqual([[first.dataset.storyId!, true]]));

    // typing in an input: no navigation
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await act(async () => fireEvent.keyDown(input, { key: "j" }));
    expect(document.activeElement).toBe(input);
    input.remove();

    await act(async () => fireEvent.keyDown(document.body, { key: "?" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});

describe("/stories", () => {
  test("search is debounced into the URL, and / focuses it", async () => {
    const seen: string[] = [];
    const router = renderApp(
      "/stories?feed=chile",
      fakeApi({
        stories: (f) => {
          seen.push(f.q);
          return Promise.resolve({ stories: [], next: null });
        },
      }),
    );
    const box = (await screen.findByRole("searchbox", { name: "Search stories" })) as HTMLInputElement;
    await act(async () => fireEvent.keyDown(document.body, { key: "/" }));
    expect(document.activeElement).toBe(box);
    await act(async () => fireEvent.change(box, { target: { value: "filtración" } }));
    expect(router.state.location.search).toBe("?feed=chile");
    await act(() => Bun.sleep(SEARCH_DEBOUNCE_MS + 100));
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("filtración");
    expect(new URLSearchParams(router.state.location.search).get("feed")).toBe("chile");
    await waitFor(() => expect(seen).toContain("filtración"));
    expect(await screen.findByText("Nothing matches these filters. Remove one or clear them all.")).toBeTruthy();
  });

  test("API errors show a retry", async () => {
    let calls = 0;
    renderApp(
      "/stories",
      fakeApi({
        stories: () => {
          calls++;
          return calls === 1 ? Promise.reject(new ApiError(503, "Service unavailable")) : Promise.resolve({ stories: [makeStory()], next: null });
        },
      }),
    );
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert").textContent).toContain("Service unavailable");
    await act(async () => fireEvent.click(retry));
    expect(await screen.findByRole("link", { name: makeStory().headline })).toBeTruthy();
  });
});
