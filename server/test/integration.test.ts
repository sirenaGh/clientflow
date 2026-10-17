import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
import { app } from "../src/app.js";
import { db } from "../src/db.js";
const url = new URL(process.env.DATABASE_URL!);
if (!url.pathname.endsWith("_test") || process.env.NODE_ENV !== "test")
  throw new Error("Isolated test database required");
const origin = process.env.APP_ORIGIN!;
const agent = () => request.agent(app);
async function login(
  a: ReturnType<typeof agent>,
  email: string,
  password: string,
) {
  const s = await a.get("/api/auth/session").expect(200);
  const r = await a
    .post("/api/auth/login")
    .set("Origin", origin)
    .set("x-csrf-token", s.body.csrf)
    .send({ email, password })
    .expect(200);
  return r.body.csrf as string;
}
after(async () => {
  await db.$disconnect();
});
test("session security, ownership boundaries, CRM lifecycle, persistence and metrics", async () => {
  const a = agent(),
    b = agent(),
    admin = agent();
  await a.get("/api/companies").expect(401);
  const first = await a.get("/api/auth/session");
  await a
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "avery@clientflow.test", password: "wrong" })
    .expect(403);
  await a
    .post("/api/auth/login")
    .set("Origin", origin)
    .set("x-csrf-token", first.body.csrf)
    .send({ email: "avery@clientflow.test", password: "wrong" })
    .expect(401);
  const token = await login(
    a,
    "avery@clientflow.test",
    process.env.SEED_SALES_ONE_PASSWORD!,
  );
  const tokenB = await login(
    b,
    "jordan@clientflow.test",
    process.env.SEED_SALES_TWO_PASSWORD!,
  );
  const tokenAdmin = await login(
    admin,
    "admin@clientflow.test",
    process.env.SEED_ADMIN_PASSWORD!,
  );
  const reps = (await admin.get("/api/representatives")).body;
  const one = reps.find((r: any) => r.name === "Avery Quinn").id,
    two = reps.find((r: any) => r.name === "Jordan Blake").id;
  const send = (
    path: string,
    method: "post" | "put" | "patch" | "delete",
    data?: object,
  ) =>
    a[method](path).set("Origin", origin).set("x-csrf-token", token).send(data);
  const suffix = Date.now();
  const c = (
    await send("/api/companies", "post", {
      name: `Lifecycle ${suffix}`,
      assignedToId: one,
    }).expect(201)
  ).body;
  await send("/api/companies", "post", {
    name: "Forbidden assignment",
    assignedToId: two,
  }).expect(403);
  const ct = (
    await send("/api/contacts", "post", {
      name: "Sam River",
      companyId: c.id,
      email: "sam@example.com",
    }).expect(201)
  ).body;
  const opportunity = {
    title: `Lifecycle deal ${suffix}`,
    companyId: c.id,
    contactId: ct.id,
    assignedToId: one,
    value: "12345.67",
    expectedCloseDate: "2027-02-20",
    stage: "NEW",
    description: "Integration lifecycle",
  };
  const o = (await send("/api/opportunities", "post", opportunity).expect(201))
    .body;
  const other = (await b.get("/api/companies")).body.items[0];
  const otherContact = (await b.get("/api/contacts")).body.items[0];
  await send("/api/opportunities", "post", {
    ...opportunity,
    contactId: otherContact.id,
  }).expect(400);
  await send("/api/opportunities", "post", {
    ...opportunity,
    companyId: other.id,
  }).expect(404);
  await send("/api/contacts", "post", {
    name: "Unauthorized",
    companyId: other.id,
  }).expect(404);
  const otherOpportunity = (await b.get("/api/opportunities")).body.items[0];
  await send("/api/tasks", "post", {
    title: "Unauthorized",
    dueDate: "2027-01-01",
    assignedToId: one,
    opportunityId: otherOpportunity.id,
  }).expect(404);
  await send("/api/opportunities", "post", {
    ...opportunity,
    value: "1.999",
  }).expect(400);
  await send("/api/opportunities", "post", {
    ...opportunity,
    expectedCloseDate: "2027-02-30",
  }).expect(400);
  const note = (
    await send(`/api/opportunities/${o.id}/notes`, "post", {
      body: "Discussed the procurement timeline.",
    }).expect(201)
  ).body;
  const t = (
    await send("/api/tasks", "post", {
      title: "Send proposal",
      dueDate: "2020-01-01",
      assignedToId: one,
      opportunityId: o.id,
    }).expect(201)
  ).body;
  // Direct ID requests cover every record boundary, including delete and update.
  for (const [resource, rid, body] of [
    ["companies", c.id, { name: "Stolen", assignedToId: two }],
    ["contacts", ct.id, { name: "Stolen", companyId: other.id }],
    ["opportunities", o.id, { ...opportunity, assignedToId: two }],
    [
      "tasks",
      t.id,
      {
        title: "Stolen",
        dueDate: "2027-02-20",
        assignedToId: two,
        opportunityId: o.id,
      },
    ],
  ] as const) {
    await b.get(`/api/${resource}/${rid}`).expect(404);
    for (const method of ["put", "delete"] as const)
      await b[method](`/api/${resource}/${rid}`)
        .set("Origin", origin)
        .set("x-csrf-token", tokenB)
        .send(body)
        .expect(404);
    const list = await b.get(`/api/${resource}?filter=all`);
    assert(!list.body.items.some((r: any) => r.id === rid));
    await admin.get(`/api/${resource}/${rid}`).expect(200);
  }
  await b
    .patch(`/api/opportunities/${o.id}/stage`)
    .set("Origin", origin)
    .set("x-csrf-token", tokenB)
    .send({ stage: "WON" })
    .expect(404);
  await b
    .post(`/api/opportunities/${o.id}/notes`)
    .set("Origin", origin)
    .set("x-csrf-token", tokenB)
    .send({ body: "Intrusion" })
    .expect(404);
  await b
    .delete(`/api/notes/${note.id}`)
    .set("Origin", origin)
    .set("x-csrf-token", tokenB)
    .expect(404);
  await send(`/api/companies/${c.id}`, "delete").expect(409);
  await send(`/api/contacts/${ct.id}`, "delete").expect(409);
  await send(`/api/opportunities/${o.id}`, "delete").expect(409);
  await send(`/api/opportunities/${o.id}/stage`, "patch", {
    stage: "PROPOSAL_SENT",
  }).expect(200);
  const detail = await a.get(`/api/opportunities/${o.id}`).expect(200);
  assert(
    Math.abs(Date.now() - new Date(detail.body.notes[0].createdAt).getTime()) <
      15000,
    "Note timestamps represent the current instant",
  );
  assert.equal(detail.body.stage, "PROPOSAL_SENT");
  assert.equal(detail.body.value, "12345.67");
  assert.equal(detail.body.notes[0].author.name, "Avery Quinn");
  const fromDB = await db.opportunity.findUniqueOrThrow({
    where: { id: o.id },
  });
  assert.equal(fromDB.value.toString(), "12345.67");
  const overdue = await a.get("/api/tasks?filter=overdue");
  assert(overdue.body.items.some((r: any) => r.id === t.id));
  await send(`/api/tasks/${t.id}`, "patch", { completed: true }).expect(200);
  assert(
    (await a.get("/api/tasks?filter=completed")).body.items.some(
      (r: any) => r.id === t.id,
    ),
  );
  await send(`/api/opportunities/${o.id}/stage`, "patch", {
    stage: "WON",
  }).expect(200);
  const sum = (await a.get("/api/summary")).body;
  const won = await db.opportunity.aggregate({
    where: { assignedToId: one, stage: "WON" },
    _sum: { value: true },
  });
  assert.equal(sum.wonValue, won._sum.value!.toString());
  // Admin can modify a representative's record; representatives cannot see admin-only lists.
  await admin
    .patch(`/api/opportunities/${o.id}/stage`)
    .set("Origin", origin)
    .set("x-csrf-token", tokenAdmin)
    .send({ stage: "LOST" })
    .expect(200);
  await send(`/api/notes/${note.id}`, "delete").expect(204);
  await send(`/api/tasks/${t.id}`, "delete").expect(204);
  await send(`/api/opportunities/${o.id}`, "delete").expect(204);
  await send(`/api/contacts/${ct.id}`, "delete").expect(204);
  await send(`/api/companies/${c.id}`, "delete").expect(204);
  await a.get("/api/companies?page=0").expect(400);
  await a
    .post("/api/auth/logout")
    .set("Origin", origin)
    .set("x-csrf-token", token)
    .expect(200);
  await a.get("/api/companies").expect(401);
});

