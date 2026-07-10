/**
 * Backward-compatible Supabase client.
 *
 * This file exports a singleton browser client for use in Client Components.
 * It uses `@supabase/ssr` so the session is persisted via cookies
 * and survives page refreshes.
 *
 * The client is lazily initialised via a Proxy so that importing this
 * module does NOT call `createBrowserClient` at module-load time.
 * This avoids crashing during `next build` (SSR / prerendering) when
 * the `NEXT_PUBLIC_SUPABASE_*` variables are not available — a
 * common scenario on Vercel if env vars aren't set in the dashboard.
 *
 * New code should prefer importing `createClient` from
 * `@/lib/supabase/client` or `@/lib/supabase/server` directly.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
      'in your .env.local or Vercel project dashboard.',
    );
  }

  client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}

/**
 * Proxy that defers `createBrowserClient()` until the first property
 * access (e.g. `supabase.from(...)`). During SSR/build the module is
 * imported but `getClient()` is never called because Supabase queries
 * only run inside `useEffect` on the client.
 *
 * Once created, the client is cached so all subsequent accesses reuse
 * the same instance — preserving auth state and avoiding allocations.
 */
export const supabase = new Proxy<SupabaseClient>(
  {} as SupabaseClient,
  {
    get(_, prop) {
      return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
    },
  },
);
