import { cleanupExpiredDemos } from "./demo.js";
import { db } from "./db.js";

try {
  const removed = await cleanupExpiredDemos();
  await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await db.publicRateBucket.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  console.log(`Expired demo workspaces removed: ${removed}`);
} catch {
  console.error(
    "Demo cleanup failed; no normal team data is selected by this command.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
