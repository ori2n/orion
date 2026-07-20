'use client';

import { useState, useEffect } from 'react';
import FitnessDashboard from '@/components/fitness/fitness-dashboard';

/**
 * Fitness landing page.
 *
 * Same ORION HUD pattern as the prior Health page: a top status bar with
 * a pulsing-dot "SYSTEM" indicator, module label, live clock, and a
 * bottom watermark. Acts purely as chrome — the actual content lives in
 * <FitnessDashboard /> which owns its own tabs, summary, and refresh
 * logic.
 */
export default function FitnessPage() {
  const [mounted, setMounted] = useState(false);
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    setMounted(true);
    const now = new Date();
    setDateStr(
      now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    );
  }, []);

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

      {/* Top status bar */}
      <header className="relative z-10 border-b border-zinc-800/50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
              <span className="text-[10px] font-semibold tracking-[0.2em] text-rose-400/80">
                SYSTEM
              </span>
            </div>
            <span className="hidden text-[10px] font-medium tracking-wider text-zinc-600 sm:block">
              FITNESS MODULE v1.0
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
      <main className="relative z-10 flex flex-1 flex-col overflow-y-auto">
        <FitnessDashboard />
      </main>

      {/* Bottom watermark */}
      <footer className="relative z-10 border-t border-zinc-800/30 px-6 py-2">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">
            STRENGTH · PHYSIQUE · WEIGHT · SLEEP
          </span>
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">
            ORION FITNESS
          </span>
        </div>
      </footer>
    </div>
  );
}

function ClockDisplay({ mounted }: { mounted: boolean }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;
  return <>{time}</>;
}
