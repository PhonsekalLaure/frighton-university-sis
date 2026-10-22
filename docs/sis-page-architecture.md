# Frighton University SIS - Page Architecture & Blueprint

## Scope and delivery status

Frighton SIS is a student self-service portal with a distinct administrator surface. The shared university `public.users` directory controls access; the SIS academic profile is `public.profiles`, keyed by `users_id` and identified externally by `student_number`.

- Only active `student` and `admin` directory accounts may sign in.
- The implemented dashboard endpoint is student-only: `GET /api/v1/dashboard/me`.
- The dashboard reads academic assignments from `academic_records`; this SIS does not model enrollment, registration, waitlists, section capacity, instructor accounts, or registrar accounts.
- The React client implements sign-in, session restoration, browser navigation, and a protected student shell. Dashboard, Schedule, Grades, and Billing are available student pages; Stage 1 adds the Holds page and a Library landing page.
- SIS owns student identity, borrowing eligibility, and university holds. The Library Management System (LMS) owns its catalog, reservations, loans, due dates, and fines.
- The student browser calls SIS APIs only. SIS and LMS communicate server-to-server with separate credentials; LMS API keys and service-role capabilities never enter browser code.
- Dashboard, Schedule, Grades, Billing, and Holds have student-only read APIs. The Library landing page is available while its LMS-backed features remain pending. The administrator surface remains separate.

## Route map

```mermaid
graph TD
    Auth["Login /login"] --> Shell["Student App Shell"]
    Shell --> Dashboard["Dashboard /dashboard"]
    Shell --> Schedule["Schedule /schedule"]
    Shell --> Grades["Grades /grades"]
    Shell --> Billing["Billing /billing"]
    Shell --> Library["Library /library"]
    Shell --> Holds["Holds /holds"]
    Auth --> Admin["Separate Administrator Console /admin"]
```

## Student dashboard

- **Route**: `/dashboard`
- **Access**: Student only.
- **Backend**: `GET /api/v1/dashboard/me`, protected by `requireAuth` and `requireStudent`.
- **Data returned**:
  - Digital ID: name, `studentNumber`, program, department, year level, academic status, and avatar.
  - Active academic term.
  - Metrics: current academic credits, cumulative GPA, earned credits, and active hold count.
  - Billing: current-term total billed, completed payments, outstanding balance, account status, and due date.
  - Unresolved student holds.
  - Current-term classes scheduled on the current `Asia/Manila` weekday.

The dashboard must render assignment language such as "current academic credits"; it must not imply that it can register a student for a class.

## Roadmap views

| Route | Audience | Backing system/tables | Notes |
| --- | --- | --- | --- |
| `/schedule` | Student | `academic_records`, `course_sections`, `courses`, `academic_terms` | `GET /api/v1/schedule/me` is available; weekly and list views remain future UI work. |
| `/grades` | Student | `academic_records`, `course_sections`, `courses`, `academic_terms` | `GET /api/v1/grades/me` returns the static transcript and GPA; presentation remains future UI work. |
| `/billing` | Student | `student_accounts`, `student_payments`, `academic_terms` | `GET /api/v1/billing/me` returns the current balance and historical cashier-posted statements. It is not an online payment portal. |
| `/library` | Student | LMS `books`, `reservations`, `borrow_records` | Stage 1 shows an integration-pending landing page. Stage 2 adds catalog, reservation, loan, due-date, and read-only fine data. |
| `/holds` | Student | SIS `student_holds` | `GET /api/v1/holds/me` and the read-only account-restrictions page are implemented. Library restrictions use `hold_type = 'library_debt'`. |
| `/admin` | Admin | SIS portal tables | The backend API is implemented under `/api/v1/admin`; the frontend still displays the administrator handoff. |

## UI shell

The protected student shell exposes Dashboard, Schedule, Grades, Billing, Library, and Holds. It supports browser back/forward navigation and shows the active term and active-hold indicator. Use the `studentNumber` returned by the API; do not use the retired `frighton_id` name. Administrator navigation belongs to the separate admin surface: an administrator who signs in here sees an explicit handoff rather than a student shell.

## Library view intent

