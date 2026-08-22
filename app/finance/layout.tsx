import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { FinanceSubnav } from '@/components/finance/finance-subnav';
import { FinanceChromeTop } from '@/components/finance/finance-chrome-top';

/**
 * Finance module layout.
 *
 * Resolves auth server-side; redirects to /login if not authenticated.
 * Provides the shared chrome (SYSTEM badge + date/time watermark)
 * and the in-module sub-nav.
 */

export const metadata: Metadata = {
  title: 'Finance — ORION',
  description: 'Track spending, investments and financial goals.',
};

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    redirect('/login');
  }
  return (
    <div
      className="relative flex min-h-full w-full flex-col"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.05) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 50% 100%, rgba(6,182,212,0.03) 0%, transparent 60%),
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
      <FinanceChromeTop />
      <FinanceSubnav />
      <main className="relative z-10 flex flex-1 flex-col">
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
          SPENDING · INVESTMENTS · GOALS
        </span>
        <span className="text-[9px] tracking-[0.15em] text-zinc-700">
          ORION FINANCE
        </span>
      </div>
    </footer>
  );
}
