import "./dom-guard.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { act } from "react";
import { EndfieldPaper, contourPaths } from "../../src/components/EndfieldPaper.tsx";
import { reloadSettings, setSettings } from "../../src/lib/settings.ts";

beforeEach(() => {
  localStorage.clear();
  reloadSettings();
});

const points = (d: string) => [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

describe("contourPaths", () => {
  const paths = contourPaths(1000, 800);

  test("18 closed paths, deterministic for a size", () => {
    expect(paths).toHaveLength(18);
    for (const d of paths) {
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      expect(points(d)).toHaveLength(181);
    }
    expect(contourPaths(1000, 800)).toEqual(paths);
    expect(contourPaths(500, 400)).not.toEqual(paths);
  });

  test("the rings are centred near 78 % / 72 % of the viewport", () => {
    const pts = points(paths[0]!);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    expect(Math.abs(cx - 780)).toBeLessThan(15);
    expect(Math.abs(cy - 576)).toBeLessThan(15);
  });
});

describe("EndfieldPaper", () => {
  test.each(["endfield", "endfield-dark"] as const)("renders in %s: an aria-hidden, click-through svg with 18 paths, every fifth at 0.9", (theme) => {
    setSettings({ theme });
    const { container } = render(<EndfieldPaper />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toContain("pointer-events-none");
    expect(svg.getAttribute("class")).toContain("fixed");
    const ps = [...svg.querySelectorAll("path")];
    expect(ps).toHaveLength(18);
    expect(ps.map((p) => p.getAttribute("stroke-opacity"))).toEqual(Array.from({ length: 18 }, (_, i) => ((i + 1) % 5 === 0 ? "0.9" : "0.55")));
  });

  test.each(["light", "dark", "sepia"] as const)("renders nothing in %s", (theme) => {
    setSettings({ theme });
    expect(render(<EndfieldPaper />).container.querySelector("svg")).toBeNull();
  });

  test("appears and goes away as the theme changes", () => {
    setSettings({ theme: "light" });
    const { container } = render(<EndfieldPaper />);
    expect(container.querySelector("svg")).toBeNull();
    act(() => setSettings({ theme: "endfield-dark" }));
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
