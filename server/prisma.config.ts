import "dotenv/config";
import { databaseSettings } from "./database-config.js";
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ? databaseSettings().migrationUrl : undefined },
});
