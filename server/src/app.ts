import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import {
  createHash,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { db } from "./db.js";
import { crmWrite } from "./ownership.js";
import { HttpError } from "./errors.js";
import { checkDemoLimit, demoEnabled, provisionDemo } from "./demo.js";

declare global {
  namespace Express {
    interface Request {
      actor?: User;
      sessionKey?: string;
      csrf?: string;
    }
  }
}
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32 || secret.startsWith("REPLACE_"))
  throw new Error("SESSION_SECRET must contain at least 32 characters");
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const production = process.env.NODE_ENV === "production";
const cookieName = production ? "__Host-clientflow" : "clientflow";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const signature = (s: string) =>
  createHmac("sha256", secret).update(s).digest("hex");
const sign = (s: string) => `${s}.${signature(s)}`;
function verify(s: unknown) {
  if (typeof s !== "string" || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(s))
    return undefined;
  const [token, mac] = s.split(".");
  if (!token || !mac || mac.length !== 64) return undefined;
  const a = Buffer.from(mac),
    b = Buffer.from(signature(token));
  return a.length === b.length && timingSafeEqual(a, b)
    ? hash(token)
    : undefined;
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const id = z.coerce.number().int().positive();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid calendar date")
  .transform((s) => new Date(s + "T00:00:00.000Z"));
const companySchema = z.object({
  name: text(160),
  industry: optionalText(120),
  website: z
    .union([
      z.literal(""),
      z.url().refine((s) => /^https?:/.test(s), "Use http or https"),
    ])
    .default(""),
  phone: optionalText(50),
  assignedToId: id,
});
const contactSchema = z.object({
  name: text(160),
  jobTitle: optionalText(120),
  email: z.union([z.literal(""), z.email().max(190)]).default(""),
  phone: optionalText(50),
  companyId: id,
});
const stages = [
  "NEW",
  "CONTACTED",
  "DEMO_SCHEDULED",
  "PROPOSAL_SENT",
  "WON",
  "LOST",
] as const;
const opportunitySchema = z.object({
  title: text(160),
  companyId: id,
  contactId: id.nullable().default(null),
  assignedToId: id,
  value: z
    .string()
    .regex(
      /^\d{1,12}(\.\d{1,2})?$/,
      "Enter a positive USD amount with up to two decimal places",
    ),
  expectedCloseDate: date,
  stage: z.enum(stages),
  description: optionalText(10000),
});
const taskSchema = z.object({
  title: text(160),
  dueDate: date,
  assignedToId: id,
  opportunityId: id,
  completed: z.boolean().default(false),
});
function scope(req: Request) {
  return req.actor!.role === "ADMIN"
    ? { assignedTo: { isDemo: false } }
    : { assignedToId: req.actor!.id };
}
async function company(
  req: Request,
  companyId: number,
  store: Prisma.TransactionClient = db,
) {
  return (
    (await store.company.findFirst({
      where: { id: companyId, ...scope(req) },
    })) || fail(404, "Company not found")
  );
}
async function opportunity(
  req: Request,
  opportunityId: number,
  store: Prisma.TransactionClient = db,
) {
  return (
    (await store.opportunity.findFirst({
      where: { id: opportunityId, ...scope(req) },
    })) || fail(404, "Opportunity not found")
  );
}
async function assignee(
  req: Request,
  assignedToId: number,
  store: Prisma.TransactionClient = db,
) {
  if (req.actor!.role !== "ADMIN" && assignedToId !== req.actor!.id)
    fail(403, "Assign records to yourself");
  const user = await store.user.findUnique({ where: { id: assignedToId } });
  if (!user || user.role !== "SALES" || user.isDemo !== req.actor!.isDemo)
    fail(400, "Choose a sales representative");
}
async function relation(
  req: Request,
  data: z.infer<typeof opportunitySchema>,
  store: Prisma.TransactionClient = db,
) {
  const c = await company(req, data.companyId, store);
  if (c.assignedToId !== data.assignedToId)
    fail(400, "Opportunity and company must have the same representative");
  await assignee(req, data.assignedToId, store);
  if (
    data.contactId &&
    !(await store.contact.findFirst({
      where: { id: data.contactId, companyId: data.companyId },
    }))
  )
    fail(400, "Contact must belong to this company");
}
async function taskRelation(
  req: Request,
  data: z.infer<typeof taskSchema>,
  store: Prisma.TransactionClient = db,
) {
  const o = await opportunity(req, data.opportunityId, store);
  await assignee(req, data.assignedToId, store);
  if (o.assignedToId !== data.assignedToId)
    fail(400, "Task and opportunity must have the same representative");
}
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(160).default(""),
});
const pageSize = 10;
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", async (req, res, next) => {
  const key = verify(req.cookies[cookieName]);
  if (key) {
    const s = await db.session.findUnique({
      where: { id: key },
      include: { user: true },
    });
    if (
      s &&
      s.expiresAt > new Date() &&
      (!s.user?.isDemo ||
        (demoEnabled() &&
          s.user.demoExpiresAt &&
          s.user.demoExpiresAt > new Date()))
    ) {
      req.sessionKey = key;
      req.csrf = s.csrf;
      req.actor = s.user ?? undefined;
    }
  }
  next();
});
async function newSession(res: Response, userId?: number) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: hash(token),
      csrf,
      userId,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  });
  sessionCookie(res, token, new Date(Date.now() + 8 * 60 * 60 * 1000));
  return csrf;
}
function sessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(cookieName, sign(token), {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}
const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  isDemo: u.isDemo,
  demoExpiresAt: u.demoExpiresAt,
});
app.get("/api/auth/session", async (req, res) =>
  res.json({
    demoEnabled: demoEnabled(),
    user: req.actor ? publicUser(req.actor) : null,
    csrf: req.csrf || (await newSession(res)),
  }),
);
app.use("/api", (req, _res, next) => {
  if (!req.actor && !["/auth/login", "/auth/demo"].includes(req.path))
    return next(new HttpError(401, "Sign in to continue"));
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (
      req.get("origin") !== origin ||
      !req.csrf ||
      req.get("x-csrf-token") !== req.csrf
    )
      return next(
        new HttpError(
          403,
          "Invalid CSRF token or origin. Reload and try again.",
        ),
      );
  }
  next();
});
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again in 15 minutes." },
});
app.post("/api/auth/login", loginLimit, async (req, res) => {
  const input = z
    .object({
      email: z
        .email()
        .max(190)
        .transform((s) => s.toLowerCase()),
      password: z.string().min(1).max(256),
    })
    .parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  // A real hash verification also runs for unknown accounts to reduce timing differences.
  const valid =
    user && !user.isDemo
      ? await argon2.verify(user.passwordHash, input.password)
      : await argon2.verify(await dummyHash, input.password);
  if (!user || user.isDemo || !valid)
    fail(401, "Email or password is incorrect");
  if (req.sessionKey)
    await db.session.deleteMany({ where: { id: req.sessionKey } });
  res.json({ user: publicUser(user), csrf: await newSession(res, user.id) });
});
const demoLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Demo creation limit reached. Try again in an hour." },
});
app.post("/api/auth/demo", demoLimit, async (req, res) => {
  if (!demoEnabled()) fail(404, "Visitor demo is not enabled");
  if (req.actor)
    fail(409, "Exit your current workspace before starting a demo");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  const user = await provisionDemo({ id: hash(token), csrf }, req.sessionKey);
  sessionCookie(res, token, user.demoExpiresAt!);
  res.status(201).json({ user: publicUser(user), csrf });
});
const dummyHash = argon2.hash(randomBytes(32));
app.post("/api/auth/logout", async (req, res) => {
  if (req.actor?.isDemo) {
    await crmWrite(req.actor, async (tx) => {
      await tx.user.update({
        where: { id: req.actor!.id },
        data: { demoExpiresAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: req.actor!.id } });
    });
  } else if (req.sessionKey)
    await db.session.deleteMany({ where: { id: req.sessionKey } });
  res
    .clearCookie(cookieName, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/",
    })
    .json({ ok: true });
});
app.use("/api", (req, _res, next) =>
  req.actor ? next() : next(new HttpError(401, "Sign in to continue")),
);
app.get("/api/representatives", async (req, res) =>
  res.json(
    await db.user.findMany({
      where: {
        role: "SALES",
        isDemo: req.actor!.isDemo,
        ...(req.actor!.role === "ADMIN" ? {} : { id: req.actor!.id }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ),
);
app.get("/api/summary", async (req, res) => {
  const where = scope(req),
    open = {
      ...where,
      stage: { notIn: ["WON", "LOST"] as ("WON" | "LOST")[] },
    };
  const [companies, openOpportunities, total, won, overdueTasks] =
    await Promise.all([
      db.company.count({ where }),
      db.opportunity.count({ where: open }),
      db.opportunity.aggregate({ where: open, _sum: { value: true } }),
      db.opportunity.aggregate({
        where: { ...where, stage: "WON" },
        _sum: { value: true },
      }),
      db.task.count({
        where: {
          ...where,
          completed: false,
          dueDate: { lt: new Date(new Date().toISOString().slice(0, 10)) },
        },
      }),
    ]);
  res.json({
    companies,
    openOpportunities,
    openValue: total._sum.value?.toString() || "0",
    wonValue: won._sum.value?.toString() || "0",
    overdueTasks,
  });
});
app.get("/api/companies", async (req, res) => {
  const { page, q } = paging.parse(req.query),
    where = { ...scope(req), name: { contains: q } };
  const [items, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        assignedTo: { select: { name: true } },
        _count: { select: { contacts: true, opportunities: true } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.company.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});
app.get("/api/companies/:id", async (req, res) => {
  const c = await company(req, id.parse(req.params.id));
  res.json(c);
});
app.post("/api/companies", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const data = companySchema.parse(req.body);
    await assignee(req, data.assignedToId, db);
    await checkDemoLimit(db, req.actor!, "company");
    return await db.company.create({ data });
  });
  res.status(201).json(result);
});
app.put("/api/companies/:id", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const c = await company(req, id.parse(req.params.id), db),
      data = companySchema.parse(req.body);
    await assignee(req, data.assignedToId, db);
    if (
      c.assignedToId !== data.assignedToId &&
      (await db.opportunity.count({ where: { companyId: c.id } }))
    )
      fail(409, "Reassignment requires a company without opportunities");
    return await db.company.update({ where: { id: c.id }, data });
  });
  res.status(200).json(result);
});
app.delete("/api/companies/:id", async (req, res) => {
  await crmWrite(req.actor!, async (db) => {
    const c = await company(req, id.parse(req.params.id), db);
    await db.company.delete({ where: { id: c.id } });
    return;
  });
  res.status(204).end();
});
app.get("/api/contacts", async (req, res) => {
  const { page, q } = paging.parse(req.query),
    companyId = req.query.companyId ? id.parse(req.query.companyId) : undefined;
  const where = {
    company: { ...scope(req) },
    companyId,
    OR: [{ name: { contains: q } }, { email: { contains: q } }],
  };
  const [items, total] = await Promise.all([
    db.contact.findMany({
      where,
      include: { company: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.contact.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});
async function contact(req: Request, store: Prisma.TransactionClient = db) {
  return (
    (await store.contact.findFirst({
      where: { id: id.parse(req.params.id), company: { ...scope(req) } },
    })) || fail(404, "Contact not found")
  );
}
app.get("/api/contacts/:id", async (req, res) => res.json(await contact(req)));
app.post("/api/contacts", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const data = contactSchema.parse(req.body);
    await company(req, data.companyId, db);
    await checkDemoLimit(db, req.actor!, "contact");
    return await db.contact.create({ data });
  });
  res.status(201).json(result);
});
app.put("/api/contacts/:id", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const c = await contact(req, db),
      data = contactSchema.parse(req.body);
    await company(req, data.companyId, db);
    if (
      c.companyId !== data.companyId &&
      (await db.opportunity.count({ where: { contactId: c.id } }))
    )
      fail(409, "A contact linked to opportunities cannot move company");
    return await db.contact.update({ where: { id: c.id }, data });
  });
  res.status(200).json(result);
});
app.delete("/api/contacts/:id", async (req, res) => {
  await crmWrite(req.actor!, async (db) => {
    const c = await contact(req, db);
    await db.contact.delete({ where: { id: c.id } });
    return;
  });
  res.status(204).end();
});
app.get("/api/opportunities", async (req, res) => {
  const { page, q } = paging.parse(req.query),
    where = { ...scope(req), title: { contains: q } };
  const [items, total] = await Promise.all([
    db.opportunity.findMany({
      where,
      include: {
        company: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ expectedCloseDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.opportunity.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});
app.get("/api/opportunities/:id", async (req, res) => {
  const result = await db.opportunity.findFirst({
    where: { id: id.parse(req.params.id), ...scope(req) },
    include: {
      company: true,
      contact: true,
      assignedTo: { select: { name: true } },
      notes: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      tasks: { orderBy: { dueDate: "asc" } },
    },
  });
  res.json(result || fail(404, "Opportunity not found"));
});
app.post("/api/opportunities", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const data = opportunitySchema.parse(req.body);
    await relation(req, data, db);
    await checkDemoLimit(db, req.actor!, "opportunity");
    return await db.opportunity.create({ data });
  });
  res.status(201).json(result);
});
app.put("/api/opportunities/:id", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const o = await opportunity(req, id.parse(req.params.id), db),
      data = opportunitySchema.parse(req.body);
    await relation(req, data, db);
    if (
      o.assignedToId !== data.assignedToId &&
      (await db.task.count({ where: { opportunityId: o.id } }))
    )
      fail(409, "An opportunity with tasks cannot be reassigned");
    return await db.opportunity.update({ where: { id: o.id }, data });
  });
  res.status(200).json(result);
});
app.patch("/api/opportunities/:id/stage", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const o = await opportunity(req, id.parse(req.params.id), db),
      { stage } = z.object({ stage: z.enum(stages) }).parse(req.body);
    return await db.opportunity.update({
      where: { id: o.id },
      data: { stage },
    });
  });
  res.status(200).json(result);
});
app.delete("/api/opportunities/:id", async (req, res) => {
  await crmWrite(req.actor!, async (db) => {
    const o = await opportunity(req, id.parse(req.params.id), db);
    await db.opportunity.delete({ where: { id: o.id } });
    return;
  });
  res.status(204).end();
});
app.post("/api/opportunities/:id/notes", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const o = await opportunity(req, id.parse(req.params.id), db),
      { body } = z.object({ body: text(10000) }).parse(req.body);
    await checkDemoLimit(db, req.actor!, "note");
    return await db.note.create({
      data: { body, opportunityId: o.id, authorId: req.actor!.id },
    });
  });
  res.status(201).json(result);
});
app.delete("/api/notes/:id", async (req, res) => {
  await crmWrite(req.actor!, async (db) => {
    const n =
      (await db.note.findFirst({
        where: { id: id.parse(req.params.id), opportunity: { ...scope(req) } },
      })) || fail(404, "Note not found");
    await db.note.delete({ where: { id: n.id } });
    return;
  });
  res.status(204).end();
});
app.get("/api/tasks", async (req, res) => {
  const { page, q } = paging.parse(req.query),
    filter = z
      .enum(["upcoming", "overdue", "completed", "all"])
      .default("upcoming")
      .parse(req.query.filter),
    today = new Date(new Date().toISOString().slice(0, 10));
  const where = {
    ...scope(req),
    title: { contains: q },
    ...(filter === "completed"
      ? { completed: true }
      : filter === "all"
        ? {}
        : {
            completed: false,
            dueDate: filter === "overdue" ? { lt: today } : { gte: today },
          }),
  };
  const [items, total] = await Promise.all([
    db.task.findMany({
      where,
      include: {
        opportunity: { select: { title: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.task.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});
async function task(req: Request, store: Prisma.TransactionClient = db) {
  return (
    (await store.task.findFirst({
      where: { id: id.parse(req.params.id), ...scope(req) },
    })) || fail(404, "Task not found")
  );
}
app.get("/api/tasks/:id", async (req, res) => res.json(await task(req)));
app.post("/api/tasks", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const data = taskSchema.parse(req.body);
    await taskRelation(req, data, db);
    await checkDemoLimit(db, req.actor!, "task");
    return await db.task.create({ data });
  });
  res.status(201).json(result);
});
app.put("/api/tasks/:id", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const t = await task(req, db),
      data = taskSchema.parse(req.body);
    await taskRelation(req, data, db);
    return await db.task.update({ where: { id: t.id }, data });
  });
  res.status(200).json(result);
});
app.patch("/api/tasks/:id", async (req, res) => {
  const result = await crmWrite(req.actor!, async (db) => {
    const t = await task(req, db),
      data = z.object({ completed: z.boolean() }).parse(req.body);
    return await db.task.update({ where: { id: t.id }, data });
  });
  res.status(200).json(result);
});
app.delete("/api/tasks/:id", async (req, res) => {
  await crmWrite(req.actor!, async (db) => {
    const t = await task(req, db);
    await db.task.delete({ where: { id: t.id } });
    return;
  });
  res.status(204).end();
});
app.use((_req, _res, next) => next(new HttpError(404, "Endpoint not found")));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      message: "Check the form fields",
      issues: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      res.status(409).json({
        message:
          "This record has linked records. Remove the links before deleting.",
      });
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json({ message: "Record no longer exists" });
      return;
    }
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ message: "Invalid JSON request" });
    return;
  }
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res.status(413).json({ message: "Request is too large" });
    return;
  }
  // Do not log request bodies, database connection strings, or authentication secrets.
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  res
    .status(500)
    .json({ message: "The request could not be completed. Please try again." });
});
