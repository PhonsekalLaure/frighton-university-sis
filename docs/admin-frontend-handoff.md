# Frighton SIS: Admin Frontend Handoff

**Audience:** Frontend engineer and QA  
**Contract reviewed:** October 22, 2026, against the current repository implementation  
**Goal:** Replace the administrator handoff screen with a separate admin console using the existing SIS backend. Also implement the public student invitation/password-recovery completion page.

## 1. Deliverables and boundaries

Build these screens:

| Suggested frontend route | Screen | Access |
| --- | --- | --- |
| `/admin` | Admin dashboard | Active administrator |
| `/admin/students` | Student accounts, filters, pagination, and create-account form | Active administrator |
| `/admin/students/:studentId` | Student detail, profile editing, and account actions | Active administrator |
| `/admin/audit-logs` | Searchable/filterable read-only audit log | Active administrator |
| `/set-password` | Accept an invitation or complete password recovery | Link-authorized; no existing login required |

Clicking a student record on **Student Accounts opens that student's detail page**. Use `student.id`, the internal directory/profile UUID, in the URL. `studentNumber` is the human-readable identifier, not the route ID. Never assume either is a Supabase Auth UUID.

Included writes are account creation, editable profile fields, access deactivation/reactivation, invitation resend, and recovery-email requests. Do not add hard delete, role editing, admin/staff provisioning, impersonation, bulk import, audit export, automated repairs, or a generic administrative-actions screen.

Academic records, grades, schedules, holds, billing, payments, courses, sections, and academic terms are read-only in this milestone. Billing is **cashier-record only**: no Pay now, payment gateway, payment entry, receipt posting, or hold-clearance control. Library operations belong to LMS; do not add borrowing/reservation controls to the admin detail page.

## 2. Existing client and integration points

The client uses React, TypeScript, Vite, existing CSS, and `lucide-react`. Reuse the established visual language, common loading/error states, and accessible form/dialog patterns. A router package is not currently installed; the app uses the History API. Support direct links, browser refresh, and back/forward navigation whichever routing approach is adopted.

Relevant starting points:

- `client/src/App.tsx`: session restoration, role branching, and current student routing.
- `client/src/pages/AdminHandoffPage.tsx`: placeholder to replace with the protected admin shell.
- `client/src/lib/api.ts`: existing credentialed GET/POST helpers.
- `client/src/types/dashboard.ts`: existing `SignedInUser`, dashboard, schedule, grades, holds, and billing types.
- `client/src/components/PageStates.tsx`: shared loading/error/heading components.

The existing domain page components fetch their own student-only `/me` endpoints. **Do not mount them unchanged inside admin detail.** Extract/reuse data-driven presentation components and pass the selected student's aggregated detail data instead. An administrator cannot use `/api/v1/dashboard/me`, `/schedule/me`, `/grades/me`, `/holds/me`, or `/billing/me` to view another student.

Route `/set-password` before the existing logged-in/logged-out role branch and before the session-loading screen. It must work even when the browser already has a student/admin session. Successful password completion clears that browser's SIS cookies, so clear client session state too.

### Authentication and environment

| Endpoint | Request / response |
| --- | --- |
| `POST /api/auth/login` | `{ email, password, remember?: boolean }` -> `{ user }` |
| `GET /api/auth/me` | Restore current session -> `{ user }` |
| `POST /api/auth/refresh` | `{}` -> `{ user }` using the HttpOnly refresh cookie |
| `POST /api/auth/logout` | `{}` -> `204`, no JSON body |

The API user contains `id`, `email`, `fullName`, and normalized `role: 'student' | 'admin'`. The current client `SignedInUser` type omits `id`; extend it if needed rather than inventing an actor-lookup endpoint.