The Library page is a student self-service view of LMS-owned data. It is not a librarian console and it does not give the browser direct database or LMS access. Stage 1 deliberately renders an integration-pending landing page; it does not show synthetic catalog data or enabled reservation/cancellation controls.

- Stage 2 will show a searchable catalog with availability and a Reserve action for available copies.
- A v1 reservation is a Main Library pickup reservation, not a waitlist. An active reservation is ready for pickup, expires after three days, and can be cancelled by the student before fulfilment.
- Show the student's active reservations, including book details, status, reservation date, Main Library pickup location, and expiry date.
- Show current loans with Manila-local due dates, overdue days, and read-only unpaid fines.
- Do not add renewals, loan history, student-entered payments, card/wallet forms, or librarian/staff workflows in v1.
- The LMS must allocate an available copy atomically, expire stale reservations, fulfil a reservation into a loan, and prevent duplicate active reservations for the same student and book.

## Holds view intent

The Holds page is a read-only account-restrictions view, not a library-loan or reservation page.

- Show active restrictions first, followed by resolved-hold history.
- For each hold, show its type, reason, source, placement date, status, and clearance guidance.
- A `library_debt` hold is an SIS restriction caused by library debt; it is not itself a book reservation or a loan record.
- Cross-link library-related guidance to `/library` and financial-hold guidance to `/billing` where appropriate.
- Students cannot create, edit, pay, or resolve holds from this page. Authorized SIS processes and the LMS manage hold state.

## Student APIs and LMS integration

Every student API requires `requireAuth` plus `requireStudent` and derives the student from the authenticated SIS session; the browser must never submit a student identifier or an LMS credential. The Holds endpoint is implemented in Stage 1. Library gateway APIs are planned for Stage 2 only, after the separate LMS publishes its service contract.

| Planned SIS API | Purpose |
| --- | --- |
| `GET /api/v1/library/books` | Return LMS-backed catalog search and availability data. |
| `GET /api/v1/library/me` | Return the signed-in student's active reservations, current loans, due dates, and read-only unpaid fines. |
| `POST /api/v1/library/reservations` | Request a reservation for an available LMS book using a server-derived student identity. |
| `DELETE /api/v1/library/reservations/:reservationId` | Cancel the signed-in student's eligible active reservation. |
| `GET /api/v1/holds/me` | **Implemented.** Return the signed-in student's active holds and resolved-hold history. |

SIS checks active status and unresolved SIS holds before forwarding a reservation request to LMS. LMS remains authoritative for availability, reservation state, loans, due dates, and fine amounts. If LMS is unavailable, SIS must not create or change a reservation locally.

When the Stage 2 contract is available, SIS configuration will add an LMS base URL and a distinct SIS-to-LMS credential. The existing LMS-to-SIS integration credential remains inbound-only. Both credentials stay server-side and are never exposed to the student browser.

LMS continues to call the protected SIS integration endpoints to check a student's borrowing eligibility and synchronize library debt holds. Use `studentNumber` consistently in every new contract; `frighton_id` is legacy terminology and must not be reintroduced.

The Stage 2 LMS contract must create or update an idempotent SIS `library_debt` hold when a loan is 14 days overdue or an unpaid replacement charge exists. It must resolve that hold only when all qualifying library debt has been cleared; this synchronization upgrade is not part of the Stage 1 SIS portal release.

## Billing view intent

The Billing page is a read-only statement center, not a payment gateway. The frontend should make the active-term statement prominent and use the returned `statements` as a newest-first term switcher or account history.

- Show total assessed, completed cashier payments, outstanding balance, due date, and `statementStatus` on the active-term card.
- Break charges into tuition, mandatory fees, and scholarship/discount. Show the receipt ledger with paid date, amount, reference number, and posting status.
- Display the supplied cashier and official-receipt notices near the ledger. A print action may create a reference statement, but must not label it an official receipt.
- Do not add a **Pay now** control, card/wallet forms, student-entered payments, or any payment write route. Only an authorized cashier/internal process records payments.
- If a future financial hold exists, cross-link it to `/holds`; do not infer or create a hold from a balance in the UI.

## Implementation order

