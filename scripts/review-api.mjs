import { spawn } from "node:child_process";
import { reviewEnv } from "./review-env.mjs";

const child = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/src/index.ts"],
  { env: reviewEnv(), stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