- All browser requests use `credentials: 'include'`. Do not read/store JWTs, set a browser Authorization header, or authenticate directly with the Supabase browser SDK.
- Successful admin login goes to `/admin`; successful student login stays in the student shell. Block student access to admin routes, but remember the backend is the actual authorization authority.
- On protected reads returning `401`, a single shared refresh attempt may restore the session; retry the GET once afterward. If refresh fails with `401`/`403`, clear session state and require login. A refresh `503` is a dependency error, not proof the account is signed out. Never enter a refresh loop.
- Do not refresh on every `403`: it can mean wrong role or deactivated access. Clear stale protected data and show an appropriate access-denied/login state.
- On logout, clear role-specific data and navigation state, including if the server reports that local cookies were cleared but provider sign-out could not be confirmed.
- Local development: client `http://localhost:3000`, API `http://localhost:5000`, existing Vite `/api` proxy. Use relative `/api/...` paths. Server `CLIENT_URL` must match the browser Origin exactly; `localhost` and `127.0.0.1` are not interchangeable for this check.
- Prefer a same-origin production `/api` proxy compatible with the current HttpOnly, SameSite=Strict cookies. Arbitrary cross-site hosting is not supported merely by adding `credentials`. If using an approved cross-origin API, coordinate cookie/CORS configuration with the backend; reading `Retry-After` also requires that response header to be exposed by CORS.
- No service-role key, Management API token, LMS credential, or database connection string belongs in client code or `VITE_*` variables. Frontend implementation needs only SIS API access.

### Upgrade the shared request helper

The existing helpers discard HTTP status, machine error codes, and response headers. Extend them, preserving compatibility with existing student callers, to support:

```ts
type ApiFailure = {
  status: number;
  message: string;       // From response.error, with a safe fallback.
  code?: string;         // Not returned by every backend error.
  retryAfter?: number;  // Seconds from the Retry-After response header.
};
```

Add PATCH support, handle `204` without JSON parsing, and allow cancellation/stale-response protection on reads. Preserve `error.message` behavior for existing callers. Treat fetch failures, aborted mutations, and lost responses as potentially unknown outcomes, not evidence that no write occurred. Do not log request bodies or sensitive URLs.

**No automatic retries of account mutations or password submission.** Only the backend reconciles its internal database operation IDs. There is no browser-facing idempotency-key contract. A timed-out POST must not be silently replayed after refresh or by a query/mutation library.

## 3. Admin API reference and data models

All endpoints below are under `/api/v1/admin` and require an active admin session.

| Method and path | Success body / status |
| --- | --- |
| `GET /dashboard` | `200 AdminDashboard` |
| `GET /students` | `200 Page<StudentListItem>` |
| `POST /students` | `201 { student: Student }` |
| `GET /students/:studentId` | `200 StudentDetail` |
| `PATCH /students/:studentId` | `200 { student: Student }` |
| `POST /students/:studentId/deactivate` | `200 { student: Student }` |
| `POST /students/:studentId/reactivate` | `200 { student: Student }` |
| `POST /students/:studentId/invitation-resend` | `202 { message: string }` |
| `POST /students/:studentId/password-recovery` | `202 { message: string }` |
| `GET /audit-logs` | `200 Page<AuditEvent>` |

For the four named action POSTs, send `{}` only. Unknown fields and identifiers such as `email` in these bodies are rejected. Do not send the whole displayed student object with any mutation.

Suggested client types, based on the API rather than database column names:

```ts
import type {
  DashboardData, ScheduleData, GradesData, HoldsData, BillingData,
} from './dashboard';

type AcademicStatus = 'active' | 'probation' | 'suspended' | 'graduated' | 'withdrawn';
type AuditAction =
  | 'student.account.created'
  | 'student.profile.updated'
  | 'student.access.deactivated'
  | 'student.access.reactivated'
  | 'student.password_recovery.requested'
  | 'student.invitation.resent';

interface Student {
  id: string;
  studentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  email: string;
  department: string | null;
  program: string | null;
  yearLevel: number | null;
  academicStatus: AcademicStatus;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type StudentListItem = Student & { activeHoldCount: number };
type StudentAuth = {
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
} | null;

interface StudentDetail {
  student: Student & { auth: StudentAuth };
  dashboard: DashboardData;
  schedule: ScheduleData;
  grades: GradesData;
  holds: HoldsData;
  billing: BillingData;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AuditEvent {
  id: string;
  actorId: string;
  actor: { id: string; fullName: string; email: string };
  action: AuditAction;
  studentId: string;
  target: Student;
  changes: Record<string, { before: unknown; after: unknown }>;
  createdAt: string;
}

interface AdminDashboard {
  metrics: {
    totalStudents: number;
    activeStudents: number;
    inactiveStudents: number;
    probationStudents: number;
    studentsWithActiveHolds: number;
  };
  currentTerm: DashboardData['currentTerm'];
  recentActivity: AuditEvent[];
}
```