1. Complete the protected student shell, including the Library and Holds navigation and administrator handoff.
2. Define and implement the separate LMS server-to-server API/client contract with distinct directional credentials.
3. Replace the Library pending state with catalog search, available-copy pickup reservation, active reservations, current loans, and read-only unpaid fines.
4. Implement the Holds read API and `/holds` view, including active restrictions and resolved history.
5. Complete remaining student pages against their existing student-only APIs.
6. Build the separate admin console against the implemented admin API below.

Steps 1 and 4 are the completed Stage 1 baseline. Steps 2 and 3 require the separate LMS repository and test environment; they are not implemented in the SIS while its service contract is unavailable.

## Admin backend contract

All `/api/v1/admin` routes require an active authenticated directory administrator (`requireAuth` and `requireAdmin`). Student `/me` routes stay student-only. This release provides account lifecycle writes; academic records, schedules, holds, billing, courses, sections, and LMS records are read-only through the admin API.

| Method and route | Response / behavior |
| --- | --- |
| `GET /api/v1/admin/dashboard` | `metrics` (`totalStudents`, `activeStudents`, `inactiveStudents`, `probationStudents`, `studentsWithActiveHolds`), nullable `currentTerm`, and ten newest `recentActivity` audit events. Multiple holds on one student count once in the dashboard. |
| `GET /api/v1/admin/students` | `{ items, page, pageSize, total, totalPages }`. Filters: `q`, `accessStatus=active\|inactive`, `academicStatus`, `department`, `page`, `pageSize`. Literal case-insensitive substring search across name, email, and student number; department is an exact case-insensitive match. Ordering: case-insensitive last name, first name, then UUID. |
| `POST /api/v1/admin/students` | `201 { student }`. Requires `firstName`, `lastName`, `email`, `studentNumber`, `department`, `program`, `yearLevel`, `academicStatus`. Optional `middleName`, `avatarUrl`. Invites by email and provisions shared directory + SIS profile. |
| `GET /api/v1/admin/students/:studentId` | `{ student, dashboard, schedule, grades, holds, billing }`. `student.auth` contains nullable `invitedAt`, `emailConfirmedAt`, `lastSignInAt`, or is null when no Auth identity matches. Auth UUIDs and credentials are never returned. Domain sections use the existing student aggregation rules. |
| `PATCH /api/v1/admin/students/:studentId` | `200 { student }`. Editable fields: `firstName`, `middleName`, `lastName`, `email`, `department`, `program`, `yearLevel`, `academicStatus`, `avatarUrl`. Student number and role are immutable. |
| `POST /api/v1/admin/students/:studentId/deactivate` | `200 { student }`; changes only directory access state. |
| `POST /api/v1/admin/students/:studentId/reactivate` | `200 { student }`; restores directory access. Academic status remains independent. |
| `POST /api/v1/admin/students/:studentId/password-recovery` | `202 { message }` after Supabase accepts the recovery-email request and its audit event commits. |
| `GET /api/v1/admin/audit-logs` | `{ items, page, pageSize, total, totalPages }`. Filters: `action`, `studentId`, `actorId`, `from`, `to`, `page`, `pageSize`. Date filters are inclusive ISO timestamps with a timezone. Order: timestamp descending, UUID descending. |

Student scope is a shared-directory student (`Students`/`student`, normalized case-insensitively) with a SIS `student` profile. Admin and librarian records are never student targets. Student snapshots include UUID, student number, name, email, academic-profile fields, `isActive`, and timestamps; student-list rows also contain `activeHoldCount`. A valid missing student UUID returns `404`; a malformed UUID returns `400`.

Pagination defaults to page 1 and 25 rows; page size is limited to 100. Invalid/repeated/unknown query parameters and unknown/immutable body fields return `400`. New student numbers must match `STU-YYYY-NNNN` or a longer numeric sequence (maximum 50 characters). Names and department are limited to 100 characters, program to 150, email to 254, search to 100, and avatar URL to 2048. Year level is 1–4. Optional profile fields can be cleared with null; whitespace-only optional text clears it. Creation requires a non-empty department/program and a year level. Email is trimmed and lowercased. Bodyless actions accept only an empty body/object.

### Identity synchronization and audit behavior

