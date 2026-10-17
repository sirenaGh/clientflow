import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
import { existsSync } from "node:fs";
if (existsSync("server/.env")) process.loadEnvFile("server/.env");

export default defineConfig({
  ...base,
  testDir: "./client/review",
  outputDir: "test-results/review",
  timeout: 180000,
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "review",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "node scripts/review-api.mjs",
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