test("signed persistent cookies, session expiry, origin rejection and login throttling", async () => {
  const a = agent();
  const s = await a.get("/api/auth/session").expect(200);
  const signedIn = await a
    .post("/api/auth/login")
    .set("Origin", origin)
    .set("x-csrf-token", s.body.csrf)
    .send({
      email: "avery@clientflow.test",
      password: process.env.SEED_SALES_ONE_PASSWORD,
    })
    .expect(200);
  const cookie = (signedIn.headers["set-cookie"] as unknown as string[])[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  const cookiePair = cookie.split(";")[0];
  await request(app)
    .get("/api/companies")
    .set("Cookie", cookiePair)
    .expect(200);
  await request(app)
    .get("/api/companies")
    .set("Cookie", cookiePair + "tampered")
    .expect(401);
  await a
    .post("/api/companies")
    .set("Origin", "https://untrusted.example")
    .set("x-csrf-token", signedIn.body.csrf)
    .send({ name: "Untrusted" })
    .expect(403);
  const token = cookiePair.split("=")[1].split(".")[0];
  await db.session.update({
    where: { id: createHash("sha256").update(token).digest("hex") },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await a.get("/api/companies").expect(401);
  const fresh = await a.get("/api/auth/session");
  let throttled = false;
  for (let i = 0; i < 10; i++) {
    const r = await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("x-csrf-token", fresh.body.csrf)
      .send({ email: "unknown@clientflow.test", password: "incorrect" });
    assert([401, 429].includes(r.status));
    if (r.status === 429) {
      throttled = true;
      break;
    }
  }
  assert(throttled, "Repeated failed login requests are rate limited");
});
