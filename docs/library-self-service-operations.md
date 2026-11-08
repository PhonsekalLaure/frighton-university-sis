# Library self-service v1 operations

## Implementation and ownership

Both repositories contain the student gateway, private service APIs, available-copy reservation lifecycle, replacement-charge workflow, and versioned debt synchronization. Deployment is deliberately disabled by default. The student browser calls SIS only; SIS never writes LMS tables. The shared directory and SIS profiles remain the identity authority.

The machine-readable contract is `library-self-service.openapi.json`. Internal `active` reservations map to `ready_for_pickup`; timestamps include an offset. Loan `dueAt` is 23:59:59 on the stored Manila calendar due date. Cover URLs returned by SIS point back to SIS, which proxies the private LMS image endpoint. Missing images use a local placeholder.

## Directional configuration

Set these server environment variables through the deployment's secret store, never in client variables or source control. Do not copy secret values into this runbook.

| Setting | SIS | LMS |
| --- | --- | --- |
| LMS → SIS secret | `LMS_INTEGRATION_API_KEY` | `SIS_API_KEY` |
| SIS → LMS secret, distinct from the first | `LMS_SERVICE_API_KEY` | `SIS_SERVICE_API_KEY` |
| Partner API URL | `LMS_API_URL` | `SIS_API_URL` |
| Student feature gate | `LIBRARY_SELF_SERVICE_ENABLED=false` | Not applicable |

Use HTTPS for deployed partner URLs. Rotate one direction at a time in a coordinated maintenance window; receivers accept only the current credential, with no default secret or overlap key. Invalid/equal directional credentials fail closed. Browser Origin headers are rejected on private endpoints. Existing staff and student session credentials remain separate.

## Migration and release order

Shared-project migration record (2026-11-08): all three migrations below were applied to `pbkvjzclnwpucrhufyvr` and recorded in its migration history. Supabase reports no pending migrations. Post-migration library/admin SQL regressions passed with synthetic records rolled back; database lint reported no schema errors. Existing users, profiles, books, loans, reservations, and holds retained their row counts. REST checks confirmed the one-loan policy, service access, and denied anonymous access to the new private tables. The student feature gate was left disabled at the migration stage.

1. Keep the SIS feature gate false. New staff reservations and checkouts will also require a reachable SIS API after the LMS backend update; coordinate both backend releases.
2. Verify the intended shared project and review existing grants, schema, and migration history. LMS 001/002 describe an older schema and must not bootstrap the production schema; 009 requires the production schema plus 003–008.
3. Read the preflight queries below. Have staff reconcile overallocated reservations and duplicate active LMS debt holds before proceeding. Neither migration automatically cancels reservations or rewrites hold history.
4. This installation shares a Supabase project, with SIS owning its tracked migration history. From SIS, apply `20261108000000_library_debt_sync.sql`, `20261108000100_lms_single_active_loan.sql`, and `20261108000200_lms_library_self_service.sql` in order. The latter two are exact deployment copies of LMS `008_single_active_loan.sql` and `009_library_self_service.sql`; joint tests check they remain identical. Do not apply the LMS copies a second time or push its older standalone migration directory into the shared project. These are forward-only migrations; do not run reset/seed commands against the shared project.
5. Deploy both APIs and the corresponding LMS staff client together. Updated staff payloads use `studentNumber`, including patron responses and loan filters; deploy the client with its API. Old `frightonId` payloads are no longer accepted.
6. For production, build LMS, then run `npm run library:worker -w server` as a supervised, separate long-running process. It runs every minute. For local development, LMS root `npm run dev` starts the client, API, and maintenance worker together with restart supervision. Use `npm run library:worker:dev -w server` separately only when not using that root command. The outbox and leases live in PostgreSQL.
7. Run the verification commands and a staging smoke test with known student/staff accounts. Confirm the worker has delivered its initial debt snapshots, both credentials work, and catalog covers are private.
8. Enable `LIBRARY_SELF_SERVICE_ENABLED=true` in SIS and restart/redeploy that API. Do not enable until migrations, worker, and joint acceptance checks pass.

Preflight (read-only):

```sql
SELECT r.book_id, count(*) AS reservations, b.copies
FROM public.reservations r JOIN public.books b ON b.books_id=r.book_id
WHERE r.status='active' AND r.expires_at>now()
GROUP BY r.book_id,b.copies HAVING count(*)>b.copies;

SELECT student_id,count(*) FROM public.student_holds
WHERE hold_type='library_debt' AND placed_by_system='Frighton LMS' AND resolved_at IS NULL
GROUP BY student_id HAVING count(*)>1;
```

## Policies and recovery

