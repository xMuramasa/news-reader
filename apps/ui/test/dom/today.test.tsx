import "./dom-guard.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { StoriesResponse, StoryView } from "@news/schema";
import { Today } from "../../src/routes/Today.tsx";
import { ApiError, type Api } from "../../src/lib/api.ts";
import { addDays, santiagoToday } from "../../src/lib/dates.ts";
import { markRead, reloadReadState } from "../../src/lib/read-state.ts";
import { fakeApi, makeEdition, makeStory, renderWith } from "./helpers.tsx";

const realMatchMedia = window.matchMedia;
const useDesktop = (on: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: on, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
};
beforeEach(() => {
  reloadReadState();
  useDesktop(false);
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

const day = "2026-10-31";
const cyberId = "cyber-20261031-031943";
const chileId = "chile-20261031-031017";
const aiId = "ai-20261031-030727";

function st(feed: "chile" | "cyber" | "ai", editionId: string, section: string, rank: number, over: Partial<StoryView> = {}): StoryView {
  return makeStory({
    id: `${editionId}-${section}-${rank}`,
    edition_id: editionId,
    feed,
    edition_date: day,
    section,
    rank,
    headline: `${feed} ${section} ${rank}`,
    tags: [],
    ...over,
  });
}

const stories: StoryView[] = [
  st("chile", chileId, "top", 2),
  st("chile", chileId, "top", 1, { tags: ["update", "topic:politics"] }),
  st("cyber", cyberId, "top", 1),
  st("cyber", cyberId, "your_stack", 1, { tags: ["stack:ubuntu"] }),
  st("cyber", cyberId, "patch_now", 2, { tags: ["kev:yes", "status:patched", "cve:cve-2026-1"] }),
  st("cyber", cyberId, "patch_now", 1, { tags: ["kev:yes", "cve:cve-2026-2"], action: "Upgrade to 25.1" }),
  st("ai", aiId, "top", 1, { tags: ["blindspot:press"], blindspot: "Only press covered it" }),
];

function api(over: Partial<Api> = {}) {
  const calls: { from: string | null; to: string | null; cursor: string | null | undefined; limit: number | undefined }[] = [];
  const a = fakeApi({
    stories: (f, cursor, limit) => {
      calls.push({ from: f.from, to: f.to, cursor, limit });
      return Promise.resolve({ stories, next: null } satisfies StoriesResponse);
    },
    edition: (id) =>
      Promise.resolve({
        edition: makeEdition({
          id,
          feed: id.startsWith("chile") ? "chile" : id.startsWith("cyber") ? "cyber" : "ai",
          lead: `Lead of ${id}`,
          markets: id.startsWith("chile") ? { as_of: "2026-10-30", items: [{ name: "IPSA", value: "10,254.15", change: "-2.76%" }, { name: "COPPER", value: "US$6.55/lb", change: "+0.24%" }] } : null,
        }),
      }),
    ...over,
  });
  return { api: a, calls };
}

const path = `/?date=${day}`;

describe("Today: data", () => {
  test("asks for the day's stories with limit 100 and follows next", async () => {
    const calls: (string | null | undefined)[] = [];
    const a = fakeApi({
      stories: (f, cursor, limit) => {
        calls.push(`${f.from}|${f.to}|${limit}|${cursor ?? ""}`);
        return Promise.resolve(cursor ? { stories: stories.slice(3), next: null } : { stories: stories.slice(0, 3), next: "c2" });
      },
    });
    renderWith(<Today />, { api: a, path });
    await screen.findByRole("heading", { name: /^Top stories/ });
    expect(calls).toEqual([`${day}|${day}|100|`, `${day}|${day}|100|c2`]);
    expect(screen.getByText("Stories", { selector: "dt" }).nextElementSibling!.textContent).toBe("7");
  });

  test("defaults to today (Santiago) and ignores an invalid ?date", async () => {
    const { api: a, calls } = api();
    renderWith(<Today />, { api: a, path: "/?date=nope" });
    await screen.findByRole("heading", { level: 1, name: "Today" });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.from).toBe(santiagoToday());
  });
});

describe("Today: header", () => {
  test("numeral, month, weekday, readouts, steps (› off on today, TODAY chip)", async () => {
    markRead(stories[0]!.id);
    const today = santiagoToday();
    const { api: a } = api({ stories: () => Promise.resolve({ stories: stories.map((s) => ({ ...s, edition_date: today })), next: null }) });
    renderWith(<Today />, { api: a });
    await screen.findByRole("heading", { name: /^Top stories/ });
    expect(screen.getByText("Today", { selector: "span" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Previous day" }).getAttribute("href")).toBe(`/?date=${addDays(today, -1)}`);
    const read = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
    expect(read("Stories")).toBe("7");
    expect(read("Unread")).toBe("6");
    expect(read("Patch now")).toBe("2");
    expect(read("Your stack")).toBe("1");
  });

  test("a past day: no TODAY chip, › links to the next day (the last step goes back to /)", async () => {
    const { api: a } = api();
    const yesterday = addDays(santiagoToday(), -1);
    renderWith(<Today />, { api: a, path: `/?date=${yesterday}` });
    await screen.findByRole("heading", { name: /^Top stories/ });
    expect(screen.queryByText("Today", { selector: "span" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next day" }).getAttribute("href")).toBe("/");
  });
});

describe("Today: phone", () => {
  test("lead = first patch-now story, then each other feed's top story, then BY FEED lines", async () => {
    const { api: a } = api();
    renderWith(<Today />, { api: a, path });
    const top = (await screen.findByRole("heading", { name: /^Top stories/ })).closest("section")!;
    const heads = within(top).getAllByRole("heading").map((h) => h.textContent);
    // lead (cyber patch now 1), chile top 1, ai top 1
    expect(heads).toEqual(["Top stories // Across feeds", "cyber patch_now 1", "chile top 1", "ai top 1"]);
    expect(top.querySelector("article[data-feed='cyber']")?.textContent).toContain("A vendor shipped fixes on 20 Oct.");
    const byFeed = screen.getByRole("heading", { name: "By feed" }).closest("section")!;
    const chile = within(byFeed).getByRole("heading", { name: "Chile" }).closest("section")!;
    expect(within(chile).getAllByRole("link").map((l) => l.textContent).filter((t) => t?.startsWith("chile"))).toEqual(["chile top 1", "chile top 2"]);
    expect(within(chile).getByRole("link", { name: "Open the Chile feed" }).getAttribute("href")).toBe("/f/chile");
    expect(within(byFeed).getAllByRole("link", { name: /^cyber /i })).toHaveLength(4);
  });

  test("without patch-now stories the lead is the top story of the first feed", async () => {
    const { api: a } = api({ stories: () => Promise.resolve({ stories: stories.filter((s) => s.section !== "patch_now"), next: null }) });
    renderWith(<Today />, { api: a, path });
    const top = (await screen.findByRole("heading", { name: /^Top stories/ })).closest("section")!;
    expect(within(top).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Top stories // Across feeds", "chile top 1", "cyber top 1", "ai top 1"]);
  });

  test("a missing feed is just left out", async () => {
    const { api: a } = api({ stories: () => Promise.resolve({ stories: stories.filter((s) => s.feed !== "cyber"), next: null }) });
    renderWith(<Today />, { api: a, path });
    await screen.findByRole("heading", { name: /^Top stories/ });
    expect(screen.queryByRole("heading", { name: "Cyber" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Chile" })).toBeTruthy();
  });
});

describe("Today: desktop", () => {
  test("panels with edition leads and labelled sections; the first patch-now row starts expanded", async () => {
    useDesktop(true);
    const { api: a } = api();
    renderWith(<Today />, { api: a, path });
    const chile = (await screen.findByRole("heading", { name: "Chile" })).closest("section")!;
    expect(await within(chile).findByText(`Lead of ${chileId}`)).toBeTruthy();
    expect(within(chile).getByRole("link", { name: "Open the Chile edition" }).getAttribute("href")).toBe(`/e/${chileId}`);
    const cyber = screen.getByRole("heading", { name: "Cyber" }).closest("section")!;
    const labels = Array.from(cyber.querySelectorAll("ol")).map((o) => o.getAttribute("aria-label"));
    expect(labels).toEqual(["Patch now", "Top stories", "Your stack"]);
    const rows = cyber.querySelectorAll<HTMLElement>("article[data-story-card]");
    expect(Array.from(rows).map((r) => r.dataset.expanded)).toEqual(["true", "false", "false", "false"]);
    expect(within(rows[0]!).getByText("Upgrade to 25.1")).toBeTruthy();
  });

  test("AT A GLANCE: patch now, your stack, blindspots and markets", async () => {
    useDesktop(true);
    const { api: a } = api();
    renderWith(<Today />, { api: a, path });
    const glance = await screen.findByRole("complementary", { name: "At a glance" });
    const patch = within(glance).getByRole("region", { name: "Patch now" });
    expect(within(patch).getAllByRole("link").map((l) => l.textContent)).toEqual(["cyber patch_now 1", "cyber patch_now 2"]);
    expect(within(patch).getAllByText("KEV")).toHaveLength(2);
    expect(within(within(glance).getByRole("region", { name: "Your stack" })).getByText(/UBUNTU/)).toBeTruthy();
    expect(within(within(glance).getByRole("region", { name: "Blindspots" })).getByText("PRESS")).toBeTruthy();
    const markets = await within(glance).findByRole("region", { name: "Markets" });
    expect(within(markets).getByText("10,254.15")).toBeTruthy();
    expect(within(markets).getByText("-2.76%").className).toContain("FF6B63");
    expect(within(markets).getByText("+0.24%").className).toContain("chip-patched");
  });

  test("a long feed folds its tail behind a More button", async () => {
    useDesktop(true);
    const many = Array.from({ length: 9 }, (_, i) => st("chile", chileId, "top", i + 1));
    const { api: a } = api({ stories: () => Promise.resolve({ stories: many, next: null }) });
    renderWith(<Today />, { api: a, path });
    const more = await screen.findByRole("button", { name: /More in Chile \/\/ 3/ });
    expect(screen.getAllByRole("article")).toHaveLength(6);
    fireEvent.click(more);
    expect(screen.getAllByRole("article")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Today: empty, loading, error", () => {
  test("an empty day says so and links to the previous day", async () => {
    const { api: a } = api({ stories: () => Promise.resolve({ stories: [], next: null }) });
    renderWith(<Today />, { api: a, path });
    expect(await screen.findByText("No editions for Sat 31 Oct yet. The briefings land around 03:00.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Fri 30 Oct" }).getAttribute("href")).toBe("/?date=2026-10-30");
  });

  test("skeletons while loading", () => {
    renderWith(<Today />, { api: fakeApi({ stories: () => new Promise(() => {}) }), path });
    expect(screen.getByRole("status", { name: "Loading the day" })).toBeTruthy();
  });

  test("an error offers a retry", async () => {
    let fail = true;
    const a = fakeApi({
      stories: () => (fail ? Promise.reject(new ApiError(500, "boom")) : Promise.resolve({ stories, next: null })),
    });
    renderWith(<Today />, { api: a, path });
    expect(await screen.findByText("boom")).toBeTruthy();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /try again/i })));
    expect(await screen.findByRole("heading", { name: /^Top stories/ })).toBeTruthy();
  });
});
