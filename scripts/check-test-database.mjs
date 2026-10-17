import { testEnv } from "./test-env.mjs";
import { database } from "../server/src/db.ts";

const client = database(testEnv().DATABASE_URL);
try {
  const [row] = await client.$queryRaw`SELECT VERSION() AS version`;
  if (!/^8\./.test(row.version)) throw new Error("MySQL 8 is required");
  if (process.env.CI === "true" && !/^8\.4\./.test(row.version))
    throw new Error("CI must verify against MySQL 8.4");
  console.log(`Isolated test database: MySQL ${row.version}`);
} finally {
  await client.$disconnect();
}
