# LMS Handoff Manual: Student Library Self-Service v1

**Audience:** LMS engineering and QA team  
**Purpose:** Define what the LMS must provide before Frighton SIS enables live catalog, loan, fine, and reservation features in the student portal.

## 1. Scope

SIS has completed the first portal stage:

- Students can sign in to the protected SIS portal.
- Students can view their SIS account holds at `/holds`.
- The `/library` page is intentionally an integration-pending screen; it has no synthetic catalog data or enabled reservation controls.

The next stage connects SIS to LMS through private server-to-server APIs. LMS remains the authority for its `books`, `reservations`, `borrow_records`, availability, expiry, due dates, and fines. SIS remains the authority for student identity, academic eligibility, and university-level holds.

## 2. Non-negotiable boundaries

- The student browser calls SIS only. It must never call LMS directly.
- LMS credentials, LMS service-role credentials, and database credentials must remain server-side.
- SIS must not write LMS tables. All reservation, loan, and fine mutations occur in LMS.
- Use `studentNumber` everywhere in new contracts, for example `STU-2026-0042`.
- Do not use the retired `frighton_id` name.
- v1 has no waitlist, renewal, loan-history screen, librarian UI, or online library-payment flow.

## 3. Credentials and network setup

Two credentials are required and they must be different:

| Direction | Owner | Use |
| --- | --- | --- |
| LMS → SIS | LMS and SIS | LMS calls SIS to verify borrowing eligibility and synchronize library-debt holds. Send it in `X-LMS-API-KEY`. |
| SIS → LMS | LMS issues; SIS stores | SIS calls the private LMS service endpoints for the signed-in student's Library page and reservation actions. |

Please provide the SIS team with the LMS **test** base URL, authentication scheme, credential-delivery method, and credential rotation procedure. Do not put secrets in source code, browser environment variables, tickets visible to students, or this document.

## 4. Existing SIS API LMS can call

All calls require:

```http
X-LMS-API-KEY: <LMS-to-SIS secret>
Content-Type: application/json
```

### Check borrowing eligibility

```http
GET /api/v1/integration/students/:studentNumber/status
```

Example:

```http
GET /api/v1/integration/students/STU-2026-0042/status
```

Example response:

```json
{
  "studentNumber": "STU-2026-0042",
  "name": "Jane Doe",
  "email": "jane.doe@frighton.edu",
  "role": "student",
  "academicStatus": "active",
  "department": "Computer Science",
  "canBorrow": true,
  "activeHolds": []
}
```

LMS must deny a new loan or reservation when `canBorrow` is `false`.

### Current debt-hold endpoints

SIS currently exposes endpoints to place and resolve a library-debt hold:

```http
POST /api/v1/integration/holds
POST /api/v1/integration/holds/:holdId/resolve
```

The current placement body is:

```json
{
  "studentNumber": "STU-2026-0042",
  "reason": "Overdue library item",
  "amount": 45.00
}
```

**Do not treat these endpoints as production-ready debt synchronization yet.** The SIS and LMS teams must first make the synchronization idempotent as described in section 7.

## 5. LMS service API to deliver

The endpoint paths below are the proposed service contract. Equivalent paths are acceptable if both teams agree before implementation, but the fields and behavior must remain equivalent.

All endpoints are private server-to-server endpoints. SIS will attach the dedicated SIS-to-LMS credential. LMS must not infer a student from a browser session or accept an LMS credential from the browser.

### 5.1 Search the catalog

```http
GET /service/v1/books?q=<search>&page=<positive integer>&pageSize=<positive integer>
```

Response:

