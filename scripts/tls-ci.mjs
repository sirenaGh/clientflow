import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
if (process.env.CI !== "true")
  throw new Error(
    "TLS fixture requires isolated CI Docker; no hosting account is used",
  );
const dir = resolve(".runtime/tls-fixture");
mkdirSync(dir, { recursive: true });
const run = (exe, args) => {
  try {
    return execFileSync(exe, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`TLS fixture command failed: ${exe}`);
  }
};
const cert = (name) => resolve(dir, name);
run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  cert("ca-key.pem"),
  "-out",
  cert("ca.pem"),
  "-days",
  "2",
  "-subj",
  "/CN=ClientFlow Test CA",
]);
run("openssl", [
  "req",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  cert("server-key.pem"),
  "-out",
  cert("server.csr"),
  "-subj",
  "/CN=localhost",
]);
writeFileSync(
  cert("extensions.cnf"),
  "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n",
);
run("openssl", [
  "x509",
  "-req",
  "-in",
  cert("server.csr"),
  "-CA",
  cert("ca.pem"),
  "-CAkey",
  cert("ca-key.pem"),
  "-CAcreateserial",
  "-out",
  cert("server.pem"),
  "-days",
  "2",
  "-extfile",
  cert("extensions.cnf"),
]);
run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  cert("wrong-key.pem"),
  "-out",
  cert("wrong.pem"),
  "-days",
  "2",
  "-subj",
  "/CN=Untrusted Test CA",
]);
for (const name of ["server-key.pem", "server.pem", "ca.pem"])
  chmodSync(cert(name), 0o644);
const password = randomBytes(32).toString("hex");
writeFileSync(
  cert("mysql.env"),
  `MYSQL_ROOT_PASSWORD=${randomBytes(32).toString("hex")}\nMYSQL_DATABASE=clientflow_tls_test\nMYSQL_USER=clientflow_tls\nMYSQL_PASSWORD=${password}\n`,
  { mode: 0o600 },
);
const container = "clientflow-tls-" + randomBytes(4).toString("hex");
let db;
try {
  run("docker", [
    "run",
    "-d",
    "--name",
    container,
    "--env-file",
    cert("mysql.env"),
    "-p",
    "127.0.0.1:3308:3306",
    "-v",
    `${dir}:/tls:ro`,
    "mysql:8.4",
    "--ssl-ca=/tls/ca.pem",
    "--ssl-cert=/tls/server.pem",
    "--ssl-key=/tls/server-key.pem",
    "--require-secure-transport=ON",
  ]);
  const raw = `mysql://clientflow_tls:${password}@localhost:3308/clientflow_tls_test`;
  const env = {
    ...process.env,
    DATABASE_URL: raw,
    DB_TLS_REQUIRED: "true",
    DB_TLS_CA_FILE: cert("ca.pem"),
  };
  Object.assign(process.env, env);
  const { database } = await import("../server/dist/src/db.js");
  db = database(raw);
  for (let i = 0; ; i++) {
    try {
      await db.$queryRaw`SELECT 1`;
      break;
    } catch {
      if (i > 8) throw new Error("TLS MySQL fixture did not become ready");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const status = await db.$queryRaw`SHOW SESSION STATUS LIKE 'Ssl_cipher'`;
  assert.ok(status[0].Value);
  console.log("Adapter connected using verified TLS and a nonempty cipher.");
  const migrate = (configuration) =>
    spawnSync(process.execPath, ["scripts/migrate-production.mjs"], {
      env: configuration,
      encoding: "utf8",
      timeout: 120000,
    });
  assert.equal(
    migrate(env).status,
    0,
    "Strict TLS migrations must succeed with the trusted CA",
  );
  assert.equal(await db.user.count(), 0, "Migrations must not seed production users");
  for (const bad of [
    { ...env, DB_TLS_CA_FILE: cert("wrong.pem") },
    { ...env, DATABASE_URL: raw.replace("localhost", "127.0.0.1") },
  ]) {
    Object.assign(process.env, bad);
    const rejected = database(bad.DATABASE_URL);
    try {
      await assert.rejects(rejected.$queryRaw`SELECT 1`);
    } finally {
      await rejected.$disconnect();
    }
    assert.notEqual(
      migrate(bad).status,
      0,
      "Migrations must reject untrusted CA or hostname mismatch",
    );
  }
  console.log(
    "Verified TLS: encrypted adapter query and strict migrations passed; both rejected wrong CA and hostname.",
  );
} finally {
  if (db) await db.$disconnect();
  try {
    run("docker", ["rm", "-f", "-v", container]);
  } catch {
    /* No persistent or hosting resources were created. */
  }
}
