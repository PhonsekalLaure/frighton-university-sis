# Admin account operations

This is a backend-only milestone. No automated test sends email, and no diagnostic/configuration command below repairs accounts or changes Supabase Auth settings. The administrator handoff frontend is unchanged.

## Verification commands

Use the linked SIS project `pbkvjzclnwpucrhufyvr` and set `SISLMS_SUPABASE_PROJECT_REF` accordingly in the local, ignored server environment. Never paste service credentials, email links, passwords, or raw requests into logs/issues.

```powershell
npm.cmd test -w server
npm.cmd run build -w server
npm.cmd run test:admin-db -w server -- --preview-migration 20261022065602_admin_account_completion.sql
# After applying the migration:
npm.cmd run test:admin-db -w server
npm.cmd run admin:diagnose -w server -- --student <internal-student-uuid>
npm.cmd run admin:diagnose -w server -- --operation <operation-uuid-from-server-log>
npm.cmd run admin:auth-check -w server
npm.cmd run admin:auth-check -w server -- --template-drafts
```

The database test uses synthetic records inside `BEGIN ... ROLLBACK`; it is not a production repair command. Diagnostics read narrowly projected information via `sis_account_diagnostics`: directory/profile existence and roles, masked emails and consistency flags, candidate Auth UUIDs, invitation/confirmation/sign-in status, password **existence only**, lease expiry, and recent commit evidence. Zero candidates means missing identity; multiple candidates require investigation, not automatic selection. An operation UUID can locate an unprovisioned invitation through its provisioning marker. Unknown UUIDs return empty results. No account or lease is changed.

## Email readiness and staged templates

`admin:auth-check` is read-only. With a `SUPABASE_ACCESS_TOKEN` supplied privately to the process, it reads the Management API and prints only safe booleans: exact redirect allowlisting, SMTP metadata presence, compatible password-length bounds, configured link expiry, and SIS-specific template markers. It never prints the token, SMTP credentials, raw configuration, or email templates. Exit `0` means inspected settings passed; `1` means a check failed; `2` means configuration is unverified/inaccessible. SMTP metadata does not prove working credentials or inbox delivery. Without Management API access, inspect the same settings manually in the dashboard. The service-role key alone cannot inspect project Auth configuration.

The template draft command does not fetch or apply settings. It emits wrappers containing explicit `__EXISTING_*_TEMPLATE_BODY__` placeholders. At deployment, use the **complete current** invitation/recovery body as each fallback; do not deploy the literal placeholders. `buildSISPasswordTemplate` preserves that body byte-for-byte in its `else` branch. Match the exact `CLIENT_URL`-derived `/set-password` redirect, not a wildcard, user metadata, or a caller-provided URL. Existing LMS/non-SIS links must continue using their original template bodies. Do not change the shared Site URL, other templates, SMTP credentials, or password policy as a side effect.

For the matching SIS redirect, links contain `token_hash={{ .TokenHash }}` and the fixed `invite`/`recovery` type. The future page must only consume the token on explicit password submission; remove it from browser history promptly, use `Referrer-Policy: no-referrer`, and disable analytics, session recording, and request-body/URL logging on this flow. The API never returns Auth access/refresh tokens. Configure error tracking and reverse proxies to redact these values as well.

Do **not** activate these templates until the deployed frontend supports this contract. Review an exact before/after diff of the shared configuration, obtain deployment approval, add the exact SIS redirect allowlist entry without removing LMS entries, and preserve a protected rollback copy of the old bodies outside Git. Rollback restores the previous templates, not audit history or user identities. Backend/schema can deploy first; email-flow launch stays gated on the password page and an approved mailbox test.

