'use client';

import { useState, useEffect, useCallback } from 'react';
import { getLatestManualInput, insertManualInput } from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { ManualInput } from '@/lib/health/storage';


export default function ManualInputs({ variant = 'state' }: { variant?: 'state' | 'recovery' }) {
  const [latest, setLatest] = useState<ManualInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form sliders
  const [energy, setEnergy] = useState(7);
  const [stress, setStress] = useState(4);
  const [soreness, setSoreness] = useState(3);
  const [mood, setMood] = useState('');
  const [saving, setSaving] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLatestManualInput();
      setLatest(data);
      if (data) {
        setEnergy(data.energy_level);
        setStress(data.stress_level);
        setSoreness(data.soreness_level);
        setMood(data.mood || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load latest inputs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await insertManualInput({
        energy_level: Math.round(energy),
        stress_level: Math.round(stress),
        soreness_level: Math.round(soreness),
        mood,
      });
      if (!result.data) {
        if (result.error) {
          setError(result.error);
        } else {
          setError('Not signed in — data cannot be saved. Authentication is required to write to Supabase.');
        }
        return;
      }
      setSuccess('State updated ✓');
      setTimeout(() => setSuccess(null), 2500);
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save inputs');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Convert 1–10 value to a hex color based on severity.
   * For inverted sliders (stress/soreness), high input = bad = rose.
   * For normal sliders (energy), high input = good = emerald.
   */
  function getAccentColor(val: number, inverted: boolean): string {
    const v = inverted ? val : 11 - val;
    if (v <= 3) return '#10b981';
    if (v <= 6) return '#f59e0b';
    return '#f43f5e';
  }

  function getTextColor(val: number, inverted: boolean): string {
    if (inverted) {
      if (val <= 3) return 'text-emerald-600 dark:text-emerald-400';
      if (val <= 6) return 'text-amber-600 dark:text-amber-400';
      return 'text-rose-600 dark:text-rose-400';
    }
    if (val >= 7) return 'text-emerald-600 dark:text-emerald-400';
    if (val >= 4) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  }

  function Slider({
    label,
    icon,
    value,
    setValue,
    inverted = false,
  }: {
    label: string;
    icon: string;
    value: number;
    setValue: (v: number) => void;
    inverted?: boolean;
  }) {
    const displayValue = inverted ? 11 - value : value;
    const accent = getAccentColor(value, inverted);
    const textColor = getTextColor(value, inverted);

    // Percentage for the filled portion of the track
    const pct = ((value - 1) / 9) * 100;
    const unfilledColor = isDark ? '#3f3f46' : '#e4e4e7';
    const trackFill = `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, ${unfilledColor} ${pct}%, ${unfilledColor} 100%)`;

    return (
      <div className="group">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {icon} {label}
          </span>
          <span className={`text-xs font-semibold transition-colors duration-200 ${textColor}`}>
            {displayValue}/10
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="
              h-2 w-full cursor-pointer appearance-none rounded-full
              transition-all duration-150
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:w-5
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-white
              [&::-webkit-slider-thumb]:bg-white
              [&::-webkit-slider-thumb]:shadow-md
              [&::-webkit-slider-thumb]:transition-transform
              [&::-webkit-slider-thumb]:duration-150
              [&::-webkit-slider-thumb]:hover:scale-110
              [&::-webkit-slider-thumb]:active:scale-95
              [&::-moz-range-thumb]:appearance-none
              [&::-moz-range-thumb]:h-5
              [&::-moz-range-thumb]:w-5
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:border-2
              [&::-moz-range-thumb]:border-white
              [&::-moz-range-thumb]:bg-white
              [&::-moz-range-thumb]:shadow-md
              [&::-moz-range-thumb]:transition-transform
              [&::-moz-range-thumb]:duration-150
              [&::-moz-range-thumb]:active:scale-95
              dark:[&::-webkit-slider-thumb]:bg-zinc-800
              dark:[&::-webkit-slider-thumb]:border-zinc-600
              dark:[&::-moz-range-thumb]:bg-zinc-800
              dark:[&::-moz-range-thumb]:border-zinc-600
            "
            style={{
              background: trackFill,
            } as React.CSSProperties}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-300 dark:text-zinc-600">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm dark:bg-violet-900/40">
          📊
        </span>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{variant === 'recovery' ? 'Recovery' : 'State'}</h3>
        {latest && (
          <span className="ml-auto text-[10px] text-zinc-400">
            Updated {new Date(latest.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          {success}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {(variant !== 'recovery') && (
          <>
            <Slider label="Energy" icon="⚡" value={energy} setValue={setEnergy} />
            <Slider label="Stress" icon="😰" value={stress} setValue={setStress} inverted />
          </>
        )}
        {/* Soreness shown in both state and recovery — always rendered */}
        <Slider label="Soreness" icon="🤕" value={soreness} setValue={setSoreness} inverted />

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            😊 Mood (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Great, tired, motivated..."
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-violet-600 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : variant === 'recovery' ? 'Update Recovery' : 'Update State'}
        </button>
      </form>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
        </div>
      )}
    </div>
  );
}
