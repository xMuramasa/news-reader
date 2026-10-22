import "./dom-guard.ts";
// The three real fixture editions (test/fixtures/editions/*.valid.json), shaped roughly as the API returns them, through
// the edition view: real lengths, markets, many tags and sections, no crashes, every story rendered once.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { screen, within } from "@testing-library/react";
import type { EditionView, StoryView } from "@news/schema";
import { FEEDS } from "../../src/lib/feeds.ts";
import { Edition } from "../../src/routes/Edition.tsx";
import { fakeApi, renderWith } from "./helpers.tsx";

const DIR = join(import.meta.dir, "..", "..", "..", "..", "test", "fixtures", "editions");

async function load(feed: "chile" | "cyber" | "ai"): Promise<EditionView> {
  const raw: any = await Bun.file(join(DIR, `${feed}.valid.json`)).json();
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(raw.source_run.file)!;
  const id = `${feed}-${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  const stories: StoryView[] = raw.stories.map((s: any) => ({
    id: `${id}-${s.slug}`,
    edition_id: id,
    feed,
    edition_date: raw.edition_date,
    run_at: new Date(raw.generated_at).toISOString(),
    sort_date: s.event_date && s.event_date <= raw.edition_date ? s.event_date : raw.edition_date,
    section: s.section,
    rank: s.rank,
    slug: s.slug,
    headline: s.headline,
    summary: s.summary,
    event_date: s.event_date ?? null,
    is_update: s.is_update ?? false,
    thread: s.thread ?? s.slug,
    verification: s.verification,
    action: s.action ?? null,
    details: s.details ?? [],
    coverage: (s.coverage ?? []).map((c: any) => ({ outlets: [], ...c })),
    framing: s.framing ?? [],
    blindspot: s.blindspot ?? null,
    sources: (s.sources ?? []).map((x: any) => ({ ...x, outlet_slug: "x", group: null, lean: null })),
    tags: s.tags ?? [],
    cves: [...new Set<string>(JSON.stringify(s).match(/CVE-\d{4}-\d{4,7}/g) ?? [])],
    favorite: false,
  }));
  return {
    id,
    feed,
    edition_date: raw.edition_date,
    run_at: new Date(raw.generated_at).toISOString(),
    title: raw.title,
    lead: raw.lead,
    language: raw.language ?? "en",
    story_count: stories.length,
    section_counts: {},
    markets: raw.markets ?? null,
    gaps: raw.gaps ?? [],
    stories,
    prev: null,
    next: null,
    same_day: [{ id, run_at: new Date(raw.generated_at).toISOString(), latest: true }],
  };
}

describe.each(["chile", "cyber", "ai"] as const)("%s fixture edition", (feed) => {
  test("renders every story once, in feed section order", async () => {
    const edition = await load(feed);
    renderWith(<Edition />, { api: fakeApi({ edition: () => Promise.resolve({ edition }) }), path: `/e/${edition.id}` });
    expect(await screen.findByRole("heading", { level: 1, name: edition.title })).toBeTruthy();
    const cards = document.querySelectorAll("[data-story-card]");
    expect(cards.length).toBe(edition.stories.length);
    const order = FEEDS[feed].sections.map((s) => s.id);
    const sections = Array.from(document.querySelectorAll("section[id^='sec-']")).map((s) => s.id.slice(4));
    expect(sections).toEqual(order.filter((id) => sections.includes(id)));
    if (edition.markets?.items.length) {
      const markets = screen.getByRole("region", { name: "Markets" });
      expect(within(markets).getAllByRole("definition").length).toBe(edition.markets.items.length);
    }
    expect(document.querySelectorAll("a[href^='javascript'], script, iframe").length).toBe(0);
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[target=_blank]")) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
    }
  });
});
