import "./dom-guard.ts";
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ExternalLink, SourceChips } from "../../src/components/Chips.tsx";
import { displayDomain, nvdUrl, safeUrl } from "../../src/lib/safe-url.ts";

describe("safeUrl", () => {
  test("allows absolute http(s) URLs and normalizes them", () => {
    expect(safeUrl("https://elpais.com/chile/2026-10-20/x.html")).toBe("https://elpais.com/chile/2026-10-20/x.html");
    expect(safeUrl("http://example.org")).toBe("http://example.org/");
    expect(safeUrl("  HTTPS://Example.ORG/a?b=1#c  ")).toBe("https://example.org/a?b=1#c");
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.org/x",
    "mailto:a@example.org",
    "//evil.example/x",
    "/relative/path",
    "example.org/x",
    "https://user:pass@example.org/",
    "https://",
    "https://exa mple.org/",
    "https://example.org/\u0000x",
    "java\nscript:alert(1)",
    "",
  ])("rejects %p", (u) => {
    expect(safeUrl(u)).toBeNull();
  });

  test("rejects non-strings and overlong URLs", () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(42)).toBeNull();
    expect(safeUrl({ href: "https://x.org" })).toBeNull();
    expect(safeUrl(`https://example.org/${"a".repeat(2100)}`)).toBeNull();
  });

  test("displayDomain strips www.", () => {
    expect(displayDomain("https://www.bleepingcomputer.com/news")).toBe("bleepingcomputer.com");
    expect(displayDomain("not a url")).toBe("");
  });

  test("nvdUrl links CVE ids only", () => {
    expect(nvdUrl("cve-2026-12345")).toBe("https://nvd.nist.gov/vuln/detail/CVE-2026-12345");
    expect(nvdUrl("CVE-2026-1")).toBeNull();
    expect(nvdUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("links built from briefing content", () => {
  test("an unsafe source renders as plain text, a safe one opens in a new tab", () => {
    const { container, getByText } = render(
      <SourceChips
        sources={[
          { outlet: "Evil", url: "javascript:alert(1)" },
          { outlet: "Good", url: "https://www.example.org/story" },
        ]}
      />,
    );
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(1);
    const a = links[0]!;
    expect(a.getAttribute("href")).toBe("https://www.example.org/story");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toContain("example.org");
    expect(getByText("Evil").closest("a")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
  });

  test("ExternalLink falls back to text", () => {
    const { container } = render(<ExternalLink href="data:text/html,hi">label</ExternalLink>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("label");
  });
});
