/**
 * Server-side auth helper.
 *
 * The existing `lib/auth.ts` (browser) helper instantiates
 * `@supabase/ssr`'s `createBrowserClient`, which falls back to an
 * empty `document.cookie` source in non-browser runtimes. When a
 * Server Component calls it, `auth.getUser()` either returns
 * `{ data: { user: null }, error: 'Auth session missing!' }` or
 * throws inside `setAll` — both paths the existing helper maps to
 * `null`. That made `app/fitness/layout.tsx` redirect to `/login`
 * unconditionally; '/login' then redirected the authenticated user
 * back to `/` via the auth-pages rule in the proxy → so navigating
 * to `/fitness` appeared to bounce to the home page ().
 *
 * This helper uses the SERVER client (cookies → next/headers) so it
 * works in Server Components, Route Handlers, and Server Actions.
 * The return type + try/catch semantics match `lib/auth.ts` so
 * callers can swap one for the other without code changes.
 */
import { createClient } from '@/lib/supabase/server';

/**
 * Returns the authenticated user id, or `null` if no session exists.
 * Never throws — callers can treat `null` as "unauthenticated" and
 * redirect to /login.
 */
export async function getCurrentUserIdServer(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    // Network down, env vars missing, etc. — behave like the browser
    // helper so callers see `null` and can render the unauthenticated
    // surface instead of crashing the server render.
    return null;
  }
}
