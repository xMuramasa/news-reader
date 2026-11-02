import "./dom-guard.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { SnapshotRow, StoryRow } from "../../src/components/StoryRow.tsx";
import { reloadReadState } from "../../src/lib/read-state.ts";
import { dismissToast, useToasts } from "../../src/lib/toast.ts";
import { moveStory } from "../../src/lib/shortcuts.ts";
import { makeStory, renderWith } from "./helpers.tsx";

function Toasts() {
  return (
    <ul>
      {useToasts().map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  );
}

const row = () => screen.findByRole("article") as Promise<HTMLElement>;

describe("<StoryRow> collapsed", () => {
  test("strip, meta line, headline link, at most four chips, star; no summary yet", async () => {
    reloadReadState();
    const s = makeStory({ section: "patch_now", verification: "claimed", tags: ["kev:yes", "stack:caddy", "cve:cve-2026-1", "update", "topic:vulnerability", "outlet:x"] });
    renderWith(<StoryRow story={s} />);
    const el = await row();
    expect(el.dataset.feed).toBe("cyber");
    expect(el.hasAttribute("data-story-card")).toBe(true);
    expect(el.querySelector(".feed-strip")).toBeTruthy();
    expect(within(el).getByText("Patch now")).toBeTruthy();
    expect(within(el).getByText("· 1 src")).toBeTruthy();
    expect(within(el).getByText("· Claimed")).toBeTruthy();
    const link = within(el).getByRole("link", { name: s.headline });
    expect(link.getAttribute("href")).toBe(`/s/${s.id}`);
    const chips = within(within(el).getByRole("list", { name: "Tags" })).getAllByRole("link");
    expect(chips.map((c) => c.textContent)).toEqual(["KEV EXPLOITED", "CADDY", "CVE-2026-1", "UPDATE"]);
    expect(chips[0]!.getAttribute("href")).toBe("/stories?tag=kev%3Ayes");
    expect(within(el).getByRole("button", { name: `Save to favorites: ${s.headline}` })).toBeTruthy();
    expect(within(el).queryByText(s.summary)).toBeNull();
    expect(within(el).getByRole("button", { name: `Details: ${s.headline}` }).getAttribute("aria-expanded")).toBe("false");
  });

  test("feed name and publish time only when asked for", async () => {
    const { unmount } = renderWith(<StoryRow story={makeStory()} />);
    await row();
    expect(screen.queryByText(/Wed 21 Oct, 13:21/)).toBeNull();
    unmount();
    renderWith(<StoryRow story={makeStory()} showFeed showDate />);
    const el = await row();
    expect(within(el).getByText(/Cyber/)).toBeTruthy();
    expect(within(el).getByText(/Wed 21 Oct, 13:21/).getAttribute("datetime")).toBe(makeStory().run_at);
  });

  test("unread diamond goes away once read, and reaching the row with j/k marks it read", async () => {
    reloadReadState();
    const s = makeStory();
    renderWith(<StoryRow story={s} />);
    expect(await screen.findByTestId("unread-dot")).toBeTruthy();
    await act(async () => void moveStory(1));
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  test("briefing text is plain text, never HTML", async () => {
    const s = makeStory({ headline: "<img src=x onerror=alert(1)> hi", summary: "**b** <script>x</script>", action: "<b>do</b> [x](javascript:alert(1))", tags: ["topic:<i>x</i>"] });
    const { container } = renderWith(<StoryRow story={s} defaultExpanded />);
    await row();
    expect(container.querySelector("img, script, b, i, iframe")).toBeNull();
    expect(container.querySelectorAll("a[href^='javascript']").length).toBe(0);
    expect(screen.getByText("**b** <script>x</script>")).toBeTruthy();
  });
});

describe("<StoryRow> expanding", () => {
  test("click on the row toggles; links, chips and buttons inside do not", async () => {
    const s = makeStory({ action: "Update Example VPN to 9.1.2." });
    renderWith(<StoryRow story={s} />);
    const el = await row();
    const toggle = within(el).getByRole("button", { name: `Details: ${s.headline}` });
    await act(async () => fireEvent.click(el));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(el).getByText(s.summary)).toBeTruthy();
    expect(within(el).getByRole("complementary", { name: "Do now" }).textContent).toContain("Update Example VPN to 9.1.2.");
    // a click on a chip link or the star leaves the row as it is
    await act(async () => fireEvent.click(within(el).getAllByRole("link", { name: /^(TOPIC|PATCHED|VULNERABILITY|EXAMPLE|EXPLOITED)/i })[0]!));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(within(el).getByRole("button", { name: `Save to favorites: ${s.headline}` })));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(within(el).getByRole("button", { name: "Collapse" })));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(el).queryByText(s.summary)).toBeNull();
  });

  test("Enter and Space on the focused row toggle it; on a button inside they do not", async () => {
    const s = makeStory();
    renderWith(<StoryRow story={s} />);
    const el = await row();
    const toggle = within(el).getByRole("button", { name: `Details: ${s.headline}` });
    el.focus();
    await act(async () => fireEvent.keyDown(el, { key: "Enter" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.keyDown(el, { key: " " }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fireEvent.keyDown(toggle, { key: "Enter" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("no DO NOW box without an action; defaultExpanded starts open", async () => {
    renderWith(<StoryRow story={makeStory()} defaultExpanded />);
    const el = await row();
    expect(within(el).getByText(makeStory().summary)).toBeTruthy();
    expect(within(el).queryByRole("complementary")).toBeNull();
  });

  test("READ STORY links to the story page; the source opens in a new tab", async () => {
    const s = makeStory();
    renderWith(<StoryRow story={s} defaultExpanded />);
    const el = await row();
    expect(within(el).getByRole("link", { name: /read story/i }).getAttribute("href")).toBe(`/s/${s.id}`);
    const src = within(el).getByRole("link", { name: "Open source: BleepingComputer (opens in a new tab)" });
    expect(src.getAttribute("href")).toBe("https://www.bleepingcomputer.com/news/x");
    expect(src.getAttribute("target")).toBe("_blank");
    expect(src.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("a source that is not http(s) gets no open-source button; the next safe one is used", async () => {
    const base = makeStory().sources[0]!;
    const { unmount } = renderWith(<StoryRow story={makeStory({ sources: [{ ...base, url: "javascript:alert(1)" }] })} defaultExpanded />);
    const el = await row();
    expect(within(el).queryByRole("link", { name: /Open source/ })).toBeNull();
    unmount();
    renderWith(<StoryRow story={makeStory({ sources: [{ ...base, url: "javascript:alert(1)" }, { ...base, outlet: "Second", url: "https://second.example/a" }] })} defaultExpanded />);
    expect((await screen.findByRole("link", { name: /Open source: Second/ })).getAttribute("href")).toBe("https://second.example/a");
  });
});

describe("<StoryRow> share", () => {
  afterEach(() => {
    delete (navigator as { share?: unknown }).share;
  });

  test("uses the Web Share API when there is one", async () => {
    const s = makeStory();
    const calls: unknown[] = [];
    (navigator as { share?: unknown }).share = (d: unknown) => {
      calls.push(d);
      return Promise.resolve();
    };
    renderWith(<StoryRow story={s} defaultExpanded />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Share" })));
    expect(calls).toEqual([{ title: s.headline, url: `http://localhost:3000/s/${s.id}` }]);
  });

  test("otherwise copies the link and says so", async () => {
    const s = makeStory();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => (copied.push(t), Promise.resolve()) } });
    renderWith(
      <>
        <StoryRow story={s} defaultExpanded />
        <Toasts />
      </>,
    );
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Share" })));
    expect(copied).toEqual([`http://localhost:3000/s/${s.id}`]);
    await waitFor(() => expect(screen.getByText("Link copied")).toBeTruthy());
    await act(async () => {
      for (let i = 1; i < 20; i++) dismissToast(i);
    });
  });
});

describe("<StoryRow> other forms", () => {
  test("headlineOnly is a diamond and a link: no card, no chips, no star", async () => {
    reloadReadState();
    const s = makeStory();
    const { container } = renderWith(<StoryRow story={s} headlineOnly />);
    const link = await screen.findByRole("link", { name: s.headline });
    expect(link.getAttribute("href")).toBe(`/s/${s.id}`);
    expect(container.querySelector("article, button, ul")).toBeNull();
    expect(container.querySelector("[data-story-card]")).toBeTruthy();
    expect(screen.getByTestId("unread-dot")).toBeTruthy();
    await act(async () => fireEvent.click(link));
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  test("<SnapshotRow> shows what the favorite snapshot knows", async () => {
    renderWith(<SnapshotRow storyId="chile-20261021-115606-gone" snapshot={{ headline: "Removed story", feed: "chile", edition_id: "chile-20261021-115606", edition_date: "2026-10-21" }} />);
    expect(await screen.findByText("Removed story")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the edition" }).getAttribute("href")).toBe("/e/chile-20261021-115606");
    expect(screen.getByRole("button", { name: "Remove from favorites: Removed story" }).getAttribute("aria-pressed")).toBe("true");
  });
});
