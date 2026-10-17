import { test, expect, devices, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

test("capture fictional admin and representative review screens and verify pipeline pagination", async ({
  browser,
  page,
}) => {
  const output = "documentation/screenshots";
  mkdirSync(output, { recursive: true });
  const errors: string[] = [];
  const watch = (p: Page) => p.on("pageerror", (e) => errors.push(e.message));
  watch(page);
  const settle = async (p: Page) => {
    await expect(
      p.getByText("Updating workspace…", { exact: true }),
    ).toHaveCount(0);
    await expect(p.getByRole("alert")).toHaveCount(0);
  };
  const shot = async (p: Page, name: string) => {
    await settle(p);
    await p.screenshot({
      path: `${output}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  };
  const nav = async (p: Page, name: string) => {
    await p
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(p.getByRole("heading", { name, exact: true })).toBeVisible();
    await settle(p);
  };
  const login = async (p: Page, email: string, password: string) => {
    await p.goto("/");
    await p.getByLabel("Email address").fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "A clearer view." }),
    ).toBeVisible();
    await expect(
      p.getByText("Organizations in your workspace", { exact: true }),
    ).toBeVisible();
    await settle(p);
  };
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible();
  await shot(page, "01-login");
  await login(page, "admin@clientflow.test", process.env.SEED_ADMIN_PASSWORD!);
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await shot(page, "02-admin-dashboard");
  await nav(page, "Companies");
  const company = page
    .getByRole("row")
    .filter({ hasText: "Northstar Fabrication" });
  await expect(company).toBeVisible();
  await shot(page, "03-companies");
  await company
    .getByRole("button", { name: "View / edit", exact: true })
    .click();
  await expect(page.getByLabel("Company name")).toHaveValue(
    "Northstar Fabrication",
  );
  await expect(
    page.getByText("Loading available relationships…", { exact: true }),
  ).toHaveCount(0);
  await shot(page, "04-company-details-dialog");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await nav(page, "Pipeline");
  await expect(page.locator(".deal")).toHaveCount(10);
  const first = await page.request.get("/api/opportunities?page=1");
  const second = await page.request.get("/api/opportunities?page=2");
  const summary = await page.request.get("/api/summary");
  expect(first.ok() && second.ok() && summary.ok()).toBeTruthy();
  const a = await first.json(),
    b = await second.json(),
    totals = await summary.json();
  expect(a.items).toHaveLength(10);
  expect(b.items).toHaveLength(2);
  expect(a.total).toBe(12);
  expect(b.total).toBe(12);
  const pageOneCounts = await page
    .locator(".lane h2 span:last-child")
    .allTextContents();
  expect(pageOneCounts.reduce((n, value) => n + Number(value), 0)).toBe(10);
  await shot(page, "05-opportunity-pipeline-page-1");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".deal")).toHaveCount(2);
  const pageTwoCounts = await page
    .locator(".lane h2 span:last-child")
    .allTextContents();
  expect(pageTwoCounts.reduce((n, value) => n + Number(value), 0)).toBe(2);
  await shot(page, "06-opportunity-pipeline-page-2");
  await page
    .getByRole("textbox", { name: "Search pipeline" })
    .fill("Regional supply agreement");
  await page
    .getByRole("button", { name: "Regional supply agreement", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Regional supply agreement",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Initial discovery call completed.", { exact: false }),
  ).toBeVisible();
  await shot(page, "07-opportunity-details");
  await nav(page, "Tasks");
  for (const [filter, name] of [
    ["upcoming", "08-follow-up-tasks-upcoming"],
    ["overdue", "09-follow-up-tasks-overdue"],
    ["completed", "10-follow-up-tasks-completed"],
  ]) {
    if (filter === "upcoming")
      await expect(
        page.getByText("Share implementation outline", { exact: true }),
      ).toBeVisible();
    else {
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/api/tasks?") &&
            r.url().includes(`filter=${filter}`),
        ),
        page.getByLabel("Task filter").selectOption(filter),
      ]);
    }
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await shot(page, name);
  }
  const representative = await browser.newContext({
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
  });
  const desktop = await representative.newPage();
  watch(desktop);
  await login(
    desktop,
    "avery@clientflow.test",
    process.env.SEED_SALES_ONE_PASSWORD!,
  );
  await expect(
    desktop.getByText("Sales representative", { exact: true }),
  ).toBeVisible();
  await shot(desktop, "11-representative-desktop-dashboard");
  await nav(desktop, "Pipeline");
  await expect(desktop.locator(".deal")).toHaveCount(6);
  await shot(desktop, "12-representative-desktop-pipeline");
  const mobile = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5174",
  });
  const phone = await mobile.newPage();
  watch(phone);
  await login(
    phone,
    "avery@clientflow.test",
    process.env.SEED_SALES_ONE_PASSWORD!,
  );
  await shot(phone, "13-representative-mobile-dashboard");
  await nav(phone, "Pipeline");
  await expect(phone.locator(".deal")).toHaveCount(6);
  await shot(phone, "14-representative-mobile-pipeline");
  await phone
    .getByRole("button", { name: "Regional supply agreement", exact: true })
    .click();
  await expect(
    phone.getByRole("heading", {
      name: "Regional supply agreement",
      exact: true,
    }),
  ).toBeVisible();
  await shot(phone, "15-representative-mobile-opportunity");
  expect(errors).toEqual([]);
  writeFileSync(
    `${output}/pagination-evidence.json`,
    JSON.stringify(
      {
        dataset: "Fictional review fixtures in a separate review test database",
        pageSize: a.pageSize,
        authorizedMatchingOpportunities: a.total,
        firstPageCards: a.items.length,
        firstPageColumnCounts: pageOneCounts.map(Number),
        secondPageCards: b.items.length,
        secondPageColumnCounts: pageTwoCounts.map(Number),
        stageOrder: [
          "NEW",
          "CONTACTED",
          "DEMO_SCHEDULED",
          "PROPOSAL_SENT",
          "WON",
          "LOST",
        ],
        adminSummary: totals,
      },
      null,
      2,
    ) + "\n",
  );
  await representative.close();
  await mobile.close();
});