- `books.copies` is stock not checked out. Free stock subtracts unexpired active reservations. Reservation creation and checkout serialize on student/book rows; cancellation/expiry release allocation without changing physical stock. Staff stock edits preserve checked-out and allocated copies.
- Active pickup reservations must be cancelled or fulfilled before archiving their title. Returns of legacy archived titles remain possible. Legacy borrowers without numbered SIS profiles can return existing loans; they do not participate in SIS debt synchronization until provisioned.
- Students with any active loan cannot reserve. All new staff/student reservations and checkouts require SIS eligibility. Returns, eligible cancellation, and offline charge settlement do not depend on SIS eligibility checks.
- A reservation is ready immediately for Main Library pickup, expires in three days, and is not a waitlist entry. Multiple different titles may be reserved when no active loan exists; duplicate active student/book reservations are prohibited.
- Replacement charges are assessed and settled by authenticated staff from the circulation page. Recording settlement requires an offline receipt/reference and confirmation. The ledger records staff UUIDs and timestamps. Settlement does not return a loan or restore stock.
- Overdue amounts accrue from day one and are labeled estimates until return. A SIS debt hold applies when an unreturned loan is at least 14 Manila calendar days overdue or any replacement charge is unpaid. Fine data in SIS is read-only.
- The LMS outbox aggregates all qualifying debt per student. Loan/charge transactions refresh it; the worker detects calendar-day transitions. Repeated snapshots are safe, and older versions cannot overwrite newer SIS state. A zero-debt notification is rechecked against live LMS debt before SIS clears a hold. Compatibility hold routes recompute authoritative debt instead of trusting supplied amounts or arbitrary hold IDs.
- A failed notification leaves pending durable work. Worker claims expire after two minutes; retry backoff starts at 30 seconds and caps at one hour. Multiple workers are safe. Do not delete outbox rows or reset version counters: SIS remembers delivered versions.
- Unnumbered student profiles are excluded from the maintenance scan. Aggregate debt is not capped at the per-charge amount limit. Legacy loans without a catalog link display an unavailable-item placeholder instead of failing the account page.
- Reservation writes are never automatically replayed. After an unknown outcome, reload account/reservation records before retrying. Staff charge writes also require reviewing the refreshed ledger after uncertain outcomes.
- An uncertain catalog save retains any newly uploaded cover because it may already be committed. Reload the catalog and reconcile that book before retrying or deleting storage objects; automatic cleanup is limited to definite rejected writes.
- Disabling the SIS feature gate restores the pending screen and blocks student gateway actions. It does not delete reservations or stop staff workflows/maintenance. Students should contact the library desk for cancellation while the gate is off.

Monitor pending count, oldest pending update, attempts, and last successful delivery. A sustained growing backlog or no recent successful delivery requires checking partner availability, credentials, and worker supervision. Logs contain operation/student identifiers, not credentials or full request payloads.

```sql
SELECT count(*) AS pending,min(updated_at) AS oldest_pending,max(attempts) AS max_attempts
FROM public.library_debt_outbox WHERE delivered_version<version;
SELECT max(last_delivered_at) AS last_success FROM public.library_debt_outbox;
```

## Verification

From SIS: `npm run test -w server`, `npm run test -w client`, `npm run build`, `npm run lint -w client`, and `npm run test:library-db -w server`.

From LMS: `npm run test -w server` and `npm run build`.

The joint database command expects the repositories as sibling directories named `Frighton University SIS` and `Frighton Univeristy LMS`. It uses in-memory PGlite PostgreSQL, synthetic identities, an isolated Auth/PostgREST protocol adapter, and both actual HTTP applications. It does not load real Auth sessions or mutate the live database. It runs the existing LMS rollback-only SQL regressions too. The embedded engine serializes database commands; staging should additionally exercise multiple native PostgreSQL connections under load to verify deployment lock behavior and privileges.

The opt-in `server/integration/library-native.test.ts` suite verifies actual concurrent PostgreSQL connections. It requires a disposable cluster whose data directory ends in `frighton-library-pg-review/data`, user `library_review`, and database `library_review_test`. Set `LIBRARY_REVIEW_PG_PORT` to that cluster's loopback port and optionally `LIBRARY_REVIEW_PSQL` to its psql executable, then run `node --import tsx --test server/integration/library-native.test.ts` from SIS. It refuses other data directories and recreates only the review database's public schema. Ordinary integration runs skip this suite when the port is not supplied. Local native tests supplement, rather than replace, staging verification against deployed privileges and network configuration.

Staging smoke test: search catalog → reserve → confirm account/pickup expiry → cancel → reserve again → staff checkout → verify active-loan block → return → assess/settle a replacement charge → verify one debt hold and eventual clearance. Exercise an SIS outage during return/settlement and confirm delivery catches up after recovery. Also verify private cover storage and actual deployed cookie/proxy configuration.

## Local activation record — 2026-11-08

The local SIS Library is enabled at `http://localhost:3000/library`, with LMS at `http://localhost:3001` and server APIs on ports 5000/5001. Directional credentials were aligned in the ignored server environment files, and no secret values were added to committable files. LMS development startup now includes the supervised maintenance worker. Initial synchronization completed for all ten numbered students with no pending deliveries.

A real seeded student signed in through SIS and used the browser to create and cancel a temporary pickup reservation. The check verified student ownership, three-day expiry, restored copy availability, and the browser-to-SIS-only boundary. Temporary verification books and reservation rows were removed. The enabled page loaded six real catalog entries and its account sections on desktop and mobile with no page errors or overflow. These are local activation checks against the shared Supabase database; public hosting/deployment is separate.
