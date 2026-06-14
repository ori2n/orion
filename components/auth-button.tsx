'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { signOut } from '@/app/auth/actions';

export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
      setLoading(false);
    }
    getUser();
  }, []);

  // Subscribe to auth state changes so the button updates
  // when the user signs in/out without a full page reload
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Not ready yet — don't render anything to avoid layout shift
  if (loading) {
    return <div className="h-4 w-4 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />;
  }

  if (!email) {
    return (
      <a
        href="/login"
        className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Sign In
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        {email}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
