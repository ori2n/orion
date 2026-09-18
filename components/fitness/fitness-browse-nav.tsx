'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * FitnessBrowseNav — the primary navigation for the entire Fitness
 * module. Rendered at the top of every Fitness page (no tab bar; the
 * tabs were removed in favour of this module).
 *
 * Six equal links into the module's pages. The current page is
 * highlighted via pathname match. The "Drill into exercise" shortcut
 * was removed — the Strength page already provides per-exercise
 * navigation.
 */

const NAV: Array<{ href: string; label: string }> = [
  { href: '/fitness', label: 'Overview' },
  { href: '/fitness/bodyweight', label: 'Body Weight' },
  { href: '/fitness/strength', label: 'Strength' },
  { href: '/fitness/workouts', label: 'Workouts' },
  { href: '/fitness/frequency', label: 'Training Frequency' },
  { href: '/fitness/manage', label: 'Manage Data' },
];

export function FitnessBrowseNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label="Fitness navigation"
      className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-3 sm:p-4"
    >
      <div className="mb-2 px-1">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Browse
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-2.5 max-sm:[&>*:last-child]:col-span-2 sm:grid-cols-3 lg:grid-cols-6">
        {NAV.map((item) => {
          const active =
            item.href === '/fitness'
              ? pathname === '/fitness'
              : pathname === item.href ||
                pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ' +
                (active
                  ? 'border-zinc-700 bg-zinc-800/70 text-zinc-50 ring-1 ring-zinc-700/60'
                  : 'border-zinc-800/40 bg-zinc-950/40 text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-white')
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
