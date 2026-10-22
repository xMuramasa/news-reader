import { describe, expect, test } from "bun:test";
import {
  buildOutletIndex,
  compileStack,
  deriveTags,
  findCves,
  matchOutlet,
  matchStack,
  normalizeFilterTag,
  parseOutletsFile,
  parseStackFile,
  parseTag,
  slugify,
  validateEdition,
  type DeriveContext,
  type Edition,
} from "../src/index.ts";
import { fixture, outletsConfig, stackConfig } from "./helpers.ts";

const outlets = buildOutletIndex(outletsConfig());
const stack = compileStack(stackConfig());

function edition(feed: string): Edition {
  const r = validateEdition(fixture(`${feed}.valid.json`));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.edition;
}

describe("normalization", () => {
  test("slugify folds accents and punctuation", () => {
    expect(slugify("Superintendencia de Pensiones")).toBe("superintendencia-de-pensiones");
    expect(slugify("  Ñuñoa & Peñalolén ")).toBe("nunoa-and-penalolen");
    expect(slugify("Palo Alto Networks, Inc.")).toBe("palo-alto-networks-inc");
    expect(slugify("¡¡!!")).toBe("");
    expect(slugify("a".repeat(70) + " b", 60).length).toBeLessThanOrEqual(60);
  });

  test("parseTag", () => {
    expect(parseTag(" Topic :  Security Crime")).toEqual({ prefix: "topic", value: "security-crime" });
    expect(parseTag("ORG:Banco_Central")).toEqual({ prefix: "org", value: "banco-central" });
    expect(parseTag("update")).toEqual({ prefix: "update", value: "" });
    expect(parseTag("topic:")).toBeNull();
    expect(parseTag("   ")).toBeNull();
  });

  test("filter tags from the query string", () => {
    expect(normalizeFilterTag("Region: Chile")).toBe("region:chile");
    expect(normalizeFilterTag("cve:CVE-2026-109618")).toBe("cve:cve-2026-109618");
    expect(normalizeFilterTag("update")).toBe("update");
    expect(normalizeFilterTag("$where:1")).toBeNull();
    expect(normalizeFilterTag("$where")).toBeNull();
    expect(normalizeFilterTag("mood:happy")).toBeNull();
    expect(normalizeFilterTag("update:yes")).toBeNull();
    expect(normalizeFilterTag("topic")).toBeNull();
    expect(normalizeFilterTag(":")).toBeNull();
  });
});

describe("CVE ids", () => {
  test("found once each, upper-cased", () => {
    expect(findCves("cve-2026-109618 and CVE-2026-109619, again CVE-2026-109618; CVE-2026-0257")).toEqual([
      "CVE-2026-109618",
      "CVE-2026-109619",
      "CVE-2026-0257",
    ]);
    expect(findCves("CVE-26-1 CVE-2026-12 XCVE-2026-12345")).toEqual([]);
  });
});

