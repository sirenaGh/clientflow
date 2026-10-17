import { db } from "../src/db.js";
import type { Stage } from "@prisma/client";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_review_test")
) {
  throw new Error(
    "Fictional review fixtures are restricted to the separate review test database",
  );
}
try {
  const companies = await db.company.findMany({
    orderBy: { id: "asc" },
    include: { contacts: true },
  });
  if (companies.length !== 4)
    throw new Error(
      "Use a review database containing only the four fictional seed companies",
    );
  const today = new Date().toISOString().slice(0, 10);
  const offset = (days: number) =>
    new Date(new Date(today + "T00:00:00Z").getTime() + days * 86400000);
  const fixtures: [string, Stage, string][] = [
    ["Procurement discovery workshop", "DEMO_SCHEDULED", "16500.00"],
    ["Warehouse coordination pilot", "PROPOSAL_SENT", "32500.00"],
    ["Customer operations rollout", "CONTACTED", "24800.00"],
    ["Packaging renewal agreement", "LOST", "9200.00"],
    ["Supplier onboarding package", "NEW", "38750.00"],
    ["Delivery planning expansion", "DEMO_SCHEDULED", "21250.00"],
    ["Regional service extension", "WON", "47000.00"],
    ["Sustainable materials pilot", "PROPOSAL_SENT", "18750.00"],
  ];
  for (const [index, [title, stage, value]] of fixtures.entries()) {
    if (await db.opportunity.findFirst({ where: { title } })) continue;
    const company = companies[index % companies.length];
    await db.opportunity.create({
      data: {
        title,
        stage,
        value,
        companyId: company.id,
        contactId: company.contacts[0].id,
        assignedToId: company.assignedToId,
        expectedCloseDate: offset(index + 1),
        description:
          "Fictional review opportunity for evaluating the sales workflow and pipeline pagination.",
      },
    });
  }
  const opportunity = await db.opportunity.findFirstOrThrow({
    where: { title: "Regional supply agreement" },
  });
  for (const [title, days, completed] of [
    ["Share implementation outline", 2, false],
    ["Confirm procurement requirements", -2, false],
    ["Send discovery meeting recap", -1, true],
  ] as [string, number, boolean][]) {
    if (!(await db.task.findFirst({ where: { title } }))) {
      await db.task.create({
        data: {
          title,
          dueDate: offset(days),
          completed,
          assignedToId: opportunity.assignedToId,
          opportunityId: opportunity.id,
        },
      });
    }
  }
  console.log(
    "Review fixtures ready: four fictional companies, twelve opportunities, and follow-up task examples.",
  );
} finally {
  await db.$disconnect();
}