- `admin_write_student` commits directory/profile changes and their audit event together. Only the service role can execute admin RPCs; the database rechecks the actor's active directory-admin role.
- Auth identities are resolved by email, not by assuming `users.users_id` equals `auth.users.id`. A minimal service-only SQL lookup avoids exposing Auth secrets or enumerating the Auth directory through the API.
- Invitations use `CLIENT_URL` plus `/set-password`. Configure this exact URL in Supabase Auth's redirect allowlist. The frontend acceptance/password screen is a later milestone; sending mail successfully does not yet make that screen available.
- Admins never supply passwords. The legacy required directory password column receives a fixed managed-by-Auth marker and is never read or returned by this feature.
- Provisioning failures remove only a newly created invitation whose ownership can be confirmed. Existing Auth or directory accounts are never adopted or deleted. Duplicate email/student number returns `409`.
- Edits use a database lease (five-minute expiry) around Auth and SQL operations to serialize account changes across API replicas. A conflicting lease returns `409`. Auth email updates are rolled back if the SQL transaction rejects the edit. If rollback cannot be confirmed, the API returns `503`, retains the lease, and logs only operation/student identifiers for review.
- RPC retries share an operation UUID; audit IDs make committed writes safe to retry after a lost response. Connection failures, unknown-completion SQLSTATEs such as `08007`/`40003`, and unfamiliar errors are treated as uncertain, not proof of rollback. An uncertain commit is reconciled against the audit record before attempting compensation. If it cannot be resolved, the identity is retained for review rather than risking deletion or reversal of a committed change. Confirmed retries reload the student profile so a redacted audit snapshot cannot replace the actual profile response; a reload failure never triggers compensation of a known commit.
- Deactivation applies to subsequent authenticated requests, including existing sessions, because `requireAuth` rechecks directory access. It does not ban the shared Auth identity, change academic status, or revoke in-flight requests.
- Profile edits with no field changes and already-active/already-inactive requests do not add duplicate audit events. Reads are not logged. There is no hard-delete route.
- Audit actions: `student.account.created`, `student.profile.updated`, `student.access.deactivated`, `student.access.reactivated`, `student.password_recovery.requested`. Each event has `id`, `actorId`, `actor`, `action`, `studentId`, `target`, `changes`, `createdAt`; changes map field names to `{ before, after }`. Actor and target snapshots survive future account edits/deletion. No passwords, Auth metadata, tokens, cookies, recovery links, raw requests, or service keys are logged.
- A database insertion trigger removes URL credentials, query parameters, and fragments from avatar URLs in audit targets and both change snapshots. Student profiles retain the complete URL. This protects RPC writes and direct service-role inserts; null avatars stay null and changes only to a URL signature still create an audit event. The follow-up migration leaves the original applied migration and existing append-only history unchanged.
- Audit rows are append-only, including a database trigger rejecting update/delete/truncate. Active admins can read through the API or audit RLS; students, inactive admins, and anonymous users cannot read them. Browser roles cannot write audit records.
- Email delivery and SQL cannot share a transaction. A successful mail submission followed by an unavailable audit database returns `503`; the email cannot be recalled. Review the account/audit state before retrying such an uncertain result. Supabase acceptance also does not prove delivery to the inbox.

### Admin verification and rollout

Run `npm run test -w server` and `npm run build -w server`. Tests inject Auth/mail clients; no invitations or recovery emails are sent. To validate pending migrations and SQL assertions against the linked SIS project before applying them, run `npm run test:admin-db -w server -- --preview-migration <pending-filename.sql> [more-filenames.sql]` in migration order. For the audit correction, supply `20261022055741_admin_audit_url_redaction.sql`. The script verifies the configured and linked project identities, uses synthetic transaction-local records, and rolls everything back. After applying the migrations, run `npm run test:admin-db -w server` to repeat those rollback-only assertions against the installed schema.

Create migrations with `supabase migration new`, review `supabase db push --dry-run`, then apply to the verified SIS project. The additive migration does not rewrite existing identity, academic, billing, or LMS data. Audit snapshots are deliberately preserved by the existing SIS reset script. Unavailable Auth/database dependencies return `503`; internal errors and secrets are not returned to clients.

## Explicit boundaries

This baseline excludes academic enrollment and registration, course waitlists, librarian UI, loan renewals, online payment processing, and direct browser access to LMS credentials, service-role keys, or LMS-owned write operations.
