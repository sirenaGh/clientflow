import { spawnSync } from "node:child_process";
import { testEnv } from "./test-env.mjs";
const r = spawnSync(
  process.execPath,
  [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "server/test/integration.test.ts",
    "server/test/ownership.test.ts",
    "server/test/demo.test.ts",
    "server/test/public-limits.test.ts",
    "server/test/deployment.test.ts",
  ],
  { env: testEnv(), stdio: "inherit" },
);
if (r.error) throw r.error;
process.exit(r.status ?? 1);
