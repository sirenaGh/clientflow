import { spawnSync } from "node:child_process";
// Each group starts and stops the same unmodified test servers. Authentication
// checks must not consume the per-IP login budget of unrelated workflow tests.
const groups = [
  ["auth-bootstrap.spec.ts"],
  ["demo.spec.ts", "regressions.spec.ts", "workflow.spec.ts"],
];
for (const group of groups) {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      ...group,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
