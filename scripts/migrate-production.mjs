import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function migrateProduction() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await new Promise((resolveJob, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--config",
        resolve(root, "server/prisma.config.ts"),
      ],
      { cwd: root, env: process.env, stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Migration timed out; server was not started"));
    }, 120000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Migration process could not start"));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveJob();
      else
        reject(
          new Error(
            "Migration failed; server was not started. Check database access, TLS certificate and migration status using your local administration environment.",
          ),
        );
    });
  });
  console.log("Committed database migrations applied successfully.");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await migrateProduction();
  } catch {
    console.error("Production migration failed. No reset or seed was run.");
    process.exitCode = 1;
  }
}
