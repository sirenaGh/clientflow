# Railway preparation verification — 2026-10-18

This revision prepares configuration only; no Railway services or deployment were created.

- `npm run db:generate`: passed, Prisma client regenerated for the public rate-budget table.
- `npm run lint`: passed after correcting a new smoke-test lint error.
- `npm run typecheck`: passed for both workspaces.
- `npm run build:production`: passed after rerunning with local child-process permission required by Vite. Builds the real frontend and compiled Express server.
- `npm run test:prepare`: passed against the isolated `clientflow_test` database, including the new third migration. This helper deliberately seeds only that test database; deployment uses `npm run db:migrate` without seeds or resets.
- `npm run test:production`: passed. Starts the compiled server with `NODE_ENV=production` and a fresh test-only secret. Checks database readiness without session creation; index and SPA route; hashed JS asset and cache policy; missing asset 404; unauthenticated JSON API errors and authenticated unknown-API 404; Secure/HttpOnly/SameSite cookie flags; incorrect-origin CSRF rejection; persistent global rate rejection despite forged forwarding headers; two simultaneous compiled cleanup processes exiting successfully, deleting the expired demo and preserving normal users. The initial smoke assertion reused a revoked anonymous session; the test was corrected to obtain a fresh session, retaining the 429 assertion.
- Existing integration cases passed before adding the new concurrency case: 5 passed, no failures or skips. They cover login/logout/session expiry, CSRF, CRM lifecycle and persistence, metrics, cross-user authorization, real ownership locking, demo isolation, fixed expiry, quotas and cleanup.
- Final `npm test`: **6 passed, 0 failed, 0 skipped** (32.39 seconds). The added test sends ten concurrent requests to a three-request MySQL budget, asserts exactly three successes and seven 429 responses, verifies persistence across middleware instances and checks an independent per-session ceiling. Its initial oversized test-only bucket prefix was shortened to fit the documented table key capacity; production bucket names were already within bounds. A sandbox-blocked run could not spawn test workers; the full rerun with process permission passed.
- `node --import tsx scripts/check-test-database.mjs`: passed, reporting local MySQL 8.0.32.
- Final `npm run test:e2e`: **6 passed, 0 failed** (4.6 minutes): desktop and mobile credential-free demo/isolation/persistence/exit/expiry; deletion/filtered pagination/open-app session recovery; normal sign-in/relationship creation/opportunity progression/reload persistence.
- Final lint and workspace type checks passed after the new test was added.

Local MySQL is 8.0.32. MySQL 8.4 migration/integration verification is delegated to the unchanged-version CI service; consult the PR's actual Actions run for its result. CI additionally builds the Docker image and runs the production smoke path. Docker is not installed locally, so no local container build is claimed. Real Railway DNS/private networking, TLS termination, runtime limits and scheduler behavior remain unverified until an explicitly authorized deployment. Browser mobile coverage is Chromium device emulation.

See [Railway setup](railway.md) for exact service commands, variables, operational bounds and post-deployment checks. Historical verification records follow.

---

# Source publication verification

Local pre-publication checks completed on **2026-10-18** (local timezone). GitHub's authenticated API account was verified as **sirenaGh**. The target repository did not exist at inspection; the reviewed source is intended for its new `main` branch. No application deployment is included.

| Command | Result |
| --- | --- |
| `npm run lint` | PASS; repeated after publication-tooling changes. |
| `npm run typecheck` | PASS for frontend, backend and test/configuration sources. |
| `npm run build` | PASS: frontend production build (40.35 seconds) and backend build. |
| `npm run test:prepare` | PASS: both versioned migrations present in the isolated test database; no pending migration; fictional seed completed. |
| `node --import tsx scripts/check-test-database.mjs` | PASS; actual local server **MySQL 8.0.32**. This helper additionally requires **8.4.x** in CI. |
| `npm test` | **5 passed, 0 failed, 0 skipped**, runner **92.937 seconds**. Includes demo isolation/expiry/quotas/cleanup and real ownership-lock contention. |
| `npm run test:e2e` | **6 passed, 0 failed**, runner **4.1 minutes**. Desktop demo 39.8 s, regression 23.0 s, workflow 40.6 s; mobile demo 46.7 s, regression 24.8 s, workflow 26.4 s. |

