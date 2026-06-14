'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Signup page — redirects to /login which handles both sign-in and sign-up.
 * The login page has both buttons in one form for simplicity.
 */
export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
    </div>
  );
}
