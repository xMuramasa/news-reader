import { describe, expect, test } from "bun:test";
import { filterTagGroups } from "../../src/components/Filters.tsx";
import { formatDayTime, santiagoDate } from "../../src/lib/dates.ts";
import { EMPTY_FILTERS, activePreset, dateRangeLabel, presetRange, tagsQuery } from "../../src/lib/filters.ts";
import { groupTags } from "../../src/lib/tags.ts";

const TODAY = "2026-10-23";

describe("published-date presets", () => {
  test("ranges relative to today in Santiago", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: "2026-10-23", to: "2026-10-23" });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-10-22", to: "2026-10-22" });
    expect(presetRange("7d", TODAY)).toEqual({ from: "2026-10-17", to: null });
    expect(presetRange("30d", TODAY)).toEqual({ from: "2026-09-24", to: null });
  });

  test("the active preset is recognised from the URL range", () => {
    expect(activePreset({ from: "2026-10-23", to: "2026-10-23" }, TODAY)).toBe("today");
    expect(activePreset({ from: "2026-10-17", to: null }, TODAY)).toBe("7d");
    expect(activePreset({ from: "2026-10-17", to: "2026-10-23" }, TODAY)).toBe("7d");
    expect(activePreset({ from: "2026-10-18", to: null }, TODAY)).toBeNull();
    expect(activePreset({ from: null, to: null }, TODAY)).toBeNull();
  });

  test("labels for the active-filter chip", () => {
    expect(dateRangeLabel("2026-10-22", "2026-10-22", TODAY)).toBe("Yesterday");
    expect(dateRangeLabel("2026-10-01", "2026-10-05", TODAY)).toBe("1 Oct 2026 – 5 Oct 2026");
    expect(dateRangeLabel("2026-10-05", "2026-10-05", TODAY)).toBe("5 Oct 2026");
    expect(dateRangeLabel("2026-10-01", null, TODAY)).toBe("since 1 Oct 2026");
    expect(dateRangeLabel(null, "2026-10-05", TODAY)).toBe("until 5 Oct 2026");
  });
});

describe("tag counts follow the filters", () => {
  test("GET /api/tags gets the same filters as the list, without sort", () => {
    const f = { ...EMPTY_FILTERS, feed: "cyber" as const, tags: ["kev:yes"], from: "2026-10-17", q: "plex", sort: "oldest" as const };
    expect(tagsQuery(f).toString()).toBe("feed=cyber&tag=kev%3Ayes&q=plex&from=2026-10-17");
    expect(tagsQuery(EMPTY_FILTERS).toString()).toBe("");
  });

  test("tag search matches labels and values, ignores accents, keeps selected tags", () => {
    const groups = groupTags([
      { tag: "topic:pensions", count: 5 },
      { tag: "topic:politics", count: 3 },
      { tag: "org:superintendencia-de-pensiones", count: 2 },
      { tag: "outlet:biobiochile", count: 4 },
      { tag: "region:chile", count: 9 },
    ]);
    const tags = (search: string, active: string[] = []) => filterTagGroups(groups, search, active).flatMap((g) => g.tags.map((t) => t.tag));
    expect(tags("pens")).toEqual(["topic:pensions", "org:superintendencia-de-pensiones"]);
    expect(tags("PENSIÓN")).toEqual(["topic:pensions", "org:superintendencia-de-pensiones"]);
    expect(tags("bio")).toEqual(["outlet:biobiochile"]);
    expect(tags("zzz", ["region:chile"])).toEqual(["region:chile"]);
    expect(tags("")).toHaveLength(5);
  });
});

describe("publish time", () => {
  test("shown in Santiago time", () => {
    expect(formatDayTime("2026-10-21T16:21:50.000Z")).toBe("Wed 21 Oct, 13:21");
    expect(formatDayTime("2026-10-24T06:04:00.000Z")).toBe("Sat 24 Oct, 03:04");
    expect(formatDayTime("nope")).toBe("");
    expect(santiagoDate("2026-10-24T02:30:00.000Z")).toBe("2026-10-23");
  });
});
