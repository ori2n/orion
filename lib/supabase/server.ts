/**
 * Server-side Supabase client.
 *
 * Use this in Server Actions, Route Handlers, and Server Components.
 * Reads and writes session cookies via the `next/headers` cookies API.
 *
 * In Next.js 15+, `cookies()` is async — this helper awaits it for you.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}
