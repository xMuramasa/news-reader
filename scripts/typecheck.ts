// Type-check the root scripts and every workspace that has a tsconfig.json (apps/ui joins automatically once it exists).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const projects = ["."];
for (const dir of ["packages", "apps"]) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base).sort()) {
    if (existsSync(join(base, name, "tsconfig.json"))) projects.push(join(dir, name));
  }
}

let failed = false;
for (const p of projects) {
  const proc = Bun.spawnSync(["bunx", "tsc", "-p", join(p, "tsconfig.json"), "--noEmit"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  console.log(`${proc.exitCode === 0 ? "ok  " : "FAIL"} ${p}`);
  if (proc.exitCode !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
