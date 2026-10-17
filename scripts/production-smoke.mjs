import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { testEnv } from "./test-env.mjs";
const env = {
  ...testEnv(),
  NODE_ENV: "production",
  APP_ORIGIN: "https://clientflow.example",
  PORT: "3089",
  SESSION_SECRET: randomBytes(32).toString("hex"),
};
process.env.DATABASE_URL = env.DATABASE_URL;
const { db } = await import("../server/dist/src/db.js");
await db.publicRateBucket.deleteMany({
  where: {
    OR: [{ key: { startsWith: "demo:" } }, { key: { startsWith: "session:" } }],
  },
});
const base = "http://127.0.0.1:3089";
const child = spawn(process.execPath, ["server/dist/src/index.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let visitor;
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null)
      throw new Error("Production server exited before ready");
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {
      /* Wait for binding. */
    }
    if (i > 100) throw new Error("Production server did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const sessions = await db.session.count();
  const health = await fetch(base + "/health");
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(health.headers.get("set-cookie"), null);
  assert.equal(await db.session.count(), sessions);
  const index = await fetch(base + "/");
  const html = await index.text();
  assert.equal(index.status, 200);
  assert.match(html, /<div id="root">/);
  assert.equal(
    await (
      await fetch(base + "/opportunities/123", {
        headers: { Accept: "text/html" },
      })
    ).text(),
    html,
  );
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  const js = await fetch(base + asset);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(base + "/assets/missing.js")).status, 404);
  for (const path of ["/api/missing", "/api/companies"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 401);
    assert.match(r.headers.get("content-type"), /json/);
  }
  const first = await fetch(base + "/api/auth/session");
  const cookieHeader = first.headers.get("set-cookie");
  assert.match(cookieHeader, /__Host-clientflow=/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  const initial = await first.json();
  const headers = {
    Cookie: cookieHeader.split(";")[0],
    Origin: env.APP_ORIGIN,
    "x-csrf-token": initial.csrf,
  };
  assert.equal(
    (
      await fetch(base + "/api/auth/demo", {
        method: "POST",
        headers: {
          ...headers,
          Origin: "https://untrusted.example",
          "x-forwarded-proto": "https",
        },
      })
    ).status,
    403,
  );
  const demo = await fetch(base + "/api/auth/demo", {
    method: "POST",
    headers,
  });
  assert.equal(demo.status, 201);
  const body = await demo.json();
  visitor = body.user.id;
  const signed = { Cookie: demo.headers.get("set-cookie").split(";")[0] };
  const missing = await fetch(base + "/api/missing", { headers: signed });
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /json/);
  const key = `demo:${Math.floor(Date.now() / 3600000)}`;
  await db.publicRateBucket.upsert({
    where: { key },
    create: { key, hits: 30, expiresAt: new Date(Date.now() + 3600000) },
    update: { hits: 30 },
  });
  const renewed = await fetch(base + "/api/auth/session");
  const renewedHeaders = {
    Cookie: renewed.headers.get("set-cookie").split(";")[0],
    Origin: env.APP_ORIGIN,
    "x-csrf-token": (await renewed.json()).csrf,
  };
  const blocked = await fetch(base + "/api/auth/demo", {
    method: "POST",
    headers: { ...renewedHeaders, "x-forwarded-for": "192.0.2.50" },
  });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  await db.publicRateBucket.delete({ where: { key } });
  await db.user.update({
    where: { id: visitor },
    data: { demoExpiresAt: new Date(0) },
  });
  const normal = await db.user.count({ where: { isDemo: false } });
  const cleanup = () =>
    new Promise((resolve, reject) => {
      const job = spawn(
        process.execPath,
        ["server/dist/src/cleanup-demos.js"],
        { env, stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        job.kill();
        reject(new Error("Cleanup did not terminate"));
      }, 30000);
      job.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error("Cleanup failed"));
      });
    });
  await Promise.all([cleanup(), cleanup()]);
  assert.equal(await db.user.findUnique({ where: { id: visitor } }), null);
  assert.equal(await db.user.count({ where: { isDemo: false } }), normal);
  console.log(
    "Production smoke passed: health, SPA, assets, API errors, Secure cookies, CSRF, shared rate budget, overlapping cleanup.",
  );
} finally {
  child.kill();
  if (visitor)
    await db.user.updateMany({
      where: { id: visitor, isDemo: true },
      data: { demoExpiresAt: new Date(0) },
    });
  const { cleanupExpiredDemos } = await import("../server/dist/src/demo.js");
  await cleanupExpiredDemos();
  await db.publicRateBucket.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "demo:" } },
        { key: { startsWith: "session:" } },
      ],
    },
  });
  await db.$disconnect();
}
