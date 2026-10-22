// Throwaway mongo:9.0.4 for tests: random name, random 127.0.0.1 port, data on tmpfs, removed in teardown even when
// tests fail (plus an exit hook, plus a 15-minute self-destruct timer inside the container as a last resort).
// No Docker means the tests fail loudly; they are never skipped.
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";

export const MONGO_IMAGE = "mongo:9.0.4";
const SELF_DESTRUCT_SECONDS = 900;

export interface TestMongo {
  name: string;
  url: string;
  stop(): void;
}

function docker(args: string[]): { ok: boolean; out: string; err: string } {
  const p = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

const running = new Set<string>();
let hooked = false;
function removeAll(): void {
  for (const name of running) docker(["rm", "-f", "-v", name]);
  running.clear();
}

export async function startMongo(): Promise<TestMongo> {
  const probe = docker(["version", "--format", "{{.Server.Version}}"]);
  if (!probe.ok) throw new Error(`Docker is required for the API tests and is not available: ${probe.err || probe.out}`);
  const image = docker(["image", "inspect", "--format", "{{.Id}}", MONGO_IMAGE]);
  if (!image.ok) throw new Error(`image ${MONGO_IMAGE} is not available locally (tests never pull): ${image.err}`);

  const name = `news-reader-test-${randomBytes(6).toString("hex")}`;
  if (!hooked) {
    hooked = true;
    process.on("exit", removeAll);
  }
  running.add(name);
  const run = docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--label",
    "news-reader-test=1",
    "--publish",
    "127.0.0.1::27017",
    "--tmpfs",
    // A cap, not an allocation: mongod refuses writes with less than 500 MB free on its dbpath.
    "/data/db:rw,size=1g",
    "--tmpfs",
    "/data/configdb:rw,size=16m",
    "--entrypoint",
    "timeout",
    MONGO_IMAGE,
    String(SELF_DESTRUCT_SECONDS),
    "docker-entrypoint.sh",
    "mongod",
    "--bind_ip_all",
    "--wiredTigerCacheSizeGB",
    "0.25",
  ]);
  const stop = () => {
    docker(["rm", "-f", "-v", name]);
    running.delete(name);
  };
  if (!run.ok) {
    stop();
    throw new Error(`could not start ${MONGO_IMAGE}: ${run.err}`);
  }
  try {
    const port = docker(["port", name, "27017/tcp"]);
    const m = /127\.0\.0\.1:(\d+)/.exec(port.out);
    if (!m) throw new Error(`no published port for ${name}: ${port.out} ${port.err}`);
    const url = `mongodb://127.0.0.1:${m[1]}/?directConnection=true`;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const client = new MongoClient(url, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000 });
      try {
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        break;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`mongo did not become ready: ${(err as Error).message}`);
        await Bun.sleep(250);
      } finally {
        await client.close().catch(() => {});
      }
    }
    return { name, url, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
