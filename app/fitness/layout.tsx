import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUserId } from '@/lib/auth';
import { FitnessSubnav } from '@/components/fitness/fitness-subnav';
import { FitnessChromeTop } from '@/components/fitness/fitness-chrome-top';

/**
 * Fitness module layout.
 *
 *   - Resolves the auth state server-side. No `userId = null` UI is
 *     rendered here; we redirect to /login so the dashboard never has
 *     to care about it. Each child page can call getCurrentUserId()
 *     again to fetch its own data.
 *
 *   - Provides the shared chrome (SYSTEM badge + date/time watermark)
 *     and the in-module sub-nav that links the deep pages together.
 *
 * The layout intentionally does NOT own data fetching — each page
 * loads its own slice of the data it needs (Stage 5 perf principle:
 * only the information for the current view).
 */

export const metadata: Metadata = {
  title: 'Fitness — ORION',
  description: 'Track strength, bodyweight and physique progress.',
};

export default async function FitnessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    // Stage 5 fitness is meaningless without a user. Boot to login.
    redirect('/login');
  }
  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(244,114,182,0.05) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 50% 100%, rgba(99,102,241,0.03) 0%, transparent 60%),
          rgb(9, 9, 11)
        `,
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />
      <FitnessChromeTop />
      <FitnessSubnav />
      <main className="relative z-10 flex flex-1 flex-col overflow-y-auto">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-zinc-800/30 px-6 py-2">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <span className="text-[9px] tracking-[0.15em] text-zinc-700">
          STRENGTH · PHYSIQUE · WEIGHT
        </span>
        <span className="text-[9px] tracking-[0.15em] text-zinc-700">
          ORION FITNESS
        </span>
      </div>
    </footer>
  );
}
