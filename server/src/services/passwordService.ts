import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAuthClient, getAdminPortalClient } from '../config/supabase.js';
import { AuthError, findUser } from './authService.js';
import { AccountError, reserveAccountRequest } from './accountRateLimit.js';

export function passwordCompletionInput(body: unknown): { tokenHash: string; type: 'invite' | 'recovery'; password: string } {
  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['tokenHash', 'type', 'password'].includes(key)) ||
    typeof input.tokenHash !== 'string' || !/^[a-zA-Z0-9_-]{20,256}$/.test(input.tokenHash) ||
    typeof input.type !== 'string' || !['invite', 'recovery'].includes(input.type) || typeof input.password !== 'string' ||
    input.password.length < 12 || input.password.length > 128 || input.password.includes('\0')) {
    throw new AccountError(400, 'invalid_password_request', 'Provide a valid invitation/recovery token and a password of 12–128 characters.');
  }
  return { tokenHash: input.tokenHash, type: input.type as 'invite' | 'recovery', password: input.password };
}

/** No browser session, administrative password setter, or persistent token storage. */
export class PasswordService {
  constructor(private readonly authFactory = createSupabaseAuthClient,
    private readonly injectedDirectory?: SupabaseClient) {}

  async complete(body: unknown, ip: string) {
    const input = passwordCompletionInput(body); // Do not consume valid links for malformed input.
    const directory = this.injectedDirectory ?? getAdminPortalClient();
    await reserveAccountRequest('password_complete', ip, undefined, directory);
    const client = this.authFactory();
    let verified = false;
    try {
      const { data, error } = await client.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
      if (error || !data.session || !data.user) {
        if (error?.status === 429) throw new AccountError(429, 'rate_limited', 'Link verification is temporarily rate limited. Try again later.', 60);
        if (error && (!error.status || error.status >= 500)) {
          throw new AccountError(503, 'verification_unavailable', 'The link could not be verified. Its outcome is unknown; a fresh link may be required.');
        }
        throw new AccountError(400, 'invalid_or_expired_link', 'This link is invalid, expired, or already used. Request a fresh link.');
      }
      verified = true;
      const student = await findUser(data.user, directory);
      if (student.role !== 'student') throw new AccountError(403, 'student_access_required', 'Password setup is restricted to active SIS students.');
      const { data: profile, error: profileError } = await directory.from('profiles').select('id,role,email')
        .eq('id', student.id).maybeSingle();
      if (profileError) throw new AccountError(503, 'account_verification_unavailable', 'Student verification is unavailable. A fresh recovery link may be required.');
      if (!profile || profile.role !== 'student' || profile.email?.toLowerCase() !== student.email.toLowerCase()) {
        throw new AccountError(403, 'student_access_required', 'A matching SIS student profile is required.');
      }
      const { data: updated, error: updateError } = await client.auth.updateUser({ password: input.password });
      if (updateError || updated.user?.id !== data.user.id) {
        if (updateError?.status === 429) throw new AccountError(429, 'password_update_throttled',
          'Password updating is rate limited. Wait before requesting a fresh recovery link.', 60);
        const definite = updateError?.status && updateError.status >= 400 && updateError.status < 500;
        throw new AccountError(definite ? 400 : 503, definite ? 'password_update_rejected' : 'password_update_unknown',
          definite ? 'The password was not accepted. Request a fresh recovery link and follow the university password requirements.'
            : 'The password update outcome could not be confirmed. Try normal login before requesting a fresh recovery link.');
      }
      return { requiresLogin: true as const };
    } catch (error) {
      if (error instanceof AccountError) throw error;
      if (error instanceof AuthError) throw new AccountError(error.status,
        error.status === 403 ? 'student_access_required' : 'account_verification_unavailable', error.message);
      throw new AccountError(503, verified ? 'password_update_unknown' : 'verification_unavailable',
        'The request outcome could not be confirmed. Try normal login or request a fresh recovery link.');
    } finally {
      // Cleanup must not turn a known successful password change into an apparent failure.
      // Also attempt cleanup when a verify response is incomplete/uncertain.
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) console.error('SIS password setup session cleanup requires review');
      } catch { console.error('SIS password setup session cleanup requires review'); }
    }
  }
}
