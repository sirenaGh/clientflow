import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { databaseSettings } from "../database-config.js";
export function database(url = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new PrismaMariaDb(databaseSettings(url).adapter),
  });
}
export const db = database();
