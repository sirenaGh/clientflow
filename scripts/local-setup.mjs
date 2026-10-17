import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import net from "node:net";
const runtime = resolve(".runtime");
mkdirSync(runtime, { recursive: true });
const mysql =
  process.env.MYSQL_BIN || "C:/Program Files/MySQL/MySQL Server 8.0/bin";
if (!existsSync(mysql + "/mysqld.exe"))
  throw new Error(
    "Set MYSQL_BIN to the MySQL 8 bin directory, or use your own MySQL server and server/.env.example.",
  );
function listening() {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: 3307 });
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}
if (await listening()) {
  if (existsSync("server/.env") && existsSync(runtime + "/mysql-ready")) {
    console.log(
      "Local MySQL is already listening on 127.0.0.1:3307. Local environment preserved.",
    );
    process.exit(0);
  }
  throw new Error(
    "Port 3307 is occupied. Existing service will not be modified.",
  );
}
const data = runtime + "/mysql-data";
if (!existsSync(runtime + "/mysql-ready") && existsSync("server/.env")) {
  throw new Error(
    "server/.env already exists and will not be overwritten. Use your configured MySQL server or configure this local instance manually.",
  );
}
if (!existsSync(data + "/auto.cnf")) {
  mkdirSync(data, { recursive: true });
  const r = spawnSync(
    mysql + "/mysqld.exe",
    ["--no-defaults", "--initialize-insecure", `--datadir=${data}`],
    { windowsHide: true, encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error(
      "MySQL initialization failed; inspect .runtime/mysql-data/*.err. " +
        (r.error?.code || ""),
    );
}
const child = spawn(
  mysql + "/mysqld.exe",
  [
    "--no-defaults",
    `--datadir=${data}`,
    "--bind-address=127.0.0.1",
    "--port=3307",
    "--mysqlx=OFF",
    "--default-time-zone=+00:00",
    `--log-error=${runtime}/mysql.log`,
  ],
  { detached: true, stdio: "ignore", windowsHide: true },
);
child.unref();
writeFileSync(runtime + "/mysql.pid", String(child.pid));
for (let i = 0; i < 60 && !(await listening()); i++)
  await new Promise((r) => setTimeout(r, 500));
if (!(await listening()))
  throw new Error("Local MySQL did not start; inspect .runtime/mysql.log");
if (!existsSync(runtime + "/mysql-ready")) {
  if (existsSync("server/.env"))
    throw new Error(
      "server/.env already exists; it will not be overwritten. Configure this instance manually.",
    );
  const password = randomBytes(24).toString("hex"),
    rootPassword = randomBytes(24).toString("hex");
  const result = spawnSync(
    mysql + "/mysql.exe",
    [
      "--no-defaults",
      "--protocol=TCP",
      "--host=127.0.0.1",
      "--port=3307",
      "--user=root",
    ],
    {
      input: `CREATE DATABASE clientflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE clientflow_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'clientflow'@'127.0.0.1' IDENTIFIED BY '${password}'; GRANT ALL ON clientflow.* TO 'clientflow'@'127.0.0.1'; GRANT ALL ON clientflow_test.* TO 'clientflow'@'127.0.0.1'; ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}';`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(
      "Local database provisioning failed. Inspect MySQL configuration.",
    );
  writeFileSync(runtime + "/mysql-root", rootPassword, { mode: 0o600 });
  const env = readFileSync("server/.env.example", "utf8")
    .replaceAll(
      "mysql://clientflow:CHANGE_ME@127.0.0.1:3306/clientflow",
      `mysql://clientflow:${password}@127.0.0.1:3307/clientflow`,
    )
    .replace(
      "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
      randomBytes(32).toString("hex"),
    )
    .replace(
      /(SEED_\w+_PASSWORD)=/g,
      (_, key) => key + "=" + randomBytes(18).toString("base64url"),
    );
  writeFileSync("server/.env", env, { mode: 0o600 });
  writeFileSync(
    runtime + "/mysql-ready",
    "Local ClientFlow database provisioned",
  );
}
console.log(
  "Private local MySQL ready on 127.0.0.1:3307. Development login passwords are in ignored server/.env. Run npm run db:generate, npm run db:migrate, npm run db:seed.",
);
