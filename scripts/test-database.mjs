import { spawnSync } from "node:child_process";
import { testEnv } from "./test-env.mjs";
const env = testEnv();
for (const args of [
  [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--config",
    "server/prisma.config.ts",
  ],
  ["node_modules/tsx/dist/cli.mjs", "server/src/cleanup-demos.ts"],
  ["node_modules/tsx/dist/cli.mjs", "server/prisma/seed.ts"],
]) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
