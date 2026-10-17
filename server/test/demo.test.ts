import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
import { cleanupExpiredDemos, demoLimits, provisionDemo } from "../src/demo.js";
import { crmWrite } from "../src/ownership.js";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const origin = process.env.APP_ORIGIN!;
const ids: number[] = [];
const agent = () => request.agent(app);
type Agent = ReturnType<typeof agent>;
const send = (
  a: Agent,
  csrf: string,
  method: "post" | "put" | "patch" | "delete",
  path: string,
  body?: object,
) =>
  a[method]("/api" + path)
    .set("Origin", origin)
    .set("x-csrf-token", csrf)
    .send(body);
async function demo() {
  const a = agent();
  const initial = await a.get("/api/auth/session").expect(200);
  assert.equal(initial.body.user, null);
  const result = await send(a, initial.body.csrf, "post", "/auth/demo").expect(
    201,
  );
  ids.push(result.body.user.id);
  return {
    a,
    csrf: result.body.csrf as string,
    user: result.body.user,
    result,
  };
}
async function login(email: string, password: string) {
  const a = agent(),
    s = await a.get("/api/auth/session");
  const r = await send(a, s.body.csrf, "post", "/auth/login", {
    email,
    password,
  }).expect(200);
  return { a, csrf: r.body.csrf as string, user: r.body.user };
}
after(async () => {
  await db.user.updateMany({
    where: { id: { in: ids }, isDemo: true },
    data: { demoExpiresAt: new Date(0) },
  });
  await cleanupExpiredDemos();
  await db.$disconnect();
});

