import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseSettings } from "../database-config.js";
import { db } from "../src/db.js";
import { runMaintenance } from "../src/maintenance.js";
import { randomUUID } from "node:crypto";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
test("database TLS fails closed without trusting insecure URL flags", () => {
  const url = "mysql://USER:DB_PASSWORD@service.aivencloud.com:12345/defaultdb";
  assert.throws(() => databaseSettings(url, {}), /absolute DB_TLS_CA_FILE/);
  assert.throws(
    () => databaseSettings(url + "?sslaccept=accept_invalid_certs", {}),
    /strict/,
  );
  assert.throws(
    () => databaseSettings(url + "?sslmode=require", {}),
    /Unsupported/,
  );
  assert.throws(
    () => databaseSettings(url, { DB_TLS_CA_FILE: "relative.pem" }),
    /absolute/,
  );
  assert.throws(
    () => databaseSettings("malformed-private-value", {}),
    (e) => e instanceof Error && !e.message.includes("malformed-private-value"),
  );
  assert.equal(
    databaseSettings("mysql://USER:DB_PASSWORD@127.0.0.1/example", {}).adapter
      .ssl,
    undefined,
  );
});
test("maintenance coalesces overlapping batches, bounds work, and preserves active demos and normal users", async () => {
  const prefix = randomUUID();
  const ids: number[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      const u = await db.user.create({
        data: {
          name: "Expired sample",
          email: `${prefix}-${i}@example.invalid`,
          passwordHash: "!disabled",
          role: "SALES",
          isDemo: true,
          demoExpiresAt: new Date(0),
        },
      });
      ids.push(u.id);
    }
    const active = await db.user.create({
      data: {
        name: "Active sample",
        email: `${prefix}-active@example.invalid`,
        passwordHash: "!disabled",
        role: "SALES",
        isDemo: true,
        demoExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    ids.push(active.id);
    const normal = await db.user.count({ where: { isDemo: false } });
    const a = runMaintenance(),
      b = runMaintenance();
    assert.equal(a, b);
    await a;
    assert.equal(
      await db.user.count({
        where: { id: { in: ids }, demoExpiresAt: new Date(0) },
      }),
      2,
    );
    assert.ok(await db.user.findUnique({ where: { id: active.id } }));
    assert.equal(await db.user.count({ where: { isDemo: false } }), normal);
    await runMaintenance();
    assert.equal(await db.user.count({ where: { id: { in: ids } } }), 1);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids }, isDemo: true } });
    await db.$disconnect();
  }
});
