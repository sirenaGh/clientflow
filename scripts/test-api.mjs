import { spawn } from "node:child_process";
import { testEnv } from "./test-env.mjs";
const c = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/src/index.ts"],
  { env: testEnv(), stdio: "inherit" },
);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => c.kill(s));
c.on("exit", (code) => process.exit(code || 0));
