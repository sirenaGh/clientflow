import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
if (existsSync("server/.env")) process.loadEnvFile("server/.env");

test("deletion, filtered pagination and open-app session recovery", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240000);
  const url = process.env.TEST_DATABASE_URL!;
  if (
    !url ||
    !new URL(url).pathname.endsWith("_test") ||
    url === process.env.DATABASE_URL
  )
    throw new Error("Separate isolated test database required");
  const { database } = await import("../../server/src/db.js");
  const db = database(url);
  const prefix = `Regression ${info.project.name} ${randomUUID().slice(0, 8)}`;
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "avery@clientflow.test" },
  });
  const companies: number[] = [],
    opportunities: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const nav = (name: string) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  const login = async () => {
    await page.getByLabel("Email address").fill(owner.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.SEED_SALES_ONE_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("navigation")).toBeVisible({ timeout: 30000 });
  };
  const companyData = {
    industry: "Fictional testing",
    website: "",
    phone: "",
    assignedToId: owner.id,
  };
  try {
    for (let i = 0; i < 11; i++) {
      const c = await db.company.create({
        data: {
          ...companyData,
          name: `${prefix} Company ${String(i).padStart(2, "0")}`,
        },
      });
      companies.push(c.id);
    }
    const dealData = {
      title: `${prefix} Follow-up`,
      companyId: companies[0],
      assignedToId: owner.id,
      description: "Fictional regression fixture",
      value: "500.25",
      stage: "NEW" as const,
      expectedCloseDate: new Date("2040-01-20"),
    };
    const linked = await db.opportunity.create({ data: dealData });
    opportunities.push(linked.id);
    const empty = await db.opportunity.create({
      data: { ...dealData, title: `${prefix} Delete` },
    });
    opportunities.push(empty.id);
    for (let i = 0; i < 11; i++)
      await db.task.create({
        data: {
          title: `${prefix} Task ${i}`,
          assignedToId: owner.id,
          opportunityId: linked.id,
          dueDate: new Date(`2040-01-${String(i + 1).padStart(2, "0")}`),
        },
      });
    await page.goto("/");
    await login();
    await nav("Pipeline");
    await page.getByRole("textbox", { name: "Search pipeline" }).fill(prefix);
    await expect(
      page.getByRole("button", { name: empty.title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: empty.title, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: empty.title, exact: true }),
    ).toBeVisible();
    const deletedDetailRequests: string[] = [];
    let deleted = false;
    page.on("request", (request) => {
      if (
        deleted &&
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/api/opportunities/${empty.id}`
      )
        deletedDetailRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/opportunities/${empty.id}`) &&
        response.status() === 204
      )
        deleted = true;
    });
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete record", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pipeline", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Record deleted" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: empty.title, exact: true }),
    ).toHaveCount(0);
    expect(deletedDetailRequests).toEqual([]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      await db.opportunity.findUnique({ where: { id: empty.id } }),
    ).toBeNull();

    await nav("Companies");
    await page.getByRole("textbox", { name: "Search companies" }).fill(prefix);
    await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
    await page
      .getByRole("row")
      .filter({ hasText: `${prefix} Company 10` })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete record", exact: true })
      .click();
    await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    await expect(page.getByText("Page 2 of 1", { exact: true })).toHaveCount(0);

    await nav("Tasks");
    await page.getByRole("textbox", { name: "Search tasks" }).fill(prefix);
    await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: `Complete ${prefix} Task 10`,
        exact: true,
      })
      .click();
    await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    expect(
      await db.task.count({
        where: { opportunityId: linked.id, completed: true },
      }),
    ).toBe(1);
    await page.reload();
    await nav("Tasks");
    await page.getByRole("textbox", { name: "Search tasks" }).fill(prefix);
    await expect(page.locator("tbody tr")).toHaveCount(10);

    // Corrupt only the outgoing token; the real API must return 403, not sign out.
    await page.route(
      "**/api/tasks/*",
      async (route) => {
        await route.continue({
          headers: { ...route.request().headers(), "x-csrf-token": "invalid" },
        });
      },
      { times: 1 },
    );
    await page
      .getByRole("checkbox", { name: `Complete ${prefix} Task 0`, exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Invalid CSRF");
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: `Complete ${prefix} Task 0`,
        exact: true,
      }),
    ).not.toBeChecked();
    const cookie = (await context.cookies()).find(
      (c) => c.name === "clientflow",
    )!;
    const key = createHash("sha256")
      .update(cookie.value.split(".")[0])
      .digest("hex");
    await db.session.update({
      where: { id: key },
      data: { expiresAt: new Date(0) },
    });
    let attempts = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH") attempts++;
    });
    await page
      .getByRole("checkbox", { name: `Complete ${prefix} Task 0`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("session has expired");
    await login();
    const newCookie = (await context.cookies()).find(
      (c) => c.name === "clientflow",
    )!;
    expect(newCookie.value).not.toBe(cookie.value);
    expect(attempts).toBe(1);
    expect(
      await db.task.count({
        where: { opportunityId: linked.id, completed: true },
      }),
    ).toBe(1);
    await nav("Tasks");
    await page.getByRole("textbox", { name: "Search tasks" }).fill(prefix);
    await expect(
      page.getByRole("checkbox", {
        name: `Complete ${prefix} Task 0`,
        exact: true,
      }),
    ).not.toBeChecked();
    // Invalidation while idle is also detected on focus, without a manual reload.
    const newKey = createHash("sha256")
      .update(newCookie.value.split(".")[0])
      .digest("hex");
    await db.session.delete({ where: { id: newKey } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText("session has expired");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await db.task.deleteMany({
      where: { opportunityId: { in: opportunities } },
    });
    await db.opportunity.deleteMany({ where: { id: { in: opportunities } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.$disconnect();
  }
});
