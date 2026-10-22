import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseOutletsFile, parseStackFile } from "../src/index.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");
export const FIXTURES = join(ROOT, "test", "fixtures", "editions");

export function fixture<T = Record<string, any>>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export interface InvalidCase {
  error: string;
  layer: "schema" | "ingest";
}

export function invalidCases(): [string, InvalidCase][] {
  const manifest = fixture<Record<string, InvalidCase>>("invalid.cases.json");
  const files = readdirSync(FIXTURES).filter((f) => f.startsWith("invalid.") && f !== "invalid.cases.json");
  for (const f of files) if (!manifest[f]) throw new Error(`${f} is missing from invalid.cases.json`);
  return Object.entries(manifest);
}

export const outletsConfig = () => parseOutletsFile(JSON.parse(readFileSync(join(ROOT, "config", "outlets.json"), "utf8")));
export const stackConfig = () => parseStackFile(JSON.parse(readFileSync(join(ROOT, "config", "stack.json"), "utf8")));
