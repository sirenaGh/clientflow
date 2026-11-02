# Demo provisioning investigation - 2026-11-02

## Finding and remaining uncertainty

The reported production failure was **not reproduced** on disposable Windows MySQL **8.4.13**, using the current production build and all three committed migrations with **no development seeds**. Both the unchanged baseline and the locally instrumented version admitted a first-time visitor, loaded the dashboard and persisted its workspace. This does not establish the cause on the deployed database or verify that the deployed artifact/schema/configuration matches this checkout. No production database or deployed endpoint was accessed or modified.

The reference-data hypothesis is not supported by this reproduction. `Role` and `Stage` are SQL enums created by the initial migration, not seeded lookup rows. Demo provisioning creates its own sales identity and derives every relationship ID from records created in the same transaction. No development account IDs or seeded companies/contacts are referenced. A production seed or speculative repair migration is not justified by this evidence.

## Request trace and the exact response

1. `GET /health` executes `SELECT 1`. It confirms basic database reachability, not the success of the provisioning transaction, schema consistency, or its foreign-key relationships.
2. The login screen fetches `GET /api/auth/session`. `newSession()` creates an anonymous session with a nullable `userId`, and `sessionCookie()` sets the signed session cookie. The response supplies its CSRF token.
3. `POST /api/auth/demo` passes session loading, exact Origin/CSRF checks, and the public creation limit. It rejects a disabled demo or an already authenticated actor before provisioning.
4. `provisionDemo()` starts a transaction, inserts a demo `User`, three companies/contacts, six opportunities, two notes and five tasks. User/company/contact/opportunity IDs come from those inserts.
5. In the same transaction it deletes only the previous anonymous session (`userId: null`) and creates the authenticated session referencing the new user, with the same fixed one-hour expiry. It commits before the route sets the new cookie and returns 201.
6. Before this change, any `PrismaClientKnownRequestError` with code `P2003` reached the centralized handler in `server/src/app.ts`, which returns 409 and the exact text **"This record has linked records. Remove the links before deleting."** Foreign-key insert failures also use P2003; a requested deletion is not necessary to reach that response. MySQL 1452 is a missing referenced row on insert/update, whereas 1451 is a restricted parent deletion/update.

The broad response classification is confirmed in source. The failing production statement and its actual MySQL code remain unknown. A deliberately injected test FK violation is evidence for diagnostic/rollback behavior, not a reproduction of the deployed incident.

## Local change

Each provisioning attempt tracks one fixed operation label: transaction begin, user/company/contact/opportunity/note/task insertion, anonymous-session deletion, authenticated-session insertion, or commit. A failure is caught **outside** the transaction, after rollback. `demo-diagnostics.ts` logs only the validated operation label, Prisma `Pdddd` code, and numeric MySQL code when available. It does not log error messages, SQL, arbitrary metadata, IDs, record values, cookies, tokens, credentials or connection strings. Successful provisioning produces no diagnostic log.

Example from the controlled local fault test (not production):

```text
Demo provisioning failed {
  operation: 'authenticated-session.create',
  prismaCode: 'P2003',
  mysqlCode: '1452'
}
```

The caller receives a sanitized HTTP 500, "The demo workspace could not be created. Please try again later.", rather than a deletion conflict. The general linked-record deletion handler is unchanged. The diagnostics are an operational failure signal, not a CRM activity/audit module. Atomicity, relationship constraints, ownership locking, session expiry, public creation limits and record quotas are unchanged.

The next evidence needed is the fixed operation/code diagnostic from an authorized deployment of the reviewed change. No deployment, production inspection or repair was performed as part of this task.

## Migrations-only regression

`npm run test:demo:pristine` requires an explicitly supplied `DEMO_TEST_DATABASE_URL` naming a **new, empty, loopback-only MySQL 8.4 database ending in `_test`**, distinct from normal development/test URLs. It refuses existing tables and wrong MySQL versions. It never resets, drops, truncates or seeds a database. Optional `DEMO_TEST_CA_FILE` supplies an absolute trusted CA path; when present the adapter and migration use verified database TLS.

Build first, then privately set these variables in the local environment:

```powershell
npm run build:production
$env:DEMO_TEST_DATABASE_URL = '<new disposable loopback MySQL 8.4 URL ending in _test>'
$env:DEMO_TEST_CA_FILE = '<absolute test CA path when TLS is required>'
npm run test:demo:pristine
```

Do not use a production URL. Keep credentials out of command history and shared logs; a local private environment/secret loader is preferable to typing actual secrets inline. The example values are placeholders only. Ports 3094 and 3095 must be free. OpenSSL and Playwright Chromium are required. The test creates an ignored, self-signed local HTTPS web proxy so the production Secure cookie and exact-Origin flow can be exercised. Its browser certificate exception applies only to that test proxy; database CA/hostname verification remains enabled when configured.

