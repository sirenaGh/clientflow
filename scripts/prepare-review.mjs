import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { reviewEnv } from "./review-env.mjs";

const env = reviewEnv();
if (!process.env.REVIEW_DATABASE_URL) {
  const url = new URL(env.DATABASE_URL);
  if (
    !existsSync(".runtime/mysql-ready") ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "3307" ||
    url.username !== "clientflow"
  ) {
    throw new Error(
      "Set REVIEW_DATABASE_URL for a pre-created separate review database, or use the managed local MySQL setup",
    );
  }
  const mysql =
    process.env.MYSQL_BIN || "C:/Program Files/MySQL/MySQL Server 8.0/bin";
  const password = readFileSync(".runtime/mysql-root", "utf8");
  const result = spawnSync(
    mysql + "/mysql.exe",
    [
      "--no-defaults",
      "--protocol=TCP",
      "--host=127.0.0.1",
      "--port=3307",
      "--user=root",
    ],
    {
      env: { ...process.env, MYSQL_PWD: password },
      input:
        "CREATE DATABASE IF NOT EXISTS clientflow_review_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON clientflow_review_test.* TO 'clientflow'@'127.0.0.1';",
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error("Could not provision the separate review database");
}
for (const args of [
  [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--config",
    "server/prisma.config.ts",
  ],
  ["node_modules/tsx/dist/cli.mjs", "server/prisma/seed.ts"],
  ["node_modules/tsx/dist/cli.mjs", "server/prisma/review-fixtures.ts"],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
