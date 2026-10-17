import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { crmWrite, lockOwners } from "../src/ownership.js";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
after(() => db.$disconnect());

test("real ownership locks serialize reassignment; former owners cannot edit, delete or reclaim related records", async () => {
  const oldOwner = await db.user.findUniqueOrThrow({
    where: { email: "avery@clientflow.test" },
  });
  const newOwner = await db.user.findUniqueOrThrow({
    where: { email: "jordan@clientflow.test" },
  });
  const adminUser = await db.user.findUniqueOrThrow({
    where: { email: "admin@clientflow.test" },
  });
  const representative = request.agent(app),
    admin = request.agent(app);
  async function login(
    agent: typeof representative,
    email: string,
    password: string,
  ) {
    const session = await agent.get("/api/auth/session");
    const response = await agent
      .post("/api/auth/login")
      .set("Origin", process.env.APP_ORIGIN!)
      .set("x-csrf-token", session.body.csrf)
      .send({ email, password })
      .expect(200);
    return response.body.csrf as string;
  }
  const csrf = await login(
    representative,
    oldOwner.email,
    process.env.SEED_SALES_ONE_PASSWORD!,
  );
  const adminCsrf = await login(
    admin,
    adminUser.email,
    process.env.SEED_ADMIN_PASSWORD!,
  );
  const send = (
    path: string,
    method: "put" | "patch" | "delete" | "post",
    body?: object,
  ) =>
    representative[method]("/api" + path)
      .set("Origin", process.env.APP_ORIGIN!)
      .set("x-csrf-token", csrf)
      .send(body);
  const transfer = (path: string, body: object) =>
    admin
      .put("/api" + path)
      .set("Origin", process.env.APP_ORIGIN!)
      .set("x-csrf-token", adminCsrf)
      .send(body)
      .expect(200);
  const companyIds: number[] = [],
    opportunityIds: number[] = [];
  const makeCompany = async (assignedToId: number) => {
    const c = await db.company.create({
      data: {
        name: "Ownership regression " + crypto.randomUUID(),
        assignedToId,
        industry: "",
        website: "",
        phone: "",
      },
    });
    companyIds.push(c.id);
    return c;
  };
  try {
    const c = await makeCompany(oldOwner.id);
    const contact = await db.contact.create({
      data: {
        name: "Taylor Vale",
        companyId: c.id,
        jobTitle: "",
        email: "",
        phone: "",
      },
    });
    let unlock!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const reassignment = crmWrite(adminUser, async (tx) => {
      await tx.company.update({
        where: { id: c.id },
        data: { assignedToId: newOwner.id },
      });
      locked();
      await gate;
    });
    await ready;
    try {
      // No sleeps or substituted methods: MySQL must reject the conflicting lock
      // while the administrator's real reassignment transaction is uncommitted.
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SET SESSION innodb_lock_wait_timeout = 1`;
          try {
            await lockOwners(tx, oldOwner);
          } finally {
            await tx.$executeRaw`SET SESSION innodb_lock_wait_timeout = 50`;
          }
        }),
        (error: unknown) =>
          /1205|Lock wait timeout/i.test(String(error) + JSON.stringify(error)),
      );
    } finally {
      unlock();
      await reassignment;
    }
    const stale = { name: "Former owner rewrite", assignedToId: oldOwner.id };
    await send(`/companies/${c.id}`, "put", stale).expect(404);
    await send(`/companies/${c.id}`, "put", {
      ...stale,
      assignedToId: newOwner.id,
    }).expect(404);
    await send(`/companies/${c.id}`, "delete").expect(404);
    await send(`/contacts/${contact.id}`, "put", {
      name: "Changed",
      companyId: c.id,
    }).expect(404);
    await send(`/contacts/${contact.id}`, "delete").expect(404);
    await send("/contacts", "post", {
      name: "Unauthorized child",
      companyId: c.id,
    }).expect(404);
    assert.equal(
      (await db.company.findUniqueOrThrow({ where: { id: c.id } }))
        .assignedToId,
      newOwner.id,
    );
    assert.equal(
      (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).name,
      "Taylor Vale",
    );

    const a = await makeCompany(oldOwner.id),
      b = await makeCompany(newOwner.id);
    const dealData = {
      title: "Ownership regression deal",
      companyId: a.id,
      assignedToId: oldOwner.id,
      description: "Regression fixture",
      value: "1200.50",
      stage: "NEW" as const,
      expectedCloseDate: new Date("2027-01-20"),
    };
    const o = await db.opportunity.create({ data: dealData });
    opportunityIds.push(o.id);
    const note = await db.note.create({
      data: {
        body: "Private fictional note",
        authorId: oldOwner.id,
        opportunityId: o.id,
      },
    });
    const moved = {
      ...dealData,
      companyId: b.id,
      assignedToId: newOwner.id,
      expectedCloseDate: "2027-01-20",
    };
    await transfer(`/opportunities/${o.id}`, moved);
    await send(`/opportunities/${o.id}`, "put", {
      ...moved,
      companyId: a.id,
      assignedToId: oldOwner.id,
    }).expect(404);
    await send(`/opportunities/${o.id}/stage`, "patch", {
      stage: "WON",
    }).expect(404);
    await send(`/opportunities/${o.id}`, "delete").expect(404);
    await send(`/opportunities/${o.id}/notes`, "post", {
      body: "Forbidden",
    }).expect(404);
    await send(`/notes/${note.id}`, "delete").expect(404);
    await representative.get(`/api/opportunities/${o.id}`).expect(404);
    const original = await db.opportunity.create({ data: dealData });
    opportunityIds.push(original.id);
    const task = await db.task.create({
      data: {
        title: "Ownership regression task",
        dueDate: new Date("2027-01-21"),
        assignedToId: oldOwner.id,
        opportunityId: original.id,
      },
    });
    const movedTask = {
      title: task.title,
      dueDate: "2027-01-21",
      assignedToId: newOwner.id,
      opportunityId: o.id,
    };
    await transfer(`/tasks/${task.id}`, movedTask);
    await send(`/tasks/${task.id}`, "put", {
      ...movedTask,
      assignedToId: oldOwner.id,
      opportunityId: original.id,
    }).expect(404);
    await send(`/tasks/${task.id}`, "patch", { completed: true }).expect(404);
    await send(`/tasks/${task.id}`, "delete").expect(404);
    await send("/tasks", "post", movedTask).expect(404);
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).completed,
      false,
    );
    assert.equal(
      (await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).stage,
      "NEW",
    );
  } finally {
    await db.task.deleteMany({
      where: { opportunityId: { in: opportunityIds } },
    });
    await db.note.deleteMany({
      where: { opportunityId: { in: opportunityIds } },
    });
    await db.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
    await db.contact.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.company.deleteMany({ where: { id: { in: companyIds } } });
  }
});
