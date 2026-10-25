# Render Free with Aiven for MySQL Free

This is a portfolio hosting configuration, not a production availability guarantee. No accounts, resources, deployment, payment methods or paid jobs were created while preparing it. The existing Railway JSON configuration and Docker default command remain unchanged.

## Free-only settings

Use one **Render Web Service, Free plan**, Docker runtime, repository root `/`, Dockerfile `./Dockerfile`, context `.`, health path `/health`, and Docker Command `node scripts/start-render.mjs` (`npm run start:render`). `render.yaml` explicitly sets `plan: free`, one web service, no disks, no managed databases, no cron/worker/jobs and `autoDeployTrigger: "off"`. This prevents commit-triggered deploys, not the first deployment when someone deliberately creates the service.

Use **Aiven for MySQL Free**, not a trial or paid plan. Current official documentation says no credit card is required; free MySQL has one node, 1 GB disk and a 76-connection limit. The application pool is five connections, with temporary additional connections during migrations or an overlapping rollout. Confirm the offered plan and MySQL version in the account before any future provisioning; do not accept an upgrade, trial conversion, paid capacity, or payment-method request. This repository does not provision Aiven.

Keep both accounts without a payment method. Review dashboard usage limits. Render free hours, build minutes and bandwidth are capped; without a payment method exhaustion can suspend service/builds instead of billing. Render can also suspend free services for excessive external traffic, including external database traffic. Free hosting can change or be unavailable in a region/account; stop rather than selecting a paid fallback. Do not add uptime pings to avoid sleeping.

## Environment variables and CA file

Set values in Render, never in committed files or build arguments. Dockerfile does not reference sensitive build arguments. Do not import the local development `.env` into production.

| Name | Exact setting |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Aiven's actual `mysql://USER:DB_PASSWORD@SERVICE_HOST:PORT/defaultdb` URL, using its DNS hostname and assigned port. Use the exact database name if different. URL-encode credentials. Do not use an IP alias or insecure TLS flags. |
| `DB_TLS_REQUIRED` | `true` |
| `DB_TLS_CA_FILE` | `/etc/secrets/aiven-ca.pem` |
| `SESSION_SECRET` | At least 32 random characters; Blueprint generates a random value. Keep stable across restarts. |
| `APP_ORIGIN` | Exact assigned `https://SERVICE.onrender.com` origin, no trailing slash/path. Set it to the actual Render URL, not an assumed hostname. |
| `DEMO_ENABLED` | Committed default `false`; deliberately change to `true` only after checking the intended hosting environment. |
| `DEMO_CLEANUP_ENABLED` | `true`; enables bounded startup and 15-minute in-process cleanup. |
| `PORT` | Supplied by Render; the existing production server binds `0.0.0.0`. Do not override with a reserved port. |

Download the CA certificate from the intended Aiven project's MySQL connection information. Add a Render **Secret File** named `aiven-ca.pem`, containing that PEM certificate. Render mounts it at `/etc/secrets/aiven-ca.pem`. Do not put its contents or a private key into `render.yaml` or Git. A CA is trust material, not a password; it still stays outside the repository to prevent accidental account-specific material publication. Rotate the secret file when the project CA changes. If configuring manually, check that the file is available to the Docker service before a successful startup; an initial missing-file deployment fails closed and can be retried after configuration, without any database reset.

The application does not pass the URL to the adapter and hope its TLS query flags work. `server/database-config.ts` builds explicit MariaDB TLS options: the PEM CA, `rejectUnauthorized: true`, TLS 1.2 minimum, expected hostname, and Node's normal certificate identity verifier. Aiven hostnames require TLS even if the flag is accidentally false. Missing/invalid CA files fail startup. Insecure and unsupported URL options are rejected. For migrations the same module constructs an absolute `sslcert` path and `sslaccept=strict` URL in `server/prisma.config.ts`. Neither client disables certificate verification. TLS is required to the external database; Railway private MySQL/local loopback can retain their existing non-TLS settings when no TLS option is configured.

Allow the Render service's documented outbound IP ranges in Aiven's firewall if the free service supports such restrictions. Include the local administrator IP only when running local migrations, then remove it. Account/network rules and real Aiven certificate chains still require live verification. Do not open a broad allowlist merely to silence connection errors.

## Migration workflow without paid commands or shells

Build stays database-independent: Docker runs `npm ci --include=dev` and `npm run build:production` (Prisma generation plus frontend/backend builds). No database migrations or secrets are needed during image build.

