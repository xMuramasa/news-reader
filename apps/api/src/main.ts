// news-api entrypoint: one process, two listeners (ingest on INGEST_PORT, public on PUBLIC_PORT).
import { MongoClient } from "mongodb";
import { createApp, startServers } from "./app.ts";
import { ConfigError, loadConfig, loadReferenceData } from "./config.ts";
import { ensureSchema, collections } from "./db.ts";
import { typesafeClassifier } from "./jev.ts";
import { KevService, defaultKevFetcher } from "./kev.ts";
import { jsonLogger as log } from "./log.ts";

async function main(): Promise<void> {
  let config;
  let reference;
  try {
    config = loadConfig(process.env);
    reference = loadReferenceData(config.configDir);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `startup failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 10_000, appName: "news-api" });
  await client.connect();
  const db = client.db(config.mongoDb);
  await ensureSchema(db);

  const kev = new KevService({
    cols: collections(db),
    url: config.kevUrl,
    refreshHours: config.kevRefreshHours,
    fetcher: defaultKevFetcher,
    log,
  });
  await kev.start();

  const app = createApp({
    db,
    ingestToken: config.ingestToken,
    publicOrigin: config.publicOrigin,
    reference,
    kev,
    log,
    jev: config.jev
      ? typesafeClassifier({ apiKey: config.jev.apiKey, url: config.jev.url, model: config.jev.model, threshold: config.jev.threshold })
      : null,
  });
  const servers = startServers(app, config);
  log.info("news-api listening", {
    ingest: `${config.ingestHost}:${servers.ingest.port}`,
    public: `${config.publicHost}:${servers.public.port}`,
    jev: config.jev ? { model: config.jev.model, threshold: config.jev.threshold } : "off",
  });

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    kev.stop();
    await servers.stop();
    await client.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(`startup failed: ${(err as Error).message}`);
  process.exit(1);
});
