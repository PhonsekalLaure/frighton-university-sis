import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';

export type SISRole = 'student' | 'admin';

export interface SISUser {
  id: string;
  frightonId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: SISRole;
  academicStatus: string;
  department?: string;
  avatarUrl?: string;
}

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function findUser(user: User, adminClient: SupabaseClient = getSupabaseAdmin()): Promise<SISUser> {
  if (!user.email) {
    throw new AuthError(400, 'User email is required.');
  }

  // Primary lookup: link by auth user UUID
  let { data: profile, error } = await adminClient
    .from('profiles')
    .select('id, frighton_id, first_name, last_name, email, role, academic_status, department, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  // Secondary lookup: fallback to email if UUID is not yet linked
  if (!profile && !error && user.email) {
    const escapedEmail = user.email.replace(/[\\%_]/g, '\\$&');
    const res = await adminClient
      .from('profiles')
      .select('id, frighton_id, first_name, last_name, email, role, academic_status, department, avatar_url')
      .ilike('email', escapedEmail)
      .maybeSingle();
    profile = res.data;
    error = res.error;
  }

  if (error) {
    throw new AuthError(503, 'Account verification is temporarily unavailable. Please try again.');
  }

  if (!profile) {
    throw new AuthError(404, 'No university SIS profile found for this account. Please contact Administration.');
  }

  const rawRole = (profile.role || '').toLowerCase();

  // Restricted Access: Only students and administrators can login to SIS
  if (rawRole !== 'student' && rawRole !== 'admin') {
    throw new AuthError(403, 'This portal is restricted to students and administrators only.');
  }

  // Academic standing check for students
  const academicStatus = (profile.academic_status || 'active').toLowerCase();
  if (rawRole === 'student' && (academicStatus === 'suspended' || academicStatus === 'withdrawn')) {
    throw new AuthError(403, `Your student account is marked as ${academicStatus}. Please contact the Registrar.`);
  }

  return {
    id: profile.id,
    frightonId: profile.frighton_id,
    email: profile.email || user.email,
    firstName: profile.first_name,
    lastName: profile.last_name,
    fullName: `${profile.first_name} ${profile.last_name}`.trim(),
    role: rawRole as SISRole,
    academicStatus: profile.academic_status,
    department: profile.department ?? undefined,
    avatarUrl: profile.avatar_url ?? undefined,
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
