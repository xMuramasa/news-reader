import "./dom-guard.ts";
import { describe, expect, test } from "bun:test";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { StoryCard, SnapshotCard } from "../../src/components/StoryCard.tsx";
import { markRead, reloadReadState } from "../../src/lib/read-state.ts";
import { makeStory, renderWith } from "./helpers.tsx";

describe("<StoryCard> card", () => {
  test("shows strip, headline link, date, summary, first 4 tags plus more, coverage and star", async () => {
    reloadReadState();
    const s = makeStory();
    const { container } = renderWith(<StoryCard story={s} />);
    const card = (await screen.findByRole("article")) as HTMLElement;
    expect(card.dataset.feed).toBe("cyber");
    expect(card.querySelector(".feed-strip")).toBeTruthy();
    const link = within(card).getByRole("link", { name: s.headline });
    expect(link.getAttribute("href")).toBe(`/s/${s.id}`);
    // published date-time (Santiago), plus the event day when it differs
    expect(within(card).getByText("Wed 21 Oct, 13:21").getAttribute("datetime")).toBe(s.run_at);
    expect(within(card).getByText("Tue 20 Oct")).toBeTruthy();
    expect(within(card).getByText(s.summary)).toBeTruthy();
    const tags = within(card).getByRole("list", { name: "Tags" });
    expect(within(tags).getAllByRole("link").length).toBe(4);
    const more = within(tags).getByRole("button", { name: "Show 2 more tags" });
    await act(async () => fireEvent.click(more));
    expect(within(tags).getAllByRole("link").length).toBe(6);
    expect(within(tags).getAllByRole("link")[0]!.getAttribute("href")).toBe("/stories?tag=topic%3Avulnerability");
    expect(within(card).getByTestId("coverage-bar")).toBeTruthy();
    const star = within(card).getByRole("button", { name: `Save to favorites: ${s.headline}` });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelectorAll("[data-story-card]").length).toBe(1);
  });

  test("briefing text is plain text, never HTML", async () => {
    const s = makeStory({
      headline: "<img src=x onerror=alert(1)> headline",
      summary: "**bold** <script>alert(1)</script> [link](javascript:alert(1))",
      details: [{ label: "<b>Status</b>", text: "<a href='javascript:alert(1)'>x</a>" }],
      blindspot: "<iframe src=//evil>",
    });
    const { container } = renderWith(<StoryCard story={s} variant="full" />);
    await screen.findByRole("article");
    expect(container.querySelector("img, script, iframe, b, strong")).toBeNull();
    expect(container.querySelectorAll("a[href^='javascript']").length).toBe(0);
    expect(screen.getByText("**bold** <script>alert(1)</script> [link](javascript:alert(1))")).toBeTruthy();
  });

  test("unread dot disappears once the story is read", async () => {
    reloadReadState();
    const s = makeStory();
    renderWith(<StoryCard story={s} />);
    expect(await screen.findByTestId("unread-dot")).toBeTruthy();
    await act(async () => markRead(s.id));
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  test("card pills flag patch now, your stack, blindspot and verification", async () => {
    renderWith(
      <StoryCard
        story={makeStory({ section: "patch_now", tags: ["stack:caddy", "kev:yes"], blindspot: "Only vendors covered it.", verification: "claimed" })}
      />,
    );
    await screen.findByRole("article");
    // "Patch now" is also the section kicker
    expect(screen.getAllByText("Patch now").length).toBe(2);
    for (const t of ["Your stack", "Blindspot", "Claimed"]) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe("<StoryCard> full", () => {
  test("callouts, details, framing, CVE chips to NVD, sources in a new tab", async () => {
    const s = makeStory({
      section: "patch_now",
      action: "Update Example VPN to 9.1.2.",
      verification: "mixed",
      blindspot: "Independent outlets didn't pick it up.",
      details: [{ label: "CISA due", text: "2026-11-10" }],
      framing: [{ group: "gov_vendor", text: "Vendor calls it limited." }],
      cves: ["CVE-2026-12345"],
      tags: ["topic:exploited", "cve:cve-2026-12345", "kev:yes", "stack:caddy"],
    });
    renderWith(<StoryCard story={s} variant="full" />);
    await screen.findByRole("article");
    expect(screen.getByRole("complementary", { name: "Patch now · in CISA KEV" }).textContent).toContain("Update Example VPN to 9.1.2.");
    expect(screen.getByRole("complementary", { name: "Your stack · caddy" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Blindspot" }).textContent).toContain("Independent outlets");
    expect(screen.getByRole("complementary", { name: "Mixed reports" })).toBeTruthy();
    expect(screen.getByText("CISA due")).toBeTruthy();
    expect(screen.getByText("Vendor calls it limited.")).toBeTruthy();
    const cve = screen.getByRole("link", { name: "CVE-2026-12345 on NVD (opens in a new tab)" });
    expect(cve.getAttribute("href")).toBe("https://nvd.nist.gov/vuln/detail/CVE-2026-12345");
    expect(cve.getAttribute("rel")).toBe("noopener noreferrer");
    const src = screen.getByRole("link", { name: "BleepingComputer, bleepingcomputer.com (opens in a new tab)" });
    expect(src.getAttribute("target")).toBe("_blank");
    // cve:/kev: tags are shown as CVE chips, not repeated as tag chips
    expect(screen.queryByRole("link", { name: "CVE: CVE-2026-12345" })).toBeNull();
  });

  test("a confirmed story has no verification callout", async () => {
    renderWith(<StoryCard story={makeStory()} variant="full" />);
    await screen.findByRole("article");
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("<SnapshotCard>", () => {
  test("shows what the favorite snapshot knows", async () => {
    renderWith(
      <SnapshotCard
        storyId="chile-20261021-115606-gone"
        snapshot={{ headline: "Removed story", feed: "chile", edition_id: "chile-20261021-115606", edition_date: "2026-10-21" }}
      />,
    );
    expect(await screen.findByText("Removed story")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the edition" }).getAttribute("href")).toBe("/e/chile-20261021-115606");
    expect(screen.getByRole("button", { name: "Remove from favorites: Removed story" }).getAttribute("aria-pressed")).toBe("true");
  });
});
