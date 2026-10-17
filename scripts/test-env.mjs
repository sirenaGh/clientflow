import { existsSync } from "node:fs";
if (existsSync("server/.env")) process.loadEnvFile("server/.env");
export function testEnv() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "TEST_DATABASE_URL is required; integration and browser tests do not use DATABASE_URL",
    );
  const parsed = new URL(url);
  if (
    !/^\/[a-zA-Z0-9_]+_test$/.test(parsed.pathname) ||
    url === process.env.DATABASE_URL
  )
    throw new Error(
      "Refusing tests: use a separate database with a name ending in _test",
    );
  return {
    ...process.env,
    DATABASE_URL: url,
    NODE_ENV: "test",
    DEMO_ENABLED: "true",
    APP_ORIGIN: "http://127.0.0.1:5174",
    PORT: "3002",
  };
}
