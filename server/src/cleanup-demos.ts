import { cleanupExpiredDemos } from "./demo.js";
import { db } from "./db.js";

try {
  const removed = await cleanupExpiredDemos();
  console.log(`Expired demo workspaces removed: ${removed}`);
} catch {
  console.error(
    "Demo cleanup failed; no normal team data is selected by this command.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
