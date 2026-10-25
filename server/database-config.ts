import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { checkServerIdentity } from "node:tls";
import { X509Certificate } from "node:crypto";

export function databaseSettings(
  raw = process.env.DATABASE_URL,
  env = process.env,
) {
  if (!raw) throw new Error("DATABASE_URL is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL");
  }
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql");
  for (const key of url.searchParams.keys())
    if (!["sslcert", "sslaccept"].includes(key))
      throw new Error(
        "Unsupported database URL option; configure the adapter explicitly",
      );
  if (
    url.searchParams.has("sslaccept") &&
    url.searchParams.get("sslaccept") !== "strict"
  )
    throw new Error("Database certificate verification must remain strict");
  if (env.DB_TLS_REQUIRED && !["true", "false"].includes(env.DB_TLS_REQUIRED))
    throw new Error("DB_TLS_REQUIRED must be true or false");
  const caFile = env.DB_TLS_CA_FILE || url.searchParams.get("sslcert");
  const required =
    env.DB_TLS_REQUIRED === "true" ||
    url.hostname.endsWith(".aivencloud.com") ||
    !!caFile ||
    url.searchParams.has("sslaccept");
  let ssl;
  if (required) {
    if (!caFile || !isAbsolute(caFile))
      throw new Error(
        "Verified database TLS requires an absolute DB_TLS_CA_FILE path",
      );
    let ca: string;
    try {
      ca = readFileSync(caFile, "utf8");
      new X509Certificate(ca);
    } catch {
      throw new Error("Database CA certificate is missing or invalid");
    }
    ssl = {
      ca,
      rejectUnauthorized: true,
      servername: url.hostname,
      checkServerIdentity,
      minVersion: "TLSv1.2" as const,
    };
    url.searchParams.set("sslcert", caFile);
    url.searchParams.set("sslaccept", "strict");
  }
  return {
    migrationUrl: url.toString(),
    adapter: {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      connectionLimit: 5,
      connectTimeout: 10000,
      timezone: "+00:00",
      initSql: "SET time_zone = '+00:00'",
      ssl,
    },
  };
}
