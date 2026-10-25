import { db } from "./db.js";
import { cleanupExpiredDemos } from "./demo.js";

// One batch at a time per process; the owner-row locks also cover other processes.
let running: Promise<void> | undefined;
export function runMaintenance() {
  if (running) return running;
  running = (async () => {
    await cleanupExpiredDemos(new Date(), db, 10);
    const now = new Date();
    const sessions = await db.session.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      take: 100,
      orderBy: { expiresAt: "asc" },
    });
    await db.session.deleteMany({
      where: { id: { in: sessions.map((s) => s.id) }, expiresAt: { lte: now } },
    });
    const buckets = await db.publicRateBucket.findMany({
      where: { expiresAt: { lte: now } },
      select: { key: true },
      take: 100,
      orderBy: { expiresAt: "asc" },
    });
    await db.publicRateBucket.deleteMany({
      where: {
        key: { in: buckets.map((b) => b.key) },
        expiresAt: { lte: now },
      },
    });
  })()
    .catch(() => {
      console.error(
        "Expired workspace maintenance failed; it will retry on the next interval.",
      );
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}
export function startMaintenance() {
  const timer = setInterval(
    () => {
      void runMaintenance();
    },
    15 * 60 * 1000,
  );
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
