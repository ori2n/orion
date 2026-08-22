'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthButton from '@/components/auth-button';

/**
 * ORION app header — the single top-level navigation.
 *
 *   • Desktop (md+): one compact row of top-level links (Home /
 *     Time Management / Fitness) with the active section highlighted.
 *   • Mobile: a single compact row showing the ORION wordmark and the
 *     CURRENT section. Tapping the section opens a small dropdown
 *     with the top-level pages; selecting one navigates and closes.
 *
 * The header is sticky and includes `env(safe-area-inset-top)` padding
 * so it sits BELOW the iOS status bar / notch in standalone PWA mode.
 * That matters for taps: with `viewport-fit: cover` + a
 * black-translucent status bar, content drawn under the status bar is
 * not tappable — the old top bar's links lived in exactly that dead
 * zone on a phone.
 *
 * The content row is a fixed 44px (`--orion-header-h`) so the Fitness
 * sub-nav can stick exactly below it (it reads the same CSS variable).
 */
const NAV: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Home' },
  { href: '/time-management', label: 'Time Management' },
  { href: '/fitness', label: 'Fitness' },
];

function currentSection(pathname: string): { href: string; label: string } | null {
  for (const item of NAV) {
    if (item.href === '/') {
      if (pathname === '/') return item;
    } else if (pathname === item.href || pathname.startsWith(item.href + '/')) {
      return item;
    }
  }
  return null;
}

export function AppHeader() {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const active = currentSection(pathname);

  // Close the mobile menu on route change (navigation happened).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close the mobile menu on outside tap / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <header
      className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="mx-auto flex h-11 max-w-7xl items-center gap-2 px-4 sm:px-6"
        style={{ ['--orion-header-h' as string]: '44px' }}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-[0.22em] text-zinc-100"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"
          />
          ORION
        </Link>

        {/* Desktop: full top-level nav row */}
        <nav
          aria-label="Primary"
          className="ml-4 hidden items-center gap-1 md:flex"
        >
          {NAV.map((item) => {
            const isActive = active?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (isActive
                    ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                    : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Mobile: compact section dropdown */}
          <div ref={dropdownRef} className="relative md:hidden">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition-colors hover:bg-zinc-800"
            >
              <span>{active?.label ?? 'Menu'}</span>
              <svg
                aria-hidden
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {open && (
              <div
                role="menu"
                aria-label="Top-level pages"
                className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 py-1 shadow-2xl shadow-black/60"
              >
                {NAV.map((item) => {
                  const isActive = active?.href === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={
                        'block px-4 py-2.5 text-sm font-medium transition-colors ' +
                        (isActive
                          ? 'bg-zinc-800/70 text-zinc-100'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <AuthButton />
        </div>
      </div>
    </header>
  );
}
