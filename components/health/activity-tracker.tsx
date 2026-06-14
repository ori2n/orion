'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getActivities, insertActivity, updateActivity } from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { Activity } from '@/lib/health/storage';

const PRESET_ACTIVITY_TYPES = [
  'Gym',
  'Running',
  'Walking',
  'Cycling',
  'Swimming',
  'Yoga',
  'Sports',
  'HIIT',
  'Other',
] as const;

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeString(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Date helpers ─────────────────────────────────────────────────

function getDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  // For 2-6 days ago, show weekday name
  const d = getDate(daysAgo);
  return `Last ${DAY_NAMES[d.getDay()]}`;
}

function combineToISO(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const date = new Date(y, m - 1, d, hh, mm);
  return date.toISOString();
}

// ─── Formatting for display ────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatActivityDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffDays = Math.round((today.getTime() - dayStart.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return `Today ${formatTime(iso)}`;
  if (diffDays === 1) return `Yesterday ${formatTime(iso)}`;
  if (diffDays <= 6) return `Last ${DAY_NAMES[d.getDay()]} ${formatTime(iso)}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${formatTime(iso)}`;
}

const INTENSITY_COLORS: Record<string, string> = {
  low: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30',
  medium: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30',
  high: 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/30',
};

// ─── Component ──────────────────────────────────────────────────────

export default function ActivityTracker() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [activityType, setActivityType] = useState<string>('Walking');
  const [customType, setCustomType] = useState('');
  const [duration, setDuration] = useState(30);
  const [intensity, setIntensity] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [selectedTime, setSelectedTime] = useState(nowTimeString());
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const isCustomType = activityType === '__custom__';

  // Memoized date options (Today, Yesterday, Last Monday, etc.)
  const dateOptions = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => ({
      daysAgo: i,
      label: getDateLabel(i),
      value: formatDateInput(getDate(i)),
    })),
  []);

  // Combined unique activity types from presets + history
  const allActivityTypes = useMemo(() => {
    const fromHistory = new Set(activities.map((a) => a.activity_type));
    PRESET_ACTIVITY_TYPES.forEach((t) => fromHistory.add(t));
    const sorted = Array.from(fromHistory).sort();
    return sorted;
  }, [activities]);

  const filteredTypes = useMemo(() => {
    if (!typeFilter) return allActivityTypes;
    return allActivityTypes.filter((t) =>
      t.toLowerCase().includes(typeFilter.toLowerCase()),
    );
  }, [allActivityTypes, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getActivities(7);
      setActivities(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function populateForm(activity: Activity) {
    // Convert the stored ISO timestamp back to date+time for the form
    const d = new Date(activity.created_at);
    const dateStr = formatDateInput(d);
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const typeExists = allActivityTypes.includes(activity.activity_type);
    if (typeExists) {
      setActivityType(activity.activity_type);
      setCustomType('');
    } else {
      setActivityType('__custom__');
      setCustomType(activity.activity_type);
    }
    setDuration(activity.duration_minutes);
    setIntensity(activity.intensity);
    setSelectedDate(dateStr);
    setSelectedTime(timeStr);
    setEditingId(activity.id);
    setTypeFilter('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDuration(30);
    setIntensity('medium');
    setCustomType('');
    setActivityType('Walking');
    setSelectedDate(todayDateString());
    setSelectedTime(nowTimeString());
    setTypeFilter('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const finalType = isCustomType ? customType.trim() : activityType;
    if (!finalType) {
      setError('Please select or enter an activity type');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        // Update existing
        const created_at = combineToISO(selectedDate, selectedTime);
        const ok = await updateActivity(editingId, {
          activity_type: finalType,
          duration_minutes: duration,
          intensity,
          notes: '',
          created_at,
        });
        if (!ok) {
          setError('Failed to update activity');
          return;
        }
        setSuccess('Activity updated ✓');
        cancelEdit();
      } else {
        // Insert new
        const created_at = combineToISO(selectedDate, selectedTime);
        const result = await insertActivity({
          activity_type: finalType,
          duration_minutes: duration,
          intensity,
          notes: '',
          created_at,
        });
        if (!result.data) {
          if (result.error) {
            setError(result.error);
          } else {
            setError('Not signed in — data cannot be saved. Authentication is required to write to Supabase.');
          }
          return;
        }
        setSuccess('Activity logged ✓');
        setDuration(30);
        setIntensity('medium');
        setCustomType('');
        setActivityType('Walking');
        setSelectedTime(nowTimeString());
        setTypeFilter('');
      }
      setTimeout(() => setSuccess(null), 2500);
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save activity');
    } finally {
      setSaving(false);
    }
  }

  // Derive activity count per type for the history list
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activities.forEach((a) => {
      counts[a.activity_type] = (counts[a.activity_type] || 0) + 1;
    });
    return counts;
  }, [activities]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm dark:bg-emerald-900/40">
          🏃
        </span>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Activity</h3>
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

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Type selector with custom option */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Type
          </label>
          {isCustomType ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter activity name..."
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                autoFocus
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => { setActivityType('Walking'); setCustomType(''); }}
                className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="relative">
              {/* Quick type filter input */}
              <input
                type="text"
                placeholder="Search or pick a type…"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="mb-1.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                size={Math.min(filteredTypes.length + 1, 6)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {filteredTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}{typeCounts[t] ? ` (${typeCounts[t]})` : ''}
                  </option>
                ))}
                <option value="__custom__">
                  ── Add custom type ──
                </option>
              </select>
            </div>
          )}
        </div>

        {/* Date & Time row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Date
            </label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {dateOptions.map((opt) => (
                <option key={opt.daysAgo} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Time
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Duration & Intensity row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Duration (min)
            </label>
            <input
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Intensity
            </label>
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as 'low' | 'medium' | 'high')}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving || (isCustomType && !customType.trim())}
            className={`flex-1 rounded-lg py-2 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
              editingId
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {saving ? 'Saving...' : editingId ? 'Update Activity' : 'Log Activity'}
          </button>
        </div>
      </form>

      {/* Recent activities */}
      {activities.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Recent
          </p>
          {activities.slice(0, 7).map((a) => (
            <div
              key={a.id}
              onClick={() => populateForm(a)}
              className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors ${
                editingId === a.id
                  ? 'bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/20 dark:ring-amber-700'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {a.activity_type}
                </span>
                <span className="text-zinc-400">{a.duration_minutes}m</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${INTENSITY_COLORS[a.intensity]}`}>
                  {a.intensity}
                </span>
                <span className="text-zinc-400">{formatActivityDate(a.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
        </div>
      )}
    </div>
  );
}
