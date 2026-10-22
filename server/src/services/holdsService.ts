import { getSupabaseAdmin } from '../config/supabase.js';

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export interface HoldsClient {
  from: (table: string) => any;
}

export class HoldsError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HoldsError';
  }
}

const asRows = <T>(value: T[] | null): T[] => value ?? [];

function requireData(result: SupabaseResult<any>, resource: string): any {
  if (result.error) throw new Error(`Unable to load ${resource}.`);
  return result.data;
}

function toHold(hold: Record<string, any>) {
  return {
    id: hold.id,
    holdType: hold.hold_type,
    reason: hold.reason,
    placedBySystem: hold.placed_by_system,
    placedAt: hold.placed_at,
    resolvedAt: hold.resolved_at,
  };
}

/**
 * Returns the authenticated student's read-only SIS restriction history.
 * Library loans and reservations intentionally remain LMS-owned data.
 */
export async function getHolds(
  studentId: string,
  client: HoldsClient = getSupabaseAdmin() as unknown as HoldsClient,
) {
  const [profileResult, holdsResult] = await Promise.all([
    client.from('profiles').select('id').eq('id', studentId).maybeSingle(),
    client.from('student_holds')
      .select('id, hold_type, reason, placed_by_system, placed_at, resolved_at')
      .eq('student_id', studentId),
  ]);

  const profile = requireData(profileResult, 'profile');
  if (!profile) throw new HoldsError('Your SIS profile has not been provisioned yet.', 404);

  const holds = asRows<Record<string, any>>(requireData(holdsResult, 'student holds'));
  const activeHolds = holds
    .filter((hold) => !hold.resolved_at)
    .sort((left, right) => String(right.placed_at).localeCompare(String(left.placed_at)))
    .map(toHold);
  const resolvedHolds = holds
    .filter((hold) => Boolean(hold.resolved_at))
    .sort((left, right) => String(right.resolved_at).localeCompare(String(left.resolved_at)))
    .map(toHold);

  return { activeHolds, resolvedHolds };
}
