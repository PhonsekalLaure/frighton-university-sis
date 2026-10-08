import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './env.js';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

/**
 * Returns the standard Supabase client (using anon key).
 * Suitable for operations scoped to user credentials.
 */
export const getSupabase = (): SupabaseClient => {
  if (!supabaseClient) {
    if (!config.supabase.url || !config.supabase.anonKey) {
      console.warn('⚠️ Supabase URL or Anon Key is missing. Check your environment variables.');
    }
    supabaseClient = createClient(
      config.supabase.url || 'https://placeholder.supabase.co',
      config.supabase.anonKey || 'placeholder-anon-key'
    );
  }
  return supabaseClient;
};

/**
 * Returns the Supabase Admin client (using service role key).
 * Bypasses RLS - use only for server-side administrative logic.
 */
export const getSupabaseAdmin = (): SupabaseClient => {
  if (!supabaseAdminClient) {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      console.warn('⚠️ Supabase Service Role Key is missing. Administrative operations will fail.');
    }
    supabaseAdminClient = createClient(
      config.supabase.url || 'https://placeholder.supabase.co',
      config.supabase.serviceRoleKey || 'placeholder-service-key',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return supabaseAdminClient;
};
