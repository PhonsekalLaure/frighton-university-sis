import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminPortalClient } from '../config/supabase.js';

export class AccountError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly retryAfter?: number) { super(message); }
}

export async function reserveAccountRequest(scope: 'admin_mail' | 'password_complete', key: string,
  actorId?: string, client: Pick<SupabaseClient, 'rpc'> = getAdminPortalClient()): Promise<void> {
  try {
    const { data, error } = await client.rpc('sis_reserve_account_request', {
      p_scope: scope, p_key: createHash('sha256').update(key.trim().toLowerCase()).digest('hex'),
      p_actor_id: actorId ?? null,
    });
    if (error || !data || typeof data.allowed !== 'boolean') throw new Error('Limit unavailable');
    if (!data.allowed) {
      if (!Number.isInteger(data.retryAfter) || data.retryAfter < 1) throw new Error('Invalid limit');
      throw new AccountError(429, 'rate_limited', 'Too many account requests. Please try again later.', data.retryAfter);
    }
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(503, 'rate_limit_unavailable', 'Account request protection is temporarily unavailable.');
  }
}
