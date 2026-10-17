import { app } from "./app.js";
import { db } from "./db.js";
const port = Number(process.env.PORT || 3001);
await db.$connect();
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`ClientFlow API: http://${host}:${port}`),
);
const cleanup = setInterval(
  () => {
    void db.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => console.error("Session cleanup failed"));
  },
  60 * 60 * 1000,
);
cleanup.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(cleanup);
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0));
    });
  });
