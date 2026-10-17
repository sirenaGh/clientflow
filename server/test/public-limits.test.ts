import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { db } from "../src/db.js";
import { publicLimit } from "../src/public-limits.js";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");

test("MySQL public budgets serialize concurrent requests and persist across middleware instances", async () => {
  const kind = `test-${randomUUID().slice(0, 16)}`;
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const makeApp = (session = false) => {
    const app = express();
    app.use((req, _res, next) => {
      if (session) req.sessionKey = "a".repeat(64);
      next();
    });
    app.use(
      publicLimit(
        kind + (session ? "-session" : ""),
        session ? 20 : 3,
        3600000,
        session ? 2 : undefined,
      ),
    );
    app.get("/", (_req, res) => res.json({ ok: true }));
    app.use(
      (
        error: { status: number; message: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status(error.status || 500).json({ message: error.message }),
    );
    return app;
  };
  try {
    const app = makeApp();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .get("/")
          .set("X-Forwarded-For", `192.0.2.${i + 1}`),
      ),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 3);
    assert.equal(responses.filter((r) => r.status === 429).length, 7);
    assert.ok(responses.find((r) => r.status === 429)!.headers["retry-after"]);
    await request(makeApp()).get("/").expect(429);
    await request(makeApp(true)).get("/").expect(200);
    await request(makeApp(true)).get("/").expect(200);
    await request(makeApp(true)).get("/").expect(429);
  } finally {
    process.env.NODE_ENV = previous;
    await db.publicRateBucket.deleteMany({
      where: { key: { startsWith: kind } },
    });
    await db.$disconnect();
  }
});
