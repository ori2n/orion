'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * In-module sub-nav for the Fitness pages.
 *
 * Stage 5 layout: a single horizontal row of links at the top of every
 * Fitness page. The active route is highlighted via pathname match.
 * On mobile the row scrolls horizontally to avoid wrapping/squeezing.
 *
 * Positioning: the sticky offset is the app header's total height
 * (`env(safe-area-inset-top)` + `--orion-header-h`, 44px) so the tabs
 * pin just below the header instead of under it. No `backdrop-blur`
 * here — blur on sticky elements inside scrollable layouts is a known
 * iOS Safari jank trigger (scroll area can lock up).
 */

const NAV: Array<{ href: string; label: string }> = [
  { href: '/fitness', label: 'Overview' },
  { href: '/fitness/strength', label: 'Strength' },
  { href: '/fitness/workouts', label: 'Workouts' },
  { href: '/fitness/bodyweight', label: 'Bodyweight' },
  { href: '/fitness/manage', label: 'Manage Data' },
];

export function FitnessSubnav() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label="Fitness section"
      className="sticky z-20 border-b border-zinc-800/40 bg-zinc-950/95"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + var(--orion-header-h, 44px))',
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {NAV.map((item) => {
          const active =
            item.href === '/fitness'
              ? pathname === '/fitness'
              : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
                (active
                  ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                  : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200')
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
