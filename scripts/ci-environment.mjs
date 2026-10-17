import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (
  process.env.CI !== "true" ||
  !process.env.GITHUB_ENV ||
  !process.env.MYSQL_CONTAINER
)
  throw new Error("This helper is only for the isolated CI MySQL service");
const random = () => randomBytes(32).toString("hex");
const password = random(),
  rootPassword = random();
const result = spawnSync(
  "docker",
  ["exec", "-i", process.env.MYSQL_CONTAINER, "mysql", "--user=root"],
  {
    input: `CREATE USER 'clientflow_ci'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON clientflow_test.* TO 'clientflow_ci'@'%'; DROP USER IF EXISTS 'root'@'%'; ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}';`,
    encoding: "utf8",
  },
);
if (result.status !== 0)
  throw new Error("Isolated CI database provisioning failed");
const env = {
  DATABASE_URL: `mysql://clientflow_ci:${password}@127.0.0.1:3306/clientflow_unused`,
  TEST_DATABASE_URL: `mysql://clientflow_ci:${password}@127.0.0.1:3306/clientflow_test`,
  SESSION_SECRET: random(),
  SEED_ADMIN_PASSWORD: random(),
  SEED_SALES_ONE_PASSWORD: random(),
  SEED_SALES_TWO_PASSWORD: random(),
};
for (const [key, value] of Object.entries(env)) {
  // GitHub's masking command registers secrets before subsequent steps can log them.
  process.stdout.write(`::add-mask::${value}\n`);
  appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
}
process.stdout.write(`::add-mask::${password}\n`);
console.log(
  "Ephemeral CI credentials configured for the isolated test database.",
);