test("credential-free demo isolation, team exclusion, writable lifecycle, fixed expiry and safe cleanup", async () => {
  const admin = await login(
    "admin@clientflow.test",
    process.env.SEED_ADMIN_PASSWORD!,
  );
  const employee = await login(
    "avery@clientflow.test",
    process.env.SEED_SALES_ONE_PASSWORD!,
  );
  const baseline = (await admin.a.get("/api/summary").expect(200)).body;
  const normalCompany = await db.company.findFirstOrThrow({
    where: { assignedToId: employee.user.id },
  });
  const first = await demo(),
    second = await demo();
  const { a, csrf, user } = first;
  assert.notEqual(user.id, second.user.id);
  assert.equal(user.isDemo, true);
  assert.equal(user.role, "SALES");
  assert.equal("passwordHash" in user, false);
  assert(
    Math.abs(new Date(user.demoExpiresAt).getTime() - Date.now() - 3600000) <
      10000,
  );
  const enabled = process.env.DEMO_ENABLED;
  try {
    process.env.DEMO_ENABLED = "false";
    await a.get("/api/summary").expect(401);
  } finally {
    process.env.DEMO_ENABLED = enabled;
  }
  const cookie = (first.result.headers["set-cookie"] as unknown as string[])[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=35\d\d|Max-Age=3600/);
  const sessionKey = createHash("sha256")
    .update(cookie.split("=")[1].split(".")[0])
    .digest("hex");
  const storedSession = await db.session.findUniqueOrThrow({
    where: { id: sessionKey },
  });
  assert.equal(storedSession.expiresAt.toISOString(), user.demoExpiresAt);
  assert.deepEqual((await admin.a.get("/api/summary")).body, baseline);
  assert(
    !(await admin.a.get("/api/representatives")).body.some((r: any) =>
      ids.includes(r.id),
    ),
  );
  assert.deepEqual((await a.get("/api/representatives")).body, [
    { id: user.id, name: "Demo Visitor" },
  ]);
  const mine = (await a.get("/api/companies")).body;
  const other = (await second.a.get("/api/companies")).body;
  assert.equal(mine.total, 3);
  assert.equal(other.total, 3);
  assert(
    mine.items.every(
      (c: any) =>
        c.assignedToId === user.id &&
        !other.items.some((o: any) => o.id === c.id),
    ),
  );
  const summary = (await a.get("/api/summary")).body;
  assert.deepEqual(summary, {
    companies: 3,
    openOpportunities: 4,
    openValue: "117000",
    wonValue: "16000",
    overdueTasks: 1,
  });
  const list = (await a.get("/api/opportunities")).body;
  assert.equal(new Set(list.items.map((o: any) => o.stage)).size, 6);
  const target = list.items[0],
    detail = (await a.get(`/api/opportunities/${target.id}`)).body;
  const targetContact = (await a.get("/api/contacts")).body.items[0];
  const targetTask = (await a.get("/api/tasks?filter=all")).body.items[0];
  assert(
    detail.notes.length > 0 && detail.notes[0].author.name === "Demo Visitor",
  );
  for (const outsider of [second, employee, admin]) {
    for (const [path, body] of [
      [
        `companies/${mine.items[0].id}`,
        { name: "Forbidden", assignedToId: outsider.user.id },
      ],
      [
        `contacts/${targetContact.id}`,
        { name: "Forbidden", companyId: mine.items[0].id },
      ],
      [`opportunities/${target.id}`, { title: "Forbidden" }],
      [`tasks/${targetTask.id}`, { title: "Forbidden" }],
    ] as const) {
      await outsider.a.get("/api/" + path).expect(404);
      await send(outsider.a, outsider.csrf, "put", "/" + path, body).expect(
        404,
      );
      await send(outsider.a, outsider.csrf, "delete", "/" + path).expect(404);
    }
    await send(
      outsider.a,
      outsider.csrf,
      "patch",
      `/opportunities/${target.id}/stage`,
      { stage: "WON" },
    ).expect(404);
    await send(
      outsider.a,
      outsider.csrf,
      "post",
      `/opportunities/${target.id}/notes`,
      { body: "Forbidden" },
    ).expect(404);
    await send(
      outsider.a,
      outsider.csrf,
      "delete",
      `/notes/${detail.notes[0].id}`,
    ).expect(404);
    await send(outsider.a, outsider.csrf, "patch", `/tasks/${targetTask.id}`, {
      completed: true,
    }).expect(404);
  }
  const foreignContact = (await employee.a.get("/api/contacts")).body.items[0];
  const foreignDeal = (await employee.a.get("/api/opportunities")).body
    .items[0];
  const foreignNote = await db.note.findFirstOrThrow({
    where: { opportunity: { assignedToId: employee.user.id } },
  });
  const foreignTask = (await employee.a.get("/api/tasks?filter=all")).body
    .items[0];
  for (const outsider of [first, second]) {
    for (const path of [
      `companies/${normalCompany.id}`,
      `contacts/${foreignContact.id}`,
      `opportunities/${foreignDeal.id}`,
      `tasks/${foreignTask.id}`,
    ]) {
      await outsider.a.get("/api/" + path).expect(404);
      await send(outsider.a, outsider.csrf, "put", "/" + path, {}).expect(404);
      await send(outsider.a, outsider.csrf, "delete", "/" + path).expect(404);
    }
    await send(
      outsider.a,
      outsider.csrf,
      "patch",
      `/opportunities/${foreignDeal.id}/stage`,
      { stage: "WON" },
    ).expect(404);
    await send(
      outsider.a,
      outsider.csrf,
      "post",
      `/opportunities/${foreignDeal.id}/notes`,
      { body: "Forbidden" },
    ).expect(404);
    await send(
      outsider.a,
      outsider.csrf,
      "delete",
      `/notes/${foreignNote.id}`,
    ).expect(404);
    await send(outsider.a, outsider.csrf, "patch", `/tasks/${foreignTask.id}`, {
      completed: true,
    }).expect(404);
    await send(outsider.a, outsider.csrf, "post", "/contacts", {
      name: "Forbidden",
      companyId: normalCompany.id,
    }).expect(404);
    await send(outsider.a, outsider.csrf, "post", "/tasks", {
      title: "Forbidden",
      dueDate: "2030-01-01",
      assignedToId: outsider.user.id,
      opportunityId: foreignDeal.id,
    }).expect(404);
  }
  await send(a, csrf, "post", "/companies", {
    name: "Forbidden",
    assignedToId: employee.user.id,
  }).expect(403);
  await send(admin.a, admin.csrf, "post", "/companies", {
    name: "Forbidden",
    assignedToId: user.id,
  }).expect(400);
  const auth = agent(),
    anonymous = await auth.get("/api/auth/session");
  await send(auth, anonymous.body.csrf, "post", "/auth/login", {
    email: user.email,
    password: "any-password-is-rejected",
  }).expect(401);
  await send(a, csrf, "post", "/auth/demo").expect(409);
  await a.post("/api/companies").set("Origin", origin).send({}).expect(403);

  const c = (
    await send(a, csrf, "post", "/companies", {
      name: "Visitor sample company",
      assignedToId: user.id,
    }).expect(201)
  ).body;
  await send(a, csrf, "put", `/companies/${c.id}`, {
    name: "Updated visitor company",
    assignedToId: user.id,
  }).expect(200);
  const contact = (
    await send(a, csrf, "post", "/contacts", {
      name: "Robin Elm",
      companyId: c.id,
    }).expect(201)
  ).body;
  const dealData = {
    title: "Visitor sample deal",
    companyId: c.id,
    contactId: contact.id,
    assignedToId: user.id,
    value: "1234.50",
    expectedCloseDate: "2030-01-20",
    stage: "NEW",
  };
  await send(a, csrf, "post", "/opportunities", {
    ...dealData,
    companyId: normalCompany.id,
  }).expect(404);
  await send(a, csrf, "post", "/opportunities", {
    ...dealData,
    contactId: foreignContact.id,
  }).expect(400);
  await send(a, csrf, "post", "/contacts", {
    name: "Forbidden",
    companyId: other.items[0].id,
  }).expect(404);
  const o = (
    await send(a, csrf, "post", "/opportunities", dealData).expect(201)
  ).body;
  await send(a, csrf, "patch", `/opportunities/${o.id}/stage`, {
    stage: "WON",
  }).expect(200);
  await send(a, csrf, "post", `/opportunities/${o.id}/notes`, {
    body: "Sample next steps",
    authorId: employee.user.id,
  }).expect(201);
  const t = (
    await send(a, csrf, "post", "/tasks", {
      title: "Sample follow-up",
      dueDate: "2030-01-21",
      assignedToId: user.id,
      opportunityId: o.id,
    }).expect(201)
  ).body;
  await send(a, csrf, "patch", `/tasks/${t.id}`, { completed: true }).expect(
    200,
  );
  const persisted = (await a.get(`/api/opportunities/${o.id}`)).body;
  assert.equal(persisted.stage, "WON");
  assert.equal(persisted.notes[0].author.name, "Demo Visitor");
  assert.equal(persisted.tasks[0].completed, true);

  // Counts and inserts are serialized by the existing owner lock, including quotas.
  const count = await db.company.count({ where: { assignedToId: user.id } });
  await db.company.createMany({
    data: Array.from({ length: 19 - count }, (_, i) => ({
      name: `Quota company ${i}`,
      industry: "",
      website: "",
      phone: "",
      assignedToId: user.id,
    })),
  });
  const races = await Promise.all(
    [0, 1].map((i) =>
      send(a, csrf, "post", "/companies", {
        name: `Last slot ${i}`,
        assignedToId: user.id,
      }),
    ),
  );
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.company.count({ where: { assignedToId: user.id } }),
    demoLimits.company,
  );
  const ctCount = await db.contact.count({
    where: { company: { assignedToId: user.id } },
  });
  await db.contact.createMany({
    data: Array.from({ length: demoLimits.contact - ctCount }, (_, i) => ({
      name: `Quota contact ${i}`,
      jobTitle: "",
      email: "",
      phone: "",
      companyId: c.id,
    })),
  });
  await send(a, csrf, "post", "/contacts", {
    name: "Over limit",
    companyId: c.id,
  }).expect(409);
  const oCount = await db.opportunity.count({
    where: { assignedToId: user.id },
  });
  await db.opportunity.createMany({
    data: Array.from({ length: demoLimits.opportunity - oCount }, (_, i) => ({
      title: `Quota deal ${i}`,
      companyId: c.id,
      assignedToId: user.id,
      value: "1.00",
      expectedCloseDate: new Date("2030-01-20"),
      description: "",
    })),
  });
  await send(a, csrf, "post", "/opportunities", dealData).expect(409);
  const nCount = await db.note.count({
    where: { opportunity: { assignedToId: user.id } },
  });
  await db.note.createMany({
    data: Array.from({ length: demoLimits.note - nCount }, () => ({
      body: "Quota sample note",
      authorId: user.id,
      opportunityId: o.id,
    })),
  });
  await send(a, csrf, "post", `/opportunities/${o.id}/notes`, {
    body: "Over limit",
  }).expect(409);
  const tCount = await db.task.count({ where: { assignedToId: user.id } });
  await db.task.createMany({
    data: Array.from({ length: demoLimits.task - tCount }, (_, i) => ({
      title: `Quota task ${i}`,
      dueDate: new Date("2030-01-21"),
      assignedToId: user.id,
      opportunityId: o.id,
    })),
  });
  await send(a, csrf, "post", "/tasks", {
    title: "Over limit",
    dueDate: "2030-01-21",
    assignedToId: user.id,
    opportunityId: o.id,
  }).expect(409);

  const before = await db.user.count({ where: { isDemo: true } });
  const companyCount = await db.company.count();
  await assert.rejects(
    provisionDemo({ id: sessionKey, csrf: randomBytes(32).toString("hex") }),
  );
  assert.equal(await db.user.count({ where: { isDemo: true } }), before);
  assert.equal(await db.company.count(), companyCount);
  const staleActor = await db.user.findUniqueOrThrow({
    where: { id: user.id },
  });
  await db.user.update({
    where: { id: user.id },
    data: { demoExpiresAt: new Date(0) },
  });
  // Extending the session row cannot extend a workspace's fixed lifetime.
  await db.session.update({
    where: { id: sessionKey },
    data: { expiresAt: new Date(Date.now() + 7200000) },
  });
  await a.get("/api/summary").expect(401);
  await send(a, csrf, "patch", `/tasks/${t.id}`, { completed: false }).expect(
    401,
  );
  await assert.rejects(
    crmWrite(staleActor, async () => {
      assert.fail("Expired identity must not reach the mutation");
    }),
    (e: any) => e.status === 401,
  );
  const normalWithPastDate = await db.user.create({
    data: {
      name: "Normal cleanup sentinel",
      email: `cleanup-${randomBytes(8).toString("hex")}@example.com`,
      passwordHash: "!test-only-no-login",
      role: "SALES",
      isDemo: false,
      demoExpiresAt: new Date(0),
    },
  });
  try {
    assert.equal(await cleanupExpiredDemos(), 1);
    assert(
      await db.user.findUnique({ where: { id: normalWithPastDate.id } }),
      "A past date never makes a normal identity eligible for demo cleanup",
    );
  } finally {
    await db.user.deleteMany({
      where: { id: normalWithPastDate.id, isDemo: false },
    });
  }

  assert.equal(await db.user.findUnique({ where: { id: user.id } }), null);
  assert.equal(await db.company.count({ where: { assignedToId: user.id } }), 0);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  assert(await db.company.findUnique({ where: { id: normalCompany.id } }));
  await second.a.get("/api/summary").expect(200);
  assert.deepEqual((await admin.a.get("/api/summary")).body, baseline);
  assert.equal(await cleanupExpiredDemos(), 0);
  await send(second.a, second.csrf, "post", "/auth/logout").expect(200);
  await second.a.get("/api/summary").expect(401);
  assert.equal(
    await db.session.count({ where: { userId: second.user.id } }),
    0,
  );
  assert.equal(await cleanupExpiredDemos(), 1);
});