List items have `activeHoldCount` but **no `auth` field**. Mutation responses contain a student snapshot but not the complete detail object, list hold count, or Auth metadata; refetch the relevant reads instead of replacing a `StudentDetail` with that response. Render nullable/missing legacy display values defensively. Treat monetary values and calculated metrics as server-authoritative.

## 4. Screen requirements

### Admin dashboard

Fetch `GET /dashboard` and display the five metrics, the active academic term, and up to ten recent audit events. `studentsWithActiveHolds` counts students, not the number of holds. Probation is academic status, not deactivated access. Do not infer one from the other or assume all metric categories are mutually exclusive.

Link recent events to their target student when appropriate, and provide navigation to Student Accounts and Audit Log. No active term and no recent events are valid empty states. The backend returns recent events newest first; preserve that order. Do not invent charts, trends, enrollment figures, or term-management controls without corresponding data.

### Student accounts

Recommended columns: student number, full name, email, program/department, year level, academic status, access status, active-hold count. A normal accessible row link opens the student detail route; preserve list filters/page on return.

Supported query parameters:

| Parameter | Behavior |
| --- | --- |
| `q` | Trimmed literal case-insensitive substring across name, email, student number; maximum 100 characters. |
| `accessStatus` | `active` or `inactive`; based on `isActive`. |
| `academicStatus` | One of the five academic statuses above. |
| `department` | Exact case-insensitive match; maximum 100 characters. No department-options endpoint exists. |
| `page` | Default `1`; positive integer, maximum `1000000`. |
| `pageSize` | Default `25`; positive integer, maximum `100`. |

Example: `/api/v1/admin/students?q=STU-2026&accessStatus=active&page=1&pageSize=25`.

Omit unset filters; do not send empty strings, `all`, repeated parameters, or unsupported `sort`, `program`, or invitation-status filters. Use `URLSearchParams`. Debounce search, reset page to 1 when filters/page size change, and cancel/ignore stale responses. Store list state in the URL using only these non-sensitive parameters. Server ordering is last name, first name, then UUID; no custom sorting is implemented. Use returned pagination metadata, including `totalPages: 0` for an empty list. An out-of-range page can return no items while retaining a nonzero total.

### Create and edit profile forms

Use a modal or dedicated form within the accounts/detail experience. There is no password field in an administrator's student form. The student sets their own password through email.

| Field | Create | Edit / validation |
| --- | --- | --- |
| `firstName` | Required | Editable, nonempty, maximum 100 characters. |
| `middleName` | Optional | Editable, maximum 100; null/blank clears. |
| `lastName` | Required | Editable, nonempty, maximum 100. |
| `email` | Required | Editable, valid email, maximum 254; server trims/lowercases. |
| `studentNumber` | Required | Immutable after creation; `^STU-\d{4}-\d{4,}$`, maximum 50. Example `STU-2026-0042`. |
| `department` | Required, nonblank | Editable, maximum 100; may be cleared to null on edit. |
| `program` | Required, nonblank | Editable, maximum 150; may be cleared to null on edit. |
| `yearLevel` | Required | Number/integer 1-4; may be null on edit. Do not send a numeric string. |
| `academicStatus` | Required | Editable; exact enum value, never null. |
| `avatarUrl` | Optional | Editable HTTP/HTTPS URL, maximum 2048; no URL credentials; null/blank clears. No avatar-upload endpoint exists. |

Trim textual inputs, reject control characters, omit absent optional create fields, and send only changed allowed fields on PATCH. Do not submit an empty PATCH; disable Save when unchanged. Do not submit `id`, `fullName`, `isActive`, `role`, `auth`, timestamps, or hold counts. For cleared nullable fields, send `null`, not an omitted key.

