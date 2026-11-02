// WCAG contrast of the theme tokens in index.css: every text colour against every surface it is used on.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const css = await Bun.file(join(import.meta.dir, "..", "..", "src", "index.css")).text();

function themeVars(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i === -1) throw new Error(`no ${selector} block`);
  const block = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) vars[m[1]!] = m[2]!.toLowerCase();
  return vars;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const THEMES = {
  endfield: '[data-theme="endfield"]',
  light: '[data-theme="light"]',
  dark: '[data-theme="dark"]',
  sepia: '[data-theme="sepia"]',
};
const SURFACES = ["bg", "card", "muted"];
const TEXT = ["fg", "muted-fg", "chile", "chile-blue", "cyber", "ai", "ok", "bad", "alert", "chip-update"];
// Graphics (coverage segments, strips) need 3:1 (WCAG 1.4.11).
const GRAPHICS = ["g-right", "g-center", "g-left", "g-independent", "g-foreign", "g-gov_vendor", "g-press", "g-research", "g-lab", "border-strong"];
// Feed marks are drawn on cards; the cyber mark is always drawn with an ink (fg) outline, so that outline is what must read.
const FEED_MARKS = ["chile-mark", "ai-mark"];
const CHIPS = ["danger", "stack", "warn", "cve", "blind", "patched", "plain"];
const TOKENS = [
  ...["chrome", "on-chrome", "on-chrome-muted", "chrome-field", "mark", "on-mark", "raised", "sunken", "rule", "outline"],
  ...["chile-mark", "cyber-mark", "ai-mark", "alert", "chip-update"],
  ...CHIPS.flatMap((c) => [`chip-${c}`, `chip-${c}-fg`]),
];

describe.each(Object.entries(THEMES))("%s theme", (_name, selector) => {
  const v = themeVars(selector);

  test.each(TEXT.flatMap((t) => SURFACES.map((s) => [t, s] as const)))("text %s on %s ≥ 4.5:1", (t, s) => {
    expect(contrast(v[t]!, v[s]!)).toBeGreaterThanOrEqual(4.5);
  });

  test.each([
    ["warn-fg", "warn-bg"],
    ["danger-fg", "danger-bg"],
    ["info-fg", "info-bg"],
    ["on-accent", "chile"],
    ["on-accent", "cyber"],
    ["on-accent", "ai"],
    ["bg", "fg"],
  ] as const)("%s on %s ≥ 4.5:1", (a, b) => {
    expect(contrast(v[a]!, v[b]!)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(GRAPHICS)("graphic %s on card ≥ 3:1", (g) => {
    expect(contrast(v[g]!, v.card!)).toBeGreaterThanOrEqual(3);
  });

  test.each(TOKENS)("token contract: --%s is defined", (t) => {
    expect(v[t]).toMatch(/^#[0-9a-f]{6}$/);
  });

  test.each([...CHIPS.map((c) => [`chip-${c}-fg`, `chip-${c}`] as const), ["on-chrome", "chrome"], ["on-chrome-muted", "chrome"], ["on-mark", "mark"]] as const)(
    "%s on %s ≥ 4.5:1",
    (a, b) => {
      expect(contrast(v[a]!, v[b]!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(FEED_MARKS)("feed mark %s on card ≥ 3:1", (m) => {
    expect(contrast(v[m]!, v.card!)).toBeGreaterThanOrEqual(3);
  });

  test("the cyber mark's ink outline (fg) on card ≥ 3:1", () => {
    expect(contrast(v.fg!, v.card!)).toBeGreaterThanOrEqual(3);
  });

  test("raised is the card colour", () => {
    expect(v.raised).toBe(v.card!);
  });
});