The harness asserts zero CRM/session/rate records after production migrations; first desktop and mobile Try demo responses of 201; dashboard metrics (three companies, four open opportunities); reload persistence; independent identities and direct-ID access denial; company quota enforcement; and server-side expiry independent of the session row. It then stops its web/proxy/browser processes. The disposable database remains available for private local inspection, never production repair.

A separate empty database is prepared in GitHub Actions for this regression; existing seeded integration/browser fixtures use their original separate database. Workflow wiring is prepared locally but **no new remote CI run has been executed**, because this task does not authorize pushing. The baseline lacked a migrations-only demo regression: prior browser/integration demo tests ran after development test seeding, while the TLS fixture checked empty migrations but did not enter a demo. This new test closes that coverage gap without inventing a seed dependency.

The initial development-browser suite returned 5/6 on two runs, with failed-login assertions (CSRF rejection, then missing-alert timeout). A follow-up comparison verified a pre-existing bootstrap race and fixes that separate client issue as described below. See `verification.md` for actual local commands and results.

## Follow-up: verified login bootstrap race

`main` at `87a31fe` was exported into an ignored comparison directory, sharing the same installed dependency versions. Before the client fix, SHA-256 comparisons confirmed identical client code, original workflow test, controlled regression test, Playwright configuration and Express routes between main and this branch. Tests ran serially with the same Node/Chromium versions, workers/retries/timeouts, local MySQL 8.4.13 TLS server, fixture passwords and migrations, using separate newly created test databases. No production database was involved.

| Version | Original failed/successful-login workflow (desktop/mobile) | Controlled late-bootstrap test (desktop/mobile) |
| --- | --- | --- |
| Main `87a31fe` | 2 passed | 2 failed: expected 401, received 403 |
| Diagnostic branch before client change | 2 passed | 2 failed: expected 401, received 403 |
| Branch after bootstrap fix | 2 passed | 2 passed |

React development StrictMode reruns the initial effect. Previously, that effect issued two anonymous `/api/auth/session` GETs. Each cookie-less request can create its own session. A late response can replace the cookie after the login form has refreshed its CSRF token, so the legitimate login POST presents a token from a different session and is correctly rejected by the server. This client race predates the diagnostic branch; the test setup exposes it through controlled response ordering, not fabricated API data.

`client/e2e/auth-bootstrap.spec.ts` holds the duplicate anonymous request until the login form's token refresh, using real backend responses and their original anonymous cookie headers. It reliably reproduced 403 on both versions before the fix. It now asserts one bootstrap request, exactly one login POST, HTTP 401 and the original incorrect-password alert; a separate wrong-Origin request must still receive 403. No retry, assertion relaxation, added sleep, CSRF bypass or mutation replay is used.

A first combined eight-case run exposed a separate test-setup interaction: twelve legitimate login attempts exceeded the existing ten-attempt development limit, and the last workflow received 429. The browser runner now uses two fresh server groups (bootstrap regression, then the six CRM workflow cases). It stops on any failure. No application limit, assertion or retry policy was changed.

The minimal client change stores the initial request promise in a component ref and reuses it when the bootstrap effect reruns. Other authentication session refreshes and server-side CSRF validation are unchanged. The earlier timeout-only result did not recur in the matched serial workflow runs; its precise latency/cancellation cause remains unconfirmed and is not represented as a separately proven diagnostics regression. The verified race is fixed and covered directly; final full-suite results are recorded in verification.


## Changed files

| File | Purpose |
| --- | --- |
| `client/src/main.tsx` | Reuses one initial session request across development effect reruns. |
| `client/e2e/auth-bootstrap.spec.ts` | Real-response session interleaving and unchanged CSRF rejection regression. |
| `server/src/demo.ts` | Per-attempt operation attribution and failure boundary after rollback; optional store for deterministic tests. |
| `server/src/demo-diagnostics.ts` | Data-minimized server diagnostic and sanitized provisioning error. |
| `server/test/demo-diagnostics.test.ts` | Safe logging, operation attribution and real late-FK rollback tests. |
| `scripts/test-demo-pristine.mjs` | Migrations-only production desktop/mobile regression on a new MySQL 8.4 database. |
| `scripts/browser.mjs` | Isolates browser groups with fresh servers so authentication tests do not exhaust workflow rate limits. |
| `scripts/integration.mjs` | Includes diagnostics tests in the backend suite. |
| `scripts/ci-environment.mjs` | Creates/grants a separate empty CI regression database. |
| `.github/workflows/checks.yml` | Wires the future migrations-only browser check. |
| `package.json` | Exposes `test:demo:pristine`. |
| `server/.env.example` | Empty placeholders for explicit disposable regression settings. |
| `README.md` | Links this investigation. |
| `documentation/demo-provisioning-investigation.md` | Findings, trace, uncertainty and reproduction instructions. |
| `documentation/verification.md` | Actual local commands, results and unperformed checks. |
