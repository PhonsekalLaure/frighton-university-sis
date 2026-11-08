# SIS–LMS integration contract

Library self-service v1 is implemented in both repositories and remains disabled until deployment gates pass. See [operations](library-self-service-operations.md), [OpenAPI](library-self-service.openapi.json), and the [student handoff](lms-student-library-self-service-handoff.md).

## Identity and credentials

Use studentNumber from profiles.student_number. SIS resolves student identity from its authenticated session; the browser submits only bookId for creation and a reservation ID for cancellation. SIS owns eligibility and university holds. LMS owns catalog, copies, reservations, loans, fine calculation, and replacement charges.

LMS → SIS uses X-LMS-API-KEY (LMS SIS_API_KEY matches SIS LMS_INTEGRATION_API_KEY). SIS → LMS uses X-SIS-API-KEY (SIS LMS_SERVICE_API_KEY matches LMS SIS_SERVICE_API_KEY). The two secrets must differ; they never enter browser code. Private endpoints reject Origin headers.

## LMS calls to SIS

- GET /api/v1/integration/students/:studentNumber/status returns studentNumber, name, email, role, academicStatus, department, canBorrow, and activeHolds. Eligibility checks directory activation, role, academic status, and unresolved holds; any lookup failure fails closed.
- PUT /api/v1/integration/library-debt/:studentNumber accepts an aggregate snapshot with studentNumber, version, qualifyingDebtCount, amount, currency (PHP), and reason. SIS atomically applies only newer versions and maintains at most one active LMS-owned library_debt hold. Zero-debt updates are checked against the latest LMS debt before clearing.
- POST /api/v1/integration/holds accepts studentNumber and recomputes debt through LMS; caller-supplied reason/amount are ignored.
- POST /api/v1/integration/holds/:holdId/resolve only accepts LMS-owned library debt holds and refuses clearance while qualifying debt remains.

## Debt and transaction rules

Qualifying debt means all unreturned loans at least 14 Manila calendar days overdue plus all unpaid replacement charges. A returned loan does not clear a hold while another qualifying item remains. The LMS durable outbox retries delivery, preserves monotonically increasing versions, and detects time-based transitions every minute. Do not reset its version counters.

All new student/staff reservations and checkouts verify SIS eligibility. An existing active loan blocks a new reservation. Reservation creation allocates a free copy atomically, prevents duplicate student/book reservations, and expires after three days. Cancellation and expiry release allocation without modifying physical stock. Pickup checkout consumes the student's own allocation. Returns, cancellation, and offline settlement do not require SIS eligibility.

Errors use JSON error and code fields; invalid service credentials return 401, forbidden/ineligible actions 403, missing or unowned records 404, state conflicts 409, and unavailable dependencies 503 (staff SIS eligibility failures may return 502). No reservation mutation is automatically retried.
