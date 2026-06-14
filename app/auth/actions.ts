'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign up with email + password.
 * On success, redirects to /login with a confirmation message.
 */
export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is disabled (common in dev), the user is
  // automatically signed in — redirect to home immediately.
  if (data?.session) {
    revalidatePath('/', 'layout');
    redirect('/');
  }

  // Email confirmation required — tell user to check their inbox
  return {
    success:
      'Check your email for a confirmation link. You can close this tab.',
  };
}

/**
 * Sign in with email + password.
 * On success, redirects to home.
 */
export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

/**
 * Sign out the current user and redirect to login.
 *
 * Designed to be used as a form action — always redirects,
 * never returns a value. Errors are logged server-side only.
 */
export async function signOut() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('[auth] signOut failed:', error.message);
  }

  revalidatePath('/', 'layout');
  redirect('/login');
}
