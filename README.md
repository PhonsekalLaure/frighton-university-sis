# Frighton University SIS

Student self-service and a separate administrator console built with React, TypeScript, Express, and Supabase.

## Local setup

1. Run `npm install` from the repository root.
2. Copy `server/.env.example` to `server/.env` and configure the Supabase URL, anonymous key, service-role key, and `SISLMS_SUPABASE_PROJECT_REF`. Keep keys out of source control.
3. Use the existing shared project `pbkvjzclnwpucrhufyvr`. Verify the configured and CLI-linked project before database commands. Database migrations are the timestamped files in `supabase/migrations`; the former `001_initial_schema.sql`, `002_rls_policies.sql`, and `supabase/seed.sql` setup instructions are retired.
4. Run `npm run dev`. Open **http://localhost:3000**; the API listens on port **5000**. The client proxies `/api` to the API. Keep the browser origin consistent with `CLIENT_URL`.
5. Sign in with an existing active university account. Student and admin roles open their own surfaces.

The browser uses SIS HTTP-only session cookies. Supabase service-role capabilities and integration credentials remain server-side. The frontend's Supabase environment template is not required for the cookie-based portal flow.

## Implemented standalone features

| Audience | Features |
| --- | --- |
| Student | Dashboard, current schedule, transcript and GPA, current/historical cashier statements and receipts, active/resolved holds |
| Administrator | Dashboard, searchable/paginated student directory, account creation/editing, access activation/deactivation, invitation/recovery requests, full read-only student records, filtered/paginated append-only audit history |
| Account access | Session restoration and one shared refresh for concurrent expired reads, role checks, browser navigation, mobile sign-out, invitation/recovery password completion |

Only safe reads are automatically retried after session refresh. Account writes and email/password requests are never automatically replayed. Uncertain outcomes require review; the UI retains edits and honors server cooldowns.

Academic records, schedules, billing, and holds are read-only. Students pay at the university cashier; SIS has no payment gateway. Administrator actions are limited to student account management.

**Library self-service remains integration-pending.** Catalog, reservations, loans, fine display, and debt synchronization are a separate LMS integration phase. Shared active administrators use the same university Auth identity and `public.users.role = 'Admin'` in both apps; admins do not need SIS student profiles.

## Verification

```powershell
npm.cmd run test -w client
npm.cmd run test -w server
npm.cmd run build
npm.cmd run lint -w client
npm.cmd run test:admin-db -w server
```

The SQL regression command verifies the configured/linked project and uses synthetic records inside a rolled-back transaction. Automated client tests mock account and email operations; they send no invitations or recovery emails.

Local feature completion is separate from live email-delivery readiness. Redirect allowlisting, shared-template preservation, SMTP, and an approved disposable-mailbox acceptance test remain deployment prerequisites. See [account operations](docs/admin-account-operations.md).

## Development data

Typed entity fixtures live in `server/src/seed-data`. **Seeding writes to the database and resets matching seeded passwords.** Do not run it merely to verify UI work.

- `npm run seed`: provisions three admin and ten student Auth accounts and related data. Admins go into shared `users`; only students receive `profiles` and academic/billing records.
- `npm run reset:sis -- --confirm`: permanently clears SIS academic/financial/profile data and SIS library-debt synchronization state while preserving shared users, Auth accounts, LMS data (including the debt outbox), and audit history.
- `npm run setup:sis -- --confirm`: runs the reset followed by the seed.

These destructive commands are for disposable development databases. Stop both APIs and the LMS maintenance worker before resetting so they cannot repopulate debt state between deletions. After setup, restart the APIs and worker and verify debt synchronization before enabling student access. Reset is sequential, not transactional; investigate any failure before retrying. Do not use reset/setup against the shared live project.

The `20261101000000_shared_admin_directory.sql` migration removes obsolete admin profiles only when no conflicting student records exist and makes SIS admin permissions use the shared directory. A full reseed is unnecessary for that correction.

Student creation now assigns its student number automatically and accepts an optional photo file (JPEG, PNG, or WebP, up to 2 MB). Apply `20261112000000_generated_student_numbers.sql` and `20261112000100_student_photo_storage.sql` to the verified SIS project before deploying this application change. The first migration initializes yearly counters from existing profiles and preserves older-server creation compatibility; the second creates the photo storage bucket. Existing student numbers and photos are preserved. Local server tests exercise the migrations and account lifecycle in an isolated PostgreSQL engine without sending emails.

## Contracts and operations

SIS student creation generates an Auth identity without sending email, commits the student profile/number/audit and pending delivery together, then asks Supabase to send through its existing SMTP setup. Apply `20261112000200_sis_invitation_delivery.sql` and run `npm.cmd run admin:invitation-check -w server`. No new SMTP credentials or encryption key are needed. Delivery failure preserves the saved student and exposes retry/review status in the admin detail page. Verify the SIS-specific password-page email template before live use. See [invitation operations](docs/admin-account-operations.md#sis-invitation-delivery-after-account-commit).

Before applying these pending migrations, the guarded database regression check can preview the complete bundle inside a rollback transaction: `npm.cmd run test:admin-db -w server -- --preview-migration 20261112000000_generated_student_numbers.sql 20261112000100_student_photo_storage.sql 20261112000200_sis_invitation_delivery.sql`. Once applied, run `npm.cmd run test:admin-db -w server` without preview arguments.

- [Page architecture](docs/sis-page-architecture.md)
- [Administrator client contract](docs/admin-frontend-handoff.md)
- [Account operations and live email gate](docs/admin-account-operations.md)
- [LMS student self-service handoff](docs/lms-student-library-self-service-handoff.md)
- [Inbound integration contract](docs/lms-integration-spec.md)

Existing inbound LMS compatibility routes are `GET /api/v1/integration/students/:studentNumber/status`, `POST /api/v1/integration/holds`, and `POST /api/v1/integration/holds/:holdId/resolve`. They do not constitute completed, idempotent debt synchronization.

## Library self-service v1

The student Library gateway and LMS integration are implemented behind `LIBRARY_SELF_SERVICE_ENABLED=false`. Follow [the operations runbook](docs/library-self-service-operations.md) for migration preflight, directional credentials, the LMS maintenance worker, isolated integration tests, and staging acceptance before enabling it. The [OpenAPI contract](docs/library-self-service.openapi.json) documents student, private service, debt, and replacement-charge endpoints.
