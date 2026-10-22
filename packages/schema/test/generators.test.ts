import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_SECTIONS,
  FEEDS,
  FEED_IDS,
  PROMPT_EXAMPLES,
  REGIONS,
  STATUSES,
  compactJson,
  editionsValidator,
  promptSection,
  storiesValidator,
  validateEdition,
} from "../src/index.ts";
import { ROOT } from "./helpers.ts";

function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      visit(k, v);
      walk(v, visit);
    }
  }
}

describe("Mongo $jsonSchema export", () => {
  for (const [name, gen] of [
    ["editions", editionsValidator],
    ["stories", storiesValidator],
  ] as const) {
    test(`${name}: Mongo dialect only`, () => {
      const v = gen();
      expect(Object.keys(v)).toEqual(["$jsonSchema"]);
      const keys = new Set<string>();
      walk(v.$jsonSchema, (k, val) => {
        keys.add(k);
        if (k === "pattern") expect(() => new RegExp(String(val))).not.toThrow();
      });
      for (const banned of ["$schema", "type", "format", "$ref", "$defs", "const"]) expect(keys.has(banned)).toBe(false);
      expect(v.$jsonSchema).toMatchObject({ bsonType: "object", additionalProperties: false });
      expect((v.$jsonSchema.required as string[]).includes("_id")).toBe(true);
      // JSON round trip: plain data, nothing that can't be sent to the server
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    });
  }

  test("stories validator knows every section and feed", () => {
    const props = storiesValidator().$jsonSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.section!.enum).toEqual(ALL_SECTIONS);
    expect(props.feed!.enum).toEqual([...FEED_IDS]);
    for (const f of FEED_IDS) for (const s of FEEDS[f].sections) expect(ALL_SECTIONS).toContain(s.id);
  });
});

describe("prompt section", () => {
  for (const feed of FEED_IDS) {
    test(`${feed}: lists, rules and a valid example`, () => {
      const p = promptSection(feed);
      expect(p).toContain("Your final answer is exactly one JSON object and nothing else");
      expect(p).toContain("answer exactly `[SILENT]`");
      expect(p).toContain('`"news-edition/v1"`');
      expect(p).toContain(`\`"${feed}"\``);
      for (const s of FEEDS[feed].sections) expect(p).toContain(`\`${s.id}\``);
      for (const g of FEEDS[feed].coverageGroups) expect(p).toContain(`\`${g.id}\``);
      expect(p).toContain(FEEDS[feed].topics.join(", "));
      expect(p).toContain(REGIONS.join(", "));
      expect(p.includes(STATUSES.join(", "))).toBe(FEEDS[feed].statusTags);
      expect(p.includes("`markets`")).toBe(FEEDS[feed].markets);
      expect(p).toContain("reuse the previous story's `thread`");

      const example = p.slice(p.indexOf("```json\n") + 8, p.lastIndexOf("\n```"));
      expect(JSON.parse(example)).toEqual(PROMPT_EXAMPLES[feed]);
      const r = validateEdition(JSON.parse(example));
      expect(r.ok && r.warnings).toEqual([]);
    });
  }

  test("compactJson is valid JSON", () => {
    for (const f of FEED_IDS) expect(JSON.parse(compactJson(PROMPT_EXAMPLES[f]))).toEqual(PROMPT_EXAMPLES[f]);
  });
});

describe("publisher", () => {
  test("its built-in feed map matches @news/schema", () => {
    const p = Bun.spawnSync(
      [
        "python3",
        "-I",
        "-c",
        "import json, runpy, sys; print(json.dumps(runpy.run_path(sys.argv[1])['FEEDS']))",
        join(ROOT, "publisher", "news_publisher.py"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(p.stderr.toString()).toBe("");
    const feeds = JSON.parse(p.stdout.toString()) as Record<string, { feed: string; label: string; emoji: string; message_sections: string[] }>;
    expect(Object.keys(feeds).sort()).toEqual(FEED_IDS.map((f) => FEEDS[f].jobId).sort());
    for (const [jobId, f] of Object.entries(feeds)) {
      const def = FEEDS[f.feed as keyof typeof FEEDS];
      expect(def.jobId).toBe(jobId);
      expect(f.label).toBe(def.label);
      expect(f.emoji).toBe(def.emoji);
      for (const s of f.message_sections) expect(def.sections.map((x) => x.id)).toContain(s);
    }
  });
});

describe("generated job prompts", () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", join(ROOT, "scripts", "gen-prompts.ts"), ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });

  test("jobs/*.md in the repo are up to date", () => {
    const r = run("--check");
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });

  test("--check fails when a prompt is stale or missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "news-prompts-"));
    try {
      expect(run("--out", dir).exitCode).toBe(0);
      expect(run("--check", "--out", dir).exitCode).toBe(0);
      const file = join(dir, "cyber.md");
      writeFileSync(file, readFileSync(file, "utf8") + "\nhand edit\n");
      const stale = run("--check", "--out", dir);
      expect(stale.exitCode).toBe(1);
      expect(stale.stderr.toString()).toContain("cyber.md");
      rmSync(file);
      expect(run("--check", "--out", dir).exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompts keep the legacy research instructions and drop the old output format", () => {
    for (const feed of FEED_IDS) {
      const p = readFileSync(join(ROOT, "jobs", `${feed}.md`), "utf8");
      expect(p).not.toContain("<!--");
      expect(p).not.toContain("Telegram Markdown");
      expect(p).not.toContain("Format for Telegram");
      expect(p.endsWith(promptSection(feed))).toBe(true);
    }
    const chile = readFileSync(join(ROOT, "jobs", "chile.md"), "utf8");
    expect(chile).toContain("Right / center-right: El Mercurio (Emol)");
    expect(chile).toContain("INPUT 1: RSS SNAPSHOT");
    expect(chile).toContain("Coverage is a sample");
    const cyber = readFileSync(join(ROOT, "jobs", "cyber.md"), "utf8");
    expect(cyber).toContain("READER'S STACK");
    expect(cyber).toContain("Hermes Agent");
    expect(cyber).toContain("Severity facts (CVSS");
    const ai = readFileSync(join(ROOT, "jobs", "ai.md"), "utf8");
    expect(ai).toContain("Open-source & local AI → `open_source`");
    expect(ai).toContain("Never invent items or links.");
  });

  test("a copy of the legacy dir is not needed: generation reads jobs/legacy only", () => {
    const dir = mkdtempSync(join(tmpdir(), "news-prompts-"));
    try {
      cpSync(join(ROOT, "jobs"), dir, { recursive: true });
      expect(run("--check", "--out", dir).exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
