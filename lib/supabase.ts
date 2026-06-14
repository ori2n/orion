/**
 * Backward-compatible Supabase client.
 *
 * This file exports a singleton browser client for use in Client Components.
 * It now uses `@supabase/ssr` so the session is persisted via cookies
 * and survives page refreshes.
 *
 * New code should prefer importing `createClient` from `@/lib/supabase/client`
 * or `@/lib/supabase/server` directly.
 */
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
