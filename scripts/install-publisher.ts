// Copies publisher/news_publisher.py to ~/.hermes/scripts/news_publisher.py. Hermes only runs scripts that live in
// that folder (symlinks are refused), so this is a real copy. Run it by hand after reviewing a change.
import { chmodSync, copyFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const src = join(import.meta.dir, "..", "publisher", "news_publisher.py");
const dir = join(homedir(), ".hermes", "scripts");
const dest = join(dir, "news_publisher.py");
const tmp = `${dest}.tmp-${process.pid}`;

mkdirSync(dir, { recursive: true, mode: 0o700 });
copyFileSync(src, tmp);
chmodSync(tmp, 0o700);
renameSync(tmp, dest);
console.log(`installed ${dest}`);