describe("outlets", () => {
  test("config covers the legacy outlet maps", () => {
    const names = outletsConfig().outlets.flatMap((o) => [o.name, ...o.aliases]);
    for (const n of [
      "Emol", "La Tercera", "La Segunda", "El Líbero", "Ex-Ante", "LyD", "CEP", "BioBioChile", "Cooperativa", "24 Horas",
      "T13", "CNN Chile", "Meganoticias", "Diario Financiero", "El Mostrador", "The Clinic", "El Desconcierto",
      "Radio Universidad de Chile", "El Siglo", "El Ciudadano", "El Clarín", "CIPER Chile", "Interferencia",
      "La Voz de los que Sobran", "Revista De Frente", "Werken Rojo", "Resumen.cl", "Piensa Chile", "Mapuexpress",
      "Radio Kurruf", "Fast Check CL", "Mala Espina Check", "Reuters", "AP", "AFP", "Bloomberg", "EFE", "El País",
      "BBC Mundo", "CISA", "SANS ISC", "Microsoft Security", "BleepingComputer", "The Record", "SecurityWeek",
      "The Hacker News", "Dark Reading", "CyberScoop", "Wired Security", "Krebs on Security", "404 Media",
      "Risky Business News", "Schneier on Security", "DataBreaches.net", "Google Project Zero", "Cisco Talos", "Unit 42",
      "Securelist", "WeLiveSecurity", "WeLiveSecurity ES", "Segu-Info", "DiarioTI", "CSIRT Chile", "ANCI", "OpenAI",
      "Anthropic", "Google", "Meta", "xAI", "Mistral", "DeepSeek", "Qwen", "arXiv", "The Verge", "Ars Technica",
      "TechCrunch", "The Information", "Hugging Face", "GitHub",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("matched by longest domain suffix, then by name", () => {
    expect(matchOutlet(outlets, { outlet: "x", url: "https://www.emol.com/noticias/a" })?.slug).toBe("emol");
    expect(matchOutlet(outlets, { outlet: "x", url: "https://unit42.paloaltonetworks.com/a" })?.slug).toBe("unit-42");
    expect(matchOutlet(outlets, { outlet: "x", url: "http://blog.segu-info.com.ar/a" })?.slug).toBe("segu-info");
    expect(matchOutlet(outlets, { outlet: "Radio U. de Chile", url: "https://example.org/" })?.slug).toBe("radio-uchile");
    expect(matchOutlet(outlets, { outlet: "Nobody", url: "https://example.org/" })).toBeUndefined();
    expect(matchOutlet(outlets, { outlet: "x", url: "https://notemol.com/" })).toBeUndefined();
  });

  test("bad config is rejected", () => {
    const bad = { outlets: [{ slug: "x", name: "X", domains: ["x.cl"], feeds: ["chile"], group: { chile: "press" } }] };
    expect(() => parseOutletsFile(bad)).toThrow(/unknown group press for feed chile/);
    expect(() => parseStackFile({ software: [{ slug: "x", name: "X", aliases: ["x"], exclude: ["("] }] })).toThrow(
      /valid regular expression/,
    );
  });
});

describe("stack matching", () => {
  const m = (text: string) => matchStack(stack, text);
  const cases: [string, string[]][] = [
    ["Bun 1.3.2 fixes a path traversal in the bundler", ["bun"]],
    ["Bun has shipped the eMudhra fix", ["bun"]],
    ["the JavaScript runtime Bun patched it", ["bun"]],
    ["a bundle of fixes for the bun maker", []],
    ["Bun Bo Hue restaurant chain breached", []],
    ["The company's homepage was defaced", []],
    ["Homepage, the self-hosted dashboard, patched an XSS", ["homepage"]],
    ["gethomepage v1.2 released", ["homepage"]],
    ["sudo vulnerability CVE-2025-32463 allows local root", ["sudo"]],
    ["Run sudo apt upgrade ca-certificates to patch the flaw", []],
    ["sudo-rs fixes a privilege bug", ["sudo"]],
    ["Microsoft MCP certification exam updated", []],
    ["Malicious MCP servers steal tokens from AI agents", ["mcp"]],
    ["Model Context Protocol spec update", ["mcp"]],
    ["Research & threat intel roundup from Intel 471", []],
    ["Intel CPU microcode update fixes a speculative bug", ["intel"]],
    ["Hacker hijacks 10% of Tor exit nodes", []],
    ["A node in the botnet relays traffic", []],
    ["Node 22.23.4 fixes a Brotli RCE", ["node"]],
    ["pnpm lockfile bug", []],
    ["Malicious npm packages steal secrets", ["node"]],
    ["Stolen data was sold on Telegram channels", []],
    ["Telegram for Android fixes a zero-click flaw", ["telegram", "android"]],
    ["Golf caddy app leaks data", []],
    ["Caddy 2.10 fixes a reverse-proxy bug", ["caddy"]],
    ["Cloudflare reports early exploitation attempts", []],
    ["Cloudflare DNS outage hits resolvers", ["cloudflare"]],
    ["Model weights are on GitHub", []],
    ["GitHub tokens leaked in Actions logs", ["github"]],
    ["Obsidian plugin vulnerability exposes vaults", ["obsidian"]],
    ["obsidian-black ransomware gang", []],
    ["Hijacked Tor exit relays stole SSH password logins", ["openssh"]],
    ["Dell earnings beat estimates", []],
    ["Dell BIOS flaw on OptiPlex desktops", ["dell"]],
  ];
  for (const [text, expected] of cases) {
    test(`${JSON.stringify(text)} -> ${expected.join(", ") || "nothing"}`, () => {
      expect(m(text).sort()).toEqual([...expected].sort());
    });
  }
});

describe("derived tags", () => {
  const kev = new Set(["CVE-2026-96652", "CVE-2026-96654", "CVE-2026-96655", "CVE-2026-96656", "CVE-2026-106931"]);
  const ctx = (feed: "chile" | "cyber" | "ai"): DeriveContext => ({ feed, outlets, stack, isKev: (c) => kev.has(c) });

  test("cyber: outlets, CVEs, KEV, stack, blindspot", () => {
    const e = edition("cyber");
    const by = (slug: string) => {
      const s = e.stories.find((x) => x.slug === slug)!;
      return deriveTags(s, ctx("cyber"));
    };
    const php = by("php2shell-emergency-patches");
    expect(php.tags).toContain("outlet:cisa");
    expect(php.tags).toContain("outlet:krebs-on-security");
    expect(php.tags).toContain("outlet:php-net");
    expect(php.tags).toContain("cve:cve-2026-109618");
    expect(php.tags).toContain("cve:cve-2026-109619");
    expect(php.tags).not.toContain("kev:yes");
    expect(php.tags.filter((t) => t.startsWith("stack:"))).toEqual([]);
    expect(php.sources[0]).toMatchObject({ outlet_slug: "cisa", group: "gov_vendor" });
    expect(php.sources[1]).toMatchObject({ outlet_slug: "php-net", group: null, lean: null });

    const plex = by("plex2shell-exploited-kev");
    expect(plex.cves).toEqual(["CVE-2026-96652", "CVE-2026-96654", "CVE-2026-96655", "CVE-2026-96656"]);
    expect(plex.tags).toContain("kev:yes");
    expect(plex.tags).toContain("blindspot:research");

    expect(by("emudhra-ca-keys-computable").tags).toEqual(expect.arrayContaining(["stack:chrome", "stack:python"]));
    expect(by("ubuntu-ca-certificates-emsign").tags).toContain("stack:ubuntu");
    expect(by("nodejs-october-security-releases").tags).toEqual(
      expect.arrayContaining(["stack:node", "cve:cve-2026-111497"]),
    );
    expect(by("tor-exit-relays-steal-ssh-logins").tags).toContain("stack:openssh");
    expect(by("tor-exit-nodes-hijacked").tags.filter((t) => t.startsWith("stack:"))).toEqual([]);
    expect(by("pan-os-cve-2026-0257-exploited").tags).toContain("cve:cve-2026-0257");
  });

  test("chile: lean groups, blindspot and update", () => {
    const e = edition("chile");
    const afp = deriveTags(e.stories.find((s) => s.slug === "afp-fondo-e-sanctions")!, ctx("chile"));
    expect(afp.tags).toEqual(["outlet:el-pais", "outlet:ex-ante", "update"]);
    expect(afp.sources.map((s) => s.group)).toEqual(["foreign", "right"]);
    const quiroz = deriveTags(e.stories.find((s) => s.slug === "quiroz-welfare-states-francia")!, ctx("chile"));
    expect(quiroz.tags).toEqual(["outlet:la-tercera", "outlet:biobiochile", "blindspot:left"]);
  });

  test("derived tags are valid tags and never duplicated", () => {
    for (const feed of ["chile", "cyber", "ai"] as const) {
      for (const s of edition(feed).stories) {
        const d = deriveTags(s, ctx(feed));
        expect(new Set(d.tags).size).toBe(d.tags.length);
        for (const t of d.tags) expect(t).toMatch(/^[a-z]+(?::[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
      }
    }
  });
});
