'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import { getHabitCompletionHistory } from '@/lib/analytics';
import { EventTypes, logEvent } from '@/lib/events';
import HabitAnalytics from '@/components/habit-analytics';
import TodoList from '@/components/todo-list';

type Frequency = 'daily' | 'weekly' | 'custom';
type View = 'today' | 'plan' | 'insights';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Habit {
  id: string;
  name: string;
  frequency: Frequency;
  custom_frequency: string;
  tag_id: string;
  duration_minutes?: number | null;
  priority?: number | null;
}

interface Completion {
  id: string;
  habit_id: string;
  completed_date: string;
}

interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  start_at: string; // ISO 8601
  end_at: string;   // ISO 8601
  color?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: string | null;
  created_at?: string;
  updated_at?: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isFutureIatError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('jwt issued at future') ||
    m.includes('issued at future') ||
    m.includes('token is issued in the future')
  );
}

const FUTURE_IAT_RETRY_DELAY_MS = 750;
const FUTURE_IAT_MAX_RETRIES = 3;

async function retryFutureIat<R extends { data: unknown; error: { message?: string } | null }>(
  label: string,
  run: () => PromiseLike<R> | Promise<R>,
): Promise<R> {
  let attempt = 0;
  let result: R = await run();
  while (
    result.error &&
    isFutureIatError(result.error.message) &&
    attempt < FUTURE_IAT_MAX_RETRIES
  ) {
    if (attempt === 0) {
      console.warn(`[habits] ${label} rejected with "JWT issued at future" — retrying once`);
    }
    attempt += 1;
    await new Promise((r) => setTimeout(r, FUTURE_IAT_RETRY_DELAY_MS));
    result = await run();
  }
  if (result.error && isFutureIatError(result.error.message)) {
    console.warn(`[habits] ${label} retry exhausted on JWT clock-skew`);
    return {
      ...result,
      error: {
        ...(result.error as { message?: string }),
        message: `${result.error.message ?? label} (clock-skew with auth server; auto-retry exhausted)`,
      },
    };
  }
  return result;
}

// ─── Section helpers ───────────────────────────────────────────────

const DEFAULT_EMOJIS: Record<string, string> = {
  Fitness: '🏋️', Health: '💚', Studies: '📚',
  Productivity: '⚡', Mindset: '🧠',
};

function getEmoji(name: string): string {
  return DEFAULT_EMOJIS[name] || '📌';
}

const SECTION_ORDER_KEY = 'habits_section_order';

function loadSectionOrder(): string[] {
  try {
    const saved = localStorage.getItem(SECTION_ORDER_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return ['Fitness', 'Studies', 'Health', 'Productivity', 'Mindset', 'Uncategorised'];
}

function saveSectionOrder(order: string[]) {
  try {
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order));
  } catch { /* ignore */ }
}

function frequencyLabel(f: Frequency, custom: string): string {
  if (f === 'daily') return 'Daily';
  if (f === 'weekly') return 'Weekly';
  return custom || 'Custom';
}

