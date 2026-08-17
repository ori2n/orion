import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUserIdServer } from '@/lib/auth-server';

/**
 * Freebuff module layout.
 *
 * Only an auth gate — the actual data fetching happens inside the
 * client page (`page.tsx`), which owns Realtime subscriptions and the
 * task/prompt/output state. No `userId = null` UI is rendered here;
 * unauthenticated visitors are redirected to /login so the page never
 * has to branch on a missing session.
 *
 * We deliberately do NOT own data fetching at the layout level (same
 * principle as the Fitness layout): the page loads exactly the slice it
 * needs for the current view.
 */

export const metadata: Metadata = {
  title: 'Freebuff — ORION',
  description: 'Control and monitor the Freebuff coding agent from your phone.',
};

export default async function FreebuffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    redirect('/login');
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {children}
    </div>
  );
}
