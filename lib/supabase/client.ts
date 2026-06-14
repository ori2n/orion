/**
 * Browser-side Supabase client.
 *
 * Use this in Client Components (marked 'use client').
 * Session state is persisted via cookies, managed automatically
 * by the `@supabase/ssr` package.
 */
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
