import "./dom-guard.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, within } from "@testing-library/react";
import type { StoryResponse } from "@news/schema";
import { isRead } from "../../src/lib/read-state.ts";
import { groupDetails, Story } from "../../src/routes/Story.tsx";
import { fakeApi, makeStory, renderWith } from "./helpers.tsx";

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});
const wide = () => {
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
};

const story = makeStory({
  id: "chile-20261031-031017-silva",
  feed: "chile",
  section: "top",
  headline: "Silva out as justice undersecretary",
  summary: "On Fri 30 Oct Kast accepted the resignation.",
  event_date: "2026-10-30",
  edition_date: "2026-10-31",
  run_at: "2026-10-31T06:10:17.000Z",
  action: "Watch the Chamber agenda.",
  details: [
    { label: "Context", text: "Context one." },
    { label: "Next", text: "AC filing reported for Tue 3 Nov." },
    { label: "Numbers", text: "68 for, 42 against." },
    { label: "Context", text: "Context two." },
    { label: "Timeline", text: "Seven days." },
  ],
  coverage: [
    { group: "right", covered: true, outlets: ["Ex-Ante", "Emol"] },
    { group: "center", covered: true, outlets: ["BioBioChile"] },
    { group: "left", covered: false, outlets: [] },
  ],
  framing: [{ group: "right", text: "Ex-Ante calls it a crucifixion." }],
  blindspot: "No left outlet covered the probe.",
  sources: [
    { outlet: "La Tercera", url: "https://www.latercera.com/x", outlet_slug: "la-tercera", group: "right", lean: null },
    { outlet: "Odd", url: "javascript:alert(1)", outlet_slug: "odd", group: null, lean: null },
  ],
  tags: ["topic:politics", "region:chile", "blindspot:left", "update", "outlet:la-tercera", "topic:courts", "topic:a", "topic:b", "topic:c"],
});
const earlier = makeStory({ id: "chile-20261030-0300-earlier", feed: "chile", edition_date: "2026-10-30", run_at: "2026-10-30T06:00:00.000Z", headline: "Earlier day headline" });
const page: StoryResponse = { story, thread: { earlier: [earlier], later: [] } };

function renderStory() {
  return renderWith(<Story />, { api: fakeApi({ story: () => Promise.resolve(page) }), path: `/s/${story.id}` });
}

describe("story page", () => {
  test("quick read: meta, headline, all tags (no cap, no outlets), summary, DO NOW and NEXT", async () => {
    renderStory();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(story.headline);
    expect(screen.getByText(/Edition 03:10/)).toBeTruthy();
    expect(screen.getByText(/Event/)).toBeTruthy();
    const tags = within(screen.getByRole("list", { name: "Tags" })).getAllByRole("link");
    expect(tags.length).toBe(7);
    expect(tags.map((a) => a.textContent).join("|")).not.toContain("LA TERCERA");
    expect(screen.getByTestId("title-rule")).toBeTruthy();
    expect(screen.getByText(story.summary).className).toContain("reading");
    expect(within(screen.getByRole("complementary", { name: "Do now" })).getByText("Watch the Chamber agenda.")).toBeTruthy();
    expect(within(screen.getByRole("complementary", { name: "Next" })).getByText("AC filing reported for Tue 3 Nov.")).toBeTruthy();
  });

  test("details are folded; headers carry counts, NUMBERS and CONTEXT first, other labels grouped", async () => {
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    const heads = screen.getAllByRole("button", { expanded: false }).filter((b) => b.closest("h3"));
    expect(heads.map((b) => b.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Numbers// 1",
      "Context// 2",
      "Timeline// 1",
      "Coverage & framing// 2 of 5 groups",
      "Sources// 2",
      "Thread// 2 days",
    ]);
    expect(screen.queryByText("Context one.")).toBeNull();
    fireEvent.click(heads[1]!);
    expect(heads[1]!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Context one.")).toBeTruthy();
    expect(screen.getByText("Context two.")).toBeTruthy();
    fireEvent.click(heads[1]!);
    expect(screen.queryByText("Context one.")).toBeNull();
  });

  test("coverage: labelled segments, missing group marked, framing with a group chip, blindspot note", async () => {
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Coverage & framing/ }));
    const segs = within(screen.getByRole("list", { name: "Coverage by group" })).getAllByRole("listitem");
    expect(segs.map((l) => l.getAttribute("data-state"))).toEqual(["covered", "covered", "missing", "unchecked", "unchecked"]);
    expect(segs[0]!.textContent).toContain("Right 2");
    expect(segs[2]!.textContent).toContain("Left 0");
    expect(screen.getByText("Ex-Ante calls it a crucifixion.")).toBeTruthy();
    expect(screen.getByText("No left outlet covered the probe.")).toBeTruthy();
  });

  test("sources link out safely; an unsafe URL is plain text. Thread marks this story and links the others", async () => {
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Sources/ }));
    const link = screen.getByRole("link", { name: "La Tercera (opens in a new tab)" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: /Odd/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Thread/ }));
    const thread = screen.getByRole("list", { name: "Thread" });
    expect(within(thread).getByRole("link", { name: "Earlier day headline" }).getAttribute("href")).toBe(`/s/${earlier.id}`);
    expect(thread.querySelector('[aria-current="true"]')!.textContent).toContain("This story");
  });

  test("top row: back link, star, share and open-source buttons", async () => {
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: /Back to the/ }).getAttribute("href")).toBe(`/e/${story.edition_id}#story-${story.slug}`);
    expect(screen.getByRole("button", { name: /Save to favorites/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open source: La Tercera/ }).getAttribute("href")).toBe("https://www.latercera.com/x");
  });

  test("opening the page marks the story read", async () => {
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    expect(isRead(story.id)).toBe(true);
  });

  test("desktop: thread, sources and coverage in a side column; numbers, context and framing stay accordions", async () => {
    wide();
    renderStory();
    await screen.findByRole("heading", { level: 1 });
    const side = screen.getByRole("heading", { name: /^Thread/ }).closest("section")!.parentElement!;
    expect(within(side).getByRole("heading", { name: /^Sources/ })).toBeTruthy();
    expect(within(side).getByRole("heading", { name: /^Coverage/ })).toBeTruthy();
    expect(within(side).getByRole("link", { name: "Earlier day headline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Thread/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sources/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Numbers/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Coverage & framing/ }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("groupDetails", () => {
  test("splits NEXT, orders NUMBERS then CONTEXT then the rest, groups by label case-insensitively", () => {
    const r = groupDetails([
      { label: "Other", text: "o" },
      { label: "context", text: "c1" },
      { label: "Next", text: "n" },
      { label: "Numbers", text: "x" },
      { label: "Context", text: "c2" },
    ]);
    expect(r.next).toEqual(["n"]);
    expect(r.groups.map((g) => [g.title, g.texts])).toEqual([["Numbers", ["x"]], ["context", ["c1", "c2"]], ["Other", ["o"]]]);
  });
});
