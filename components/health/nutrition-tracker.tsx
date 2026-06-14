'use client';

import { useState, useEffect, useCallback } from 'react';
import { getLatestNutritionLog, insertNutritionLog } from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { NutritionLog } from '@/lib/health/storage';

function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function combineToday(timeStr: string): string {
  const today = new Date();
  const [h, m] = timeStr.split(':').map(Number);
  today.setHours(h, m, 0, 0);
  return today.toISOString();
}

export default function NutritionTracker() {
  const [latest, setLatest] = useState<NutritionLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form
  const [waterMl, setWaterMl] = useState(250);
  const [caffeineMg, setCaffeineMg] = useState(0);
  const [caffeineTime, setCaffeineTime] = useState(nowTime());
  const [creatineTaken, setCreatineTaken] = useState(false);

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLatestNutritionLog();
      setLatest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load nutrition data');
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
      const result = await insertNutritionLog({
        calories: 0,
        protein_g: 0,
        water_ml: waterMl,
        caffeine_mg: caffeineMg,
        caffeine_time: caffeineMg > 0 ? combineToday(caffeineTime) : null,
        creatine_taken: creatineTaken,
      });
      if (!result.data) {
        if (result.error) {
          setError(result.error);
        } else {
          setError('Not signed in — data cannot be saved. Authentication is required to write to Supabase.');
        }
        return;
      }
      setSuccess('Nutrition logged ✓');
      setTimeout(() => setSuccess(null), 2500);
      setCaffeineMg(0);
      setCreatineTaken(false);
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save nutrition log');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm dark:bg-amber-900/40">
          🥗
        </span>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nutrition</h3>
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

      {/* Today's summary */}
      {latest && !loading && (
        <div className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">
              💧 {latest.water_ml}ml
            </span>
            {(latest.caffeine_mg ?? 0) > 0 && (
              <span className="text-zinc-500 dark:text-zinc-400">
                ☕ {latest.caffeine_mg}mg
              </span>
            )}

            {latest.creatine_taken && (
              <span className="text-amber-600 dark:text-amber-400">✦ Creatine</span>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Water */}
        <div>
          <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>💧 Water</span>
            <span>{waterMl}ml</span>
          </label>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[250, 500, 750].map((ml) => (
                <button
                  key={ml}
                  type="button"
                  onClick={() => setWaterMl(ml)}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                    waterMl === ml
                      ? 'bg-sky-500 text-white'
                      : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                  }`}
                >
                  {ml}ml
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              max={5000}
              value={waterMl}
              onChange={(e) => setWaterMl(Math.max(0, Number(e.target.value)))}
              className="w-16 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Caffeine toggle */}
        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={caffeineMg > 0}
              onChange={(e) => setCaffeineMg(e.target.checked ? 100 : 0)}
              className="rounded border-zinc-300 text-amber-500 focus:ring-amber-400 dark:border-zinc-600"
            />
            ☕ Caffeine
          </label>
          {caffeineMg > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-zinc-400">mg</label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={25}
                  value={caffeineMg}
                  onChange={(e) => setCaffeineMg(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-zinc-400">Time</label>
                <input
                  type="time"
                  value={caffeineTime}
                  onChange={(e) => setCaffeineTime(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* Creatine toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-300">
          <input
            type="checkbox"
            checked={creatineTaken}
            onChange={(e) => setCreatineTaken(e.target.checked)}
            className="rounded border-zinc-300 text-amber-500 focus:ring-amber-400 dark:border-zinc-600"
          />
          <span className="flex items-center gap-1.5">
            ✦ Creatine taken
            <span className={`text-[10px] italic transition-opacity ${creatineTaken ? 'opacity-100' : 'opacity-0'}`}>
              — logged for today
            </span>
          </span>
        </label>



        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-amber-600 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Log Nutrition'}
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
