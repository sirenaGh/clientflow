import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer as httpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer as tcpServer } from "node:net";
import { chromium, expect, devices } from "@playwright/test";

// Explicit opt-in, loopback only, no reset/drop/seed commands, and an empty DB.
const raw = process.env.DEMO_TEST_DATABASE_URL;
if (!raw)
  throw new Error(
    "DEMO_TEST_DATABASE_URL must name a new disposable MySQL 8.4 database",
  );
let target;
try {
  target = new URL(raw);
} catch {
  throw new Error(
    "DEMO_TEST_DATABASE_URL must be a valid disposable MySQL URL",
  );
}
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/[A-Za-z0-9_]+_test$/.test(target.pathname) ||
  raw === process.env.DATABASE_URL ||
  raw === process.env.TEST_DATABASE_URL
)
  throw new Error(
    "Refusing anything other than a separate disposable loopback database ending in _test",
  );
for (const [port, host] of [
  [3094, "0.0.0.0"],
  [3095, "127.0.0.1"],
]) {
  await new Promise((ready, reject) => {
    const probe = tcpServer();
    probe.once("error", reject);
    probe.listen(port, host, () => probe.close(ready));
  });
}
const env = {
  ...process.env,
  DATABASE_URL: raw,
  NODE_ENV: "production",
  DB_TLS_REQUIRED: process.env.DEMO_TEST_CA_FILE ? "true" : "false",
  DB_TLS_CA_FILE: process.env.DEMO_TEST_CA_FILE || "",
  DEMO_ENABLED: "true",
  DEMO_CLEANUP_ENABLED: "true",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  PORT: "3094",
  APP_ORIGIN: "https://127.0.0.1:3095",
};
process.env.DATABASE_URL = raw;
process.env.DB_TLS_REQUIRED = env.DB_TLS_REQUIRED;
process.env.DB_TLS_CA_FILE = env.DB_TLS_CA_FILE;
const { database } = await import("../server/dist/src/db.js");
const db = database(raw);
let server, proxy, browser;
try {
  const version = (await db.$queryRaw`SELECT VERSION() AS version`)[0].version;
  assert.match(version, /^8\.4\./, "This regression requires real MySQL 8.4");
  const tables =
    await db.$queryRaw`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`;
  assert.equal(
    tables.length,
    0,
    "Refusing an existing database: create a new empty disposable database",
  );
  const migration = spawnSync(
    process.execPath,
    ["scripts/migrate-production.mjs"],
    { env, encoding: "utf8", timeout: 130000 },
  );
  assert.equal(
    migration.status,
    0,
    "Production migrations must succeed without seeding",
  );
  for (const model of [
    "user",
    "company",
    "contact",
    "opportunity",
    "note",
    "task",
    "session",
    "publicRateBucket",
  ])
    assert.equal(
      await db[model].count(),
      0,
      `Migrations must leave ${model} empty`,
    );
  console.log(
    `Migrations-only database verified: MySQL ${version}; zero CRM, session or reference records.`,
  );

  const fixture = resolve(".runtime/demo-pristine-tls");
  mkdirSync(fixture, { recursive: true });
  const openssl =
    process.env.OPENSSL_BIN ||
    (existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  const certificate = spawnSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      resolve(fixture, "key.pem"),
      "-out",
      resolve(fixture, "cert.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  assert.equal(
    certificate.status,
    0,
    "OpenSSL is required for the local HTTPS browser fixture",
  );
  server = spawn(process.execPath, ["scripts/start-render.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // No raw child output is printed: it can contain configuration diagnostics.
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null)
      throw new Error("Production test server exited before readiness");
    try {
      ready = (await fetch("http://127.0.0.1:3094/health")).ok;
    } catch {
      /* Wait for startup migrations and maintenance. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, "Production test server must become ready");
  assert.equal(
    await db.session.count(),
    0,
    "Readiness must not create a session",
  );
  proxy = httpsServer(
    {
      key: readFileSync(resolve(fixture, "key.pem")),
      cert: readFileSync(resolve(fixture, "cert.pem")),
    },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: 3094,
          method: req.method,
          path: req.url,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise((resolveReady) =>
    proxy.listen(3095, "127.0.0.1", resolveReady),
  );
  browser = await chromium.launch();
  const makeContext = (mobile) =>
    browser.newContext({
      ...(mobile ? devices["iPhone 13"] : {}),
      baseURL: env.APP_ORIGIN,
      ignoreHTTPSErrors: true,
    });
  // The certificate exception is restricted to this self-signed local web proxy;
  // it changes neither the application's database TLS options nor production.
  const first = await makeContext(false),
    page = await first.newPage();
  const enter = async (p) => {
    await p.goto(env.APP_ORIGIN);
    const response = p.waitForResponse((r) =>
      r.url().endsWith("/api/auth/demo"),
    );
    await p.getByRole("button", { name: "Try demo", exact: true }).click();
    const result = await response;
    assert.equal(
      result.status(),
      201,
      "First-time visitor must receive a new demo session",
    );
    await expect(
      p.getByRole("region", { name: "Demo workspace", exact: true }),
    ).toBeVisible();
    await expect(
      p
        .locator(".metric")
        .filter({ has: p.getByText("Companies", { exact: true }) })
        .locator("strong"),
    ).toHaveText("3");
    await expect(
      p
        .locator(".metric")
        .filter({ has: p.getByText("Open opportunities", { exact: true }) })
        .locator("strong"),
    ).toHaveText("4");
    return result.json();
  };
  const firstDemo = await enter(page);
  assert.equal(
    await db.user.count({ where: { isDemo: false } }),
    0,
    "Demo must not depend on seeded employee accounts",
  );
  const owner = await db.user.findUniqueOrThrow({
    where: { id: firstDemo.user.id },
  });
  const session = await db.session.findFirstOrThrow({
    where: { userId: owner.id },
  });
  assert.equal(session.expiresAt.getTime(), owner.demoExpiresAt.getTime());
  assert.ok(owner.demoExpiresAt.getTime() - Date.now() <= 3600000);
  assert.ok(owner.demoExpiresAt.getTime() - Date.now() > 3500000);
  const summary = await first.request.get("/api/summary");
  assert.equal(summary.status(), 200);
  const totals = await summary.json();
  assert.equal(totals.companies, 3);
  assert.equal(totals.openOpportunities, 4);
  assert.equal(totals.openValue, "117000");
  await page.reload();
  await expect(page.locator(".metrics")).toBeVisible();
  const second = await makeContext(true),
    mobile = await second.newPage();
  const secondDemo = await enter(mobile);
  assert.notEqual(secondDemo.user.id, owner.id);
  const company = await db.company.findFirstOrThrow({
    where: { assignedToId: owner.id },
  });
  assert.equal(
    (await second.request.get(`/api/companies/${company.id}`)).status(),
    404,
  );
  assert.equal(
    (
      await second.request.put(`/api/companies/${company.id}`, {
        headers: { Origin: env.APP_ORIGIN, "x-csrf-token": secondDemo.csrf },
        data: {},
      })
    ).status(),
    404,
  );
  for (let i = 3; i < 20; i++) {
    const created = await first.request.post("/api/companies", {
      headers: { Origin: env.APP_ORIGIN, "x-csrf-token": firstDemo.csrf },
      data: {
        name: "Fictional quota sample",
        industry: "",
        phone: "",
        website: "",
        assignedToId: owner.id,
      },
    });
    assert.equal(created.status(), 201);
  }
  assert.equal(
    (
      await first.request.post("/api/companies", {
        headers: { Origin: env.APP_ORIGIN, "x-csrf-token": firstDemo.csrf },
        data: { name: "Fictional quota overflow", assignedToId: owner.id },
      })
    ).status(),
    409,
  );
  await db.user.update({
    where: { id: owner.id },
    data: { demoExpiresAt: new Date(0) },
  });
  assert.equal((await first.request.get("/api/summary")).status(), 401);
  assert.equal((await second.request.get("/api/summary")).status(), 200);
  await first.close();
  await second.close();
  console.log(
    "Pristine demo regression passed: desktop/mobile entry and dashboard, reload persistence, isolation, quota and fixed expiry; no development seeds.",
  );
} finally {
  if (browser) await browser.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise((resolveClose) => proxy.close(resolveClose));
  }
  if (server) {
    server.kill();
    await new Promise((resolveExit) => {
      if (server.exitCode !== null) return resolveExit();
      server.once("exit", resolveExit);
      setTimeout(resolveExit, 10000).unref();
    });
  }
  await db.$disconnect();
}
