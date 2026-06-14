'use client';

import { useState, useEffect } from 'react';
import HealthDashboard from '@/components/health/health-dashboard';
import { getUserProfile, upsertBirthDate } from '@/lib/health/user-profile';
import { computeAge } from '@/lib/age';

export default function HealthPage() {
  const [mounted, setMounted] = useState(false);
  const [dateStr, setDateStr] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [savedBirthDate, setSavedBirthDate] = useState('');
  const [editingAge, setEditingAge] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Load profile on mount
  useEffect(() => {
    (async () => {
      const profile = await getUserProfile();
      if (profile?.birth_date) {
        setBirthDate(profile.birth_date);
        setSavedBirthDate(profile.birth_date);
        setAge(computeAge(profile.birth_date));
      }
    })();
  }, []);

  useEffect(() => {
    setMounted(true);
    const now = new Date();
    setDateStr(now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }));
  }, []);

  async function handleAgeSave() {
    if (!birthDate.trim()) return;
    const ok = await upsertBirthDate(birthDate.trim());
    if (ok) {
      setSavedBirthDate(birthDate.trim());
      setAge(computeAge(birthDate.trim()));
      setEditingAge(false);
      setSaveMsg('Age updated');
      setTimeout(() => setSaveMsg(null), 2000);
    } else {
      setSaveMsg('Failed to save');
      setTimeout(() => setSaveMsg(null), 2000);
    }
  }

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(56,189,248,0.04) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 50% 100%, rgba(148,163,184,0.02) 0%, transparent 60%),
          rgb(0, 0, 0)
        `,
      }}
    >
      {/* Very small grid overlay — Jarvis HUD style */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(148,163,184,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '16px 16px',
        }}
      />

      {/* Secondary finer grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(148,163,184,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,0.015) 1px, transparent 1px)
          `,
          backgroundSize: '4px 4px',
        }}
      />

      {/* Top status bar */}
      <header className="relative z-10 border-b border-zinc-800/50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
              <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400/80">SYSTEM</span>
            </div>
            <span className="hidden text-[10px] font-medium tracking-wider text-zinc-600 sm:block">
              HEALTH MONITOR v2.0
            </span>
            {/* Age / Birth Date input */}
            <div className="flex items-center gap-1.5">
              {editingAge ? (
                <>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                    className="w-[130px] rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-200 focus:border-cyan-600 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleAgeSave}
                    disabled={!birthDate.trim()}
                    className="rounded bg-cyan-700 px-2 py-0.5 text-[9px] font-medium text-white transition-colors hover:bg-cyan-600 disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setBirthDate(savedBirthDate); setEditingAge(false); }}
                    className="text-[9px] text-zinc-600 hover:text-zinc-400"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditingAge(true)}
                  className="group flex items-center gap-1.5 rounded border border-zinc-700/30 bg-zinc-800/40 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-600/50 hover:text-zinc-200"
                >
                  {age != null ? (
                    <>
                      <span className="font-mono text-cyan-400">{age}</span>
                      <span className="text-zinc-600">years old</span>
                    </>
                  ) : (
                    <span className="text-zinc-600">Set age</span>
                  )}
                  <span className="ml-0.5 text-[8px] opacity-0 transition-opacity group-hover:opacity-60">✎</span>
                </button>
              )}
              {saveMsg && (
                <span className="text-[9px] text-emerald-500 animate-in fade-in">{saveMsg}</span>
              )}
            </div>
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
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-hidden">
        <HealthDashboard />
      </main>

      {/* Bottom watermark */}
      <footer className="relative z-10 border-t border-zinc-800/30 px-6 py-2">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">ENERGY SCORE · REAL-TIME BIOMETRICS</span>
          <span className="text-[9px] tracking-[0.15em] text-zinc-700">J.A.R.V.I.S. INTERFACE</span>
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
