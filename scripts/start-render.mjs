import { migrateProduction } from "./migrate-production.mjs";
try {
  await migrateProduction();
  await import("../server/dist/src/index.js");
} catch {
  console.error(
    "Application startup failed. Check database, TLS, migrations and required configuration. No reset or seed was run.",
  );
  process.exitCode = 1;
}