```json
{
  "items": [
    {
      "id": "book-123",
      "title": "Introduction to Algorithms",
      "authors": ["Thomas H. Cormen"],
      "isbn": "9780262046305",
      "coverUrl": null,
      "availableCopies": 2,
      "totalCopies": 4,
      "reservable": true
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

`reservable` must be `true` only when LMS can currently accept a pickup reservation. SIS treats availability as display data only; the reservation request is the final authority.

### 5.2 Get the student's library account

```http
GET /service/v1/students/:studentNumber/account
```

Response:

```json
{
  "reservations": [
    {
      "id": "reservation-123",
      "status": "ready_for_pickup",
      "createdAt": "2026-10-22T02:00:00.000Z",
      "expiresAt": "2026-10-25T02:00:00.000Z",
      "pickupLocation": "Main Library",
      "book": {
        "id": "book-123",
        "title": "Introduction to Algorithms",
        "authors": ["Thomas H. Cormen"],
        "coverUrl": null
      }
    }
  ],
  "loans": [
    {
      "id": "loan-123",
      "borrowedAt": "2026-10-01T02:00:00.000Z",
      "dueAt": "2026-10-29T15:59:59.000Z",
      "overdueDays": 0,
      "book": {
        "id": "book-456",
        "title": "Database System Concepts",
        "authors": ["Abraham Silberschatz"],
        "coverUrl": null
      }
    }
  ],
  "unpaidFines": [
    {
      "id": "fine-123",
      "amount": 45.00,
      "currency": "PHP",
      "reason": "Overdue item",
      "assessedAt": "2026-10-20T02:00:00.000Z"
    }
  ]
}
```

Rules:

- Send all timestamps as ISO 8601 timestamps with an offset or `Z`.
- SIS displays due dates and expiry dates in `Asia/Manila`.
- `overdueDays` is calculated by LMS and is `0` when the loan is not overdue.
- Only unpaid fines are returned. Fine data is read-only in SIS.
- Do not return loan history in v1.

### 5.3 Create a pickup reservation

```http
POST /service/v1/reservations
Content-Type: application/json
```

Request:

```json
{
  "studentNumber": "STU-2026-0042",
  "bookId": "book-123"
}
```

Success response (`201 Created`):

```json
{
  "id": "reservation-123",
  "status": "ready_for_pickup",
  "createdAt": "2026-10-22T02:00:00.000Z",
  "expiresAt": "2026-10-25T02:00:00.000Z",
  "pickupLocation": "Main Library",
  "book": {
    "id": "book-123",
    "title": "Introduction to Algorithms",
    "authors": ["Thomas H. Cormen"],
    "coverUrl": null
  }
}
```

LMS must atomically allocate an available copy, prevent duplicate active reservations for the same `studentNumber` and `bookId`, and create a reservation for Main Library pickup only.

### 5.4 Cancel a reservation

```http
DELETE /service/v1/reservations/:reservationId
```

SIS will include the server-derived `studentNumber` using the agreed authentication or request convention. LMS must verify that the reservation belongs to that student and is still eligible for cancellation. Return `204 No Content` on success.

## 6. Required LMS lifecycle behavior

- A reservation is an available-copy pickup reservation, not a waitlist entry.
- The pickup location is `Main Library`.
- An active reservation expires after three days.
- Expiry processing must release the allocated copy safely.
- Fulfilment converts a reservation into a loan.
- Cancellation releases the allocated copy safely.
- LMS must prevent duplicate active reservations even when SIS retries a request.
- Renewals are out of scope for v1.

## 7. Required library-debt synchronization behavior

Before production release, LMS and SIS must jointly implement and test this policy:

1. When a student has a loan at least 14 days overdue, or has an unpaid replacement charge, LMS synchronizes a `library_debt` hold to SIS.
2. Repeated notifications for the same student and qualifying debt must create or update one active SIS debt hold, never duplicate active holds.
3. LMS resolves the debt hold only after all qualifying overdue debt and unpaid replacement charges are cleared.
4. Retried resolution requests must be safe and must not resolve a hold while qualifying debt remains.

The current SIS placement endpoint creates holds and is not yet idempotent. Coordinate the upgraded request/response contract with the SIS team before enabling this integration in production.

## 8. Errors and retry behavior

LMS should return consistent JSON errors in this shape:

```json
{
  "error": "Human-readable explanation",
  "code": "MACHINE_READABLE_CODE"
}
```

| Status | Meaning | Examples |
| --- | --- | --- |
| `400` | Invalid request | Missing `bookId`, malformed query parameters |
| `401` | Missing or invalid SIS-to-LMS credential | No service authentication |
| `403` | Service is authenticated but not permitted | Invalid service scope |
| `404` | Resource does not exist or is not owned by the student | Unknown book or reservation |
| `409` | Valid request conflicts with current LMS state | No available copy, duplicate active reservation, reservation already fulfilled/expired |
| `503` | LMS is temporarily unavailable | SIS should show a retry-later message and make no local state change |

SIS will not create local reservation, loan, or fine records when LMS is unavailable or returns an error.

## 9. Delivery and test checklist

Please provide all of the following before the SIS Library page is switched on:

- [ ] LMS test base URL and API specification (OpenAPI file preferred).
- [ ] Dedicated SIS-to-LMS credential and rotation procedure.
- [ ] Test student accounts using known `studentNumber` values.
- [ ] Catalog fixtures for available and unavailable books.
- [ ] Reservation fixtures for active, expired, cancelled, and fulfilled reservations.
- [ ] Loan fixtures for current and overdue loans.
- [ ] Unpaid-fine and no-fine fixtures.
- [ ] Automated tests for atomic allocation and duplicate-reservation prevention.
- [ ] Automated tests for three-day expiry, cancellation, and fulfilment-to-loan.
- [ ] Joint test of SIS borrowing eligibility and idempotent library-debt synchronization.

## 10. Acceptance criteria

The SIS team can enable the live Library page when the LMS test environment demonstrates that:

1. Catalog results and availability can be read with the server credential.
2. A signed-in eligible student can create and cancel only their own active reservation.
3. No available copy and duplicate reservation cases return a predictable conflict response.
4. The account endpoint returns active reservations, current loans, Manila-displayable dates, and read-only unpaid fines.
5. Reservation expiry, cancellation, and fulfilment preserve copy availability correctly.
6. LMS never receives a browser credential or a browser-originated call.
7. Debt-hold synchronization is idempotent and resolves only after all qualifying debt clears.

## Related SIS documentation

- `docs/sis-page-architecture.md`
- `docs/lms-integration-spec.md`
