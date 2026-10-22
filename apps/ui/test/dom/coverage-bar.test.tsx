import "./dom-guard.ts";
import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CoverageBar, coverageLabel, coverageRows } from "../../src/components/CoverageBar.tsx";
import { FEEDS } from "../../src/lib/feeds.ts";

const chileCoverage = [
  { group: "right", covered: true, outlets: ["Emol", "La Tercera"] },
  { group: "center", covered: true, outlets: ["T13"] },
  { group: "left", covered: false, outlets: [] },
  { group: "independent", covered: true, outlets: ["CIPER"] },
  // "foreign" not checked by the briefing
];

describe("coverageRows", () => {
  test("one row per coverage group of the feed, in feed order", () => {
    const rows = coverageRows("chile", chileCoverage);
    expect(rows.map((r) => r.group)).toEqual(FEEDS.chile.coverageGroups.map((g) => g.id));
    expect(rows.map((r) => r.state)).toEqual(["covered", "covered", "missing", "covered", "unchecked"]);
  });

  test("ignores groups the feed doesn't have", () => {
    const rows = coverageRows("ai", [{ group: "right", covered: true, outlets: ["X"] }]);
    expect(rows.map((r) => r.group)).toEqual(["lab", "press", "independent", "research"]);
    expect(rows.every((r) => r.state === "unchecked")).toBe(true);
  });

  test("label lists outlets and missing groups", () => {
    const label = coverageLabel(coverageRows("chile", chileCoverage));
    expect(label).toContain("3 of 5 groups");
    expect(label).toContain("Right: Emol, La Tercera");
    expect(label).toContain("Left: not covered");
    expect(label).toContain("Foreign: not checked");
  });
});

describe("<CoverageBar>", () => {
  test("renders a filled, striped or dashed segment per group", () => {
    render(<CoverageBar feed="chile" coverage={chileCoverage} />);
    const bar = screen.getByTestId("coverage-bar");
    const segs = Array.from(bar.querySelectorAll<HTMLElement>("[data-group]"));
    expect(segs.length).toBe(5);
    const byGroup = Object.fromEntries(segs.map((s) => [s.dataset.group, s]));
    expect(byGroup.right!.className).toContain("seg-covered");
    expect(byGroup.left!.className).toContain("seg-missing");
    expect(byGroup.foreign!.className).toContain("seg-unchecked");
    expect(byGroup.right!.style.getPropertyValue("--g")).toBe("var(--g-right, var(--border-strong))");
    expect(bar.getAttribute("aria-label")).toContain("Independent: CIPER");
  });

  test("opens the outlet list on click (tap)", async () => {
    render(<CoverageBar feed="chile" coverage={chileCoverage} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("coverage-bar"));
    });
    expect(await screen.findByText("Emol, La Tercera")).toBeTruthy();
    expect(screen.getByText("not checked")).toBeTruthy();
  });

  test("renders nothing when the story has no coverage data", () => {
    const { container } = render(<CoverageBar feed="cyber" coverage={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
