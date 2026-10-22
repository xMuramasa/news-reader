import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildOutletIndex,
  compileStack,
  parseOutletsFile,
  parseStackFile,
  type OutletIndex,
  type StackMatcher,
} from "@news/schema";

export interface Config {
  mongoUrl: string;
  mongoDb: string;
  ingestToken: string;
  ingestHost: string;
  ingestPort: number;
  publicHost: string;
  publicPort: number;
  publicOrigin: string;
  kevUrl: string;
  kevRefreshHours: number;
  configDir: string;
}

export const DEFAULT_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const DEFAULT_CONFIG_DIR = resolve(import.meta.dir, "..", "..", "..", "config");

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

type Env = Record<string, string | undefined>;

/** Parse the environment, collecting every problem before failing. Secrets never appear in messages. */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const get = (k: string) => {
    const v = env[k];
    return v === undefined || v.trim() === "" ? undefined : v.trim();
  };
  const port = (k: string, dflt: number): number => {
    const raw = get(k);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > 65535) problems.push(`${k} must be a port number 1-65535`);
    return n;
  };
  const host = (k: string, dflt: string): string => {
    const v = get(k) ?? dflt;
    if (!/^[A-Za-z0-9.:\-[\]]+$/.test(v)) problems.push(`${k} must be a host name or IP address`);
    return v;
  };

  const mongoUrl = get("MONGO_URL") ?? "";
  if (!mongoUrl) problems.push("MONGO_URL is required");
  else if (!/^mongodb(\+srv)?:\/\//.test(mongoUrl)) problems.push("MONGO_URL must start with mongodb:// or mongodb+srv://");

  const mongoDb = get("MONGO_DB") ?? "news";
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(mongoDb)) problems.push("MONGO_DB must be 1-63 letters, digits, _ or -");

  const ingestToken = env.INGEST_TOKEN ?? "";
  if (!ingestToken) problems.push("INGEST_TOKEN is required");
  else if (ingestToken.length < 32) problems.push("INGEST_TOKEN must be at least 32 characters");
  else if (/\s/.test(ingestToken)) problems.push("INGEST_TOKEN must not contain whitespace");

  const ingestHost = host("INGEST_HOST", "0.0.0.0");
  const ingestPort = port("INGEST_PORT", 8787);
  const publicHost = host("PUBLIC_HOST", "0.0.0.0");
  const publicPort = port("PUBLIC_PORT", 8080);
  if (ingestPort === publicPort) problems.push("INGEST_PORT and PUBLIC_PORT must differ");

  const publicOrigin = get("PUBLIC_ORIGIN") ?? "https://news.lab.x-muramasa.dev";
  try {
    const u = new URL(publicOrigin);
    if (!/^https?:$/.test(u.protocol) || u.origin !== publicOrigin) throw new Error();
  } catch {
    problems.push("PUBLIC_ORIGIN must be an origin like https://news.example.org (scheme and host, no path)");
  }

  const kevUrl = get("KEV_URL") ?? DEFAULT_KEV_URL;
  try {
    if (!/^https?:$/.test(new URL(kevUrl).protocol)) throw new Error();
  } catch {
    problems.push("KEV_URL must be an http(s) URL");
  }

  const kevRaw = get("KEV_REFRESH_HOURS") ?? "24";
  const kevRefreshHours = Number(kevRaw);
  if (!Number.isFinite(kevRefreshHours) || kevRefreshHours < 1 || kevRefreshHours > 720) {
    problems.push("KEV_REFRESH_HOURS must be a number of hours between 1 and 720");
  }

  const configDir = resolve(get("CONFIG_DIR") ?? DEFAULT_CONFIG_DIR);

  if (problems.length) throw new ConfigError(problems);
  return {
    mongoUrl,
    mongoDb,
    ingestToken,
    ingestHost,
    ingestPort,
    publicHost,
    publicPort,
    publicOrigin,
    kevUrl,
    kevRefreshHours,
    configDir,
  };
}

export interface ReferenceData {
  outlets: OutletIndex;
  stack: StackMatcher;
}

/** Load and validate config/outlets.json and config/stack.json. */
export function loadReferenceData(configDir: string): ReferenceData {
  const read = (name: string): unknown => {
    const file = join(configDir, name);
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      throw new ConfigError([`${file}: ${(err as Error).message}`]);
    }
  };
  try {
    return {
      outlets: buildOutletIndex(parseOutletsFile(read("outlets.json"))),
      stack: compileStack(parseStackFile(read("stack.json"))),
    };
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError([(err as Error).message]);
  }
}