// useNow — SSR-safe current Date. Returns null on the first render (during
// hydration the server snapshot has no clock) and switches to a live Date
// + minute-tick subscription after mount. Used wherever the page reads
// the wall clock for display so SSR markup matches the first client paint.
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Time Management — the dashboard-level page that owns "today".
 *
 * Shape (Phase 1 — foundation):
 *   - Top nav: Today | Plan | Insights.
 *   - Today view: full-width 3-column shell.
 *       LEFT  — calendar panel (today's hour grid placeholder, no events yet)
 *       RIGHT TOP   — habits, with the existing section-grid structure
 *       RIGHT BOTTOM — flexible to-do list
 *   - Plan view: placeholder stub (Phase 4 — AI scheduling from NL)
 *   - Insights view: existing HabitAnalytics surface
 *
 * Phase 2 will replace the calendar placeholder with a real day/week/month
 * calendar + drag/resize; Phase 3 will add duration_minutes / curfew /
 * AVAILABLE/LOCKED/COMPLETED state UI on the right column; Phase 4 will
 * add voice + NL scheduling; Phase 5 will add the todos→calendar drag.
 */
export default function ActionsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Top-nav view — drives which main panel renders.
  const [view, setView] = useState<View>('today');

  // Analytics refresh trigger
  const [analyticsKey, setAnalyticsKey] = useState(0);
  const [analyticsWindow, setAnalyticsWindow] = useState<7 | 14 | 30>(30);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Track loading state per habit to prevent rapid double-submission
  const togglingRef = useRef<Set<string>>(new Set());

  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  // Sections default-collapsed so the Today view fits without scrolling.
  // The `sectionsClaimedRef` ref below tracks which sections have ALREADY
  // been auto-collapsed once — sections the user expanded afterwards are
  // deliberately NOT re-collapsed when subsequent reloads fire.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(loadSectionOrder()),
  );
  const sectionsClaimedRef = useRef<Set<string>>(
    new Set(loadSectionOrder()),
  );

  const [addingInSection, setAddingInSection] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [inlineFreq, setInlineFreq] = useState<Frequency>('daily');
  const [inlineCustomFreq, setInlineCustomFreq] = useState('');

  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  const [draggedHabitId, setDraggedHabitId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);

  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const uid = await getCurrentUserId();
    setUserId(uid);

    const [tagsResult, habitsResult, completionsResult] = await Promise.all([
      supabase.from('tags').select('*').order('created_at'),
      supabase.from('habits').select('*').order('created_at'),
      uid
        ? supabase.from('habit_completions').select('*').eq('user_id', uid).eq('completed_date', today())
        : Promise.resolve({ data: [], error: null }),
    ]);

    const fixedTagsResult = tagsResult.error && isFutureIatError(tagsResult.error.message)
      ? await retryFutureIat('tags', () => supabase.from('tags').select('*').order('created_at'))
      : tagsResult;
    const fixedHabitsResult = habitsResult.error && isFutureIatError(habitsResult.error.message)
      ? await retryFutureIat('habits', () => supabase.from('habits').select('*').order('created_at'))
      : habitsResult;
    const fixedCompletionsResult = completionsResult.error && isFutureIatError(completionsResult.error.message) && uid
      ? await retryFutureIat('habit_completions', () =>
          supabase.from('habit_completions').select('*').eq('user_id', uid).eq('completed_date', today()),
        )
      : completionsResult;

    if (fixedTagsResult.error) {
      setError(`Failed to load tags: ${fixedTagsResult.error.message}`);
      setLoading(false);
      return;
    }
    if (fixedHabitsResult.error) {
      setError(`Failed to load habits: ${fixedHabitsResult.error.message}`);
      setLoading(false);
      return;
    }
    if (fixedCompletionsResult.error) {
      setError(`Failed to load completions: ${fixedCompletionsResult.error.message}`);
      setLoading(false);
      return;
    }

    const loadedTags = fixedTagsResult.data ?? [];
    setTags(loadedTags);
    setHabits(fixedHabitsResult.data ?? []);
    setCompletions(new Set((fixedCompletionsResult.data ?? []).map((c: Completion) => c.habit_id)));

    const tagNames = new Set(loadedTags.map((t: Tag) => t.name));
    setSectionOrder((prev) => {
      const filtered = prev.filter((s) => s === 'Uncategorised' || tagNames.has(s));
      for (const t of loadedTags) {
        if (!filtered.includes(t.name)) {
          filtered.splice(Math.max(0, filtered.length - 1), 0, t.name);
        }
      }
      if (!filtered.includes('Uncategorised')) filtered.push('Uncategorised');
      saveSectionOrder(filtered);
      return filtered;
    });

    setLoading(false);
  }, []);

  // First-fetch trigger: on every mount, kick off `loadData()`. The
  // upload flow's `onSaved()` callback re-runs it after a write so the
  // gallery refreshes, but we never auto-reload on every render.
  useEffect(() => {
    let cancelled = false;
    void loadData().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // Auto-collapse: initially every section is collapsed (set in the
  // useState lazy initializer above). When `sectionOrder` grows after
  // `loadData()` resolves — e.g. server returns a new tag — only NEW
  // section names are folded into the collapsed set. Sections the
  // user expanded are NOT re-collapsed if a later reload flips
  // `loading` back to false: the ref acts as a one-shot "we already
  // touched this section" guard, so re-collapsing paths (delete-restore,
  // future upload-restore, etc.) respect the current user toggle.
  useEffect(() => {
    if (loading) return;
    const newlySeen: string[] = [];
    for (const s of sectionOrder) {
      if (!sectionsClaimedRef.current.has(s)) {
        sectionsClaimedRef.current.add(s);
        newlySeen.push(s);
      }
    }
    if (newlySeen.length === 0) return;
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const s of newlySeen) next.add(s);
      return next;
    });
  }, [loading, sectionOrder]);

  const now = useNow();
  const todayStr = now
    ? now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : '';

  function getTagNameById(tagId: string): string | null {
    return tags.find((t) => t.id === tagId)?.name ?? null;
  }
  function getTagIdByName(name: string): string | null {
    return tags.find((t) => t.name === name)?.id ?? null;
  }
  function getSectionForHabit(habit: Habit): string {
    const tagName = getTagNameById(habit.tag_id);
    if (tagName && sectionOrder.includes(tagName)) return tagName;
    return 'Uncategorised';
  }
  function groupHabitsBySection(): Map<string, Habit[]> {
    const grouped = new Map<string, Habit[]>();
    for (const name of sectionOrder) grouped.set(name, []);
    for (const habit of habits) {
      const section = getSectionForHabit(habit);
      if (grouped.has(section)) {
        grouped.get(section)!.push(habit);
      } else {
        grouped.set(section, [habit]);
      }
    }
    return grouped;
  }

  async function addHabitToSection(section: string) {
    if (!inlineName.trim()) return;
    const sectionTagId = getTagIdByName(section);

    const { data, error: insertError } = await supabase
      .from('habits')
      .insert({
        name: inlineName.trim(),
        frequency: inlineFreq,
        custom_frequency: inlineFreq === 'custom' ? inlineCustomFreq.trim() : '',
        tag_id: sectionTagId,
        user_id: userId,
      })
      .select()
      .single();

    if (insertError) {
      setError(`Failed to add habit: ${insertError.message}`);
      return;
    }

    if (data) setHabits((prev) => [...prev, data as Habit]);
    setInlineName('');
    setInlineFreq('daily');
    setInlineCustomFreq('');
    setAddingInSection(null);
  }

  async function deleteHabit(habitId: string) {
    setHabits((prev) => prev.filter((h) => h.id !== habitId));

    const { error: completionsError } = await supabase
      .from('habit_completions')
      .delete()
      .eq('habit_id', habitId);

    if (completionsError) {
      setError(`Failed to delete habit completions: ${completionsError.message}`);
      void loadData();
      return;
    }

    const { error: deleteError } = await supabase.from('habits').delete().eq('id', habitId);
    if (deleteError) {
      setError(`Failed to delete habit: ${deleteError.message}`);
      void loadData();
      return;
    }
    setAnalyticsKey((k) => k + 1);
  }

  async function toggleCompletion(habitId: string) {
    if (togglingRef.current.has(habitId)) return;
    togglingRef.current.add(habitId);
    setCompletions((prev) => new Set(prev));

    try {
      const isCompleted = completions.has(habitId);

      if (isCompleted) {
        const { error: deleteError } = await supabase
          .from('habit_completions')
          .delete()
          .eq('habit_id', habitId)
          .eq('user_id', userId)
          .eq('completed_date', today());

        if (deleteError) {
          setError(`Failed to unmark completion: ${deleteError.message}`);
          return;
        }

        setCompletions((prev) => {
          const next = new Set(prev);
          next.delete(habitId);
          return next;
        });

        void logEvent(EventTypes.HABIT_LOG, {
          habit_id: habitId,
          status: 'incomplete',
          completed_date: today(),
        });

        setAnalyticsKey((k) => k + 1);
      } else {
        const { error: upsertError } = await supabase
          .from('habit_completions')
          .upsert(
            { habit_id: habitId, completed_date: today(), user_id: userId },
            { onConflict: 'habit_id,completed_date', ignoreDuplicates: true },
          );

        if (upsertError) {
          setError(`Failed to mark completion: ${upsertError.message}`);
          return;
        }

        setCompletions((prev) => new Set(prev).add(habitId));

        void logEvent(EventTypes.HABIT_LOG, {
          habit_id: habitId,
          status: 'completed',
          completed_date: today(),
        });

        setAnalyticsKey((k) => k + 1);
      }
    } finally {
      togglingRef.current.delete(habitId);
      setCompletions((prev) => new Set(prev));
    }
  }

  function handleHabitDragStart(e: React.DragEvent, habitId: string) {
    e.dataTransfer.setData('text/plain', habitId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedHabitId(habitId);
  }
  function handleHabitDragOver(e: React.DragEvent, section: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSection(section);
  }
  function handleHabitDragLeave() {
    setDragOverSection(null);
  }

  async function handleHabitDrop(e: React.DragEvent, targetSection: string) {
    e.preventDefault();
    const habitId = e.dataTransfer.getData('text/plain');
    if (!habitId) return;

    const habit = habits.find((h) => h.id === habitId);
    if (!habit) return;

    const currentSection = getSectionForHabit(habit);
    if (currentSection === targetSection) {
      setDraggedHabitId(null);
      setDragOverSection(null);
      return;
    }

    const isUncategorised = targetSection === 'Uncategorised';
    const targetTagId = isUncategorised ? '' : (getTagIdByName(targetSection) ?? '');

    if (!isUncategorised && !targetTagId) {
      setDraggedHabitId(null);
      setDragOverSection(null);
      return;
    }

    setHabits((prev) =>
      prev.map((h) => (h.id === habitId ? { ...h, tag_id: targetTagId } : h)),
    );

    const { error: updateError } = await supabase
      .from('habits')
      .update({ tag_id: isUncategorised ? null : targetTagId })
      .eq('id', habitId);

    if (updateError) {
      setHabits((prev) =>
        prev.map((h) => (h.id === habitId ? { ...h, tag_id: habit.tag_id } : h)),
      );
      setError(`Failed to move habit: ${updateError.message}`);
    }

    setDraggedHabitId(null);
    setDragOverSection(null);
  }

  function handleHabitDragEnd() {
    setDraggedHabitId(null);
    setDragOverSection(null);
  }

  function handleSectionDragStart(e: React.DragEvent, section: string) {
    e.dataTransfer.setData('text/plain', section);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedSection(section);
  }
  function handleSectionDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSectionIdx(idx);
  }
  function handleSectionDrop(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    const section = e.dataTransfer.getData('text/plain');
    if (!section || !draggedSection || draggedSection === 'Uncategorised') {
      setDraggedSection(null);
      setDragOverSectionIdx(null);
      return;
    }
    const fromIdx = sectionOrder.indexOf(draggedSection);
    if (fromIdx === -1 || fromIdx === targetIdx) {
      setDraggedSection(null);
      setDragOverSectionIdx(null);
      return;
    }
    setSectionOrder((prev) => {
      const next = [...prev];
      next.splice(fromIdx, 1);
      const adjustedTarget = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
      next.splice(adjustedTarget, 0, draggedSection);
      saveSectionOrder(next);
      return next;
    });
    setDraggedSection(null);
    setDragOverSectionIdx(null);
  }
  function handleSectionDragEnd() {
    setDraggedSection(null);
    setDragOverSectionIdx(null);
  }

  async function addSection() {
    const name = newSectionName.trim();
    if (!name || !userId) return;

    const { data, error: insertError } = await supabase
      .from('tags')
      .insert({ name, color: 'bg-zinc-100 text-zinc-700 border-zinc-200', user_id: userId })
      .select()
      .single();

    if (insertError) {
      setError(`Failed to create section: ${insertError.message}`);
      return;
    }

    if (data) {
      setTags((prev) => [...prev, data as Tag]);
      setSectionOrder((prev) => {
        const next = [...prev];
        const uncatIdx = next.indexOf('Uncategorised');
        if (uncatIdx >= 0) next.splice(uncatIdx, 0, name);
        else next.push(name);
        saveSectionOrder(next);
        return next;
      });
    }
    setNewSectionName('');
    setShowNewSection(false);
  }

  async function removeSection(section: string) {
    if (section === 'Uncategorised') return;
    const tag = tags.find((t) => t.name === section);
    if (!tag) return;

    const { error: updateError } = await supabase
      .from('habits')
      .update({ tag_id: null })
      .eq('tag_id', tag.id);

    if (updateError) {
      setError(`Failed to unlink habits from section: ${updateError.message}`);
      return;
    }

    const { error: deleteError } = await supabase.from('tags').delete().eq('id', tag.id);

    if (deleteError) {
      setError(`Failed to delete section: ${deleteError.message}`);
      return;
    }

    setHabits((prev) =>
      prev.map((h) => (h.tag_id === tag.id ? { ...h, tag_id: '' } : h)),
    );
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
    setSectionOrder((prev) => {
      const next = prev.filter((s) => s !== section);
      saveSectionOrder(next);
      return next;
    });
  }

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function completedToday(habitId: string): boolean {
    return completions.has(habitId);
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950">
      {/* ── Top nav (sticky) ───────────────────────────────────── */}
      <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-1.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-amber-500 text-base">
              🧭
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Time</div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Management
              </h1>
            </div>
          </div>

          {/* View tabs */}
          <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/80">
            {(['today', 'plan', 'insights'] as const).map((v) => {
              const label = v === 'today' ? 'Today' : v === 'plan' ? 'Plan' : 'Insights';
              const active = view === v;
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={active}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                    active
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {/* Render a stable, non-time-dependent fallback during SSR/first
                paint so server markup matches client markup. Once useNow()
                reports a Date, the real formatted date swaps in. */}
            <span suppressHydrationWarning>{todayStr}</span>
          </div>
        </div>
      </nav>

      {/* ── View content ───────────────────────────────────────── */}
      <main className="mx-auto max-w-[1600px] px-3 py-1 sm:px-4 sm:py-2">
        {view === 'today' && (
          <TodayView
            error={error}
            sectionOrder={sectionOrder}
            habits={habits}
            completions={completions}
            collapsedSections={collapsedSections}
            draggedHabitId={draggedHabitId}
            dragOverSection={dragOverSection}
            draggedSection={draggedSection}
            dragOverSectionIdx={dragOverSectionIdx}
            addingInSection={addingInSection}
            inlineName={inlineName}
            inlineFreq={inlineFreq}
            inlineCustomFreq={inlineCustomFreq}
            showNewSection={showNewSection}
            newSectionName={newSectionName}
            tags={tags}
            userId={userId}
            groupHabitsBySection={groupHabitsBySection}
            getSectionForHabit={getSectionForHabit}
            getEmoji={getEmoji}
            getTagIdByName={getTagIdByName}
            frequencyLabel={frequencyLabel}
            setInlineName={setInlineName}
            setInlineFreq={setInlineFreq}
            setInlineCustomFreq={setInlineCustomFreq}
            setAddingInSection={setAddingInSection}
            setShowNewSection={setShowNewSection}
            setNewSectionName={setNewSectionName}
            completedToday={completedToday}
            togglingRef={togglingRef}
            handleHabitDragStart={handleHabitDragStart}
            handleHabitDragOver={handleHabitDragOver}
            handleHabitDragLeave={handleHabitDragLeave}
            handleHabitDrop={handleHabitDrop}
            handleHabitDragEnd={handleHabitDragEnd}
            handleSectionDragStart={handleSectionDragStart}
            handleSectionDragOver={handleSectionDragOver}
            handleSectionDrop={handleSectionDrop}
            handleSectionDragEnd={handleSectionDragEnd}
            toggleSection={toggleSection}
            addHabitToSection={addHabitToSection}
            addSection={addSection}
            removeSection={removeSection}
            toggleCompletion={toggleCompletion}
            deleteHabit={deleteHabit}
            setError={setError}
          />
        )}

        {view === 'plan' && <PlanPlaceholder />}

        {view === 'insights' && (
          <InsightsView
            habits={habits}
            analyticsKey={analyticsKey}
            analyticsWindow={analyticsWindow}
            userId={userId}
            setAnalyticsWindow={setAnalyticsWindow}
          />
        )}
      </main>
    </div>
  );
}

// ─── Today view (3-column shell) ──────────────────────────────────

function TodayView(props: {
  error: string | null;
  sectionOrder: string[];
  habits: Habit[];
  completions: Set<string>;
  collapsedSections: Set<string>;
  draggedHabitId: string | null;
  dragOverSection: string | null;
  draggedSection: string | null;
  dragOverSectionIdx: number | null;
  addingInSection: string | null;
  inlineName: string;
  inlineFreq: Frequency;
  inlineCustomFreq: string;
  showNewSection: boolean;
  newSectionName: string;
  tags: Tag[];
  userId: string | null;
  groupHabitsBySection: () => Map<string, Habit[]>;
  getSectionForHabit: (habit: Habit) => string;
  getEmoji: (name: string) => string;
  getTagIdByName: (name: string) => string | null;
  frequencyLabel: (f: Frequency, c: string) => string;
  setInlineName: (s: string) => void;
  setInlineFreq: (f: Frequency) => void;
  setInlineCustomFreq: (s: string) => void;
  setAddingInSection: (s: string | null) => void;
  setShowNewSection: (b: boolean) => void;
  setNewSectionName: (s: string) => void;
  completedToday: (id: string) => boolean;
  togglingRef: React.MutableRefObject<Set<string>>;
  handleHabitDragStart: (e: React.DragEvent, id: string) => void;
  handleHabitDragOver: (e: React.DragEvent, sect: string) => void;
  handleHabitDragLeave: () => void;
  handleHabitDrop: (e: React.DragEvent, sect: string) => void;
  handleHabitDragEnd: () => void;
  handleSectionDragStart: (e: React.DragEvent, s: string) => void;
  handleSectionDragOver: (e: React.DragEvent, i: number) => void;
  handleSectionDrop: (e: React.DragEvent, i: number) => void;
  handleSectionDragEnd: () => void;
  toggleSection: (s: string) => void;
  addHabitToSection: (s: string) => Promise<void>;
  addSection: () => Promise<void>;
  removeSection: (s: string) => Promise<void>;
  toggleCompletion: (id: string) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  setError: (msg: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-2">
      {/* LEFT — Calendar panel */}
      <CalendarTodayPanel />

      {/* RIGHT — Habits + To-dos stacked */}
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* Habits card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {/* Error banner */}
          {props.error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {props.error}
              <button
                onClick={() => props.setError(null)}
                className="ml-3 font-medium underline underline-offset-2 hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Section-based Habits List — single column for compactness in
              the right rail. Phase 3 can re-introduce a 2-col sub-grid if
              habit counts ever justify it. */}
          <div className="space-y-0.5">
            {props.sectionOrder.map((sectionName, idx) => {
              const grouped = props.groupHabitsBySection();
              const sectionHabits = grouped.get(sectionName) ?? [];
              const isCollapsed = props.collapsedSections.has(sectionName);
              const isDragOver = props.dragOverSection === sectionName;
              const isSectionDragged = props.draggedSection === sectionName;
              const isDragOverHere = props.dragOverSectionIdx === idx;
              const isUncategorised = sectionName === 'Uncategorised';

              return (
                <SectionContainer
                  key={sectionName}
                  sectionName={sectionName}
                  emoji={props.getEmoji(sectionName)}
                  isCollapsed={isCollapsed}
                  isDragOver={isDragOver}
                  isSectionDragged={isSectionDragged}
                  isDragOverHere={isDragOverHere}
                  isUncategorised={isUncategorised}
                  pendingCount={sectionHabits.length}
                  onToggle={() => props.toggleSection(sectionName)}
                  onAddClick={() => {
                    props.setAddingInSection(
                      props.addingInSection === sectionName ? null : sectionName,
                    );
                    props.setInlineName('');
                    props.setInlineFreq('daily');
                    props.setInlineCustomFreq('');
                  }}
                  onRemove={() => props.removeSection(sectionName)}
                  onHabitDragOver={(e) => props.handleHabitDragOver(e, sectionName)}
                  onHabitDragLeave={props.handleHabitDragLeave}
                  onHabitDrop={(e) => props.handleHabitDrop(e, sectionName)}
                  onSectionDragStart={(e) => props.handleSectionDragStart(e, sectionName)}
                  onSectionDragOver={(e) => props.handleSectionDragOver(e, idx)}
                  onSectionDrop={(e) => props.handleSectionDrop(e, idx)}
                  onSectionDragEnd={props.handleSectionDragEnd}
                >
                  {/* Inline add form */}
                  {props.addingInSection === sectionName && (
                    <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          placeholder={`New habit in ${sectionName}...`}
                          value={props.inlineName}
                          onChange={(e) => props.setInlineName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') props.addHabitToSection(sectionName);
                            if (e.key === 'Escape') props.setAddingInSection(null);
                          }}
                          className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5">
                          <select
                            value={props.inlineFreq}
                            onChange={(e) => props.setInlineFreq(e.target.value as Frequency)}
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="custom">Custom</option>
                          </select>
                          {props.inlineFreq === 'custom' && (
                            <input
                              type="text"
                              placeholder="e.g. 3x/week"
                              value={props.inlineCustomFreq}
                              onChange={(e) => props.setInlineCustomFreq(e.target.value)}
                              className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                            />
                          )}
                          <button
                            onClick={() => props.addHabitToSection(sectionName)}
                            disabled={!props.inlineName.trim()}
                            className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Habit cards */}
                  {!isCollapsed && (
                    <div className="space-y-1.5 p-2.5">
                      {sectionHabits.length === 0 ? (
                        <div
                          className={`flex items-center justify-center rounded-lg border-2 border-dashed py-4 transition-colors duration-200 ${
                            isDragOver
                              ? 'border-zinc-400 bg-zinc-100/50 dark:border-zinc-500 dark:bg-zinc-800/30'
                              : 'border-zinc-200 dark:border-zinc-700'
                          }`}
                        >
                          <p className="text-xs text-zinc-300 dark:text-zinc-600">
                            Drop habits here
                          </p>
                        </div>
                      ) : (
                        sectionHabits.map((habit) => {
                          const done = props.completedToday(habit.id);
                          const isDragging = props.draggedHabitId === habit.id;
                          return (
                            <HabitCard
                              key={habit.id}
                              habit={habit}
                              done={done}
                              isDragging={isDragging}
                              onToggle={() => props.toggleCompletion(habit.id)}
                              onDelete={() => props.deleteHabit(habit.id)}
                              onDragStart={(e) => props.handleHabitDragStart(e, habit.id)}
                              onDragEnd={props.handleHabitDragEnd}
                              isLoading={props.togglingRef.current.has(habit.id)}
                              userId={props.userId}
                              frequencyLabel={props.frequencyLabel}
                            />
                          );
                        })
                      )}
                    </div>
                  )}
                </SectionContainer>
              );
            })}
          </div>

          {/* Add section button */}
          <div className="mt-1 flex items-center justify-center">
            {props.showNewSection ? (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <input
                  type="text"
                  placeholder="Section name..."
                  value={props.newSectionName}
                  onChange={(e) => props.setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') props.addSection();
                    if (e.key === 'Escape') {
                      props.setShowNewSection(false);
                      props.setNewSectionName('');
                    }
                  }}
                  className="w-40 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                  autoFocus
                />
                <button
                  onClick={props.addSection}
                  disabled={!props.newSectionName.trim()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    props.setShowNewSection(false);
                    props.setNewSectionName('');
                  }}
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => props.setShowNewSection(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-3 py-1 text-sm text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add section
              </button>
            )}
          </div>
        </div>

        {/* To-dos card */}
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <TodoList />
        </div>
      </div>
    </div>
  );
}

// ─── Calendar "Today" panel — dynamic, event-driven ───────────────
//
// The panel renders an hour grid ONLY when there are real events for
// today. With zero events (the Phase 1 default before users have
// created commitments), it renders a compact empty-state card so the
// left rail doesn't drag the page down with empty vertical scaffolding.
// When events eventually exist (Phase 2+), the grid fits the actual
// hour range spanned by the events rather than hard-coding 06:00 → 23:00.

function CalendarTodayPanel() {
  const liveNow = useNow();
  const fallbackDate = new Date(0); // 1970-01-01T00:00:00Z — deterministic
  const now = liveNow ?? fallbackDate;
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Today's events — fetched from Supabase calendar_events if the table
  // exists, falls back to [] (renders empty-state card) on any error so
  // a missing migration or failed query does not crash the page.
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getCurrentUserId();
        if (!uid) return;
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date();
        dayEnd.setHours(23, 59, 59, 999);
        const { data, error } = await supabase
          .from('calendar_events')
          .select('*')
          .eq('user_id', uid)
          .gte('start_at', dayStart.toISOString())
          .lte('start_at', dayEnd.toISOString())
          .order('start_at');
        if (!cancelled && !error && data) setEvents(data as CalendarEvent[]);
      } catch {
        /* calendar_events may not exist yet — render empty state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute the hour-range we need to render. With events: clamp to
  // [min start hour, max end hour] padded by ±1 hour for context, floor
  // to 06 / ceil to 23 outermost bounds. Without events: don't render
  // the grid at all — show a compact card instead — so the page height
  // is determined by the right column instead.
  const hasEvents = events.length > 0;
  const HOUR_FLOOR = 6;
  const HOUR_CEIL = 23;
  const ROW_H = 31; // py-1 (8) + border-t (1) + min-h-[22] content
  const GRID_PAD_TOP = 8; // py-2 on the day-grid container

  function eventHour(iso: string): number {
    const d = new Date(iso);
    return d.getHours() + d.getMinutes() / 60;
  }
  const allHours = hasEvents
    ? events.flatMap((e) => [eventHour(e.start_at), eventHour(e.end_at)])
    : [];
  const minHour = hasEvents
    ? Math.max(HOUR_FLOOR, Math.floor(Math.min(...allHours, currentHour - 1)))
    : HOUR_FLOOR;
  const maxHour = hasEvents
    ? Math.min(HOUR_CEIL, Math.ceil(Math.max(...allHours, currentHour + 1)))
    : HOUR_CEIL;
  const hourRows = hasEvents
    ? Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i)
    : [];

  // Live indicator math uses the fitted minHour as its base, not a
  // hard-coded 6. Only show it inside the rendered grid region.
  const showLiveLine =
    liveNow !== null &&
    hasEvents &&
    currentHour >= minHour &&
    currentHour <= maxHour;

  // Compact empty-state card. Replacing 18 hard-coded rows with this
  // (~110 px) saves ~480 px on the page when there are no events.
  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-7 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-base dark:bg-zinc-800">
        📅
      </div>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        Free day
      </p>
      <p className="max-w-[220px] text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
        Add tennis, school, or an appointment to block this time on the calendar.
      </p>
      <button
        type="button"
        disabled
        title="Add commitment — coming soon (Phase 2)"
        className="mt-1 inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-400 opacity-60 dark:border-zinc-700 dark:text-zinc-500"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add commitment
      </button>
    </div>
  );

  return (
    <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Single-line header: 📅 + date + D/W/M toggle right.
          Collapsed from the previous 2-line stacked eyebrow + date
          layout to save ~32 px. */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-sm">📅</span>
          <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            <span suppressHydrationWarning>
              {now.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </span>
        </div>
        <div
          role="group"
          aria-label="Calendar view"
          className="flex items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 text-[11px] font-medium dark:bg-zinc-800"
        >
          {(['D', 'W', 'M'] as const).map((v, i) => (
            <button
              key={v}
              aria-pressed={i === 0 ? true : undefined}
              aria-disabled={i > 0 ? true : undefined}
              tabIndex={i > 0 ? -1 : 0}
              title={
                i === 0
                  ? 'Day view (active)'
                  : i === 1
                    ? 'Week view — coming soon'
                    : 'Month view — coming soon'
              }
              className={`rounded px-1.5 py-0.5 transition-colors duration-150 ${
                i === 0
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-400'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Body — empty-state card (no rows) when no events; fitted hour
          grid (only the rows that contain events + ±1 h padding for
          context) when events exist. Capped height so the panel never
          stretches the page. */}
      <div className="relative flex-1 overflow-hidden">
        {!hasEvents ? (
          // Always render the empty-state card; pin min-h-[180px] so the
          // SSR/first-paint render (regardless of eventsLoading) shares
          // an identical footprint with the post-load render. No layout
          // shift, no spinner needed.
          <div className="min-h-[180px]">{emptyState}</div>
        ) : (
          <div className="relative max-h-[420px] overflow-y-auto px-3 py-2">
            {hourRows.map((h, idx) => (
              <div
                key={h}
                className={`flex items-start gap-3 border-t border-zinc-100 py-1 text-[11px] tabular-nums text-zinc-400 first:border-t-0 dark:border-zinc-800`}
              >
                <span className="w-10 shrink-0 pt-0.5">
                  {String(h).padStart(2, '0')}:00
                </span>
                <div className="min-h-[22px] flex-1" />
              </div>
            ))}

            {/* Live current-time indicator — sits at the matching row
                using the fitted minHour as base. */}
            {showLiveLine && (
              <div
                className="pointer-events-none absolute left-3 right-3 flex items-center gap-2"
                style={{
                  top: `${
                    GRID_PAD_TOP +
                    ((currentHour - minHour) * ROW_H) +
                    ((currentMinute / 60) * ROW_H)
                  }px`,
                }}
              >
                <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.18)]" />
                <span className="h-px flex-1 bg-gradient-to-r from-rose-500/70 to-rose-500/10" />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Plan placeholder ─────────────────────────────────────────────

function PlanPlaceholder() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-2xl">
        📝
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        Plan
      </h3>
      <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Natural-language scheduling lands next. Tell ORION what you need to do
        today and we'll suggest a slot for each item.
      </p>
      <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-400">
        <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
          &quot;Revise Mandarin 30 min before lunch&quot;
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
          &quot;Gym at 6pm&quot;
        </span>
      </div>
    </div>
  );
}

// ─── Insights view (existing HabitAnalytics) ───────────────────────

function InsightsView(props: {
  habits: Habit[];
  analyticsKey: number;
  analyticsWindow: 7 | 14 | 30;
  userId: string | null;
  setAnalyticsWindow: (n: 7 | 14 | 30) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Insights
          </div>
          <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Habit trends
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Window
          </span>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {([7, 14, 30] as const).map((d) => {
              const active = props.analyticsWindow === d;
              return (
                <button
                  key={d}
                  onClick={() => props.setAnalyticsWindow(d)}
                  aria-pressed={active}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ${
                    active
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {d}d
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {props.habits.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-24 text-sm text-zinc-400">
          Add habits on the Today tab to start collecting insights.
        </div>
      ) : (
        <HabitAnalytics
          refreshKey={props.analyticsKey}
          userId={props.userId}
          windowDays={props.analyticsWindow}
        />
      )}
    </div>
  );
}

// ─── Section Container ────────────────────────────────────────────

function SectionContainer({
  sectionName,
  emoji,
  isCollapsed,
  isDragOver,
  isSectionDragged,
  isDragOverHere,
  isUncategorised,
  pendingCount,
  onToggle,
  onAddClick,
  onRemove,
  onHabitDragOver,
  onHabitDragLeave,
  onHabitDrop,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  children,
}: {
  sectionName: string;
  emoji: string;
  isCollapsed: boolean;
  isDragOver: boolean;
  isSectionDragged: boolean;
  isDragOverHere: boolean;
  isUncategorised: boolean;
  pendingCount: number;
  onToggle: () => void;
  onAddClick: () => void;
  onRemove: () => void;
  onHabitDragOver: (e: React.DragEvent) => void;
  onHabitDragLeave: () => void;
  onHabitDrop: (e: React.DragEvent) => void;
  onSectionDragStart: (e: React.DragEvent) => void;
  onSectionDragOver: (e: React.DragEvent) => void;
  onSectionDrop: (e: React.DragEvent) => void;
  onSectionDragEnd: () => void;
  children: React.ReactNode;
}) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwiping = useRef(false);
  const swipedRef = useRef(false);
  const holdArmed = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef(0);
  const HOLD_DURATION_MS = 400;

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (isUncategorised) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, select, input')) return;

    swipeStartX.current = e.clientX;
    swipeStartY.current = e.clientY;
    isSwiping.current = false;
    holdArmed.current = false;
    setHoldProgress(0);
    holdStartRef.current = Date.now();

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);
      if (progress >= 1) {
        holdArmed.current = true;
        clearHoldTimer();
        setHoldProgress(1);
      }
    }, 50);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (isUncategorised) return;
    if (!holdArmed.current) {
      const dx = Math.abs(e.clientX - swipeStartX.current);
      const dy = Math.abs(e.clientY - swipeStartY.current);
      if (dx > 15 || dy > 15) {
        clearHoldTimer();
        setHoldProgress(0);
        holdArmed.current = false;
      }
      return;
    }
    const dx = e.clientX - swipeStartX.current;
    if (!isSwiping.current) {
      if (Math.abs(dx) > 10) {
        isSwiping.current = true;
      } else {
        return;
      }
    }
    const offset = Math.max(0, Math.min(dx, 250));
    setSwipeOffset(offset);
  }

  function handlePointerUp(e: React.PointerEvent) {
    clearHoldTimer();
    setHoldProgress(0);
    holdArmed.current = false;
    if (isUncategorised || !isSwiping.current) {
      setSwipeOffset(0);
      isSwiping.current = false;
      return;
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    swipedRef.current = true;
    if (swipeOffset > 120) {
      setSwipeOffset(0);
      isSwiping.current = false;
      onRemove();
    } else {
      setSwipeOffset(0);
      isSwiping.current = false;
    }
  }

  const isSwipingRight = swipeOffset > 0;
  const deleteReveal = Math.min(swipeOffset / 120, 1);

  return (
    <div
      onDragOver={onHabitDragOver}
      onDragLeave={onHabitDragLeave}
      onDrop={onHabitDrop}
      className={`relative flex flex-col overflow-hidden rounded-xl border shadow-sm transition-all duration-200 ${
        isDragOver
          ? 'border-zinc-400 bg-zinc-50/50 shadow-md dark:border-zinc-500 dark:bg-zinc-800/30'
          : isSectionDragged
            ? 'border-zinc-300 bg-zinc-50 opacity-50 dark:border-zinc-600 dark:bg-zinc-800'
            : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
      } ${
        isDragOverHere && !isSectionDragged
          ? 'ring-2 ring-zinc-400 dark:ring-zinc-500'
          : ''
      }`}
    >
      {!isUncategorised && (
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end pr-5 transition-all duration-200 ${
            isSwipingRight ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            width: `${Math.min(swipeOffset * 1.8, 250)}px`,
            background: `linear-gradient(to left, rgb(239 68 68 / ${0.6 + deleteReveal * 0.4}), rgb(239 68 68 / ${deleteReveal * 0.3}))`,
            borderRadius: '0 0.75rem 0.75rem 0',
          }}
        >
          <svg
            className="h-6 w-6 text-white drop-shadow"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          <span className="ml-1.5 text-xs font-semibold text-white drop-shadow">
            Delete
          </span>
        </div>
      )}

      <div
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping.current ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={(e) => {
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
            clearHoldTimer();
            setHoldProgress(0);
            holdArmed.current = false;
            setSwipeOffset(0);
            isSwiping.current = false;
          }}
          className={`relative flex cursor-pointer items-center justify-between border-b border-zinc-200 px-2 py-1 transition-colors duration-200 dark:border-zinc-700 ${
            isSectionDragged ? 'opacity-50' : ''
          } ${isSwipingRight ? 'cursor-grabbing touch-pan-y' : ''}`}
          onClick={() => {
            if (holdArmed.current || isSwiping.current || swipeOffset > 0 || swipedRef.current) {
              swipedRef.current = false;
              return;
            }
            onToggle();
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <div
              draggable={!isUncategorised}
              onDragStart={!isUncategorised ? onSectionDragStart : undefined}
              onDragOver={onSectionDragOver}
              onDrop={onSectionDrop}
              onDragEnd={onSectionDragEnd}
              className={`flex items-center gap-2 ${!isUncategorised ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {!isUncategorised && (
                <svg
                  className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover/header:text-zinc-400 dark:text-zinc-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
              <span className="text-base leading-none">{emoji}</span>
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {sectionName}
              </h3>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {pendingCount}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isUncategorised && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-300 opacity-0 transition-all hover:text-red-500 group-hover/container:opacity-100 dark:text-zinc-600 dark:hover:text-red-400"
                aria-label={`Delete ${sectionName} section`}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddClick();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              aria-label={`Add habit to ${sectionName}`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            <svg
              className={`h-4 w-4 text-zinc-400 transition-transform duration-200 dark:text-zinc-500 ${
                isCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>

          {holdProgress > 0.15 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-red-400/60 transition-all duration-[50ms] dark:bg-red-500/60"
                style={{ width: `${holdProgress * 100}%` }}
              />
            </div>
          )}

          {holdProgress > 0 && holdProgress < 0.5 && (
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium tracking-wider text-zinc-300 dark:text-zinc-600"
              style={{ opacity: Math.max(0, 0.6 - holdProgress) }}
            >
              HOLD TO DELETE
            </span>
          )}
        </div>

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Habit Card ────────────────────────────────────────────────────

function HabitCard({
  habit,
  done,
  isDragging,
  onToggle,
  onDelete,
  onDragStart,
  onDragEnd,
  isLoading,
  userId,
  frequencyLabel,
}: {
  habit: Habit;
  done: boolean;
  isDragging: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isLoading: boolean;
  userId?: string | null;
  frequencyLabel: (f: Frequency, c: string) => string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<Array<{ date: string; completed: boolean }> | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    if (!historyData && !historyLoading) {
      setHistoryOpen(true);
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const result = await getHabitCompletionHistory(habit.id, 30, userId);
        setHistoryData(result);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setHistoryLoading(false);
      }
    } else {
      setHistoryOpen(true);
    }
  }
  return (      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`group cursor-grab rounded-md border p-2 transition-all duration-200 active:cursor-grabbing ${
        done
          ? 'border-zinc-200 bg-white opacity-70 dark:border-zinc-700 dark:bg-zinc-900'
          : 'border-zinc-200 bg-white shadow-sm hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900'
      } ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-zinc-400 dark:ring-zinc-500' : ''}`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onDelete}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-400 opacity-100 transition-all hover:bg-red-50 hover:text-red-500 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
          aria-label={`Delete ${habit.name} habit`}
          title="Delete habit"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>

        <svg
          className="h-4 w-4 shrink-0 text-zinc-200 opacity-0 transition-all group-hover:opacity-100 dark:text-zinc-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>

        <button
          onClick={onToggle}
          disabled={isLoading}
          className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
            isLoading
              ? 'opacity-40 cursor-not-allowed border-zinc-300 dark:border-zinc-600'
              : done
                ? 'border-emerald-400 bg-emerald-400 text-white dark:border-emerald-500 dark:bg-emerald-500'
                : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-zinc-500'
          }`}
          aria-label={done ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {done && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium leading-tight transition-colors duration-200 ${
              done
                ? 'text-zinc-400 line-through dark:text-zinc-500'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {habit.name}
          </p>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {frequencyLabel(habit.frequency, habit.custom_frequency)}
          </span>
        </div>

        {done && (
          <span className="shrink-0 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
            ✓ Done
          </span>
        )}

        {userId && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void toggleHistory();
            }}
            onDragStart={(e) => e.preventDefault()}
            title={historyOpen ? 'Hide 30-day history' : 'Show 30-day history'}
            aria-label={`Toggle 30-day history for ${habit.name}`}
            aria-expanded={historyOpen}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all duration-200 ${
              historyOpen
                ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3v18h18" />
              <path d="M7 14h2v4H7z" />
              <path d="M11 10h2v8h-2z" />
              <path d="M15 6h2v12h-2z" />
            </svg>
          </button>
        )}
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          historyOpen ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
        }`}
        aria-hidden={!historyOpen}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <HabitHistory
          days={30}
          loading={historyLoading}
          error={historyError}
          data={historyData}
        />
      </div>
    </div>
  );
}

// ─── Habit History ────────────────────────────────────────────────

function HabitHistory({
  days,
  loading,
  error,
  data,
}: {
  days: number;
  loading: boolean;
  error: string | null;
  data: Array<{ date: string; completed: boolean }> | null;
}) {
  const cells = data ?? Array.from({ length: days });

  return (
    <div
      className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800"
      role="region"
      aria-label="Last 30 days of habit completion"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Last {days} days
        </span>
        {loading && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Loading…
          </span>
        )}
        {!loading && error && (
          <span className="text-[10px] text-red-500 dark:text-red-400">
            Failed to load
          </span>
        )}
      </div>

      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${days / 5}, minmax(0, 1fr))` }}
        role="grid"
      >
        {cells.map((cell, i) => {
          const isPlaceholder = !data;
          const completed = !isPlaceholder && cell.completed;
          return (
            <div
              key={isPlaceholder ? `ph-${i}` : cell.date}
              title={
                isPlaceholder
                  ? 'Loading…'
                  : `${cell.date}: ${cell.completed ? 'Completed' : 'Not completed'}`
              }
              aria-label={
                isPlaceholder
                  ? 'Loading'
                  : `${cell.date}: ${cell.completed ? 'completed' : 'not completed'}`
              }
              className={`aspect-square rounded-sm transition-colors ${
                isPlaceholder
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : completed
                    ? 'bg-emerald-400 dark:bg-emerald-500'
                    : 'bg-zinc-100 dark:bg-zinc-800'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
