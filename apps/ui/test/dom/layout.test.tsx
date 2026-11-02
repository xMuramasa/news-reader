import "./dom-guard.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { Api } from "../../src/lib/api.ts";
import { ApiContext } from "../../src/lib/api.ts";
import { routes } from "../../src/App.tsx";
import { fakeApi, makeStory, testQueryClient } from "./helpers.tsx";

function renderApp(path: string, api: Api = fakeApi()) {
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

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function current(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent!.trim());
}

describe("navigation chrome", () => {
  test("tab bar and tab row list their destinations", async () => {
    renderApp("/", fakeApi());
    const tabs = await screen.findByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Today", "/"],
      ["Stories", "/stories"],
      ["Saved", "/favorites"],
      ["Search", "/search"],
    ]);
    const row = screen.getByRole("navigation", { name: "Sections" });
    expect(within(row).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Today", "/"],
      ["Chile", "/f/chile"],
      ["Cyber", "/f/cyber"],
      ["AI", "/f/ai"],
      ["Stories", "/stories"],
      ["Saved", "/favorites"],
    ]);
  });

  test.each([
    ["/", "Today", "Today"],
    ["/stories", "Stories", "Stories"],
    ["/favorites", "Saved", "Saved"],
    ["/search", "Search", null],
    ["/f/cyber", null, "Cyber"],
  ])("%s marks the active destination", async (path, tab, row) => {
    renderApp(path, fakeApi());
    const tabs = await screen.findByRole("navigation", { name: "Tabs" });
    expect(current(tabs)).toEqual(tab ? [tab] : []);
    expect(current(screen.getByRole("navigation", { name: "Sections" }))).toEqual(row ? [row] : []);
  });

  test("the desktop search field submits to /search?q=", async () => {
    const router = renderApp("/stories", fakeApi());
    const box = (await screen.findByRole("searchbox", { name: "Search stories, tags, CVEs" })) as HTMLInputElement;
    await act(async () => fireEvent.change(box, { target: { value: "CVE-2026-1234 vpn" } }));
    await act(async () => fireEvent.submit(box.closest("form")!));
    expect(router.state.location.pathname).toBe("/search");
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("CVE-2026-1234 vpn");
  });

  test("/ focuses the top bar field on desktop, and the search page field on /search", async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
    renderApp("/", fakeApi());
    const top = await screen.findByRole("searchbox", { name: "Search stories, tags, CVEs" });
    await act(async () => fireEvent.keyDown(document.body, { key: "/" }));
    expect(document.activeElement).toBe(top);
  });

  test("/ on the phone opens the Search page", async () => {
    const router = renderApp("/", fakeApi());
    await screen.findByRole("navigation", { name: "Tabs" });
    await act(async () => fireEvent.keyDown(document.body, { key: "/" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/search"));
    expect(document.activeElement).toBe(await screen.findByRole("searchbox", { name: "Search stories" }));
  });
});

describe("/search", () => {
  test("hint before a query; results from ?q= through the stories API", async () => {
    const seen: string[] = [];
    const api = fakeApi({
      stories: (f) => {
        seen.push(f.q);
        return Promise.resolve({ stories: [makeStory({ headline: "Found it" })], next: null });
      },
    });
    const router = renderApp("/search", api);
    expect(await screen.findByRole("heading", { level: 1, name: "Search" })).toBeTruthy();
    expect(screen.getByText("Search headlines, summaries, tags and CVEs")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search stories" }));
    expect(seen).toEqual([]);
    await act(async () => void router.navigate("/search?q=vpn"));
    expect(await screen.findByRole("link", { name: "Found it" })).toBeTruthy();
    expect(seen).toEqual(["vpn"]);
    expect(screen.queryByText("Search headlines, summaries, tags and CVEs")).toBeNull();
  });

  test("no matches says so", async () => {
    renderApp("/search?q=zzz", fakeApi({ stories: () => Promise.resolve({ stories: [], next: null }) }));
    expect(await screen.findByText(/Nothing matches/)).toBeTruthy();
  });
});
