import { describe, expect, test } from "bun:test";
import {
  FEEDS,
  LIMITS,
  editionIdFor,
  isEditionId,
  isStoryId,
  validateEdition,
  type ValidationResult,
} from "../src/index.ts";
import { fixture, invalidCases } from "./helpers.ts";

function ok(r: ValidationResult) {
  if (!r.ok) throw new Error(`expected valid, got:\n${r.errors.join("\n")}`);
  return r;
}

function errorsOf(r: ValidationResult): string[] {
  if (r.ok) throw new Error("expected invalid");
  return r.errors;
}

/** A small valid edition to mutate. */
function minimal(): Record<string, any> {
  const e = fixture("chile.valid.json");
  e.stories = [e.stories[0]];
  return e;
}

describe("valid fixtures", () => {
  const expected = { chile: 11, cyber: 22, ai: 15 } as const;
  for (const feed of ["chile", "cyber", "ai"] as const) {
    test(`${feed}.valid.json validates with no warnings`, () => {
      const r = ok(validateEdition(fixture(`${feed}.valid.json`), { requireSourceRun: true }));
      expect(r.warnings).toEqual([]);
      expect(r.edition.feed).toBe(feed);
      expect(r.edition.stories).toHaveLength(expected[feed]);
      expect(r.edition.source_run?.job_id).toBe(FEEDS[feed].jobId);
      for (const s of r.edition.stories) {
        expect(FEEDS[feed].sections.map((x) => x.id)).toContain(s.section);
        expect(s.tags.some((t) => t.startsWith("topic:"))).toBe(true);
      }
    });
  }

  test("every fixture source URL is http(s) and every section rank sequence starts at 1", () => {
    for (const feed of ["chile", "cyber", "ai"]) {
      const e = fixture(`${feed}.valid.json`);
      const bySection = new Map<string, number[]>();
      for (const s of e.stories) {
        for (const src of s.sources) expect(src.url).toMatch(/^https?:\/\//);
        bySection.set(s.section, [...(bySection.get(s.section) ?? []), s.rank]);
      }
      for (const ranks of bySection.values()) expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    }
  });
});

describe("invalid fixtures", () => {
  for (const [file, c] of invalidCases()) {
    test(`${file} -> ${c.error}`, () => {
      const input = fixture<unknown>(file);
      if (c.layer === "schema") {
        expect(errorsOf(validateEdition(input))).toContain(c.error);
      } else if (file === "invalid.missing-source-run.json") {
        ok(validateEdition(input));
        expect(errorsOf(validateEdition(input, { requireSourceRun: true }))).toContain(c.error);
      } else {
        // job id / feed consistency is checked by the API, the schema only checks the shape
        ok(validateEdition(input, { requireSourceRun: true }));
      }
    });
  }

  test("a body over 1 MB is rejected", () => {
    const e = minimal();
    expect(errorsOf(validateEdition(e, { bodyBytes: LIMITS.bodyBytes + 1 }))[0]).toMatch(/larger than 1000000 bytes/);
    e.gaps = Array.from({ length: 3000 }, () => "x".repeat(400));
    expect(errorsOf(validateEdition(e))[0]).toMatch(/larger than/);
  });

  test("missing generated_at is required at ingest", () => {
    const e = minimal();
    delete e.generated_at;
    expect(errorsOf(validateEdition(e, { requireSourceRun: true }))).toContain("generated_at: is required");
  });

  test("bad source_run and generated_at shapes", () => {
    const e = minimal();
    e.source_run = { job_id: "XYZ", file: "2026-10-21.md" };
    e.generated_at = "21 Oct 2026";
    const errors = errorsOf(validateEdition(e, { requireSourceRun: true }));
    expect(errors).toContain("source_run.job_id: must be a 12-character hex Hermes job id");
    expect(errors).toContain("source_run.file: must be a run file name YYYY-MM-DD_HH-MM-SS.md");
    expect(errors).toContain("generated_at: must be an ISO 8601 date-time with offset");
  });

  test("other URL schemes and credentials in URLs are rejected", () => {
    for (const url of ["data:text/html,hi", "ftp://example.com/x", "https://user:pw@example.com/", "https://exa mple.com/", "mailto:a@b.c"]) {
      const e = minimal();
      e.stories[0].sources[0].url = url;
      expect(errorsOf(validateEdition(e))).toContain("stories[0].sources[0].url: must be an absolute http(s) URL");
    }
  });

  test("wrong types are reported per field", () => {
    const e = minimal();
    e.stories[0].is_update = "yes";
    e.stories[0].coverage[0].covered = 1;
    e.stories[0].tags = "topic:congress";
    const errors = errorsOf(validateEdition(e));
    expect(errors).toContain("stories[0].is_update: must be boolean");
    expect(errors).toContain("stories[0].coverage[0].covered: must be boolean");
    expect(errors).toContain("stories[0].tags: must be array");
  });

  test("duplicate coverage groups are an error", () => {
    const e = minimal();
    e.stories[0].coverage.push({ group: "right", covered: false, outlets: [] });
    expect(errorsOf(validateEdition(e)).some((x) => x.includes('duplicate group "right"'))).toBe(true);
  });
});

describe("forgiving about cosmetics", () => {
  test("strings are trimmed, ids lower-cased, control characters removed", () => {
    const e = minimal();
    const s = e.stories[0];
    s.slug = "  Migrant Expulsion_Law ";
    s.section = " TOP ";
    s.verification = "Confirmed";
    s.headline = "  Faster​ migrant-expulsion‮ law \n clears Congress  ";
    s.coverage[0].group = "Right";
    s.event_date = "";
    s.action = "   ";
    delete s.thread;
    delete s.is_update;
    delete s.framing;
    e.language = "EN";
    e.feed = "Chile";
    const r = ok(validateEdition(e));
    const out = r.edition.stories[0]!;
    expect(out.slug).toBe("migrant-expulsion-law");
    expect(out.thread).toBe("migrant-expulsion-law");
    expect(out.section).toBe("top");
    expect(out.verification).toBe("confirmed");
    expect(out.headline).toBe("Faster migrant-expulsion law clears Congress");
    expect(out.coverage[0]!.group).toBe("right");
    expect(out.event_date).toBeNull();
    expect(out.action).toBeNull();
    expect(out.is_update).toBe(false);
    expect(out.framing).toEqual([]);
    expect(r.edition.language).toBe("en");
    expect(r.edition.feed).toBe("chile");
  });

  test("cyber coverage group spelled with a hyphen is accepted", () => {
    const e = fixture("cyber.valid.json");
    e.stories = [e.stories[0]];
    e.stories[0].coverage[0].group = "gov-vendor";
    expect(ok(validateEdition(e)).edition.stories[0]!.coverage[0]!.group).toBe("gov_vendor");
  });
});

describe("soft problems are warnings and the value is dropped", () => {
  test("unknown keys at every level", () => {
    const e = minimal();
    e.extra = 1;
    e.stories[0].mood = "good";
    e.stories[0].sources[0].title = "x";
    e.stories[0].coverage[0].weight = 2;
    e.source_run.host = "box";
    const r = ok(validateEdition(e));
    expect(r.warnings).toEqual([
      "extra: dropped unknown field",
      "source_run.host: dropped unknown field",
      "stories[0].mood: dropped unknown field",
      "stories[0].coverage[0].weight: dropped unknown field",
      "stories[0].sources[0].title: dropped unknown field",
    ]);
    expect("extra" in r.edition).toBe(false);
    expect("mood" in r.edition.stories[0]!).toBe(false);
    expect("title" in r.edition.stories[0]!.sources[0]!).toBe(false);
  });

  test("tags: normalized, unknown values and API-owned prefixes dropped, max 5 org", () => {
    const e = minimal();
    e.stories[0].tags = [
      " Topic : Security Crime ",
      "topic:SECURITY_CRIME",
      "topic:sports",
      "region:Chile",
      "region:mars",
      "status:exploited",
      "outlet:emol",
      "kev:yes",
      "update",
      "mood:happy",
      "org:Superintendencia de Pensiones",
      "org:Ñuñoa Municipality",
      "org:a",
      "org:b",
      "org:c",
      "org:d",
      "org:Superintendencia-de-Pensiones",
      "::",
    ];
    const r = ok(validateEdition(e));
    expect(r.edition.stories[0]!.tags).toEqual([
      "topic:security-crime",
      "region:chile",
      "org:superintendencia-de-pensiones",
      "org:nunoa-municipality",
      "org:a",
      "org:b",
      "org:c",
    ]);
    expect(r.warnings).toEqual([
      'stories[0].tags[2]: dropped unknown topic "sports" for feed chile',
      'stories[0].tags[4]: dropped unknown region "mars"',
      "stories[0].tags[5]: dropped status tag, feed chile has no status tags",
      'stories[0].tags[6]: dropped "outlet:emol", outlet tags are added by the reader',
      'stories[0].tags[7]: dropped "kev:yes", kev tags are added by the reader',
      'stories[0].tags[8]: dropped "update", update tags are added by the reader',
      'stories[0].tags[9]: dropped tag with unknown prefix "mood"',
      'stories[0].tags[15]: dropped "org:d", more than 5 org tags',
      'stories[0].tags[17]: dropped unreadable tag "::"',
    ]);
  });

  test("markets on a feed without markets", () => {
    const e = fixture("cyber.valid.json");
    e.markets = { as_of: null, items: [] };
    const r = ok(validateEdition(e));
    expect(r.warnings).toEqual(["markets: dropped, feed cyber has no markets"]);
    expect(r.edition.markets).toBeUndefined();
  });
});

describe("ids", () => {
  test("edition id from the run file name", () => {
    expect(editionIdFor("chile", "2026-10-21_08-04-12.md")).toBe("chile-20261021-080412");
    expect(() => editionIdFor("chile", "2026-10-21.md")).toThrow();
  });

  test("id validation", () => {
    expect(isEditionId("cyber-20261021-132150")).toBe(true);
    expect(isEditionId("sports-20261021-132150")).toBe(false);
    expect(isEditionId("cyber-20261021-132150 ")).toBe(false);
    expect(isStoryId("cyber-20261021-132150-php2shell-emergency-patches")).toBe(true);
    expect(isStoryId("cyber-20261021-132150-PHP")).toBe(false);
    expect(isStoryId("cyber-20261021-132150-")).toBe(false);
    expect(isStoryId("cyber-20261021-132150-a--b")).toBe(false);
    expect(isStoryId(`cyber-20261021-132150-${"a".repeat(200)}`)).toBe(false);
  });
});
