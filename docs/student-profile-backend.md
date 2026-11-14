# Student profile backend

The profile API serves the authenticated, active SIS student. It uses the existing shared `users` directory and SIS `profiles` table. No new migration or environment variable is needed; the existing account-request limiter migration must already be installed. The profile page frontend is not included in this backend change.

Both endpoints require the existing SIS HTTP-only session cookies or a valid bearer token, plus student authorization. Administrators cannot use these endpoints. The server derives the student ID and email from authentication. There is no route for reading another student's profile or editing personal/academic details.

## Read basic details

`GET /api/v1/profile/me`

```json
{
  "profile": {
    "id": "shared-directory-uuid",
    "studentNumber": "STU-2026-0001",
    "firstName": "Test",
    "middleName": "Middle",
    "lastName": "Student",
    "fullName": "Test Middle Student",
    "email": "student@example.edu",
    "department": "Computer Studies",
    "program": "BS Computer Science",
    "yearLevel": 1,
    "academicStatus": "active",
    "avatarUrl": null,
    "createdAt": "2026-10-20T00:00:00Z",
    "updatedAt": "2026-11-12T00:00:00Z"
  }
}
```

Names and email come from the shared directory; academic information, student number, photo, and timestamps come from the SIS profile. `middleName`, `department`, `program`, `yearLevel`, and `avatarUrl` may be null. Profile timestamps describe the SIS academic profile. The response never contains passwords, Auth UUIDs, or tokens. Responses have `Cache-Control: no-store`.

## Change password

`POST /api/v1/profile/me/password`

Send JSON with these exact fields and the configured frontend `Origin` when using cookies:

```json
{
  "currentPassword": "current password",
  "newPassword": "new password of at least 12 characters",
  "confirmPassword": "new password of at least 12 characters"
}
```

The current password must be nonempty and at most 1024 characters. The new password must be 12–128 characters, differ from the current password, and match confirmation exactly. Passwords are not trimmed; NUL characters and unknown fields are rejected. Supabase may impose additional password requirements.

The server reauthenticates with the current password through an isolated Supabase client, resolves its identity back to the same active directory student, and rechecks the SIS profile before updating the password. Auth UUIDs are not assumed to equal directory UUIDs. The update uses authenticated Supabase Auth, with no plaintext password storage in SIS tables. Because SIS and LMS share Auth identities, this changes the student's password for both systems.

The existing database-backed password limiter allows 20 attempts per 15-minute window per IP and per student account. The IP budget is shared with invitation/recovery password completion. Both budgets are reserved before credential verification, are shared across API instances, and fail closed if the limiter is unavailable. Configure any deployment proxy to supply a trustworthy client IP consistent with the existing server setup.

Successful response:

```json
{ "requiresLogin": true, "sessionsRevoked": true }
```

After a confirmed change, the server attempts global sign-out and clears all three SIS authentication cookies. The frontend should clear its in-memory user state, clear password fields, and navigate to login. `sessionsRevoked: true` means Supabase accepted global refresh-session revocation. Existing access JWTs may remain valid until expiry, as described in [Supabase's sign-out documentation](https://supabase.com/docs/guides/auth/signout).

If global sign-out fails, the confirmed password change still returns `200`, with `sessionsRevoked: false`. Tell the student their password changed and they must sign in again, but other sessions could not be confirmed signed out. Do not submit the password change again automatically.

## Error handling

Errors use `{ "error": "Displayable message", "code": "stable_code" }`.

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_password_request` | Invalid body, unsupported fields, or password length. |
| 400 | `password_mismatch` | Confirmation does not match. |
| 400 | `password_unchanged` | New password equals the current password. |
| 400 | `incorrect_current_password` | Reauthentication was rejected. |
| 400 | `password_update_rejected` | Supabase rejected the proposed password. |
| 401 | `UNAUTHORIZED` | Missing or expired authentication; sign in again. |
| 403 | `FORBIDDEN`, `student_access_required`, or `account_verification_failed` | Wrong role, disallowed request origin, or unavailable/mismatched student identity. |
| 404 | `profile_not_found` | The student's SIS profile has not been provisioned. |
| 429 | `rate_limited` | Wait for the `Retry-After` header before another attempt. |
| 503 | `profile_unavailable`, `rate_limit_unavailable`, or `password_verification_unavailable` | A required service is unavailable; no password update was attempted. |
| 503 | `account_verification_failed` | Directory verification after reauthentication is unavailable; no update was attempted. |
| 503 | `password_update_unknown` | An update was attempted but its outcome is uncertain. Cookies are cleared; try normal login before another change. |

Never automatically replay this POST after refresh, a timeout, or another transport failure. Show an explicit result and let the student retry deliberately. Password confirmation and current-password values must not enter URLs, analytics, logs, or browser persistence.

Verification: `npm run build:server` and `npm run test:server`. The profile tests use injected database/Auth clients and local HTTP servers; they do not change real student passwords. A deployed end-to-end Auth check remains separate from these tests.
