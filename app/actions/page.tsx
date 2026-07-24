'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import { getHabitCompletionHistory } from '@/lib/analytics';
import { EventTypes, logEvent } from '@/lib/events';
import HabitAnalytics from '@/components/habit-analytics';
import TodoList from '@/components/todo-list';
import CalendarPanel from '@/components/time-management/calendar-panel';

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
 * Time Management — static (non-scrolling) dashboard page that owns
 * "today".
 *
 * Shape:
 *   - Inline page header (~32 px): 🧭 emoji + "Time Management" title +
 *     today's date. No sticky chrome.
 *   - Single full-height grid:
 *       LEFT  — calendar panel (Day / Week / Month with drag-to-create
 *               and drag-to-move/resize events)
 *       RIGHT TOP   — habits card (sections, default-collapsed to fit
 *                     the viewport)
 *       RIGHT BOTTOM — to-dos card (overdue / today / tomorrow / upcoming)
 *
 * Latest tooling: CalendarPanel handles its own internal scroll for the
 * day timeline; the habits & to-dos cards also have their own
 * `flex-1 overflow-y-auto` so an expanded section or a long todo list
 * scrolls inside those cards. The page itself never produces a
 * scrollbar on a 900-px-tall viewport.
 */
export default function ActionsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // The page is statically laid out to fit the viewport without
  // page-level scroll. The previously-exposed Today | Plan |
  // Insights tab switcher has been retired; the bar that held those
  // tabs has been removed from the page header so the calendar +
  // habits + todos grid fills the viewport cleanly. Plan and Insights
  // surfaces remain in the codebase as future-tour placeholders but
  // are not currently reachable from this route.

  // Top-nav view — drives which main panel renders. Today still
  // keeps the page statically laid out (no page scroll); Plan and
  // Insights are reachable but render inside their own scroll
  // wrapper so they never push the page to scroll either.
  const [view, setView] = useState<View>('today');

  // Analytics refresh trigger / window — only meaningful while the
  // Insights view is mounted, but the state lives at the parent so
  // a habit toggle in Today view can stay alive when the user later
  // switches to Insights. We track whether Insights has ever been
  // mounted so we don't churn `analyticsKey` on routine Today-view
  // toggles for users who never visit Insights.
  const [analyticsKey, setAnalyticsKey] = useState(0);
  const [analyticsWindow, setAnalyticsWindow] = useState<7 | 14 | 30>(30);
  const insightsVisitedRef = useRef(false);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Track loading state per habit to prevent rapid double-submission
  const togglingRef = useRef<Set<string>>(new Set());

  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  // Habits sections: AT MOST ONE open at a time, default-collapsed. Stored
  // as the single `openSection` identifier so opening another section
  // atomically closes the previous one. Newly-arrived sections are
  // naturally closed because they don't match `openSection` until the
  // user clicks them — no ref-claim bookkeeping required.
  const [openSection, setOpenSection] = useState<string | null>(null);

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


  const now = useNow();
  const todayStr = now
    ? now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : '';

  // Mark Insights as "visited" the first time the user opens it, so
  // subsequent Today-view habit toggles start bumping `analyticsKey`
  // and the next visit to Insights shows fresh data. Lives in an
  // effect (not in the JSX render body) to keep React's
  // no-side-effects-during-render rule satisfied. Short-circuits
  // after the first visit so the effect is a true no-op on the
  // Today→Insights→Today back-and-forth.
  useEffect(() => {
    if (insightsVisitedRef.current) return;
    if (view === 'insights') insightsVisitedRef.current = true;
  }, [view]);

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
    if (insightsVisitedRef.current) setAnalyticsKey((k) => k + 1);
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

        if (insightsVisitedRef.current) setAnalyticsKey((k) => k + 1);
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
    // Drop the open-section pointer if it pointed at the deleted section,
    // so the next render doesn't try to expand a missing entry. Safe to
    // call even when `openSection` was already something else.
    setOpenSection((prev) => (prev === section ? null : prev));
  }

  function toggleSection(section: string) {
    // Single-active-section semantics: opening a section replaces any
    // previous open section in one atomic update. Toggling the same
    // section re-collapses it (openSection becomes null).
    setOpenSection((prev) => (prev === section ? null : section));
  }

  function completedToday(habitId: string): boolean {
    return completions.has(habitId);
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  return (
    // No more sticky top nav bar — the page header below the layout's
    // chrome is just a single inline row (~28 px). The result is a
    // fully static page: it never scrolls vertically because the
    // outer container is `overflow-hidden` and each child panel
    // (calendar, habits card, todos card) manages its own internal
    // scroll when its content exceeds its share of the viewport.
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* ── Inline page header (not sticky) ───────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-3 px-3 pt-2 pb-1.5 sm:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-base leading-none">🧭</span>
          <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Time Management
          </h1>
        </div>

        {/* View pills — compact, inline. On view === 'today' the page
            stays strictly non-scrolling. Plan / Insights render inside
            their own `overflow-y-auto` wrapper further down so neither
            of them makes the page itself scroll. */}
        <div
          role="group"
          aria-label="Switch view"
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 text-[11px] font-medium dark:bg-zinc-800/80"
        >
          {(['today', 'plan', 'insights'] as const).map((v) => {
            const label =
              v === 'today' ? 'Today' :
              v === 'plan'   ? 'Plan'  :
                               'Insights';
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={active}
                className={`rounded px-2 py-0.5 transition-colors duration-150 ${
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

        <div className="hidden text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500 sm:block">
          {/* Render a stable, non-time-dependent fallback during SSR/first
              paint so server markup matches client markup. Once useNow()
              reports a Date, the real formatted date swaps in. Hidden on
              tiny screens so the pills keep room. */}
          <span suppressHydrationWarning>{todayStr}</span>
        </div>
      </header>

      {/* ── View content ───────────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col overflow-hidden px-2 pb-2 sm:px-3">
        {view === 'today' && (
          <TodayView
            error={error}
            sectionOrder={sectionOrder}
            habits={habits}
            completions={completions}
            openSection={openSection}
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

        {/* Plan / Insights are wrapped in `h-full overflow-y-auto` so
            they scroll inside their own box and the page itself never
            grows a scrollbar. The inner scroll only works because
            <main> has `flex-1` (which produces a definite height
            from `app/layout.tsx`'s `min-h-0 flex-1 flex-col` wrapper);
            don't collapse that height or this scroll silently breaks. */}
        {view === 'plan' && (
          <div className="h-full w-full overflow-y-auto">
            <PlanPlaceholder />
          </div>
        )}

        {view === 'insights' && (
          <div className="h-full w-full overflow-y-auto">
            <InsightsView
              habits={habits}
              analyticsKey={analyticsKey}
              analyticsWindow={analyticsWindow}
              userId={userId}
              setAnalyticsWindow={setAnalyticsWindow}
            />
          </div>
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
  openSection: string | null;
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
  // Mutually-exclusive active module. The right column renders exactly
  // ONE module body (Habits or To-dos) at a time — when its body is
  // open the module takes `flex-1` and fills the right column; the
  // other module shrinks to its header bar (~36 px) so the page never
  // grows a vertical scrollbar. Default 'habits' so the section list
  // is on screen at first paint.
  return (
    // The grid inherits the height of the page (`h-full` from <main> +
    // `flex-1` from this div's parent). On desktop, both columns share
    // the full vertical space (`lg:items-stretch`), so the calendar
    // fills its half end-to-end and the right column splits Habits +
    // Todos evenly. On mobile the grid stacks vertically with each
    // child self-sized; the right column's `overflow-hidden` + each
    // card's `flex-1 overflow-y-auto` carry the same no-page-scroll
    // guarantee.
    <div className="grid h-full min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-stretch lg:gap-2">
      {/* LEFT — Calendar panel (largest area, per spec). Self-fetches.
          The wrapper itself is `h-full min-h-0` so the panel rides the
          column share independent of `items-stretch` drift. On mobile
          (grid-cols-1) it caps at 55 vh so the habits + todos below
          still have visible height; on `lg` the cap is removed and the
          panel fills the column. The panel's internal day-timeline
          scrolls inside its own `overflow-y-auto` container. */}
      <div className="h-full min-h-0 min-w-0 max-h-[55vh] lg:max-h-none">
        <CalendarPanel />
      </div>

      {/* RIGHT — Habits + To-dos stacked in the right column, but
          MUTUALLY EXCLUSIVE: only the currently-active module renders
          its body. Both module HEADERS stay always-visible (each
          ~36 px) so the user can swap with one click. At any moment
          either Habits is fully open (filling the right column) or
          To-dos is fully open — never both at the same time. The
          page itself never scrolls because each module manages its
          own internal scroll and the inactive one has no body. */}
      <div className="flex min-h-0 flex-col overflow-hidden">

        {/* Habits card — 50/50 stacked with the To-dos card below.
            Body is always rendered. The Add section button sits
            flush against the bottom of the section list (no
            internal mt-1 gap) so vertical space flows naturally
            into the To-dos card. At most ONE habit section is
            open at a time (openSection); the smooth expand/collapse
            animation lives inside SectionContainer. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              {/* Error banner — sits OUTSIDE the inner scroll wrapper
                  so it never shrinks the scroll viewport. Compact mb-2
                  keeps the banner tight on constrained viewports. */}
              {props.error && (
                <div className="mb-2 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                  {props.error}
                  <button
                    onClick={() => props.setError(null)}
                    className="ml-3 font-medium underline underline-offset-2 hover:no-underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Section-based Habits List — single column for compactness
                  in the right rail. min-h-0 flex-1 overflow-y-auto so an
                  expanded section scrolls INSIDE this card without ever
                  growing the page (the page never scrolls). AT MOST ONE
                  section is open at any time; opening another closes the
                  previous one. */}
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
            {props.sectionOrder.map((sectionName, idx) => {
              const grouped = props.groupHabitsBySection();
              const sectionHabits = grouped.get(sectionName) ?? [];
              const isCollapsed = props.openSection !== sectionName;
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

          {/* Add section button */}            <div className="flex items-center justify-center">
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

        {/* To-dos card — 50/50 stacked with the Habits card above.
            Body is always rendered. TodoList manages its own
            internal layout and scroll inside its grid of bucket
            rows; the wrapper just provides an outer overflow
            guard so a long task list scrolls inside this card
            rather than growing the page itself. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TodoList />
          </div>
        </div>
      </div>
    </div>
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
