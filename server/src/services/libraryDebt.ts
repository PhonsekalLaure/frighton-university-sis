import { getSupabaseAdmin } from '../config/supabase.js';
import { isDebtSnapshot, type DebtSnapshot } from './libraryContracts.js';
import { lmsRequest, LibraryError } from './lmsClient.js';
export async function latestDebt(number: string): Promise<DebtSnapshot> {
  const result = await lmsRequest('/service/v1/students/' + encodeURIComponent(number) + '/debt');
  if (!isDebtSnapshot(result, number))
    throw new LibraryError(503, 'INVALID_LMS_RESPONSE', 'Library debt could not be verified.');
  return result;
}
export async function applyDebt(snapshot: DebtSnapshot) {
  // A clearing notification cannot clear just one paid item while other debt remains.
  const current = snapshot.qualifyingDebtCount === 0 ? await latestDebt(snapshot.studentNumber) : snapshot;
  if (current.version < snapshot.version)
    throw new LibraryError(503, 'DEBT_VERIFICATION_UNAVAILABLE', 'Latest library debt is not available.');
  const result = await getSupabaseAdmin().rpc('apply_library_debt', {
    p_student_number: current.studentNumber,
    p_version: current.version,
    p_count: current.qualifyingDebtCount,
    p_amount: current.amount,
    p_reason: current.reason,
  });
  if (result.error)
    throw new LibraryError(
      503,
      'DEBT_SYNC_UNAVAILABLE',
      'Library debt synchronization is temporarily unavailable.',
    );
  return result.data;
}
