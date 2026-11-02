import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  demoOperations,
  demoProvisioningFailure,
} from "../src/demo-diagnostics.js";
import { HttpError } from "../src/errors.js";
import { provisionDemo } from "../src/demo.js";
import { db } from "../src/db.js";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated test environment required");

test("demo diagnostics expose only a static operation and database codes", () => {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  const sensitive = "private-test-canary";
  try {
    for (const operation of demoOperations) {
      const error = demoProvisioningFailure(operation, {
        code: "P2003",
        message: sensitive,
        meta: {
          visitor: sensitive,
          driverAdapterError: {
            cause: {
              originalCode: "1452",
              originalMessage: sensitive,
              sql: sensitive,
            },
          },
        },
        cookies: sensitive,
        connectionString: sensitive,
      });
      assert.equal(error.status, 500);
      assert.ok(!error.message.includes("linked records"));
      assert.deepEqual(logs.at(-1), [
        "Demo provisioning failed",
        { operation, prismaCode: "P2003", mysqlCode: "1452" },
      ]);
    }
    demoProvisioningFailure("company.create", {
      code: sensitive,
      meta: { driverAdapterError: { cause: { originalCode: sensitive } } },
    });
    assert.deepEqual(logs.at(-1), [
      "Demo provisioning failed",
      { operation: "company.create", prismaCode: "UNKNOWN" },
    ]);
    assert.ok(!JSON.stringify(logs).includes(sensitive));
  } finally {
    console.error = original;
  }
});

test("provisioning reports the failing operation after the transaction rejects", async () => {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  let rejected = false;
  const failure = new Prisma.PrismaClientKnownRequestError(
    "private-test-canary",
    { code: "P2003", clientVersion: "test" },
  );
  const store = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      try {
        return await work({
          user: { create: async () => ({ id: 1 }) },
          company: {
            create: async () => {
              throw failure;
            },
          },
        });
      } catch (error) {
        rejected = true;
        throw error;
      }
    },
  } as unknown as Pick<typeof db, "$transaction">;
  try {
    await assert.rejects(
      provisionDemo(
        { id: "test-session", csrf: "test-csrf" },
        undefined,
        store,
      ),
      (error) => error instanceof HttpError && error.status === 500,
    );
    assert.equal(rejected, true);
    assert.deepEqual(logs, [
      [
        "Demo provisioning failed",
        { operation: "company.create", prismaCode: "P2003" },
      ],
    ]);
  } finally {
    console.error = original;
    await db.$disconnect();
  }
});

test("real session foreign-key failure rolls back the entire demo and preserves the anonymous session", async () => {
  const previous = await db.session.create({
    data: {
      id: randomBytes(32).toString("hex"),
      csrf: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const counts = () =>
    Promise.all([
      db.user.count(),
      db.company.count(),
      db.contact.count(),
      db.opportunity.count(),
      db.note.count(),
      db.task.count(),
      db.session.count(),
    ]);
  const before = await counts();
  const logs: unknown[][] = [],
    original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  const store = {
    $transaction: (
      work: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      db.$transaction(
        (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key !== "session") return Reflect.get(target, key);
                return {
                  ...target.session,
                  create: (args: Prisma.SessionCreateArgs) =>
                    target.session.create({
                      ...args,
                      data: {
                        id: args.data.id,
                        csrf: args.data.csrf,
                        expiresAt: args.data.expiresAt,
                        userId: -1,
                      },
                    }),
                };
              },
            }),
          ),
        options,
      ),
  } as unknown as Pick<typeof db, "$transaction">;
  try {
    await assert.rejects(
      provisionDemo(
        {
          id: randomBytes(32).toString("hex"),
          csrf: randomBytes(32).toString("hex"),
        },
        previous.id,
        store,
      ),
      (error) => error instanceof HttpError && error.status === 500,
    );
    assert.deepEqual(await counts(), before);
    assert.ok(await db.session.findUnique({ where: { id: previous.id } }));
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], [
      "Demo provisioning failed",
      {
        operation: "authenticated-session.create",
        prismaCode: "P2003",
        mysqlCode: "1452",
      },
    ]);
  } finally {
    console.error = original;
    await db.session.deleteMany({ where: { id: previous.id } });
    await db.$disconnect();
  }
});
