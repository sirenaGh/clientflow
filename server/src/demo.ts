import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { db } from "./db.js";
import { HttpError } from "./errors.js";

export const demoEnabled = () => process.env.DEMO_ENABLED === "true";
export const DEMO_LIFETIME_MS = 60 * 60 * 1000;
export const demoLimits = {
  company: 20,
  contact: 40,
  opportunity: 40,
  note: 100,
  task: 80,
} as const;

export async function checkDemoLimit(
  tx: Prisma.TransactionClient,
  actor: User,
  kind: keyof typeof demoLimits,
) {
  if (!actor.isDemo) return;
  const own = { assignedToId: actor.id };
  const count =
    kind === "company"
      ? await tx.company.count({ where: own })
      : kind === "contact"
        ? await tx.contact.count({ where: { company: own } })
        : kind === "opportunity"
          ? await tx.opportunity.count({ where: own })
          : kind === "note"
            ? await tx.note.count({ where: { opportunity: own } })
            : await tx.task.count({ where: own });
  if (count >= demoLimits[kind])
    throw new HttpError(
      409,
      `Demo workspace limit reached: ${demoLimits[kind]} ${kind} records. Delete a demo record to make room.`,
    );
}

export function provisionDemo(
  session: { id: string; csrf: string },
  previousSession?: string,
) {
  const expiresAt = new Date(Date.now() + DEMO_LIFETIME_MS);
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.create({
        data: {
          name: "Demo Visitor",
          email: `visitor-${randomUUID()}@demo.clientflow.invalid`,
          passwordHash: "!password-login-disabled",
          role: "SALES",
          isDemo: true,
          demoExpiresAt: expiresAt,
        },
      });
      const today = new Date(new Date().toISOString().slice(0, 10));
      const day = (offset: number) =>
        new Date(today.getTime() + offset * 86400000);
      const names = ["Cedar Peak Supply", "Lumen Works", "Bluehaven Logistics"];
      const contacts = ["Alex Rowan", "Casey Vale", "Morgan Reed"];
      const companies = [];
      for (let i = 0; i < names.length; i++) {
        const company = await tx.company.create({
          data: {
            name: names[i],
            industry: ["Manufacturing", "Technology", "Logistics"][i],
            website: `https://example.com/${i + 1}`,
            phone: "",
            assignedToId: user.id,
          },
        });
        const contact = await tx.contact.create({
          data: {
            name: contacts[i],
            jobTitle: "Operations Director",
            email: `contact${i + 1}@example.com`,
            phone: "",
            companyId: company.id,
          },
        });
        companies.push({ company, contact });
      }
      const stages = [
        "NEW",
        "CONTACTED",
        "DEMO_SCHEDULED",
        "PROPOSAL_SENT",
        "WON",
        "LOST",
      ] as const;
      const titles = [
        "Regional supply agreement",
        "Customer operations rollout",
        "Procurement workshop",
        "Warehouse coordination pilot",
        "Service renewal",
        "Packaging trial",
      ];
      for (let i = 0; i < stages.length; i++) {
        const { company, contact } = companies[i % companies.length];
        const opportunity = await tx.opportunity.create({
          data: {
            title: titles[i],
            companyId: company.id,
            contactId: contact.id,
            assignedToId: user.id,
            value: [
              "24500.00",
              "18000.00",
              "32000.00",
              "42500.00",
              "16000.00",
              "9500.00",
            ][i],
            expectedCloseDate: day(i + 3),
            stage: stages[i],
            description:
              "Fictional sample opportunity. Explore the pipeline and plan the next conversation.",
          },
        });
        if (i < 2)
          await tx.note.create({
            data: {
              opportunityId: opportunity.id,
              authorId: user.id,
              body: "Discovery conversation completed. Prepare a proposal covering the sample team's requirements.",
            },
          });
        if (i < 5)
          await tx.task.create({
            data: {
              title: [
                "Confirm requirements",
                "Arrange discovery call",
                "Prepare workshop",
                "Follow up on proposal",
                "Share next steps",
              ][i],
              opportunityId: opportunity.id,
              assignedToId: user.id,
              dueDate: day(i - 1),
              completed: i === 4,
            },
          });
      }
      if (previousSession)
        await tx.session.deleteMany({
          where: { id: previousSession, userId: null },
        });
      await tx.session.create({
        data: { ...session, userId: user.id, expiresAt },
      });
      return user;
    },
    { timeout: 10000 },
  );
}

// Lock the same stable owner row as CRM writes; recheck expiry after acquiring it.
export async function cleanupExpiredDemos(now = new Date(), store = db) {
  const candidates = await store.user.findMany({
    where: { isDemo: true, demoExpiresAt: { lte: now } },
    select: { id: true },
  });
  let removed = 0;
  for (const { id } of candidates) {
    removed += await store.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id } });
        if (!user?.isDemo || !user.demoExpiresAt || user.demoExpiresAt > now)
          return 0;
        const owned = { assignedToId: id };
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.task.deleteMany({ where: owned });
        await tx.note.deleteMany({ where: { opportunity: owned } });
        await tx.opportunity.deleteMany({ where: owned });
        await tx.contact.deleteMany({ where: { company: owned } });
        await tx.company.deleteMany({ where: owned });
        await tx.user.delete({ where: { id } });
        return 1;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
      },
    );
  }
  return removed;
}
