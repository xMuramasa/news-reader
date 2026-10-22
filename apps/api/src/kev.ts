// CISA Known Exploited Vulnerabilities: an in-memory set of CVE ids, persisted in `meta` so a restart doesn't need the
// network, refreshed every KEV_REFRESH_HOURS. Refresh failures are logged, never fatal.
import { cveTag } from "@news/schema";
import type { Collections } from "./db.ts";
import type { Logger } from "./log.ts";

export type KevFetcher = (url: string) => Promise<unknown>;

export const defaultKevFetcher: KevFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`KEV download failed: HTTP ${res.status}`);
  return res.json();
};

const META_ID = "kev";
const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;

/** Extract CVE ids from the CISA KEV JSON feed. Throws on anything that doesn't look like it. */
export function parseKevCatalog(body: unknown): { cves: string[]; catalogVersion: string | null } {
  if (!body || typeof body !== "object" || !Array.isArray((body as { vulnerabilities?: unknown }).vulnerabilities)) {
    throw new Error("KEV feed has no vulnerabilities array");
  }
  const b = body as { vulnerabilities: unknown[]; catalogVersion?: unknown };
  const cves = new Set<string>();
  for (const v of b.vulnerabilities) {
    const id = v && typeof v === "object" ? (v as { cveID?: unknown }).cveID : undefined;
    if (typeof id === "string" && CVE_ID.test(id.trim().toUpperCase())) cves.add(id.trim().toUpperCase());
  }
  if (cves.size === 0) throw new Error("KEV feed contains no CVE ids");
  return { cves: [...cves].sort(), catalogVersion: typeof b.catalogVersion === "string" ? b.catalogVersion : null };
}

export interface KevOptions {
  cols: Collections;
  url: string;
  refreshHours: number;
  fetcher: KevFetcher;
  log: Logger;
  now?: () => Date;
}

export class KevService {
  private set = new Set<string>();
  private fetchedAt: Date | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<boolean> | null = null;

  constructor(private readonly opts: KevOptions) {}

  has(cve: string): boolean {
    return this.set.has(cve.toUpperCase());
  }

  get size(): number {
    return this.set.size;
  }

  get lastFetched(): Date | null {
    return this.fetchedAt;
  }

  /** Load the persisted set. Returns whether a refresh is due. */
  async load(): Promise<boolean> {
    try {
      const doc = await this.opts.cols.meta.findOne({ _id: META_ID });
      if (doc && Array.isArray(doc.cves) && doc.fetched_at instanceof Date) {
        this.set = new Set((doc.cves as unknown[]).filter((c): c is string => typeof c === "string"));
        this.fetchedAt = doc.fetched_at;
      }
    } catch (err) {
      this.opts.log.warn("kev: could not load the cached list", { error: (err as Error).message });
    }
    return this.isStale();
  }

  isStale(): boolean {
    const now = (this.opts.now ?? (() => new Date()))();
    return !this.fetchedAt || now.getTime() - this.fetchedAt.getTime() >= this.opts.refreshHours * 3_600_000;
  }

  /** Download, persist, and tag stories whose CVEs were added. Never throws; returns whether it succeeded. */
  refresh(): Promise<boolean> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<boolean> {
    const { cols, log } = this.opts;
    try {
      const { cves, catalogVersion } = parseKevCatalog(await this.opts.fetcher(this.opts.url));
      const fetchedAt = (this.opts.now ?? (() => new Date()))();
      await cols.meta.replaceOne(
        { _id: META_ID },
        { cves, fetched_at: fetchedAt, catalog_version: catalogVersion, count: cves.length },
        { upsert: true },
      );
      const added = cves.filter((c) => !this.set.has(c));
      this.set = new Set(cves);
      this.fetchedAt = fetchedAt;
      if (added.length) {
        // Stories ingested before their CVE reached the catalog.
        const r = await cols.stories.updateMany(
          { tags: { $in: added.map(cveTag) } },
          { $addToSet: { tags: "kev:yes" } },
        );
        if (r.modifiedCount) log.info("kev: tagged existing stories", { stories: r.modifiedCount });
      }
      log.info("kev: refreshed", { cves: cves.length, catalog_version: catalogVersion });
      return true;
    } catch (err) {
      log.warn("kev: refresh failed, keeping the previous list", { error: (err as Error).message, cves: this.set.size });
      return false;
    }
  }

  /** Load the cache, refresh in the background if stale, then refresh on a timer. */
  async start(): Promise<void> {
    if (await this.load()) void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshHours * 3_600_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
