'use client';

import { useEffect, useState } from 'react';

/**
 * Finance chrome — top status bar with a pulsing-dot "SYSTEM"
 * indicator, module label and live clock + date. Pure presentation.
 */
export function FinanceChromeTop() {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <header className="relative z-10 border-b border-zinc-800/50 px-4 py-2 sm:px-6 sm:py-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400/80">
              SYSTEM
            </span>
          </div>
          <span className="hidden text-[10px] font-medium tracking-wider text-zinc-600 sm:block">
            FINANCE MODULE v1.0
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-[11px] text-zinc-500">
            {dateLabel.toUpperCase()}
          </span>
          <span className="hidden font-mono text-[11px] text-zinc-600 sm:block">
            {clock}
          </span>
        </div>
      </div>
    </header>
  );
}
