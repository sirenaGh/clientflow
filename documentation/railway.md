# Railway deployment preparation

The repository prepares deployment; it does not create infrastructure. Merge only after review and deliberately connect the chosen commit. GitHub Actions tests code, never deploys it.

## Services and commands

Use one Railway project/environment/region with these three services. Root directory is `/` for both repository services. Use Node.js 24 LTS in the Dockerfile; the lockfile controls npm dependencies. `node:24-bookworm-slim` tracks supported security patches; record the resolved image digest in the release record and pin it when byte-identical image builds are required. `npm ci --include=dev` installs build tools and the Prisma migration CLI, which remain in the image so pre-deploy migrations can run. No secrets are needed during image build.

| Service | Source/config | Settings |
| --- | --- | --- |
| MySQL | Official `mysql:8.4` image, persistent volume mounted at `/var/lib/mysql` | Private networking only, port 3306; no public TCP proxy/domain. Set `MYSQL_DATABASE=clientflow`, a random `MYSQL_ROOT_PASSWORD`, `MYSQL_USER=clientflow`, and a different random `MYSQL_PASSWORD`. Verify `SELECT VERSION()` reports 8.4.x. Enable backups and test restore before accepting real team data. |
| Web | This repository, `Dockerfile`, config `/railway.json` | One replica initially. Build: Dockerfile (`npm ci --include=dev`, then `npm run build:production`). Pre-deploy: `npm run db:migrate`. Start: `node server/dist/src/index.js` (equivalent `npm start`). Healthcheck `/health`, timeout 120s, pre-deploy timeout 300s, on-failure restart up to 3. Add HTTPS domain only when deployment is authorized. |
| Cleanup | Same repository/Dockerfile, config `/railway.cleanup.json` | Start `npm run demo:cleanup:production`; UTC cron `*/15 * * * *`; restart policy Never; no healthcheck, domain, public port, or pre-deploy command. Deploy web migrations before first cleanup run. |

The build command expands to `npm run db:generate && npm run build`. The migration command expands to `prisma migrate deploy` in the server workspace. It applies committed migrations, never resets the database, and never seeds accounts. Do not set a development seed command on either service. Production intentionally starts with no normal users; visitor mode requires none. Private employee provisioning needs a separately reviewed operational process; development account seeding must not be used in production.

## Variables

Set variables in Railway's service variables UI. Never put real values into repository files, build arguments, logs, or issue comments.

| Variable | Web | Cleanup | Value |
| --- | --- | --- | --- |
| `DATABASE_URL` | Required | Required | Private URL `mysql://USER:DB_PASSWORD@mysql.railway.internal:3306/clientflow`; use the actual MySQL service private hostname and reference its user/password/database variables. URL-encode reserved characters in credentials. Avoid public connection URLs. |
| `SESSION_SECRET` | Required | Not used | Independently generated random secret, at least 32 characters, preferably 32 random bytes encoded as hex. Stable across replicas/restarts; rotating invalidates existing cookies. |
| `NODE_ENV` | `production` | `production` | Enables production binding, frontend serving and secure cookies. |
| `APP_ORIGIN` | Required | Not used | Exact externally visible HTTPS origin, e.g. `https://your-domain.example`, without trailing slash, path, or wildcard. Must match the browser origin. Startup rejects missing/insecure origins. |
| `DEMO_ENABLED` | Default `false`; deliberately set `true` for public visitors | Not required | This is the actual feature flag. No committed config enables it. |
| `PORT` | Railway supplies it | Not used | Server binds `0.0.0.0:$PORT` in production; fallback 3001. Local development remains loopback-only. |

Do not set `TEST_DATABASE_URL`, `REVIEW_DATABASE_URL`, or any `SEED_*_PASSWORD` on production services. `.env.example` documents local-only variables. No frontend secret variables or CORS configuration are required: browser requests use relative `/api` URLs on the same origin.

With the database service named `MySQL`, use this exact private reference expression for both repository services (generate MySQL passwords as random hex so interpolation is URL-safe):

