import { Prisma, type User } from "@prisma/client";
import { db } from "./db.js";
import { HttpError } from "./errors.js";
import { demoEnabled } from "./demo.js";

// Every CRM write takes these locks before reading ownership or relationships.
// Transfers therefore serialize with both the old and new representative's writes.
export async function lockOwners(tx: Prisma.TransactionClient, actor: User) {
  if (actor.role === "ADMIN") {
    await tx.$queryRaw`SELECT id FROM User FORCE INDEX (PRIMARY) WHERE role = 'SALES' AND isDemo = false ORDER BY id FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${actor.id} FOR UPDATE`;
  }
}

export function crmWrite<T>(
  actor: User,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await lockOwners(tx, actor);
      if (actor.isDemo) {
        const current = await tx.user.findUnique({ where: { id: actor.id } });
        if (
          !demoEnabled() ||
          !current?.isDemo ||
          !current.demoExpiresAt ||
          current.demoExpiresAt <= new Date()
        )
          throw new HttpError(
            401,
            "Demo workspace has expired. Start a new demo.",
          );
      }
      return work(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10000,
    },
  );
}