The local result is separate from [GitHub Actions](https://github.com/sirenaGh/clientflow/actions/workflows/checks.yml). That workflow uses an isolated `mysql:8.4` service, verifies its actual version, and runs migrations, backend integration tests, and both browser profiles. Consult the run and commit for its actual result; a local pass is not a remote result. Only selected fictional-data PNGs are eligible for failure artifacts; raw traces, filled-form error contexts and runtime files are not uploaded.

The staged source and every new commit are inspected before pushing. Actual environment files (including the rotated development password), logs, session/browser state, database dumps, dependencies, build output, caches, private helpers and review ZIPs are excluded. Only placeholder environment examples, migrations, source/tests/documentation and selected fictional-data screenshots are included. Existing archive reports below describe historical local snapshots, not the source being published. No remote history is rewritten and no live-demo URL is configured.

---

# Verification

## Visitor-demo revision: local results

This section records the visitor-demo implementation separately from the historical refinement results below. No push or public deployment was performed. The server-side switch defaults to false; only the ignored local development environment enables it. Tests explicitly enable it only through the isolated test launcher.

| Exact command | Actual result |
| --- | --- |
| `npm run db:generate` | PASS: generated Prisma Client 7.10.1 with the demo marker/expiry fields. |
| `npm run db:migrate` | PASS on local MySQL 8.0.32: additive `202610170002_visitor_demo` migration applied without a reset. Initial sandbox attempt failed with `spawn EPERM`; approved rerun passed. |
| `npm run test:prepare` | PASS: both versioned migrations applied in the isolated `clientflow_test` database, followed by development seeding. |
| `npm test` | Initial run PASS: **5 passed, 0 failed, 0 skipped**, **32.011 seconds**. Final run after strengthened cleanup/disable tests and password rotation: **5 passed, 0 failed, 0 skipped**, **30.502 seconds**. Demo lifecycle 7.356 s, demo switch/CSRF/throttle 0.266 s, existing lifecycle 4.479 s, session security 2.943 s, real ownership contention 5.065 s. |
| `npm run test:e2e` | Final run PASS: **6 passed, 0 failed**, runner **3.3 minutes**. Desktop demo 36.8 s, desktop existing regressions 21.2 s, desktop authenticated workflow 32.9 s; mobile demo 26.3 s, mobile existing regressions 16.8 s, mobile authenticated workflow 26.3 s. No retries. |
| `npm run lint` | PASS. Final repeat passed after all test updates. |
| `npm run typecheck` | PASS. Final repeat passed including the new browser and strengthened backend tests. |
| `npm run build` | PASS after approved rerun: frontend Vite production build (1 minute 38 seconds) and backend TypeScript build. Initial restricted Vite subprocess failed with `spawn EPERM`. |
| `node --import tsx .runtime/rotate-local-password.mjs` | PASS: rotated the affected fictional login in development, test and review databases and the ignored local environment, without printing the replacement. The temporary helper is not a deliverable. |
| `npm run demo:cleanup` | PASS: development database had **0 expired demo workspaces**. Initial restricted TypeScript subprocess failed with `spawn EPERM`; approved rerun succeeded. Repeated successfully and again removed **0**. |
| `npx prettier --write server/src/app.ts server/src/demo.ts server/src/ownership.ts server/src/errors.ts server/src/cleanup-demos.ts server/test/demo.test.ts client/src/main.tsx client/src/styles.css scripts/integration.mjs scripts/test-env.mjs` | PASS. New browser test and strengthened backend test were subsequently formatted with `npx prettier --write client/e2e/demo.spec.ts` and `npx prettier --write server/test/demo.test.ts`. |

### Focused backend cases

`server/test/demo.test.ts` uses real MySQL and two independent signed-cookie agents. The test runner now serializes backend test files so baseline team metrics cannot race unrelated fixture creation. No normal database reset or destructive test command was used.

- **credential-free demo isolation, team exclusion, writable lifecycle, fixed expiry and safe cleanup**: anonymous entry without passwords; distinct user and record IDs; six seeded stages; real authorized summary values; no password hash returned; session/workspace expiry match one hour; HttpOnly/SameSite cookie; disabling the flag blocks existing visitor access; admin/employee/other-visitor direct GET/PUT/DELETE, stage, note and task attempts denied; visitor attacks against team records denied; team metrics/selectors exclude demos; regular password login rejects the demo identity; CSRF failures denied; create/edit company, contact, opportunity, stage, authored note and completed task persist in MySQL; invalid cross-workspace relationships rejected; all five quotas enforced, including two concurrent requests for the last company slot; deliberate session uniqueness failure rolls back provisioning; extended session cannot extend expired workspace; stale actor is rejected inside the write transaction; cleanup removes expired data while preserving an active visitor, a normal identity with an old expiry date, and existing team data; cleanup repeats safely; exit invalidates sessions.
- **demo creation is disabled by default, CSRF protected, and rate limited**: absent flag reports disabled and cannot create a user; invalid Origin/token denied; creation reaches the five-attempt hourly limit.
- Existing lifecycle/security and real ownership-lock regressions also run unchanged; all five backend cases passed in the initial run.

### Focused browser case

`client/e2e/demo.spec.ts`: **visitor demo: no credentials, editable samples, isolation, persistence, exit and expiry**, once on desktop and once on iPhone-sized Chromium. It enters without filling login fields, checks the banner and all six stage samples, creates/edits a company and creates a contact/opportunity/note/task, changes a stage, completes a task, verifies reload persistence, opens a second independent visitor, verifies its search cannot find the first visitor's record, exits that second demo, checks the session is invalidated in MySQL/API, expires the first workspace in MySQL, and returns to the login/demo entry screen without manual reload. Asserts no uncaught page errors. Runtime dashboard screenshots are `test-results/desktop-visitor-demo.png` and `test-results/mobile-visitor-demo.png`; no browser session state is exported. Blank login screenshots are also captured as `test-results/desktop-visitor-demo-login.png` and `test-results/mobile-visitor-demo-login.png`.

Existing opportunity-deletion, pagination, session-recovery and authenticated workflow browser regressions also run. All browser and backend fixtures use the isolated test database. Cleanup of visitor test fixtures uses marked IDs and the production cleanup function against that test database.

### Remaining limits

MySQL **8.4** and remote GitHub Actions remain **unverified**; local migration and test results are from **8.0.32**. No new dependencies were required. Production Secure-cookie delivery, reverse-proxy/shared limiting, public abuse/load tests, external cleanup scheduling, physical mobile devices and non-Chromium browsers were not verified. Demo data is inaccessible at expiry but remains stored until `npm run demo:cleanup` runs. No public hosting was enabled.

An initial full browser run had five passes and one mobile re-login assertion timeout during local concurrent build load. The waiting login assertion now allows 30 seconds, with no retries or automatic mutation replay. A local test password was exposed while reading that failure artifact; the affected fictional development login was rotated in all three private local databases and the ignored environment, and the generated failure directory was removed. No credentials are recorded in this document or included in deliverables.

The prior ZIP, manifest and 15 screenshots below remain historical artifacts; they were not regenerated for this feature request. Current behavior and commands are documented in `visitor-demo.md`. A UTF-8 scan of 43 project text files found no prohibited tool-branding phrases; third-party attribution is preserved. Final successful browser output contains only runtime PNGs and `.last-run.json`, with no retained failure traces. Blank login and demo dashboard screenshots were visually inspected for both profiles.

---

# Earlier refinement verification (historical)

Refinement verified locally on **2026-10-17**. This revision fixes concurrent ownership authorization, opportunity deletion navigation, session recovery, pagination after mutations, and secondary-text readability. The existing design and modules are preserved. No schema change or new product module was introduced. Nothing was pushed or deployed.

## Environment and version coverage

- Windows; Node.js **24.18.0 LTS**, npm **11.16.0**; Chromium **156.0.8078.4**.
- `node --import tsx .runtime/review-database-version.mjs` executed the read-only query `SELECT VERSION() AS version, DATABASE() AS databaseName`: **8.0.32**, **clientflow_test**. The temporary helper and all runtime contents are excluded from the ZIP.
- MySQL is bound to loopback port **3307**. Integration/browser regressions use **clientflow_test**. Screenshots use the separate **clientflow_review_test** database, with fictional fixtures. Normal development data was not reset or used for screenshots.
- `Get-Command docker,podman,mysqld -ErrorAction SilentlyContinue` and `Get-ChildItem 'C:/Program Files/MySQL'` found MySQL 8.0.32 only; Docker, Podman and MySQL 8.4 were unavailable.
- CI declares **mysql:8.4** in `.github/workflows/checks.yml`. **MySQL 8.4 migrations: NOT RUN. MySQL 8.4 integration tests: NOT RUN. Remote GitHub Actions: NOT RUN.** Local 8.0 results do not establish tested 8.4 compatibility.
- Desktop uses Chromium's Desktop Chrome profile; mobile uses iPhone 13 Chromium emulation. Screenshot viewports: 1600x1000 admin, 1440x1000 representative desktop, 390x844 mobile CSS pixels (mobile device scale 3). Physical mobile hardware/Safari were not tested.

## Actual commands and results for this revision

Run from the repository root. These results supersede the earlier handoff's results.

| Command | Actual result |
| --- | --- |
| `npm run test:prepare` | PASS on MySQL 8.0.32: one versioned migration found, no pending changes; isolated database seeded. Initial attempt blocked by sandbox `spawn EPERM`; approved rerun passed. No reset command used. |
| `node scripts/prepare-review.mjs` | PASS: separate review database migration check and fictional seed/fixtures. Initial restricted subprocess failed to provision; approved rerun passed. Existing review fixtures preserved. |
| `npm test` | PASS: **3 passed, 0 failed, 0 skipped**, final runner **69.087 seconds**. Earlier run also passed all three (46.289 seconds). |
| `npm run lint` | PASS, exit 0. |
| `npm run typecheck` | PASS, exit 0, frontend/backend and test/configuration sources. |
| `npm run build` | PASS, exit 0: frontend production build and backend TypeScript build; final Vite build 54.71 seconds. |
| `npm run build -w client` | PASS, exit 0 after the final CSS-only pipeline header adjustment; Vite build 13.89 seconds. Final `npm run lint` also passed after this adjustment. |
| `npm run test:e2e` | PASS, exit 0: **4 passed, 0 failed**, runner **4.5 minutes** including startup/teardown. Desktop regression 28.9 s, desktop workflow 37.5 s, mobile regression 36.5 s, mobile workflow 1.2 minutes (runner-reported). |
| `npx playwright test --config playwright.review.config.ts` | PASS, exit 0: **1 passed**, final scenario **32.2 seconds**, runner **59.0 seconds**; all 15 screenshots refreshed. Earlier capture also passed (39.0 seconds; runner 1.3 minutes), followed by the final header-layout adjustment and recapture. |
| `npx prettier --write server/src/app.ts server/src/ownership.ts server/test/ownership.test.ts client/src/main.tsx client/src/styles.css client/e2e/regressions.spec.ts scripts/integration.mjs` | PASS. Client and regression files were formatted again with `npx prettier --write client/src/main.tsx client/e2e/regressions.spec.ts`. |
| `python scripts/package-review.py` | PASS, exit 0: **67 files**, including **15 screenshots**. Source allowlist, actual-environment secret matching, placeholder checks, PNG metadata inspection, ZIP CRC/path validation, and manifest SHA-256 checks passed before and after compression. Rebuilt after recording these results; the external SHA-256 sidecar identifies the final ZIP. |

Two earlier `npm run test:e2e` attempts each had the two existing workflow cases pass and the two new regressions fail: first an exact-text selector omitted the notification's dismiss button, then checkbox `check()` waited for the old input after session expiry replaced its screen. Corrected the tests to assert the status region and click the expiring control. Those failed attempts are not counted as passes. Raw traces and runtime outputs are excluded because they can contain session information. Browser runs print benign NO_COLOR/FORCE_COLOR warnings. The final browser runner printed an npm lifecycle exit-1 message when stopping its managed Vite process at teardown; all four scenarios and the runner itself exited successfully.

A build attempt failed at Vite's sandboxed `spawn EPERM`; an approved rerun passed, followed by a final build after the last client adjustment. The server build also ran. Dependency installation and database client generation were not repeated; manifests and lockfile were unchanged.

## Backend cases actually executed

Source: `server/test/integration.test.ts` and `server/test/ownership.test.ts`, against real isolated MySQL 8.0.32.

### session security, ownership boundaries, CRM lifecycle, persistence and metrics

**PASS**, 28020.8671 ms. Assertions actually exercised:

1. Unauthenticated company list returns 401.
2. Login missing CSRF returns 403; a bad password with valid CSRF/origin returns 401.
3. Avery, Jordan, and admin sign in successfully with locally supplied passwords.
4. Avery creates a company, contact, opportunity, authored note, and overdue task.
5. Assigning a representative's new company to another representative returns 403.
6. A contact outside the chosen company returns 400. Foreign company for an opportunity, foreign company for a contact, and foreign opportunity for a new task return 404.
7. Three-decimal-place money and an impossible calendar date return 400.
8. For **each of companies, contacts, opportunities, and tasks**, Jordan's direct GET, PUT, and DELETE using Avery's created ID return 404; Jordan's list excludes it; admin's GET succeeds.
9. Jordan's foreign stage change, note creation, and note deletion return 404.
10. Deleting a linked company, linked contact, or opportunity with history returns 409.
11. Proposal Sent persists; note author and current-instant timestamp are checked; decimal 12345.67 survives API readback and a separate Prisma database read.
12. Overdue filter includes the task; completion succeeds; completed filter includes it.
13. Won-value metric is checked against a separate authorized Prisma aggregate. Admin can subsequently move that representative's opportunity to Lost.
14. Own note, task, opportunity, contact, and company delete in dependency order. Pagination page 0 returns 400.
15. Logout succeeds and subsequent company access returns 401.

### signed persistent cookies, session expiry, origin rejection and login throttling

**PASS**, 7092.888 ms. Assertions actually exercised:

1. Sign-in cookie has HttpOnly, SameSite=Lax, and Path=/.
2. Reusing that signed cookie in a fresh request succeeds; tampering returns 401.
3. A write from an untrusted Origin with otherwise valid CSRF returns 403.
4. Expiring the session in MySQL makes subsequent access return 401.
5. Repeated invalid credentials reach 429 within ten attempts; preceding failures return 401.

This targeted suite does not independently verify every summary field, every input boundary, every valid role/CRUD combination, or production Secure-cookie delivery over HTTPS.

### real ownership locks serialize reassignment; former owners cannot edit, delete or reclaim related records

**PASS**, 16408.7847 ms. An admin transaction takes the production ownership guard locks and updates a real company's assignee without committing. A second real MySQL transaction attempts the former representative's production lock with a one-second lock-wait limit. The test requires error **1205**, proving contention without substituted methods or scheduling sleeps. It then releases/commits the transfer and verifies:

1. Former-owner company PUT, reclaim PUT, and DELETE each return 404; the database still contains the new owner.
2. Inherited contact edit/delete and new contact creation return 404; the contact remains unchanged.
3. A real admin API move transfers an opportunity to the other representative's company. Former-owner PUT/reclaim, stage PATCH, DELETE, note POST, note DELETE and detail GET return 404. Stage remains New.
4. A real admin API task move changes opportunity and representative together. Former-owner task PUT/reclaim, completion PATCH, DELETE and creation against the foreign opportunity return 404. The task remains incomplete.
5. All fixture cleanup is by exact IDs in the guarded test database. Existing composite relationship constraints and protected-deletion tests remain active.

See `concurrency.md` for lock scope and tradeoffs. The suite tests this controlled contention and committed-transfer ordering, not every concurrent schedule or production load level.

## Browser cases

`client/e2e/workflow.spec.ts`: **sign in, create a relationship, progress a deal and persist after reload**, once per desktop/mobile profile. Tests failed/successful login; company/contact/opportunity creation; company search/edit/readback; Escape and dialog focus return; delete cancellation; stage changes; authored note/task creation; task completion; Won; reload/readback; logout; Jordan's inability to find Avery's company. Asserts no uncaught page errors or external requests.

`client/e2e/regressions.spec.ts`: **deletion, filtered pagination and open-app session recovery**, once per desktop/mobile profile, using newly inserted fictional fixtures in the isolated test database. Assertions:

1. Delete an opportunity with no notes/tasks through confirmation. Show Pipeline and success, no misleading error, no GET of the deleted detail after deletion, and database row absent.
2. Create eleven searchable companies. Delete the only company on page 2; load ten remaining rows on Page 1 of 1, with no Page 2 of 1.
3. Create eleven upcoming tasks. Complete the only task on filtered page 2; reload Page 1 of 1 with ten rows. Check completion directly in MySQL and after browser reload.
4. Corrupt an outgoing mutation's CSRF header while preserving the real backend response. The API returns 403, the checkbox rolls back, the workspace remains authenticated, and an error is displayed.
5. Expire the current session directly in MySQL while the app is open. A task update returns 401; stale workspace state clears and the sign-in screen explains expiration. Sign in again without manual reload; cookie rotates, only one failed update was sent, and the task was not completed/replayed.
6. Delete the replacement session in MySQL and dispatch window focus; normal session checking returns the app to sign-in without manual reload. Assert no uncaught page errors.

The periodic sixty-second check shares the focus check's implementation; the test triggers focus rather than waiting a minute. Mutation failure is never automatically retried.

## Screenshots and pipeline pagination

`client/review/capture.spec.ts`: **capture fictional admin and representative review screens and verify pipeline pagination**. Screens include blank login, admin dashboard, companies, existing company View/edit dialog, both pipeline pages, opportunity details/notes, all task filters, representative desktop dashboard/pipeline and mobile dashboard/pipeline/details. Traces/video are disabled. All 15 refreshed screenshots were visually inspected. Screenshot pixels contain fictional data and no entered passwords.

The server applies authorization and title search, sorts **all matching stages together** by expected closing date then ID, and returns **ten opportunities per page**. The client divides just those returned cards among six columns. Each column explicitly labels its count **on this page**. It is not ten cards per column, and an empty column does not mean the database has no opportunity in that stage.

- Toolbar matching-record totals cover all authorized search matches on all pages. Search resets page 1.
- Sidebar open counts and dashboard metrics cover all authorized database records independently of the board search/pagination. Open excludes Won/Lost; the matching board total includes them.
- Open/won monetary totals are database aggregates, not sums of visible cards. There is no column money total.
- Horizontal scrolling reveals more columns on the same page. Next/Previous loads different cards.
- Mutations re-fetch totals and clamp an invalid page to the last valid page, then load it. An empty collection uses internal page 1 and shows No records.

Captured fixture evidence is in `screenshots/pagination-evidence.json`:

| Stage | Page 1 cards | Page 2 cards | All matching |
| --- | ---: | ---: | ---: |
| New | 2 | 0 | 2 |
| Contacted | 2 | 0 | 2 |
| Demo Scheduled | 2 | 0 | 2 |
| Proposal Sent | 2 | 1 | 3 |
| Won | 1 | 1 | 2 |
| Lost | 1 | 0 | 1 |
| **All stages** | **10** | **2** | **12** |

The review database's real aggregates are 4 companies, 9 open opportunities, USD 277,050 open value, USD 74,500 won value, and 2 overdue tasks. Avery sees six opportunities, five open, across two companies. These are fixture-backed database values.

## Remaining limitations and package inspection

MySQL 8.4 and remote CI remain unverified. No production HTTPS/Secure-cookie delivery, shared rate limiting, database TLS/backup, load testing, formal contrast/screen-reader audit, non-Chromium browser or physical mobile testing was performed. Ownership guard locks serialize one representative's writes and make admin writes block all representative writes; they do not detect conflicting field edits by authorized editors. Secondary text was enlarged/darkened; screenshots support visual review, not an accessibility certification.

The package uses a source/documentation allowlist and placeholder environment examples. Actual environment files, credentials, session/browser state, database dumps, dependencies, Git metadata, builds, caches and runtime artifacts are excluded. See `archive-inspection.md` and `review-archive-manifest.json` for the completed archive inspection. Required licenses and legitimate attribution are preserved. Source/configuration/documentation were searched with `rg -n -i` for the prohibited branding phrases, then a local UTF-8 scan checked 40 project text files; no matches remained. The final archive is checked again after compression. Nothing was pushed or deployed.
