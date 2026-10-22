import "./dom-guard.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  applySettings,
  getSettings,
  parseSettings,
  reloadSettings,
  setSettings,
} from "../../src/lib/settings.ts";

const INIT_SCRIPT = await Bun.file(join(import.meta.dir, "..", "..", "public", "theme-init.js")).text();

function runInitScript(): Record<string, string | null> {
  const d = document.documentElement;
  for (const a of ["data-theme", "data-size", "data-font", "data-width"]) d.removeAttribute(a);
  new Function(INIT_SCRIPT)();
  return attrs();
}

function attrs(): Record<string, string | null> {
  const d = document.documentElement;
  return {
    theme: d.getAttribute("data-theme"),
    size: d.getAttribute("data-size"),
    font: d.getAttribute("data-font"),
    width: d.getAttribute("data-width"),
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadSettings();
});

describe("reading settings", () => {
  test("defaults, and garbage falls back field by field", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ theme: "neon", size: "xl", font: 3, width: "wide" }))).toEqual({
      theme: null,
      size: "xl",
      font: "serif",
      width: "wide",
    });
  });

  test("setSettings persists to localStorage and applies to <html>", () => {
    setSettings({ theme: "sepia", size: "l", font: "sans", width: "narrow" });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({ theme: "sepia", size: "l", font: "sans", width: "narrow" });
    expect(attrs()).toEqual({ theme: "sepia", size: "l", font: "sans", width: "narrow" });
  });

  test("survives a reload: the stored theme is read back", () => {
    setSettings({ theme: "dark" });
    localStorage.setItem(SETTINGS_KEY, localStorage.getItem(SETTINGS_KEY)!);
    reloadSettings();
    expect(getSettings().theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test.each([
    null,
    "{}",
    "garbage",
    JSON.stringify({ theme: "dark", size: "s" }),
    JSON.stringify({ theme: "sepia", size: "xl", font: "sans", width: "wide" }),
    JSON.stringify({ theme: "light", size: "huge", width: "narrow" }),
  ])("theme-init.js applies the same attributes as applySettings for %p", (stored) => {
    if (stored === null) localStorage.removeItem(SETTINGS_KEY);
    else localStorage.setItem(SETTINGS_KEY, stored);
    const fromScript = runInitScript();
    applySettings(document.documentElement, parseSettings(stored));
    expect(attrs()).toEqual(fromScript);
    expect(fromScript.theme).not.toBeNull();
  });
});