test("demo creation is disabled by default, CSRF protected, and rate limited", async () => {
  const a = agent(),
    s = await a.get("/api/auth/session");
  const original = process.env.DEMO_ENABLED;
  try {
    delete process.env.DEMO_ENABLED;
    assert.equal((await a.get("/api/auth/session")).body.demoEnabled, false);
    const before = await db.user.count({ where: { isDemo: true } });
    await send(a, s.body.csrf, "post", "/auth/demo").expect(404);
    assert.equal(await db.user.count({ where: { isDemo: true } }), before);
  } finally {
    process.env.DEMO_ENABLED = original;
  }
  await a.post("/api/auth/demo").set("Origin", origin).expect(403);
  await a
    .post("/api/auth/demo")
    .set("Origin", "https://untrusted.example")
    .set("x-csrf-token", s.body.csrf)
    .expect(403);
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const result = await send(a, s.body.csrf, "post", "/auth/demo");
    if (result.status === 429) {
      limited = true;
      break;
    }
    assert.equal(result.status, 201);
    ids.push(result.body.user.id);
    // A new anonymous session is required after each visitor has exited.
    await send(a, result.body.csrf, "post", "/auth/logout").expect(200);
    const next = await a.get("/api/auth/session");
    s.body.csrf = next.body.csrf;
  }
  assert(limited, "Creation must reach the five-per-hour cap");
});
