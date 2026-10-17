import { defineConfig, devices } from "@playwright/test";
process.env.API_TARGET = "http://127.0.0.1:3002";
export default defineConfig({
  testDir: "./client/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node scripts/test-api.mjs",
      url: "http://127.0.0.1:3002/api/auth/session",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -w client -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
