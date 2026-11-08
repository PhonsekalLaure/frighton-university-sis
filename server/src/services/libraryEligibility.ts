import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { LibraryError } from './lmsClient.js';
export async function libraryEligibility(number: string, client: SupabaseClient = getSupabaseAdmin()) {
  const profile = await client
    .from('profiles')
    .select('id,student_number,first_name,last_name,email,role,academic_status,department')
    .eq('student_number', number)
    .maybeSingle();
  if (profile.error)
    throw new LibraryError(503, 'ELIGIBILITY_UNAVAILABLE', 'Student standing could not be verified.');
  if (!profile.data) throw new LibraryError(404, 'STUDENT_NOT_FOUND', 'Student was not found.');
  const p = profile.data;
  const [user, holds] = await Promise.all([
    client.from('users').select('role,is_active').eq('users_id', p.id).maybeSingle(),
    client
      .from('student_holds')
      .select('id,hold_type,reason,placed_by_system,placed_at,resolved_at')
      .eq('student_id', p.id)
      .is('resolved_at', null),
  ]);
  if (user.error || holds.error || !user.data)
    throw new LibraryError(503, 'ELIGIBILITY_UNAVAILABLE', 'Student standing could not be verified.');
  const activeHolds = holds.data ?? [];
  return {
    studentNumber: p.student_number,
    name: [p.first_name, p.last_name].join(' '),
    email: p.email,
    role: p.role,
    academicStatus: p.academic_status,
    department: p.department,
    canBorrow:
      p.role === 'student' &&
      ['student', 'students'].includes(user.data.role.toLowerCase()) &&
      user.data.is_active === true &&
      p.academic_status === 'active' &&
      activeHolds.length === 0,
    activeHolds,
  };
}
