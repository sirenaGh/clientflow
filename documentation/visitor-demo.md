# Visitor demo

**Try demo** on the login page creates a temporary, editable MySQL-backed workspace without credentials. Its banner identifies sample data and asks visitors not to enter personal or confidential information. **Exit demo** invalidates the session, expires the workspace immediately, and returns to login.

## Setup and defaults

After the usual README setup, run `npm run db:generate` and `npm run db:migrate`. Set `DEMO_ENABLED=true` in your ignored `server/.env`, restart with `npm run dev`, and open `http://127.0.0.1:5173`. Enable it only in the local environment you intend to use for review. The committed environment example uses **false**; an absent setting also disables demos. Availability comes from `/api/auth/session`; changing client code cannot enable the endpoint. Turning the setting off also blocks existing demo sessions. Normal password login remains available.

There is no public application deployment, shared writable visitor account, published employee password, or organization-management module. Existing review ZIPs are historical snapshots from before this revision.

## Ownership and transactions

Migration `202610170002_visitor_demo` adds `User.isDemo` (default false), nullable `User.demoExpiresAt`, and an expiry index. A workspace is that explicitly marked temporary sales identity and its existing ownership graph: companies, opportunities, and tasks reference it; contacts inherit company ownership and notes inherit opportunity access. This avoids duplicated flags on every record. Existing normal users retain false and their records are preserved.

- Each successful `POST /api/auth/demo` creates a unique temporary identity, three companies, three contacts, six opportunities (one per stage), two authored notes, and five tasks spanning overdue/upcoming/completed states. Dates follow the existing UTC calendar convention.
- One interactive transaction creates the identity, fixtures and session, and removes the previous anonymous session. Failure rolls back everything. The cookie is issued after commit.
- Demo password fields contain a non-password sentinel. Regular password login explicitly rejects demo identities using the dummy verification path. No visitor password is generated or returned.
- Existing server ownership checks cover every list, detail, relationship, note, task and metric. Assignment checks prohibit crossing the demo/team boundary. Team administrators' scopes exclude demo owners, including direct-ID requests. Normal selectors omit demo identities; visitors select only themselves.
- Admin guard locks cover normal representatives only and scan the primary index in ID order, preserving lock order despite the new expiry index. Demo writes lock their own stable user row and recheck availability and expiry inside the transaction. Cleanup locks the same row. Normal-team ownership transfers preserve the previous guarantees; see `concurrency.md`.

## Lifetime and limits

Workspace and session expiry are fixed to **one hour from provisioning**, enforced independently by the server. Extending a session row cannot extend its workspace. Activity, reload and session lookup do not renew access. Exit expires the workspace early and deletes its sessions. The client uses the existing expiry recovery flow and never replays a failed mutation automatically.

Creation uses exact Origin validation and the existing anonymous session-bound CSRF flow. Cookies remain HttpOnly and SameSite=Lax, with Secure in production. Authenticated users must exit first. The endpoint allows **five attempts per IP per hour**, using the existing per-process limiter. Shared limiting, explicit reverse-proxy settings, and aggregate provisioning controls remain prerequisites to assess before public/multi-instance hosting.

Limits include sample records:

| Record | Maximum per workspace |
| --- | ---: |
| Companies | 20 |
| Contacts | 40 |
| Opportunities | 40 |
| Notes | 100 |
| Tasks | 80 |

Quota counts and inserts run under the owner lock in one transaction, preventing simultaneous requests from consuming the same final slot. A useful 409 explains the limit. Editing, stages, completion and deletion remain available. Existing field/request-size limits apply. Deleting a record frees its slot, subject to restricted linked-record deletion. Normal team records have no demo quotas.

## Repeatable cleanup

```powershell
npm run demo:cleanup
```

Run from the root with the intended database in `server/.env`. The command selects **only** identities with `isDemo=true` and non-null expiry at or before its captured current time. For each candidate it locks the owner row, rechecks marker/expiry, and deletes sessions, tasks, opportunity notes, opportunities, contacts, companies, and finally the identity in a transaction. Active demos and normal identities are excluded. Foreign-key failure rolls back that workspace. Output is only a removed-workspace count; no credentials or tokens are logged. Repeating the command removes zero when nothing else has expired.

Expiry blocks access immediately, even before cleanup. Data remains stored until cleanup runs. No external scheduler was created. Run cleanup after local reviews; schedule this command regularly when deliberately preparing a hosted demo. Do not reset a database to clean demos. Verify the intended database as for any administration command; cleanup predicates still exclude normal team data.

## Code and evidence

- `server/src/demo.ts`: atomic provisioning, fictional fixtures, quotas, cleanup.
- `server/src/app.ts`: availability, session creation, password-login exclusion, scopes/selectors, quota calls, exit.
- `server/src/ownership.ts`: expiry checks under ownership locks.
- `server/src/cleanup-demos.ts`: cleanup command.
- `client/src/main.tsx` / `styles.css`: login entry, banner and exit; existing editable CRM controls.
- `server/test/demo.test.ts`: credential-free creation; two visitors; direct-ID read/edit/delete/stage/note/task attacks; employee/admin exclusion; CRUD/persistence; rollback; all quotas including concurrent final-slot requests; fixed expiry despite a longer session row; stale-writer rejection; active/expired cleanup; exit; disabled default; CSRF and throttling.
- `client/e2e/demo.spec.ts`: desktop/mobile entry, editing, stages, notes, tasks, reload persistence, second-visitor isolation, exit and expiry recovery. Screenshots are runtime artifacts, not exported session state.

See `verification.md` for actual commands/results. The guarded isolated test launcher explicitly enables demos for testing. Local MySQL 8.0.32 results do not imply MySQL 8.4 or remote CI was tested.
