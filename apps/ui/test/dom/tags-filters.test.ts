import { describe, expect, test } from "bun:test";
import { EMPTY_FILTERS, filtersToSearch, parseFilters, storiesQuery, toggleTag, type Filters } from "../../src/lib/filters.ts";
import { groupTags, tagLabel, tagTitle } from "../../src/lib/tags.ts";

describe("groupTags", () => {
  const counts = [
    { tag: "outlet:emol", count: 4 },
    { tag: "topic:politics", count: 2 },
    { tag: "topic:pensions", count: 5 },
    { tag: "topic:congress", count: 2 },
    { tag: "update", count: 3 },
    { tag: "region:chile", count: 9 },
    { tag: "cve:cve-2026-1234", count: 1 },
    { tag: "stack:caddy", count: 1 },
    { tag: "org:cmf", count: 1 },
    { tag: "status:patched", count: 1 },
    { tag: "kev:yes", count: 1 },
    { tag: "blindspot:left", count: 2 },
  ];

  test("groups by prefix in a fixed order", () => {
    expect(groupTags(counts).map((g) => g.prefix)).toEqual([
      "topic",
      "region",
      "status",
      "org",
      "outlet",
      "stack",
      "cve",
      "kev",
      "blindspot",
      "update",
    ]);
  });

  test("sorts by count, then name, and keeps counts", () => {
    const topic = groupTags(counts).find((g) => g.prefix === "topic")!;
    expect(topic.label).toBe("Topic");
    expect(topic.tags).toEqual([
      { tag: "topic:pensions", count: 5 },
      { tag: "topic:congress", count: 2 },
      { tag: "topic:politics", count: 2 },
    ]);
  });

  test("leaves out empty groups and keeps unknown prefixes last", () => {
    const g = groupTags([{ tag: "zeta:x", count: 1 }, { tag: "region:us", count: 1 }]);
    expect(g.map((x) => x.prefix)).toEqual(["region", "zeta"]);
    expect(groupTags([])).toEqual([]);
  });

  test("labels", () => {
    expect(tagLabel("topic:security-crime")).toBe("security crime");
    expect(tagLabel("cve:cve-2026-1234")).toBe("CVE-2026-1234");
    expect(tagLabel("kev:yes")).toBe("CISA KEV");
    expect(tagLabel("update")).toBe("update");
    expect(tagLabel("blindspot:gov-vendor")).toBe("missing gov vendor");
    expect(tagTitle("org:cmf")).toBe("Organisation: cmf");
  });
});

describe("URL filter state", () => {
  const full: Filters = {
    sort: "oldest",
    feed: "cyber",
    tags: ["topic:ransomware", "status:exploited", "update"],
    q: "filtración datos",
    from: "2026-10-01",
    to: "2026-10-21",
    favorites: true,
  };

  test("round-trips through the query string", () => {
    const sp = filtersToSearch(full);
    expect(parseFilters(new URLSearchParams(sp.toString()))).toEqual(full);
    expect(parseFilters(filtersToSearch(EMPTY_FILTERS))).toEqual(EMPTY_FILTERS);
  });

  test("serializes canonically and omits defaults", () => {
    expect(filtersToSearch(full).toString()).toBe(
      "feed=cyber&tag=topic%3Aransomware&tag=status%3Aexploited&tag=update&q=filtraci%C3%B3n+datos&from=2026-10-01&to=2026-10-21&favorites=1&sort=oldest",
    );
    expect(filtersToSearch(EMPTY_FILTERS).toString()).toBe("");
    expect(filtersToSearch({ ...EMPTY_FILTERS, q: "   " }).toString()).toBe("");
  });

  test("drops invalid values instead of failing", () => {
    const f = parseFilters(
      new URLSearchParams(
        "feed=sports&tag=bogus:x&tag=Topic:Security Crime&tag=topic:security-crime&tag=&sort=sideways&from=2026-02-30&to=nope&favorites=yes",
      ),
    );
    expect(f).toEqual({ ...EMPTY_FILTERS, tags: ["topic:security-crime"] });
  });

  test("swaps a reversed date range, caps tags and query length", () => {
    const sp = new URLSearchParams("from=2026-10-21&to=2026-10-01&q=" + "x".repeat(300));
    for (let i = 0; i < 15; i++) sp.append("tag", `org:o${i}`);
    const f = parseFilters(sp);
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-21"]);
    expect(f.tags.length).toBe(10);
    expect(f.q.length).toBe(200);
  });

  test("API query adds sort, limit and cursor", () => {
    expect(storiesQuery({ ...EMPTY_FILTERS, feed: "ai" }, "abc", 20).toString()).toBe("feed=ai&sort=newest&limit=20&cursor=abc");
  });

  test("toggleTag adds and removes", () => {
    const a = toggleTag(EMPTY_FILTERS, "topic:apt");
    expect(a.tags).toEqual(["topic:apt"]);
    expect(toggleTag(a, "topic:apt").tags).toEqual([]);
  });
});
