# Frighton University SIS & LMS Integration Specification

## 1. Executive Summary
This document specifies the integration protocol between the **Frighton University Student Information System (SIS)** and the **Frighton University Library Management System (LMS)**.

Both systems use `studentNumber` as the shared student identifier (for example, `STU-2026-0001`). The retired `frighton_id` term is not part of new contracts.

---

## 2. Shared Identity Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Patron as Student / Patron
    participant LMS as Library Management System
    participant SIS as Frighton SIS API
    participant DB as SIS PostgreSQL / Supabase

    Patron->>LMS: Request Book Loan / Access
    LMS->>SIS: GET /api/v1/integration/students/{studentNumber}/status
    Note over LMS,SIS: Header: X-LMS-API-KEY
    SIS->>DB: Query profile & active holds
    DB-->>SIS: Return status (active/probation/holds)
    SIS-->>LMS: Return JSON { canBorrow: true/false, activeHolds: [...] }
    
    alt Holds Present or Inactive
        LMS-->>Patron: Loan Denied (Clear holds in SIS first)
    else Standing Good
        LMS-->>Patron: Loan Approved
    end
```

---

## 3. Integration Endpoints

All requests must include the secret header:
```http
X-LMS-API-KEY: <LMS_INTEGRATION_API_KEY>
Content-Type: application/json
```

### 3.1. Query Student / Patron Status
- **Method**: `GET`
- **Route**: `/api/v1/integration/students/:studentNumber/status`
- **Description**: Returns whether the patron is currently enrolled, active, and permitted to borrow library materials.

#### Example Response (200 OK)
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

---

### 3.2. Synchronize Library-Debt Hold on Student Account
- **Method**: `POST`
- **Route**: `/api/v1/integration/holds`
- **Current behavior**: The compatibility endpoint creates a SIS `library_debt` restriction when LMS reports an overdue item or unpaid replacement charge. It does not represent a reservation or loan and is **not idempotent**; do not use it for production debt synchronization.
- **Stage 2 behavior**: This endpoint will create or update one active SIS `library_debt` restriction for the student's qualifying library debt, as defined in section 5.

#### Request Body
```json
{
  "studentNumber": "STU-2026-0042",
  "reason": "Overdue Rare Manuscripts (Grimoire Collection Vol. II)",
  "amount": 45.00
}
```

#### Current example response (`201 Created`)
```json
{
  "message": "Library hold successfully placed in SIS",
  "hold": {
    "id": "e4b6c374-...",
    "student_id": "9a12c842-...",
    "hold_type": "library_debt",
    "reason": "Overdue Rare Manuscripts (Grimoire Collection Vol. II) (Outstanding Balance: $45)",
    "placed_by_system": "Frighton LMS",
    "placed_at": "2026-10-08T16:00:00Z",
    "resolved_at": null
  }
}
```

---

### 3.3. Resolve Library-Debt Hold
- **Method**: `POST`
- **Route**: `/api/v1/integration/holds/:holdId/resolve`
- **Current behavior**: Resolves the specified hold ID. It does not verify whether other qualifying debt remains, so do not use it for production debt synchronization.
- **Stage 2 behavior**: LMS may resolve the corresponding active SIS `library_debt` restriction only after all qualifying overdue debt and unpaid replacement charges have cleared for the student.

#### Example Response (200 OK)
```json
{
  "message": "Library hold successfully resolved in SIS",
  "hold": {
    "id": "e4b6c374-...",
    "resolved_at": "2026-10-08T16:15:00Z"
  }
}
```

---

## 4. Error Responses

| Status Code | Reason | Example Payload |
|:---|:---|:---|
| `401 Unauthorized` | Invalid or missing `X-LMS-API-KEY` header | `{"error": "Unauthorized: Invalid or missing integration API key"}` |
| `404 Not Found` | Unknown `studentNumber` or invalid `holdId` | `{"error": "Entity with ID STU-9999-9999 not found in Frighton University SIS"}` |
| `500 Internal Error`| Database or server failure | `{"error": "Internal Server Error"}` |

---

## 5. Stage 2 idempotency requirement

The LMS-to-SIS debt-hold synchronization must be idempotent before LMS-backed student self-service is released. Repeating the same qualifying-debt notification must create or update the same active `library_debt` hold, never create duplicate active holds. A resolution request must be ignored or rejected while any qualifying library debt remains.

This is the target Stage 2 contract. The current SIS integration endpoint is retained for compatibility and must be upgraded alongside the LMS before either system relies on this policy in production.
