import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAuthClient, getAdminPortalClient } from '../config/supabase.js';
import { AccountError, reserveAccountRequest } from './accountRateLimit.js';
import { AuthError, findUser, type SISUser } from './authService.js';

export function passwordChangeInput(body: unknown) {
  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['currentPassword', 'newPassword', 'confirmPassword'].includes(key)) ||
    typeof input.currentPassword !== 'string' || !input.currentPassword || input.currentPassword.length > 1024 ||
    input.currentPassword.includes('\0') || typeof input.newPassword !== 'string' ||
    input.newPassword.length < 12 || input.newPassword.length > 128 || input.newPassword.includes('\0') ||
    typeof input.confirmPassword !== 'string') {
    throw new AccountError(400, 'invalid_password_request', 'Provide your current password and a new password of 12–128 characters, with confirmation.');
  }
  if (input.newPassword !== input.confirmPassword) {
    throw new AccountError(400, 'password_mismatch', 'The new password and confirmation must match.');
  }
  if (input.newPassword === input.currentPassword) {
    throw new AccountError(400, 'password_unchanged', 'Choose a password different from your current password.');
  }
  return { currentPassword: input.currentPassword, newPassword: input.newPassword };
}

/** Student IDs always come from authentication, never request parameters. */
export class ProfileService {
  constructor(private readonly injectedDirectory?: SupabaseClient,
    private readonly authFactory = createSupabaseAuthClient) {}

  private get directory() { return this.injectedDirectory ?? getAdminPortalClient(); }

  async me(user: SISUser) {
    if (user.role !== 'student') throw new AccountError(403, 'student_access_required', 'Student access is required.');
    try {
      const [profileResult, accountResult] = await Promise.all([
        this.directory.from('profiles')
          .select('id,student_number,email,role,department,program,year_level,academic_status,avatar_url,created_at,updated_at')
          .eq('id', user.id).maybeSingle(),
        this.directory.from('users').select('users_id,email,first_name,middle_name,last_name,role,is_active')
          .eq('users_id', user.id).maybeSingle(),
      ]);
      if (profileResult.error || accountResult.error) throw new Error('Profile read failed');
      const profile = profileResult.data;
      const account = accountResult.data;
      if (!account || account.is_active !== true || !['student', 'students'].includes(account.role?.toLowerCase()) ||
        account.email?.toLowerCase() !== user.email.toLowerCase()) {
        throw new AccountError(403, 'student_access_required', 'An active matching student account is required.');
      }
      if (!profile) throw new AccountError(404, 'profile_not_found', 'Your SIS profile has not been provisioned yet.');
      if (profile.role !== 'student' || profile.email?.toLowerCase() !== account.email.toLowerCase()) {
        throw new AccountError(403, 'student_access_required', 'A matching SIS student profile is required.');
      }
      return { profile: {
        id: profile.id, studentNumber: profile.student_number,
        firstName: account.first_name, middleName: account.middle_name ?? null, lastName: account.last_name,
        fullName: [account.first_name, account.middle_name, account.last_name].filter(Boolean).join(' '),
        email: account.email, department: profile.department ?? null, program: profile.program ?? null,
        yearLevel: profile.year_level ?? null, academicStatus: profile.academic_status,
        avatarUrl: profile.avatar_url ?? null, createdAt: profile.created_at, updatedAt: profile.updated_at,
      } };
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError(503, 'profile_unavailable', 'Your student profile is temporarily unavailable. Please try again.');
    }
  }

  async changePassword(user: SISUser, body: unknown, ip: string) {
    const input = passwordChangeInput(body);
    await this.me(user);
    // Reuse the deployed database-backed password budget (20 / 15 minutes).
    // The account key also limits attempts arriving from different IP addresses.
    await reserveAccountRequest('password_complete', ip, undefined, this.directory);
    await reserveAccountRequest('password_complete', `student-password:${user.id}`, undefined, this.directory);
    const client = this.authFactory();
    let updateAttempted = false;
    let changed = false;
    let sessionsRevoked = false;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: input.currentPassword });
      if (error || !data.user || !data.session) {
        if (error?.status === 429) throw new AccountError(429, 'rate_limited', 'Too many password attempts. Try again later.', 60);
        if (!error || !error.status || error.status >= 500) {
          throw new AccountError(503, 'password_verification_unavailable', 'Password verification is temporarily unavailable.');
        }
        throw new AccountError(400, 'incorrect_current_password', 'Your current password is incorrect.');
      }
      // Auth UUIDs can differ from directory UUIDs. Resolve and recheck identity
      // after reauthentication so a concurrent email/account change fails closed.
      const verified = await findUser(data.user, this.directory);
      if (verified.id !== user.id || verified.role !== 'student' || verified.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new AccountError(403, 'student_access_required', 'The verified identity does not match your student account.');
      }
      await this.me(verified);
      updateAttempted = true;
      const { data: updated, error: updateError } = await client.auth.updateUser({ password: input.newPassword });
      if (updateError) {
        if (updateError.status === 429) throw new AccountError(429, 'rate_limited', 'Password updating is temporarily rate limited.', 60);
        if (updateError.status && updateError.status >= 400 && updateError.status < 500) {
          throw new AccountError(400, 'password_update_rejected', 'The new password was not accepted. Follow the university password requirements.');
        }
        throw new Error('Unconfirmed update');
      }
      if (updated.user?.id !== data.user.id) throw new Error('Unconfirmed identity');
      changed = true;
    } catch (error) {
      if (error instanceof AccountError) throw error;
      if (error instanceof AuthError) throw new AccountError(error.status, 'account_verification_failed', error.message);
      throw new AccountError(503, updateAttempted ? 'password_update_unknown' : 'password_verification_unavailable',
        updateAttempted ? 'The password update could not be confirmed. Try signing in before attempting another change.'
          : 'Password verification is temporarily unavailable.');
    } finally {
      // A cleanup failure must not misreport a confirmed password change.
      try {
        const { error } = await client.auth.signOut({ scope: changed ? 'global' : 'local' });
        sessionsRevoked = changed && !error;
        if (error) console.error('SIS student password session cleanup requires review');
      } catch { console.error('SIS student password session cleanup requires review'); }
    }
    return { requiresLogin: true as const, sessionsRevoked };
  }
}
