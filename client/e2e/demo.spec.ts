import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
if (existsSync("server/.env")) process.loadEnvFile("server/.env");

test("visitor demo: no credentials, editable samples, isolation, persistence, exit and expiry", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith("_test") ||
    url === process.env.DATABASE_URL
  )
    throw new Error("Separate isolated test database required");
  const { database } = await import("../../server/src/db.js");
  const { cleanupExpiredDemos } = await import("../../server/src/demo.js");
  const db = database(url),
    ids: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = (p: Page, name: string) =>
    p
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  async function enter(p: Page) {
    await p.goto("/");
    await expect(
      p.getByText(
        "Explore a temporary workspace with sample data. No account required.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(p.getByLabel("Email address")).toHaveValue("");
    if (p === page) await p.screenshot({ path: `test-results/${info.project.name}-visitor-demo-login.png`, fullPage: true });
    const response = p.waitForResponse(
      (r) => r.url().endsWith("/api/auth/demo") && r.status() === 201,
    );
    await p.getByRole("button", { name: "Try demo", exact: true }).click();
    ids.push((await (await response).json()).user.id);
    await expect(
      p.getByRole("region", { name: "Demo workspace", exact: true }),
    ).toContainText("Do not enter personal or confidential information");
    await expect(
      p.getByText("Updating workspace…", { exact: true }),
    ).toHaveCount(0);
  }
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:5174" });
  try {
    await enter(page);
    await page.screenshot({
      path: `test-results/${info.project.name}-visitor-demo.png`,
      fullPage: true,
    });
    await nav(page, "Pipeline");
    await expect(page.locator(".deal")).toHaveCount(6);
    await expect(page.locator(".lane h2 span:last-child")).toHaveText([
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
    ]);
    await nav(page, "Companies");
    await page
      .getByRole("button", { name: "New company", exact: true })
      .click();
    await page.getByLabel("Company name").fill("Visitor Sample Studio");
    await expect(
      page.getByLabel("Assigned representative").locator("option"),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Save company", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const row = page
      .getByRole("row")
      .filter({ hasText: "Visitor Sample Studio" });
    await row.getByRole("button", { name: "View / edit", exact: true }).click();
    await page.getByLabel("Industry").fill("Fictional sample studio");
    await page
      .getByRole("button", { name: "Save company", exact: true })
      .click();
    await expect(row).toContainText("Fictional sample studio");
    await nav(page, "Contacts");
    await page
      .getByRole("button", { name: "New contact", exact: true })
      .click();
    await page.getByLabel("Contact name").fill("Robin Elm");
    await page
      .getByLabel("Company", { exact: false })
      .selectOption({ label: "Visitor Sample Studio" });
    await page
      .getByRole("button", { name: "Save contact", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await nav(page, "Pipeline");
    await page
      .getByRole("button", { name: "New opportunity", exact: true })
      .click();
    await page.getByLabel("Opportunity title").fill("Visitor supply plan");
    await page
      .getByLabel("Company", { exact: false })
      .selectOption({ label: "Visitor Sample Studio" });
    await page
      .getByLabel("Contact", { exact: true })
      .selectOption({ label: "Robin Elm" });
    await page.getByLabel("Estimated value").fill("2345.67");
    await page
      .getByRole("button", { name: "Save opportunity", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Visitor supply plan", exact: true })
      .click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/stage") && r.status() === 200,
      ),
      page.getByLabel("Pipeline stage").selectOption("PROPOSAL_SENT"),
    ]);
    await page
      .getByLabel("Add a note")
      .fill("Sample discussion complete. Prepare the next steps.");
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(
      page.getByText("Sample discussion complete.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page.getByLabel("Task title").fill("Review the sample proposal");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("checkbox", {
        name: "Complete Review the sample proposal",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("checkbox", {
        name: "Complete Review the sample proposal",
        exact: true,
      }),
    ).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Demo workspace", exact: true }),
    ).toBeVisible();
    await nav(page, "Pipeline");
    await page
      .getByRole("button", { name: "Visitor supply plan", exact: true })
      .click();
    await expect(page.getByLabel("Pipeline stage")).toHaveValue(
      "PROPOSAL_SENT",
    );
    await expect(
      page.getByText("Sample discussion complete.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "Complete Review the sample proposal",
        exact: true,
      }),
    ).toBeChecked();

    const second = await other.newPage();
    await enter(second);
    expect(ids[0]).not.toBe(ids[1]);
    await nav(second, "Companies");
    await second
      .getByRole("textbox", { name: "Search companies" })
      .fill("Visitor Sample Studio");
    await expect(
      second.getByRole("heading", { name: "No matches found", exact: true }),
    ).toBeVisible();
    await second
      .getByRole("region", { name: "Demo workspace", exact: true })
      .getByRole("button", { name: "Exit demo", exact: true })
      .click();
    await expect(
      second.getByRole("button", { name: "Try demo", exact: true }),
    ).toBeVisible();
    expect((await second.request.get("/api/summary")).status()).toBe(401);
    expect(await db.session.count({ where: { userId: ids[1] } })).toBe(0);

    await db.user.update({
      where: { id: ids[0] },
      data: { demoExpiresAt: new Date(0) },
    });
    await nav(page, "Tasks");
    await expect(
      page.getByRole("button", { name: "Try demo", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("session has expired");
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await db.user.updateMany({
      where: { id: { in: ids }, isDemo: true },
      data: { demoExpiresAt: new Date(0) },
    });
    await cleanupExpiredDemos(new Date(), db);
    await db.$disconnect();
  }
});
