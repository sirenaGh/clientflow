import argon2 from "argon2";
import { db } from "../src/db.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Development seed is disabled in production");
const passwords = [
  "SEED_ADMIN_PASSWORD",
  "SEED_SALES_ONE_PASSWORD",
  "SEED_SALES_TWO_PASSWORD",
].map((key) => {
  const value = process.env[key];
  if (!value || value.length < 12)
    throw new Error(
      `${key} must be supplied locally with at least 12 characters`,
    );
  return value;
});
try {
  const users = [];
  for (const [i, name] of [
    "Morgan Ellis",
    "Avery Quinn",
    "Jordan Blake",
  ].entries()) {
    users.push(
      await db.user.upsert({
        where: { email: ["admin", "avery", "jordan"][i] + "@clientflow.test" },
        update: { passwordHash: await argon2.hash(passwords[i]) },
        create: {
          name,
          email: ["admin", "avery", "jordan"][i] + "@clientflow.test",
          role: i === 0 ? "ADMIN" : "SALES",
          passwordHash: await argon2.hash(passwords[i]),
        },
      }),
    );
  }
  for (const [i, name] of [
    "Northstar Fabrication",
    "Harborline Logistics",
    "Juniper Systems",
    "Fieldstone Packaging",
  ].entries()) {
    const assignedToId = users[1 + (i % 2)].id;
    if (await db.company.findFirst({ where: { name } })) continue;
    const c = await db.company.create({
      data: {
        name,
        industry: ["Manufacturing", "Logistics", "Technology", "Packaging"][i],
        website: `https://example.com/${i}`,
        phone: "",
        assignedToId,
      },
    });
    const contact = await db.contact.create({
      data: {
        name: ["Taylor Reed", "Casey Lane", "Robin Vale", "Alex Brook"][i],
        jobTitle: "Operations Director",
        email: `contact${i + 1}@example.com`,
        phone: "",
        companyId: c.id,
      },
    });
    const o = await db.opportunity.create({
      data: {
        title: [
          "Regional supply agreement",
          "Fleet planning platform",
          "Team expansion package",
          "Distribution partnership",
        ][i],
        companyId: c.id,
        contactId: contact.id,
        assignedToId,
        value: ["42500", "18000", "64000", "27500"][i],
        expectedCloseDate: new Date(Date.now() + (i + 1) * 7 * 86400000),
        stage: ["NEW", "CONTACTED", "PROPOSAL_SENT", "WON"][i] as
          "NEW" | "CONTACTED" | "PROPOSAL_SENT" | "WON",
        description:
          "Discovery conversations focus on improving procurement and team coordination.",
      },
    });
    await db.note.create({
      data: {
        opportunityId: o.id,
        authorId: assignedToId,
        body: "Initial discovery call completed. Share a tailored proposal after reviewing requirements.",
      },
    });
    await db.task.create({
      data: {
        title: "Confirm requirements and next steps",
        opportunityId: o.id,
        assignedToId,
        dueDate: new Date(Date.now() + (i - 1) * 86400000),
      },
    });
  }
  console.log(
    "Development seed complete. Accounts: admin@clientflow.test, avery@clientflow.test, jordan@clientflow.test. Passwords are the values supplied in your local environment.",
  );
} finally {
  await db.$disconnect();
}