Minimal creation example:

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane.doe@example.edu",
  "studentNumber": "STU-2026-0042",
  "department": "Computer Studies",
  "program": "BS Computer Science",
  "yearLevel": 1,
  "academicStatus": "active"
}
```

Creation sends an invitation and provisions the linked account records. A `201` means the request succeeded, not that email reached the inbox or the student accepted it. Navigate to the returned `student.id`, refresh list/dashboard data, and use wording such as "Account created; invitation requested." A duplicate email/student number returns `409`; do not assume which field conflicted unless the server says so.

Before an email edit, explain that it changes the shared university login identity, not just a contact field. The backend handles Auth/directory/profile synchronization; the client must not perform separate Supabase writes. On `503` or a network timeout, retain the form safely and refresh/review the record before any manual retry. An unresolved synchronization issue requires operator review, not a client-side rollback.

### Student detail

Fetch the single `GET /students/:studentId` aggregation. Recommended sections/tabs:

| Section | Data and behavior |
| --- | --- |
| Header / profile | `student`: identity, student number, academic profile, distinct access badge, edit action. Use `student.fullName` for the header. |
| Account activity | `student.auth`: invited, email-confirmed, and last-sign-in timestamps. Null means unavailable/missing identity, not an invitation to create another account. |
| Overview | `dashboard`: academic metrics, current term, active holds, current billing summary, Manila-local today's schedule. |
| Schedule | `schedule.currentTerm`, `schedule.classes`; no assignment editing. |
| Grades | `grades.summary`, `grades.terms`; use returned GPA/credit totals and `gradeStatus` (`final`, `in_progress`, `withdrawn`, `not_recorded`). |
| Holds | `holds.activeHolds`, `holds.resolvedHolds`; show source, reason, placed/resolved dates. No Resolve/Edit/Delete button. |
| Billing | `billing.currentStatement`, `billing.statements`, charges, cashier receipts, supplied notices; read-only. |
| Audit history link | Open `/admin/audit-logs?studentId=<student.id>`. No separate student-events endpoint exists. |

No active term, no classes, no grades, no holds, and no statement/payment history are normal empty states. Do not show missing GPA as zero, a missing billing statement as a confirmed zero balance, or failed reads as empty data. Detail is currently all-or-error: a domain dependency failure returns `503`, not a partial success payload. A valid missing UUID returns `404`; malformed IDs return `400`.

Do not infer that a confirmed email means password setup is complete. Detail does not expose password existence or invitation expiry. A last-sign-in timestamp is historical information, not a live online indicator. Render timestamps in `Asia/Manila`; treat date-only term/due-date fields as calendar dates without UTC-day shifts. Follow the existing Philippine peso formatting for billing, and do not recompute financial/grade eligibility in the browser.

### Account actions on detail

| Action | When to offer | UX and request |
| --- | --- | --- |
| Deactivate | `student.isActive === true` | Confirm student identity and explain subsequent SIS requests will be denied. POST `/deactivate` with `{}`. |
| Reactivate | `student.isActive === false` | Confirm restoration of account access. POST `/reactivate` with `{}`. |
| Resend invitation | Active account, non-null Auth metadata, `invitedAt` present, `emailConfirmedAt` absent | POST `/invitation-resend` with `{}`; say "Invitation requested," not "delivered." |
| Send recovery instructions | Active account and `emailConfirmedAt` present | POST `/password-recovery` with `{}`; say "Recovery instructions requested." |

If Auth metadata is missing/inconsistent, show an account-verification warning and disable email actions pending operator review. Recheck server responses even when local eligibility looked valid. Inactive accounts return `409` for email actions; unconfirmed recovery returns `409 invitation_pending`; confirmed/non-invited resend returns `409 invitation_not_pending`.

Serialize profile saves and account actions for a given student in the UI; disable conflicting controls while a request is pending. Access changes are idempotent but are not academic-status changes, hold clearance, hard deletion, or a shared Auth ban. Do not optimistically report success. After success refetch detail, affected list/dashboard reads, and visible audit data. Refetch Auth metadata after an email action; do not manufacture confirmation/sign-in timestamps.

## 5. Audit log

`GET /api/v1/admin/audit-logs` accepts `page`, `pageSize`, `action`, `studentId`, `actorId`, `from`, and `to` only. Pagination defaults/limits match the student list. `studentId` and `actorId` are internal directory UUIDs; omit blank filters. There is no free-text `q`, actor directory, or audit export endpoint.

Use these labels for the six supported action values:

| Value | Suggested label |
| --- | --- |
| `student.account.created` | Account created |
| `student.profile.updated` | Profile updated |
| `student.access.deactivated` | Access deactivated |
| `student.access.reactivated` | Access reactivated |
| `student.password_recovery.requested` | Recovery instructions requested |
| `student.invitation.resent` | Invitation resent |

Show timestamp, action, actor snapshot, student snapshot/number, and expandable field-level changes. The backend supplies `changes[field] = { before, after }`; render a readable field label and explicit "Not set" for null. Creation can have null before-values. Mail events can have empty changes; show "No profile fields changed" rather than an error.

Actor/target snapshots are historical: do not replace their displayed names/emails with current profile values. Avatar URLs in audit snapshots have credentials/query/fragment redacted; do not use audit targets to populate editable profile forms or overwrite a current profile/avatar. Render values as text, not raw HTML. There are no audit edit/delete controls. Reads, no-op profile/access updates, and failed account changes do not create successful mutation events.

`from` and `to` are inclusive ISO timestamps with an explicit timezone, not `YYYY-MM-DD` or an unqualified `datetime-local` string. For date-only Manila filters, translate the start date to Manila `00:00:00.000+08:00` and the end date to `23:59:59.999+08:00`, then serialize using `URLSearchParams`. Validate `from <= to`. Preserve newest-first backend ordering (timestamp then UUID descending).

## 6. Student invitation and recovery page

The staged email contract is:

```text
/set-password?token_hash=<sensitive-one-time-hash>&type=invite
/set-password?token_hash=<sensitive-one-time-hash>&type=recovery
```

This route is for students, not administrator password provisioning. Do not add a public resend/recovery-email request form: requesting mail remains an admin-only action in this backend.

1. At route entry, capture one `token_hash` and one `type` into ephemeral memory. Validate the type and reject missing/repeated parameters. The backend accepts token hashes matching `^[a-zA-Z0-9_-]{20,256}$`.
2. Immediately remove sensitive query/fragment data using `history.replaceState`, leaving `/set-password`. Capture/scrub once before analytics and the normal app bootstrap, not as a repeated render side effect; account for React development Strict Mode. Do not put tokens in localStorage/sessionStorage, router persistence, error reports, logs, or screenshots. A reload after scrubbing requires reopening the email link.
3. Show password and confirm-password inputs with appropriate new-password autocomplete, visible labels, accessible validation, and show/hide controls. Require 12-128 characters, no NUL, and matching confirmation. **Do not trim passwords.** Supabase may enforce stronger policy; backend/provider validation is authoritative.
4. On explicit submit only, call `POST /api/auth/password/complete` with `{ tokenHash, type, password }`. Do not send confirm-password, email, student ID, or Auth session tokens. No API call should verify/consume the link on page load, GET, hover, or component mount.
5. On `200 { requiresLogin: true }`, clear password/token memory and any old app session/cache, show "Password set. Sign in to continue," and navigate to `/login` through an explicit action. Do not automatically log in or send the user to a protected dashboard.
6. Handle link errors with guidance to contact Administration for a fresh invitation/recovery request. After token verification, even a failed password update can leave an invitation confirmed; a fresh **recovery** link, not another invitation, may be necessary.

Disable duplicate submission while pending. On an uncertain/network result, do not retry the same token automatically. Offer normal login first when password update might have succeeded, otherwise direct the student to Administration. Show an actionable invalid-link state when visiting `/set-password` without valid parameters; never bounce into an endless login/reset loop.

Use `Referrer-Policy: no-referrer` on the **frontend HTML response**, disable analytics/session recording on this route, and redact passwords and token-bearing URLs from proxy/error-monitoring logs. Backend API headers do not protect an independently hosted frontend document. Do not use the Supabase browser SDK to parse URL fragments, exchange links, or set passwords; this flow is completed by the SIS API.

## 7. Errors, cooldowns, and uncertain outcomes

General errors have `{ error: string }`; newer lifecycle errors may also have `code`. Never require `code` to exist or infer outcomes by matching English messages alone.

| Status / code | Frontend behavior |
| --- | --- |
| `400` | Show validation/link feedback. Do not discard an account edit unnecessarily. |
| `401` | Restore an expired session once for safe reads, or require login. Do not silently replay account writes. |
| `403` | Access denied/wrong role/deactivated account, or disallowed Origin. Do not assume every `403` is an expired session. |
| `404` | Student not found; provide Back to Student Accounts. |
| `409` | Duplicate identity/student number, conflicting account lease, or action eligibility changed. Preserve form state, inspect the server message/code, and refresh when needed. |
| `409 inactive_student` / `invitation_pending` / `invitation_not_pending` | Refresh account metadata. Require reactivation for an inactive account, invitation resend for an unconfirmed account, or recovery for a confirmed account. |
| `429 rate_limited` | Honor `Retry-After` seconds; show a countdown and disable the relevant submission until expiry. No automatic resend at zero. |
| `429 password_update_throttled` | Verification may already have consumed the link. Wait, then obtain a fresh recovery link through Administration. |
| `503 rate_limit_unavailable` | Do not bypass protection or call Supabase directly. No automatic mail attempt. |
| `503 identity_inconsistent` | Disable further email attempts and request operator review. |
| `503 email_rejected` | Provider did not accept the mail request. Show failure; any later retry is explicit and must respect cooldown. |
| `503 email_delivery_unknown` / `email_audit_incomplete` | Delivery or audit outcome needs review. The email may have been sent. Do not automatically resend or claim nothing happened. |
| `400 invalid_password_request` | Local request validation failed before verification; correct the input. |
| `400 invalid_or_expired_link` | Invalid/expired/already-used link; request a fresh link through Administration. |
| `400 password_update_rejected` | Password rejected after verification; obtain a fresh recovery link and meet provider policy. |
| `403 student_access_required` | Do not try another account ID/email; contact Administration. |
| `503 verification_unavailable` / `account_verification_unavailable` | Verification cannot be confirmed/completed; a fresh recovery link may be required. No automatic token replay. |
| `503 password_update_unknown` | Password might have changed. Offer normal login before requesting another recovery link. |
| Other `503` or mutation network timeout | Keep a neutral "Outcome not confirmed; refresh/review before retrying" state. Some legacy account errors do not have machine codes. |

Shared limits cover creation invitations, resends, and recovery requests: **20/admin/15 minutes**, **one/recipient/minute**, **five/recipient/hour**. Password completion allows **20/IP/15 minutes**. A local button timer is advisory; another tab/admin can consume shared allowance. Provider failures consume reserved allowance, and provider limits can be stricter. Never present a cooldown expiry as guaranteed delivery availability. If `Retry-After` is unavailable, explain the wait without inventing a server-authoritative reset time.

## 8. Implementation order and acceptance checklist

Recommended order: shared request/error handling and role routing; admin shell/dashboard; list/create; detail/edit/actions; audit log; public password page; integration/QA and coordinated email rollout. Suggested shell navigation is Dashboard, Student Accounts, Audit Log, plus signed-in identity and Sign out. Detail is reached through Student Accounts, not a separate top-level menu item.

- [ ] Replace the admin placeholder without changing student-only navigation/access. Direct admin links, refresh, back/forward, and sign-out work.
- [ ] Dashboard metrics, no active term, no recent events, loading, and dependency errors render correctly.
- [ ] Search/filter combinations, page changes, no matches, out-of-range pages, stale response races, and URL state work against server pagination.
- [ ] Create/edit forms enforce field limits, numeric year level, immutable fields, nullable clears, email-change confirmation, duplicate errors, and no-op Save prevention.
- [ ] Clicking a student opens the UUID detail route. Empty academic/financial data renders without pretending a failed read is empty.
- [ ] Existing domain components are data-driven in admin detail; no student-only `/me` calls are made for the selected student.
- [ ] Deactivate/reactivate/resend/recovery eligibility, confirmation dialogs, pending-state serialization, cooldowns, and post-success refetches work. No failed/uncertain response shows a success toast.
- [ ] Audit filters, historical snapshots, empty changes, redacted URLs, Manila date ranges, and read-only controls behave correctly.
- [ ] Password setup works logged out and with an existing session; it survives normal rendering without consuming a token. Missing/repeated/invalid parameters, invalid passwords, expired/replayed links, provider rejection, and uncertain updates have useful states.
- [ ] Password success clears old session state and requires normal login. GET/navigation and automatic retries never consume/replay links.
- [ ] Keyboard navigation, dialog focus/return focus, error announcements, mobile table layouts, and status labels are accessible; status is not conveyed by color alone.
- [ ] Browser tests mock account/email requests. Do not create real invitations or send recovery emails from automated tests. Run `npm.cmd test -w client`, `npm.cmd run build -w client`, and `npm.cmd run lint -w client`.
- [ ] Before live email launch, coordinate an approved disposable mailbox test and exact SIS redirect/template activation with backend/operations. The SMTP/redirect configuration and inbox delivery are not yet verified by this handoff. Preserve the shared LMS template fallback; do not change project Auth settings from the frontend.

Operational prerequisites and the opt-in live email checklist are in [Admin account operations](admin-account-operations.md). The broader API architecture is in [SIS page architecture](sis-page-architecture.md). The current backend route/validation/service implementations are authoritative if a future code change makes this document stale.
