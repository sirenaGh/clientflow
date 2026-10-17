import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
if (existsSync("server/.env")) process.loadEnvFile("server/.env");
test("sign in, create a relationship, progress a deal and persist after reload", async ({
  page,
}, info) => {
  const suffix = `${info.project.name}-${Date.now()}`;
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().startsWith("http") &&
      new URL(r.url()).origin !== "http://127.0.0.1:5174"
    )
      externalRequests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("avery@clientflow.test");
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_SALES_ONE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view." }),
  ).toBeVisible();
  await expect(
    page.getByText("Updating workspace…", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/${info.project.name}-overview.png`,
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Companies", exact: true })
    .click();
  await page.getByRole("button", { name: "New company", exact: true }).click();
  await page.getByLabel("Company name").fill("Acorn " + suffix);
  await page.getByLabel("Industry").fill("Manufacturing");
  await page.getByRole("button", { name: "Save company", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search companies" })
    .fill("Acorn " + suffix);
  const companyRow = page
    .getByRole("row")
    .filter({ hasText: "Acorn " + suffix });
  await companyRow
    .getByRole("button", { name: "View / edit", exact: true })
    .click();
  await page.getByLabel("Phone", { exact: true }).fill("555-0100");
  await page.getByRole("button", { name: "Save company", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await companyRow
    .getByRole("button", { name: "View / edit", exact: true })
    .click();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(
    "555-0100",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    companyRow.getByRole("button", { name: "View / edit", exact: true }),
  ).toBeFocused();
  await companyRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "New contact", exact: true }).click();
  await page.getByLabel("Contact name").fill("Jamie Valley " + suffix);
  await page
    .getByLabel("Company", { exact: false })
    .selectOption({ label: "Acorn " + suffix });
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Pipeline/ })
    .click();
  await page
    .getByRole("button", { name: "New opportunity", exact: true })
    .click();
  await page.getByLabel("Opportunity title").fill("Supply agreement " + suffix);
  await page
    .getByLabel("Company", { exact: false })
    .selectOption({ label: "Acorn " + suffix });
  await page
    .getByLabel("Contact", { exact: true })
    .selectOption({ label: "Jamie Valley " + suffix });
  await page.getByLabel("Estimated value").fill("12900.25");
  await page
    .getByRole("button", { name: "Save opportunity", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search pipeline" })
    .fill("Supply agreement " + suffix);
  await page
    .getByRole("button", { name: "Supply agreement " + suffix, exact: true })
    .click();
  await page.getByLabel("Pipeline stage").selectOption("PROPOSAL_SENT");
  await page
    .getByLabel("Add a note")
    .fill("Requirements agreed. Proposal follows this week.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByText("Requirements agreed.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task title").fill("Confirm procurement " + suffix);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Complete Confirm procurement " + suffix })
    .check();
  await expect(page.getByText(/Due .*Completed/)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/stage") &&
        r.request().method() === "PATCH" &&
        r.status() === 200,
    ),
    page.getByLabel("Pipeline stage").selectOption("WON"),
  ]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A clearer view." }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Pipeline/ })
    .click();
  await page
    .getByRole("textbox", { name: "Search pipeline" })
    .fill("Supply agreement " + suffix);
  await page
    .getByRole("button", { name: "Supply agreement " + suffix, exact: true })
    .click();
  await expect(page.getByLabel("Pipeline stage")).toHaveValue("WON");
  await expect(
    page.getByText("Requirements agreed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete Confirm procurement " + suffix,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("jordan@clientflow.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_SALES_TWO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Companies", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search companies" })
    .fill("Acorn " + suffix);
  await expect(
    page.getByRole("heading", { name: "No matches found" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
