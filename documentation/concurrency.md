# Ownership changes and concurrent writes

`server/src/ownership.ts` coordinates every CRM mutation in `server/src/app.ts` with a Prisma interactive transaction at **READ COMMITTED** isolation. A transaction by itself would leave the original check-then-write race possible. The locks below establish the ordering.

1. A representative locks their own stable `User` row with `SELECT ... FOR UPDATE` before any ownership or relationship lookup.
2. An administrator locks all normal sales representatives' user rows in ascending ID order before any CRM write. An ownership transfer therefore conflicts with writes by both its former and new owner.
3. All authorization lookups, relationship checks, counts, and mutations use the same transaction client. Checks run only after obtaining the locks. READ COMMITTED gives those reads the committed ownership state after any preceding reassignment.
4. The locks remain held until commit or rollback. The HTTP success response is sent after commit. The application does not automatically replay failed writes.

If a representative obtains the lock first, their write finishes before the transfer can take effect. If the administrator obtains it first, the representative waits, then checks the newly committed owner and receives 404. A stale form cannot reclaim a company by submitting its previous assignee. The same ordering covers contact moves, opportunity/company/contact validation, stage changes, notes, task moves/completion, and restricted deletion. Composite foreign keys remain in place as independent relationship enforcement.

This deliberately coarse protocol fits a small team: writes by one representative serialize, and an administrator's CRM write temporarily blocks all representative writes. Reads do not acquire these guard locks. Transactions have a ten-second timeout. Larger workloads should narrow the protocol to ordered record/parent locks with equivalent regression coverage. This change prevents stale authorization; it does not implement field-level conflict detection between two authorized editors. User creation is an offline development seed operation; future user/role administration must also participate in the locking protocol. Direct SQL maintenance must run with application writes stopped or follow the same protocol.

## Regression evidence

`server/test/ownership.test.ts` uses the guarded isolated MySQL database. An administrator transaction acquires the production guard locks and changes a real company owner while holding the transaction open. A second real transaction attempts the representative's production guard lock with a one-second MySQL lock-wait timeout. The test requires MySQL error 1205, with no substituted database methods and no scheduling sleeps. It then releases and commits the reassignment, makes direct former-owner API requests, and verifies that update, delete, reclaim, and inherited contact operations fail without changing the persisted owner or contact. Separate real admin API transfers exercise opportunity, note, and task access after reassignment, including task completion and deletion denial. Fixtures are removed by their exact IDs, only from the isolated test database.

Local execution used MySQL **8.0.32**. MySQL **8.4** is the CI target and has not been executed locally or remotely in this handoff. See `verification.md` for actual commands and results.

The design follows MySQL's documented [locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) and [READ COMMITTED behavior](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html). Documentation alignment is not a substitute for testing that server version.

Visitor demos are excluded from normal team scopes, assignments, and admin guard locks. Each demo writer and expired-workspace cleanup locks that demo identity's own user row; writes recheck its server-side expiry after acquiring the lock. See `visitor-demo.md`.
