import { describe, expect, test } from "bun:test";
import { rowTags } from "../../src/lib/tags.ts";

const labels = (tags: string[], feed = "cyber", max?: number) => rowTags(tags, feed, max).map((t) => `${t.kind}:${t.label}`);

// Real tag lists from the 31 Oct and 1 Nov editions (outlet:* trimmed to one: it never shows).
const EXAMPLES: { name: string; feed: string; tags: string[]; expected: string[] }[] = [
  {
    name: "KEV + three CVEs + patched + org",
    feed: "cyber",
    tags: "topic:vulnerability topic:exploited status:exploited status:patched region:global org:ivanti org:cisa org:volexity outlet:cisa cve:cve-2026-111357 cve:cve-2026-118527 cve:cve-2026-104935 kev:yes".split(" "),
    expected: ["danger:KEV EXPLOITED", "cve:CVE-2026-111357 +2", "patched:PATCHED", "plain:IVANTI"],
  },
  {
    name: "stack, CVEs and update push patched out",
    feed: "cyber",
    tags: "topic:vulnerability topic:exploited status:exploited status:patched region:global org:palo-alto-networks org:php outlet:x cve:cve-2026-109618 cve:cve-2026-109619 cve:cve-2026-46300 kev:yes stack:linux-kernel update".split(" "),
    expected: ["danger:KEV EXPLOITED", "stack:LINUX KERNEL", "cve:CVE-2026-109618 +2", "update:UPDATE"],
  },
  {
    name: "one CVE",
    feed: "cyber",
    tags: "topic:vulnerability topic:exploited status:exploited status:patched region:global org:cisco org:cisa outlet:cisco cve:cve-2026-76418 kev:yes".split(" "),
    expected: ["danger:KEV EXPLOITED", "cve:CVE-2026-76418", "patched:PATCHED", "plain:CISCO"],
  },
  {
    name: "status:exploited without KEV",
    feed: "cyber",
    tags: "topic:vulnerability topic:exploited status:exploited status:patched region:global org:drupal outlet:drupal-org cve:cve-2026-118539".split(" "),
    expected: ["danger:EXPLOITED", "cve:CVE-2026-118539", "patched:PATCHED", "plain:DRUPAL"],
  },
  {
    name: "topics then orgs, global region hidden",
    feed: "cyber",
    tags: "topic:apt region:global org:binance org:trm-labs org:chainalysis outlet:wired".split(" "),
    expected: ["plain:APT", "plain:BINANCE", "plain:TRM LABS", "plain:CHAINALYSIS"],
  },
  {
    name: "multi-word topic",
    feed: "cyber",
    tags: "topic:ai-security region:global org:crowdstrike outlet:crowdstrike".split(" "),
    expected: ["plain:AI SECURITY", "plain:CROWDSTRIKE"],
  },
  {
    name: "two topics in stored order",
    feed: "cyber",
    tags: "topic:privacy topic:supply-chain region:global org:trezor org:ledger org:cryptobilis".split(" "),
    expected: ["plain:PRIVACY", "plain:SUPPLY CHAIN", "plain:TREZOR", "plain:LEDGER"],
  },
  {
    name: "a foreign region shows",
    feed: "cyber",
    tags: "topic:data-breach topic:privacy region:us org:florida-department-of-education outlet:the-record".split(" "),
    expected: ["plain:DATA BREACH", "plain:PRIVACY", "plain:US", "plain:FLORIDA DEPARTMENT OF EDUCATION"],
  },
  {
    name: "patched alone is hidden",
    feed: "cyber",
    tags: "topic:vulnerability status:patched region:global org:wordpress outlet:x".split(" "),
    expected: ["plain:VULNERABILITY", "plain:WORDPRESS"],
  },
  {
    name: "stack with +N, CVE hides topic:vulnerability",
    feed: "cyber",
    tags: "topic:vulnerability topic:research region:global org:canonical org:anthropic cve:cve-2026-98432 stack:ubuntu stack:caddy stack:adguard-home stack:syncthing stack:dozzle stack:backrest stack:beszel stack:dell".split(" "),
    expected: ["stack:UBUNTU +7", "cve:CVE-2026-98432", "plain:RESEARCH", "plain:CANONICAL"],
  },
  {
    name: "single stack",
    feed: "cyber",
    tags: "topic:vulnerability region:global org:tianocore cve:cve-2026-97631 stack:dell".split(" "),
    expected: ["stack:DELL", "cve:CVE-2026-97631", "plain:TIANOCORE"],
  },
  {
    name: "stack without CVE keeps topics",
    feed: "cyber",
    tags: "topic:supply-chain topic:malware region:global org:anthropic org:cursor stack:openssh stack:node stack:claude-code stack:macos".split(" "),
    expected: ["stack:OPENSSH +3", "plain:SUPPLY CHAIN", "plain:MALWARE", "plain:ANTHROPIC"],
  },
  {
    name: "update first among plain, Chile home region hidden",
    feed: "chile",
    tags: "topic:politics topic:government topic:courts region:chile org:ministerio-de-justicia update".split(" "),
    expected: ["update:UPDATE", "plain:POLITICS", "plain:GOVERNMENT", "plain:COURTS"],
  },
  {
    name: "Chile: region:us shows, region:chile does not",
    feed: "chile",
    tags: "topic:markets region:chile region:us org:sqm".split(" "),
    expected: ["plain:MARKETS", "plain:US", "plain:SQM"],
  },
  {
    name: "blindspot",
    feed: "chile",
    tags: "topic:security-crime region:chile org:ministerio-publico org:carabineros-de-chile blindspot:independent".split(" "),
    expected: ["blind:BLINDSPOT INDEPENDENT", "plain:SECURITY CRIME", "plain:MINISTERIO PUBLICO", "plain:CARABINEROS DE CHILE"],
  },
  {
    name: "stack before blindspot",
    feed: "ai",
    tags: "topic:product topic:agents region:global org:google stack:android blindspot:press".split(" "),
    expected: ["stack:ANDROID", "blind:BLINDSPOT PRESS", "plain:PRODUCT", "plain:AGENTS"],
  },
  {
    name: "no patch, then PoC, in that order",
    feed: "cyber",
    tags: "topic:vulnerability topic:exploited status:exploited status:poc-public status:no-patch region:global cve:cve-2026-1 outlet:x".split(" "),
    expected: ["danger:EXPLOITED", "warn:NO PATCH", "warn:POC PUBLIC", "cve:CVE-2026-1"],
  },
];

