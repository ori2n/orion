'use client';

import { useState, useEffect } from 'react';
import FinanceDashboard from '@/components/finance/finance-dashboard';

export default function FinancePage() {
  const [mounted, setMounted] = useState(false);
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    setMounted(true);
    const now = new Date();
    setDateStr(now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }));
  }, []);

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 50% 100%, rgba(245,158,11,0.04) 0%, transparent 60%),
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

      {/* Scan line effect */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(245,158,11,0.08) 2px, rgba(245,158,11,0.08) 3px)',
        }}
      />

      {/* Top status bar */}
      <header className="relative z-10 border-b border-zinc-800/50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
              <span className="text-[10px] font-semibold tracking-[0.2em] text-amber-400/80">SYSTEM</span>
            </div>
            <span className="hidden text-[10px] font-medium tracking-wider text-zinc-600 sm:block">
              FINANCE MODULE v1.0
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px] text-zinc-500">
              {mounted ? dateStr.toUpperCase() : ''}
            </span>
            <span className="hidden font-mono text-[11px] text-zinc-600 sm:block">
              <ClockDisplay mounted={mounted} />
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <FinanceDashboard />
      </main>

      {/* Bottom watermark */}
      <footer className="relative z-10 border-t border-zinc-800/30 px-6 py-2">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">NET WORTH · CASHFLOW · PROJECTIONS</span>
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">ORION FINANCE</span>
        </div>
      </footer>
    </div>
  );
}

/** Live clock display */
function ClockDisplay({ mounted }: { mounted: boolean }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;
  return <>{time}</>;
}
