import { app } from "./app.js";
import { runMaintenance, startMaintenance } from "./maintenance.js";
import { db } from "./db.js";
const port = Number(process.env.PORT || 3001);
await db.$connect();
if (process.env.DEMO_CLEANUP_ENABLED === "true") await runMaintenance();
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`ClientFlow API: http://${host}:${port}`),
);
const stopMaintenance =
  process.env.DEMO_CLEANUP_ENABLED === "true"
    ? startMaintenance()
    : async () => {};
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      void stopMaintenance()
        .then(() => db.$disconnect())
        .then(() => process.exit(0));
    });
  });