describe("rowTags examples", () => {
  test.each(EXAMPLES)("$name", ({ tags, feed, expected }) => {
    expect(labels(tags, feed)).toEqual(expected);
  });
});

describe("rowTags rules", () => {
  test("kev:yes wins over status:exploited, one danger chip", () => {
    expect(labels(["status:exploited", "kev:yes"])).toEqual(["danger:KEV EXPLOITED"]);
  });

  test("merged chips carry the first tag and the count", () => {
    const [stack, cve] = rowTags(["cve:cve-2026-1", "cve:cve-2026-2", "stack:a-b", "stack:c"], "cyber");
    expect(stack).toEqual({ tag: "stack:a-b", kind: "stack", label: "A B +1", more: 1 });
    expect(cve).toEqual({ tag: "cve:cve-2026-1", kind: "cve", label: "CVE-2026-1 +1", more: 1 });
    expect(rowTags(["stack:x"], "cyber")[0]).not.toHaveProperty("more");
  });

  test("blindspot groups join into one chip", () => {
    const [b] = rowTags(["blindspot:center", "blindspot:left"], "chile");
    expect(b).toEqual({ tag: "blindspot:center", kind: "blind", label: "BLINDSPOT CENTER · LEFT" });
  });

  test("patched needs an exploited or CVE tag; topic:exploited hides only next to the exploited chip", () => {
    expect(labels(["status:patched"])).toEqual([]);
    expect(labels(["status:patched", "cve:cve-2026-5"])).toEqual(["cve:CVE-2026-5", "patched:PATCHED"]);
    expect(labels(["topic:exploited", "topic:vulnerability"])).toEqual(["plain:EXPLOITED", "plain:VULNERABILITY"]);
  });

  test("outlet tags never show; max caps the list; empty in, empty out", () => {
    expect(labels(["outlet:cisa", "outlet:x"])).toEqual([]);
    expect(labels(["topic:a", "topic:b", "topic:c"], "cyber", 2)).toEqual(["plain:A", "plain:B"]);
    expect(rowTags([], "ai")).toEqual([]);
  });

  test("region:chile shows on the other feeds", () => {
    expect(labels(["region:chile"], "cyber")).toEqual(["plain:CHILE"]);
    expect(labels(["region:chile"], "chile")).toEqual([]);
  });
});
