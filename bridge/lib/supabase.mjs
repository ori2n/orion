import { createClient } from '@supabase/supabase-js';
import { config } from './config.mjs';

let client = null;

/**
 * Service-role Supabase client. Runs ONLY on the local PC — the
 * service-role key bypasses RLS and must never reach the browser.
 */
export function getSupabase() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return client;
}