At every startup, including a wake from sleep, `node scripts/start-render.mjs` runs **only `prisma migrate deploy`** against committed migrations. It starts Express only after that succeeds. The wrapper has a 120-second timeout, exits nonzero on failure, suppresses raw CLI output to avoid credential leakage, and never invokes reset, push, migrate dev, or development seeding. Applying already-applied migrations is a no-op. Prisma's migration locking remains enabled. Startup migration failure must be investigated, not automatically reset or marked resolved. New migrations must remain compatible with the previous running release during rollout (expand/contract); taking a code rollback does not undo a database migration.

An operator can run the identical command from a trusted local checkout, with production values supplied privately and an absolute local CA path:

```text
npm ci
npm run db:generate
npm run db:migrate:production
```

Do not use the development setup/test commands against the production URL. They intentionally seed isolated local/test databases. Do not set `TEST_DATABASE_URL`, `REVIEW_DATABASE_URL`, or any `SEED_*_PASSWORD` in Render. No normal user credentials are created by deployment. The visitor demo needs none; normal employee provisioning remains a separately reviewed operational process. To inspect a failure locally, use Prisma migration status from a trusted local environment; keep its output private and redact connection information before sharing. Failed DDL migrations may require deliberate forward repair under MySQL's non-transactional DDL rules; never reset production.

## Cleanup while awake

`DEMO_CLEANUP_ENABLED=true` runs one asynchronous batch after database connection/startup and every 15 minutes while the process is alive. A batch selects at most **10 expired demo users**, **100 expired session rows**, and **100 expired rate buckets**. Workspace record quotas bound each user's linked records; per-user transactions retain a 10-second timeout. Process-local overlap coalesces onto the current promise. Stable owner-row locks and expiry rechecks also serialize cleanup across overlapping service instances and the retained Railway cleanup command. Shutdown stops the timer and waits for an in-flight batch before disconnecting the pool; a platform kill rolls back the current transaction. Cleanup failures log only a generic message and retry on the next awake interval.

Render sleeps after inactivity; timers stop, cleanup pauses, and expired data can remain until a later awake batch. Server authorization independently enforces the fixed one-hour demo expiry on every access and inside CRM write locks, so sleeping or delayed deletion never grants extra access. Rate buckets remain in MySQL across sleep/restarts. Backlogs are processed in successive batches; this is not an exact wall-clock cron guarantee. Monitor free database storage and reduce/disable demo creation if cleanup falls behind. The retained CLI cleanup removes up to 25 workspaces per invocation; Railway can continue using its existing scheduled service.

Sessions, HttpOnly/Secure/SameSite cookies, exact-origin CSRF, ownership isolation and quotas are unchanged. Proxy trust stays **false**: cookies and origin validation use explicit configuration, and shared database budgets do not trust forwarded IP headers. All frontend/API requests use the same origin.

## Future deployment steps and checks (not executed)

1. Review and merge this PR only when separately authorized. Confirm both offerings are still free and keep payment methods absent.
2. Deliberately prepare the Aiven Free database, record its exact version/host/port/name, download its CA, and select a nearby Render region where Free is available. No infrastructure is created by these instructions alone.
3. Configure one Free Docker web service from the intended reviewed commit using the settings above, or inspect `render.yaml` before deliberately applying the Blueprint. Add the CA secret file and variables. Service creation or saving settings can trigger an initial deploy even with automatic deploys off; do not click through until deployment is authorized.
4. Confirm migrations succeeded and `/health` returns 200 without a session cookie. Check real TLS for adapter queries and migrations; verify database reports a nonempty TLS cipher. Inspect the same-origin frontend, hashed assets, direct SPA navigation and JSON unknown-API errors.
5. Verify Secure cookie behavior over actual HTTPS, rejected invalid Origin/CSRF, two independent demo profiles, cross-ID denial, quotas and persistence after sleep/restart. Verify server expiry at one hour and eventual bounded cleanup after wake, preserving normal users.
6. Check free usage/storage and account firewall settings; do not upgrade or add paid cron, shell access or jobs to solve a failure.

## Official documentation consulted (2026-10-25)

- [Render Free limits](https://render.com/docs/free)
- [Render deploy lifecycle and paid pre-deploy limitation](https://render.com/docs/deploys)
- [Render Docker support](https://render.com/docs/docker)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render secret files](https://render.com/docs/configure-environment-variables)
- [Aiven MySQL Free](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier)
- [Aiven TLS certificates](https://aiven.io/docs/platform/concepts/tls-ssl-certificates)
- [Prisma MySQL TLS parameters](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql)
- [MariaDB Node.js TLS options and hostname verification](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)