```text
DATABASE_URL=mysql://${{MySQL.MYSQL_USER}}:${{MySQL.MYSQL_PASSWORD}}@${{MySQL.RAILWAY_PRIVATE_DOMAIN}}:3306/${{MySQL.MYSQL_DATABASE}}
```

The local production smoke uses loopback HTTP and explicitly supplied Cookie headers to inspect production behavior; it does not claim to verify browser TLS or Railway proxy behavior.

## Authentication and public resource bounds

Sessions remain server-managed in MySQL, with signed `__Host-clientflow` cookies: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. TLS terminates at Railway. Express deliberately trusts **no** proxy headers. Cookie security is explicit; CSRF checks compare the exact configured origin plus session token. `X-Forwarded-For`, `Forwarded`, and `X-Forwarded-Proto` cannot select a rate-limit identity or alter security decisions. If future trusted client-IP support is required, first verify Railway's overwrite behavior and narrow trusted proxy addresses; do not enable blanket proxy trust.

Production limits use atomic MySQL row locks shared across replicas and restarts: session discovery 600/hour globally, login 100/15 minutes globally, demo creation 30/hour globally and 5/hour per existing anonymous session. Windows are fixed; adjacent windows can burst up to twice the budget. Attempts consume budget even if credentials/provisioning fail. Changing cookies cannot bypass the global ceiling. Requests return 429 with Retry-After. Conservative global budgets deliberately trade availability under attack for bounded public database creation; tune only after traffic review. Development retains existing per-IP limits. Health and static files consume no sessions or public buckets. Successful demo sessions expire at a fixed one hour, with existing per-workspace quotas: 20 companies, 40 contacts, 40 opportunities, 100 notes, 80 tasks. Provisioning and ownership constraints remain transactional.

The hourly cap bounds provisioning even if scheduled cleanup fails, but expired records can accumulate over time; alert on cleanup failures and database growth. No Redis or other new service is required. Existing authenticated CRM APIs remain subject to record ownership checks; these creation budgets are not a complete edge DDoS defense.

## Cleanup and deployment behavior

The compiled cleanup entry point closes its database pool and exits 0 on success, nonzero on failure. It selects only explicitly marked, expired demo users, locks each stable owner row and rechecks expiry before deleting in foreign-key order. Concurrent cleanup invocations serialize each owner and safely skip already removed users. Normal team users and records are never selected. It also removes expired session and rate-bucket rows. Railway skips a scheduled run when its preceding run is still active; no in-process scheduling library is used. Run every 15 minutes UTC; access still expires at one hour independently of cleanup timing.

The health endpoint runs `SELECT 1`, returns only `{ status: "ok" }` or a 503 `{ status: "unavailable" }`, and never reads/creates a session. Railway uses it during rollout rather than continuous uptime monitoring. Unknown `/api` routes remain JSON errors (401 before authentication or 404 after authentication), never SPA HTML. Hashed assets cache immutably; HTML revalidates; missing asset files return 404.

## Post-deployment checks (not performed yet)

1. Confirm pre-deploy migration logs succeed and MySQL reports 8.4.x; no seed/reset command ran.
2. GET `/health`: 200 without Set-Cookie or sensitive details. Check frontend assets, mobile layout and a direct SPA URL. GET `/api/missing`: JSON error, never HTML.
3. Inspect the HTTPS session cookie flags, reject an incorrect Origin/CSRF token, and verify login/logout using deliberately provisioned normal credentials if available.
4. Enable `DEMO_ENABLED=true` deliberately. Enter two separate browser profiles; verify distinct records, cross-ID rejection, quotas, stage changes and tasks. Verify expiry at one hour without refreshing or extending it.
5. Observe creation 429/Retry-After without trusting forwarded headers; account for shared budgets before running load checks.
6. Run cleanup manually once, then verify scheduled exit and subsequent run; preserve normal data and remove only expired demos. Confirm MySQL is unreachable publicly and configure backup/cleanup-failure monitoring.

## Official references consulted

- [Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command)
- [Private networking](https://docs.railway.com/networking/private-networking)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Cron jobs](https://docs.railway.com/cron-jobs)
- [Configuration reference](https://docs.railway.com/config-as-code/reference)
