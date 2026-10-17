# Understanding ClientFlow

Start with a single action: a representative creates an opportunity.

1. `client/src/main.tsx` renders `RecordForm`. It fetches authorized companies and contacts, presents labeled controls, and submits decimal money as a string and dates as YYYY-MM-DD.
2. The `api` helper sends a same-origin JSON request plus the CSRF token. Vite forwards `/api` to Express during local development. The browser attaches its HttpOnly session cookie; JavaScript never reads the cookie.
3. `server/src/app.ts` verifies the cookie signature, hashes its opaque token, retrieves the unexpired session and user from MySQL, requires authentication for protected endpoints, and checks the Origin and CSRF token on writes.
4. `server/src/ownership.ts` begins a READ COMMITTED transaction and acquires ownership guard locks before lookups or writes. See `concurrency.md` for why these locks prevent a former owner from writing after reassignment. Zod validates the payload. The opportunity route checks company ownership, representative assignment, and company/contact consistency. Out-of-scope IDs return 404 rather than disclosing another representative's records.
5. Within the same locked transaction, `server/src/db.ts` creates Prisma Client with the MySQL-compatible driver adapter. Prisma inserts a row using the versioned schema. Decimal and foreign key constraints remain authoritative even when a direct API caller bypasses the UI.
6. After commit, Express returns the persisted record. The client refetches its list and summary so totals reflect database state. Reloading starts a new session lookup and reads the same database records.

## Code map

| Question | Start here |
| --- | --- |
| How do password and sessions work? | `server/src/app.ts`: `/auth/session`, `/auth/login`, `newSession`, `verify` |
| Where is access enforced? | `scope`, `company`, `opportunity`, `assignee`, and each route in `server/src/app.ts` |
| What happens on invalid input? | Zod schemas and final error middleware |
| Why can't a linked company be deleted? | Restrict relations in `server/prisma/schema.prisma` and P2003 error mapping |
| How are dates and decimal money handled? | `date`/opportunity schemas; MySQL DATE and Decimal(14,2); UI `day` and `money` |
| Where do metrics come from? | `/api/summary`, Prisma count and aggregate queries scoped to the user |
| How does the UI change stage? | Pipeline select and `OpportunityDetail`, PATCH stage route |
| What proves isolation? | `server/test/integration.test.ts`, direct requests with another user's IDs; `server/test/ownership.test.ts`, real lock contention and former-owner requests |
| How do client regressions work? | `client/e2e/regressions.spec.ts`: deletion, page correction, expired-session sign-in and persistence |
| What proves the main journey works? | `client/e2e/workflow.spec.ts`, including reload and mobile viewport |

## Interview discussion prompts

- Explain authentication versus authorization: a valid session identifies the user, but every record query must still constrain ownership.
- Explain why cookies need CSRF protection: browsers attach cookies automatically. A separate unpredictable token and Origin allowlist protect mutations.
- Explain application validation versus database constraints: validation gives useful errors; foreign keys and decimal types preserve consistency independently of a particular UI or request path.
- Explain the deletion tradeoff: restricted relationships require deliberate removal and preserve history, but may be less convenient than archival. Soft deletion would need consistent query scopes and restore semantics.
- Explain why this uses a modular monolith: one Express process and straightforward route modules are easier to inspect and run than distributed services for a small CRM.
- Explain how to extend ownership to shared teams: introduce explicit membership/access relations and centralize authorization predicates; do not simply remove the current filters.
- Explain testing boundaries: integration tests use real MySQL; browser tests verify the complete stack. Neither should run on normal data. Prepared CI is not evidence of a successful remote CI run.

Suggested exercise: add a required lost-reason field for Lost opportunities. Update the schema with a migration, Zod validation, stage transition API/UI, and a meaningful integration test. Trace each layer before coding.

## Trace a visitor demo

Try demo obtains the existing anonymous CSRF token, then posts to `/api/auth/demo`. `server/src/demo.ts` atomically creates a marked temporary sales identity, fictional records, and its one-hour session. Normal CRM requests use the same ownership checks and transaction locks. Team-admin scopes exclude demo identities. `npm run demo:cleanup` removes expired demo graphs under the same owner lock. See `visitor-demo.md` for limits and the focused tests.
