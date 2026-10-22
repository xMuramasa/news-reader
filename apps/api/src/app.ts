import type { Db } from "mongodb";
import { LIMITS } from "@news/schema";
import { collections, type Collections } from "./db.ts";
import { router, type Route } from "./http.ts";
import { ingestHandler, type IngestStep } from "./ingest.ts";
import type { KevService } from "./kev.ts";
import type { Logger } from "./log.ts";
import { healthHandler, publicRoutes } from "./public.ts";
import type { ReferenceData } from "./config.ts";

export interface AppOptions {
  db: Db;
  ingestToken: string;
  publicOrigin: string;
  reference: ReferenceData;
  kev: KevService;
  log: Logger;
  now?: () => Date;
  /** Test hook: called after each ingest write step (throw to simulate a crash). */
  afterIngestStep?: (step: IngestStep, editionId: string) => void | Promise<void>;
}

export interface App {
  cols: Collections;
  ingest: (req: Request) => Promise<Response>;
  public: (req: Request) => Promise<Response>;
}

export function createApp(o: AppOptions): App {
  const cols = collections(o.db);
  const now = o.now ?? (() => new Date());
  const ping = async () => {
    await o.db.command({ ping: 1 }, { timeoutMS: 2000 });
  };
  const kevStatus = () => ({ cves: o.kev.size, fetched_at: o.kev.lastFetched?.toISOString() ?? null });

  const ingestRoutes: Route[] = [
    {
      pattern: /^\/ingest\/editions$/,
      methods: {
        POST: ingestHandler(
          {
            cols,
            outlets: o.reference.outlets,
            stack: o.reference.stack,
            isKev: (c) => o.kev.has(c),
            now,
            ...(o.afterIngestStep ? { afterStep: o.afterIngestStep } : {}),
          },
          o.ingestToken,
        ),
      },
    },
    { pattern: /^\/healthz$/, methods: { GET: healthHandler({ ping, kevStatus }) } },
  ];

  return {
    cols,
    ingest: router(ingestRoutes, o.log),
    public: router(publicRoutes({ cols, publicOrigin: o.publicOrigin, now, ping, kevStatus }), o.log),
  };
}

export interface Listen {
  ingestHost: string;
  ingestPort: number;
  publicHost: string;
  publicPort: number;
}

export interface Servers {
  ingest: ReturnType<typeof Bun.serve>;
  public: ReturnType<typeof Bun.serve>;
  stop(): Promise<void>;
}

export function startServers(app: App, l: Listen): Servers {
  const ingest = Bun.serve({
    hostname: l.ingestHost,
    port: l.ingestPort,
    // Our own limit (1 MB, checked by header and by bytes read) answers 413; this is only a hard ceiling.
    maxRequestBodySize: LIMITS.bodyBytes * 2,
    fetch: app.ingest,
  });
  const pub = Bun.serve({
    hostname: l.publicHost,
    port: l.publicPort,
    maxRequestBodySize: 64 * 1024,
    fetch: app.public,
  });
  return {
    ingest,
    public: pub,
    async stop() {
      await Promise.all([ingest.stop(true), pub.stop(true)]);
    },
  };
}
