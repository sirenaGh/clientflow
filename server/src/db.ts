import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
export function database(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  const u = new URL(url);
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
      connectionLimit: 5,
      timezone: "+00:00",
      initSql: "SET time_zone = '+00:00'",
    }),
  });
}
export const db = database();
