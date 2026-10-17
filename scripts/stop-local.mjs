import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const mysql =
  process.env.MYSQL_BIN || "C:/Program Files/MySQL/MySQL Server 8.0/bin";
if (!existsSync(".runtime/mysql-ready"))
  throw new Error("No managed local database was provisioned");
// The local client receives its password through its environment, never shell arguments.
const password = readFileSync(".runtime/mysql-root", "utf8");
const r = spawnSync(
  mysql + "/mysql.exe",
  [
    "--no-defaults",
    "--protocol=TCP",
    "--host=127.0.0.1",
    "--port=3307",
    "--user=root",
  ],
  {
    env: { ...process.env, MYSQL_PWD: password },
    input: "SHUTDOWN;",
    encoding: "utf8",
    windowsHide: true,
  },
);
if (r.status !== 0)
  throw new Error("Could not stop the managed local MySQL instance");
console.log("Local MySQL stopped. Restart with npm run setup:local.");