Supabase documents [email-template variables](https://supabase.com/docs/guides/auth/auth-email-templates) and [custom SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp). The default email service is restricted and is not a production delivery solution. Existing SMTP settings require operational verification; this milestone does not select or purchase an email provider.

## Investigating failed operations

Always start with read-only diagnostics and Auth provider logs. Email delivery and SQL audit recording are separate systems; API acceptance is not inbox-delivery proof. Capture only operation/student UUIDs, timestamps, safe error codes, and outcome notes.

| Situation | Investigation and next action |
| --- | --- |
| Invitation timed out or provisioning cleanup failed | Use the logged provisioning operation UUID to find the candidate identity and check whether directory/profile records and the creation audit committed. Never resend a creation request or delete an existing/shared identity based only on an HTTP failure. |
| Orphan invitation, no linked SIS records | Confirm ownership using the provisioning marker, creation timing, and absence of linked LMS/SIS use. Prepare a narrowly scoped corrective proposal for an authorized operator. Diagnostics must not delete or adopt it. |
| Directory/profile/Auth email mismatch | Determine the committed intended email from sanitized audit evidence and the original approved change. Auth UUID and directory UUID can differ. Do not choose the newest-looking value or overwrite all candidates blindly. Escalate ambiguous identities. |
| SQL commit response was lost | Check the exact operation's audit evidence. A matching event proves that account transaction committed; a failed lookup does not prove rollback. Refresh the profile before retrying. |
| Email accepted but audit missing | Inspect provider logs and the operation state. Do not automatically resend to "fix" the audit. Audit history is append-only; any corrective evidence must follow an explicitly authorized operational procedure, never alter old events. |
| Active or expired account lease | An active five-minute lease blocks conflicting changes. Wait for in-flight work to finish and investigate the operation. Expiry permits future work but does not prove that an earlier external call failed. Diagnostics never clear leases. |
| Expired/replayed link | Pending/unconfirmed invited student: administrator may resend after checking delivery state and cooldown. Confirmed student: use recovery instead. |
| Invitation confirmed but password completion failed | Check `hasPassword` and the safe API code. For an uncertain update, try normal login privately first; otherwise request a fresh recovery link. Do not unconfirm/recreate the account. |
| Password changed but temporary-session cleanup failed | A sanitized server warning is emitted; known password success still returns success. Use normal login. Do not repeat password updates as cleanup. |

Every corrective write requires explicit operator authorization for the exact target and proposed change. No repair SQL, blanket cleanup, hard-delete API, or automatic retry agent is included.

## Opt-in live mailbox smoke test

This is a **manual checklist**, not part of `npm test`. Obtain explicit approval for a dedicated disposable mailbox, a unique valid student number, the environment, email sends, and any later cleanup. Never use a real student's account. Stop if custom SMTP, shared-template preservation, or the deployed password page is unverified.

1. Confirm the linked/configured project, deployed API/frontend origin, exact redirect allowlist, staged templates, SMTP sender readiness, and provider password policy. Confirm the non-SIS template branch remains unchanged.
2. As an authorized admin, create the approved test student. Verify one directory/profile pair, one creation event, and an invitation received at the approved mailbox. Do not copy its link into terminal arguments or shared logs.
3. Before accepting, resend after the minute cooldown. Verify the Auth UUID is unchanged, no extra profile exists, and exactly one resend event was recorded. Inspect the latest message's SIS link and confirm merely opening the page does not consume it.
4. Submit a locally invalid password: the page/API must reject it before consuming the token. Submit a valid password, confirm normal login is required, then sign in using the new password. Reusing the submitted link must fail without changing the password again.
5. Request recovery as the admin after cooldown. Verify the recovery event, email receipt, password completion, and normal login using the replacement password. A provider rejection after link verification may require a new recovery link.
6. Verify rate-limit feedback and `Retry-After` using only approved test traffic. Check deactivation blocks subsequent authenticated access and reactivation restores it; do not change grades, holds, billing, or LMS records.
7. Review the dedicated student's diagnostics and audit events. Record only safe pass/fail evidence. Any account cleanup is separately approved; there is no hard-delete endpoint and audit history must remain intact.

Completing mocked/rollback tests does not satisfy this delivery gate. The gate remains outstanding until an operator performs the approved live test.
