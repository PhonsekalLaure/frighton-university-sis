import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './env.js';

let supabaseAdminClient: SupabaseClient | null = null;
let adminPortalClient: SupabaseClient | null = null;
const authOptions = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

function requireConfig(key: string): void {
  if (!config.supabase.url || !key || config.supabase.url.includes('your-project-id')) {
    throw new Error('Supabase authentication is not configured.');
  }
}

// Each login and refresh gets an isolated client so sessions cannot mix.
export const createSupabaseAuthClient = (): SupabaseClient => {
  requireConfig(config.supabase.anonKey);
  return createClient(config.supabase.url, config.supabase.anonKey, { auth: authOptions });
};

export const getSupabaseAdmin = (): SupabaseClient => {
  if (!supabaseAdminClient) {
    requireConfig(config.supabase.serviceRoleKey);
    supabaseAdminClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: authOptions,
    });
  }
  return supabaseAdminClient;
};

// Bound the external Auth/REST calls covered by admin account-change leases.
export const getAdminPortalClient = (): SupabaseClient => {
  if (!adminPortalClient) {
    requireConfig(config.supabase.serviceRoleKey);
    adminPortalClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: authOptions,
      global: { fetch: (url, options) => fetch(url, { ...options,
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(options?.signal ? [options.signal] : [])]),
      }) },
    });
  }
  return adminPortalClient;
};

// Backwards-compatible alias for standard Supabase client operations
export const getSupabase = (): SupabaseClient => {
  return createSupabaseAuthClient();
};
