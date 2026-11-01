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
- `npm run reset:sis -- --confirm`: permanently clears SIS academic/financial/profile data while preserving shared users, Auth accounts, LMS data, and audit history.
- `npm run setup:sis -- --confirm`: runs the reset followed by the seed.

The `20261101000000_shared_admin_directory.sql` migration removes obsolete admin profiles only when no conflicting student records exist and makes SIS admin permissions use the shared directory. A full reseed is unnecessary for that correction.

## Contracts and operations

- [Page architecture](docs/sis-page-architecture.md)
- [Administrator client contract](docs/admin-frontend-handoff.md)
- [Account operations and live email gate](docs/admin-account-operations.md)
- [LMS student self-service handoff](docs/lms-student-library-self-service-handoff.md)
- [Inbound integration contract](docs/lms-integration-spec.md)

Existing inbound LMS compatibility routes are `GET /api/v1/integration/students/:studentNumber/status`, `POST /api/v1/integration/holds`, and `POST /api/v1/integration/holds/:holdId/resolve`. They do not constitute completed, idempotent debt synchronization.
