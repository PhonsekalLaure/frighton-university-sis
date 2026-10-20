import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';

export type SISRole = 'student' | 'admin';

export interface SISUser {
  id: string;
  email: string;
  fullName: string;
  role: SISRole;
}

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function findUser(user: User, adminClient: SupabaseClient = getSupabaseAdmin()): Promise<SISUser> {
  if (!user.email || !user.email_confirmed_at) {
    throw new AuthError(403, 'Please verify your university email before signing in.');
  }

  // Match the LMS account model: Supabase Auth validates credentials, then the
  // shared public.users record determines portal access and account status.
  const email = user.email.replace(/[\\%_]/g, '\\$&');
  const { data: account, error } = await adminClient
    .from('users')
    .select('users_id,email,first_name,middle_name,last_name,role,is_active')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    throw new AuthError(503, 'Account verification is temporarily unavailable. Please try again.');
  }

  // The shared LMS table stores its student role as "Students". Normalize it
  // to SIS's singular student role without changing the shared table contract.
  const accountRole = typeof account?.role === 'string' ? account.role.toLowerCase() : '';
  const rawRole: SISRole | undefined = accountRole === 'students' || accountRole === 'student'
    ? 'student'
    : accountRole === 'admin'
      ? 'admin'
      : undefined;

  // The SIS intentionally admits a different subset from the LMS: students and admins.
  if (!account || !rawRole) {
    throw new AuthError(403, 'This portal is restricted to active students and administrators.');
  }

  if (account.is_active !== true) {
    throw new AuthError(403, 'Your university account has been deactivated. Please contact Administration.');
  }

  return {
    id: account.users_id,
    email: account.email,
    fullName: [account.first_name, account.middle_name, account.last_name].filter(Boolean).join(' '),
    role: rawRole,
  };
}

export async function verifyUser(token: string, adminClient: SupabaseClient = getSupabaseAdmin()): Promise<SISUser> {
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    if (error && (!error.status || error.status >= 500)) {
      throw new AuthError(503, 'Authentication is temporarily unavailable. Please try again.');
    }
    throw new AuthError(401, 'Your session has expired. Please sign in again.');
  }
  return findUser(data.user, adminClient);
}
