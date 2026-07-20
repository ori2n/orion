'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import { EventTypes, logEvent } from '@/lib/events';
import HabitAnalytics from '@/components/habit-analytics';
import TodoList from '@/components/todo-list';

type Frequency = 'daily' | 'weekly' | 'custom';

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

/**
 * Helper: determine whether an error message indicates the Supabase
 * "JWT issued at future" clock-skew problem.
 *
 * Root cause: when the middleware (`proxy.ts`) freshly refreshes a
 * session via GoTrue, the browser immediately receives the new JWT.
 * Because GoTrue (Auth server) and PostgREST (Database server) sit
 * on different nodes with slightly drifting clocks, the just-issued
 * token's `iat` can still be "in the future" relative to PostgREST's
 * clock at the moment the very first database query lands. A short
 * delay is enough for the database clock to catch up — the token
 * itself is perfectly valid.
 */
function isFutureIatError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  // Match across known phrasings ("JWT issued at future", "in the future",
  // "future date", etc.) plus Postgres's "i_at" form, defensively.
  return (
    m.includes('jwt issued at future') ||
    m.includes('issued at future') ||
    m.includes('token is issued in the future')
  );
}

/** Retry delay (ms) after a "future iat" rejection. Tuned to outlast the
 *  typical Auth → DB clock drift observed on Supabase hosted infra. */
const FUTURE_IAT_RETRY_DELAY_MS = 750;
/** Max number of retry attempts before giving up. */
const FUTURE_IAT_MAX_RETRIES = 3;

/**
 * Retry a Supabase query up to FUTURE_IAT_MAX_RETRIES times if it fails
 * with the transient "JWT issued at future" clock-skew error.
 *
 * Hoisted to module scope (rather than declared inside `loadData`) so it
 * is allocated once. Accepts both `PromiseLike` and `Promise` returns
 * because Supabase query chains (`supabase.from(...).select(...).order(...)`)
 * resolve to a `PostgrestFilterBuilder` which is thenable but not a
 * full Promise — so we accept `PromiseLike<R> | Promise<R>`. Any other
 * error is returned unchanged so the existing UI error path still fires.
 */
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
      // Single warning per query per load — useful to confirm in DevTools
      // that the upstream Supabase drift is real vs. some other error.
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

type Tab = 'habits' | 'todo';

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

export default function ActionsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('habits');

  // Analytics refresh trigger
  const [analyticsKey, setAnalyticsKey] = useState(0);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Track loading state per habit to prevent rapid double-submission
  const togglingRef = useRef<Set<string>>(new Set());

  // Dynamic sections: built from tags in DB + Uncategorised
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());

  // Section collapse state (all expanded by default)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Which section has its inline add form open
  const [addingInSection, setAddingInSection] = useState<string | null>(null);
  // Inline add form state
  const [inlineName, setInlineName] = useState('');
  const [inlineFreq, setInlineFreq] = useState<Frequency>('daily');
  const [inlineCustomFreq, setInlineCustomFreq] = useState('');

  // New section creation
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  // Habit drag state
  const [draggedHabitId, setDraggedHabitId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);

  // Section drag state
  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Get current user for RLS-compatible queries
    const uid = await getCurrentUserId();
    setUserId(uid);

    // Fire queries in parallel.
    //
    // IMPORTANT: The very first load right after the middleware freshly
    // refreshed the session can race with PostgREST's clock on hosted
    // Supabase infra — the database side rejects the brand-new JWT with
    // "JWT issued at future" because its clock is fractionally behind
    // GoTrue's. A short retry after the drift resolves the issue without
    // any user-visible change. The retry is bounded so a real auth
    // failure still surfaces promptly.
    const [tagsResult, habitsResult, completionsResult] = await Promise.all([
      supabase.from('tags').select('*').order('created_at'),
      supabase.from('habits').select('*').order('created_at'),
      uid
        ? supabase.from('habit_completions').select('*').eq('user_id', uid).eq('completed_date', today())
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Re-run any query whose error is a "future iat" rejection. The retry
    // helper handles only the transient clock-skew rejection — every other
    // error falls through unchanged so the existing error UI still fires.
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

    // Merge loaded tags into section order
    const tagNames = new Set(loadedTags.map((t: Tag) => t.name));
    setSectionOrder((prev) => {
      // Keep existing order for known sections, add new tags at end, keep Uncategorised last
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

  useEffect(() => {
    let cancelled = false;
    loadData().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // ─── Grouping logic ────────────────────────────────────────────

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
    for (const name of sectionOrder) {
      grouped.set(name, []);
    }
    for (const habit of habits) {
      const section = getSectionForHabit(habit);
      if (grouped.has(section)) {
        grouped.get(section)!.push(habit);
      } else {
        // Fallback — section not in order yet
        grouped.set(section, [habit]);
      }
    }
    return grouped;
  }

  // ─── Inline add habit in a section ────────────────────────────

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

    if (data) {
      setHabits((prev) => [...prev, data as Habit]);
    }

    setInlineName('');
    setInlineFreq('daily');
    setInlineCustomFreq('');
    setAddingInSection(null);
  }

  // ─── Delete habit ─────────────────────────────────────────────

  async function deleteHabit(habitId: string) {
    // Optimistically remove from UI
    setHabits((prev) => prev.filter((h) => h.id !== habitId));

    // Remove related completions first to avoid FK issues
    const { error: completionsError } = await supabase
      .from('habit_completions')
      .delete()
      .eq('habit_id', habitId);

    if (completionsError) {
      setError(`Failed to delete habit completions: ${completionsError.message}`);
      // Reload habits to restore UI state
      void loadData();
      return;
    }

    const { error: deleteError } = await supabase
      .from('habits')
      .delete()
      .eq('id', habitId);

    if (deleteError) {
      setError(`Failed to delete habit: ${deleteError.message}`);
      void loadData();
      return;
    }

    setAnalyticsKey((k) => k + 1);
  }

  // ─── Toggle completion ────────────────────────────────────────

  async function toggleCompletion(habitId: string) {
    // Guard against rapid double-clicks
    if (togglingRef.current.has(habitId)) return;
    togglingRef.current.add(habitId);

    // Force re-render to show disabled state
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

  // ─── Habit drag-and-drop handlers ─────────────────────────────

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

    const targetTagId = getTagIdByName(targetSection);
    if (!targetTagId) {
      setDraggedHabitId(null);
      setDragOverSection(null);
      return;
    }

    setHabits((prev) =>
      prev.map((h) =>
        h.id === habitId ? { ...h, tag_id: targetTagId } : h,
      ),
    );

    const { error: updateError } = await supabase
      .from('habits')
      .update({ tag_id: targetTagId })
      .eq('id', habitId);

    if (updateError) {
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId ? { ...h, tag_id: habit.tag_id } : h,
        ),
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

  // ─── Section drag-and-drop reordering ─────────────────────────

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
      // Adjust target index if the removed item was before it
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

  // ─── Add / remove sections ────────────────────────────────────

  async function addSection() {
    const name = newSectionName.trim();
    if (!name || !userId) return;

    // Create a matching tag in the DB
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
        // Insert before Uncategorised
        const next = [...prev];
        const uncatIdx = next.indexOf('Uncategorised');
        if (uncatIdx >= 0) {
          next.splice(uncatIdx, 0, name);
        } else {
          next.push(name);
        }
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

    // Update habits that reference this tag to remove the tag_id
    const { error: updateError } = await supabase
      .from('habits')
      .update({ tag_id: null })
      .eq('tag_id', tag.id);

    if (updateError) {
      setError(`Failed to unlink habits from section: ${updateError.message}`);
      return;
    }

    // Delete the tag
    const { error: deleteError } = await supabase
      .from('tags')
      .delete()
      .eq('id', tag.id);

    if (deleteError) {
      setError(`Failed to delete section: ${deleteError.message}`);
      return;
    }

    // Update local state
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

  // ─── Collapse/expand ──────────────────────────────────────────

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  function completedToday(habitId: string): boolean {
    return completions.has(habitId);
  }

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Habits
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{todayStr}</p>
        </header>

        {/* Tab toggle */}
        <div className="mb-8 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          <button
            onClick={() => setActiveTab('habits')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${
              activeTab === 'habits'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            Habits
          </button>
          <button
            onClick={() => setActiveTab('todo')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${
              activeTab === 'todo'
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            To-do
          </button>
        </div>

        {/* Habits tab content */}
        {activeTab === 'habits' && (<>
        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 font-medium underline underline-offset-2 hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Section-based Habits List */}
        <div className="space-y-3">
          {sectionOrder.map((sectionName, idx) => {
            const grouped = groupHabitsBySection();
            const sectionHabits = grouped.get(sectionName) ?? [];
            const isCollapsed = collapsedSections.has(sectionName);
            const isDragOver = dragOverSection === sectionName;
            const isSectionDragged = draggedSection === sectionName;
            const isDragOverHere = dragOverSectionIdx === idx;
            const isUncategorised = sectionName === 'Uncategorised';

            return (
              <SectionContainer
                key={sectionName}
                sectionName={sectionName}
                emoji={getEmoji(sectionName)}
                isCollapsed={isCollapsed}
                isDragOver={isDragOver}
                isSectionDragged={isSectionDragged}
                isDragOverHere={isDragOverHere}
                isUncategorised={isUncategorised}
                pendingCount={sectionHabits.length}
                onToggle={() => toggleSection(sectionName)}
                onAddClick={() => {
                  setAddingInSection(addingInSection === sectionName ? null : sectionName);
                  setInlineName('');
                  setInlineFreq('daily');
                  setInlineCustomFreq('');
                }}
                onRemove={() => removeSection(sectionName)}
                onHabitDragOver={(e) => handleHabitDragOver(e, sectionName)}
                onHabitDragLeave={handleHabitDragLeave}
                onHabitDrop={(e) => handleHabitDrop(e, sectionName)}
                onSectionDragStart={(e) => handleSectionDragStart(e, sectionName)}
                onSectionDragOver={(e) => handleSectionDragOver(e, idx)}
                onSectionDrop={(e) => handleSectionDrop(e, idx)}
                onSectionDragEnd={handleSectionDragEnd}
              >
                {/* Inline add form */}
                {addingInSection === sectionName && (
                  <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        placeholder={`New habit in ${sectionName}...`}
                        value={inlineName}
                        onChange={(e) => setInlineName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addHabitToSection(sectionName);
                          if (e.key === 'Escape') setAddingInSection(null);
                        }}
                        className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <select
                          value={inlineFreq}
                          onChange={(e) => setInlineFreq(e.target.value as Frequency)}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="custom">Custom</option>
                        </select>
                        {inlineFreq === 'custom' && (
                          <input
                            type="text"
                            placeholder="e.g. 3x/week"
                            value={inlineCustomFreq}
                            onChange={(e) => setInlineCustomFreq(e.target.value)}
                            className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                          />
                        )}
                        <button
                          onClick={() => addHabitToSection(sectionName)}
                          disabled={!inlineName.trim()}
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
                  <div className="space-y-1.5 p-3">
                    {sectionHabits.length === 0 ? (
                      <div
                        className={`flex items-center justify-center rounded-lg border-2 border-dashed py-8 transition-colors duration-200 ${
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
                        const done = completedToday(habit.id);
                        const isDragging = draggedHabitId === habit.id;
                        return (
                          <HabitCard
                            key={habit.id}
                            habit={habit}
                            done={done}
                            isDragging={isDragging}
                            onToggle={() => toggleCompletion(habit.id)}
                            onDelete={() => deleteHabit(habit.id)}
                            onDragStart={(e) => handleHabitDragStart(e, habit.id)}
                            onDragEnd={handleHabitDragEnd}
                            isLoading={togglingRef.current.has(habit.id)}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </SectionContainer>
            );
          })}

          {/* Add section button */}
          <div className="flex items-center justify-center pt-1">
            {showNewSection ? (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <input
                  type="text"
                  placeholder="Section name..."
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addSection();
                    if (e.key === 'Escape') { setShowNewSection(false); setNewSectionName(''); }
                  }}
                  className="w-40 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
                  autoFocus
                />
                <button
                  onClick={addSection}
                  disabled={!newSectionName.trim()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowNewSection(false); setNewSectionName(''); }}
                  className="text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewSection(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add section
              </button>
            )}
          </div>
        </div>

        {/* Analytics section — auto-refreshes on completion toggle */}
        {habits.length > 0 && <HabitAnalytics refreshKey={analyticsKey} userId={userId} />}
        </>)}

        {/* To-do tab content */}
        {activeTab === 'todo' && (
          <TodoList />
        )}
      </div>
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
  // ─── Swipe-to-delete state ───────────────────────────────────
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0); // 0-1, for visual feedback during hold
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const isSwiping = useRef(false);
  const swipedRef = useRef(false);
  const holdArmed = useRef(false);       // true after hold threshold is reached
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

    // Start hold timer — updates progress every ~50ms for visual feedback
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
      // If the finger moves too much before the hold completes, cancel the hold
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

    // Only start swiping once horizontal movement dominates (avoids vertical jitter)
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
  const deleteReveal = Math.min(swipeOffset / 120, 1); // 0 → 1 as swipe progresses

  return (
    <div
      onDragOver={onHabitDragOver}
      onDragLeave={onHabitDragLeave}
      onDrop={onHabitDrop}
      className={`relative overflow-hidden rounded-xl border shadow-sm transition-all duration-200 ${
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
      {/* Swipe delete background */}
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

      {/* Swipeable content */}
      <div
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping.current ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {/* Header — swipe gesture lives here to avoid interfering with habit cards */}
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
          className={`relative flex cursor-pointer items-center justify-between border-b border-zinc-200 px-4 py-3 transition-colors duration-200 dark:border-zinc-700 ${
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

          {/* Hold progress bar — appears after ~100ms as user holds */}
          {holdProgress > 0.15 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-red-400/60 transition-all duration-[50ms] dark:bg-red-500/60"
                style={{ width: `${holdProgress * 100}%` }}
              />
            </div>
          )}

          {/* Hold hint text — subtle nudge on first 15% of hold */}
          {holdProgress > 0 && holdProgress < 0.5 && (
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium tracking-wider text-zinc-300 dark:text-zinc-600"
              style={{ opacity: Math.max(0, 0.6 - holdProgress) }}
            >
              HOLD TO DELETE
            </span>
          )}
        </div>

        {/* Collapsible body */}
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
}: {
  habit: Habit;
  done: boolean;
  isDragging: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isLoading: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group cursor-grab rounded-lg border p-3 transition-all duration-200 active:cursor-grabbing ${
        done
          ? 'border-zinc-200 bg-white opacity-70 dark:border-zinc-700 dark:bg-zinc-900'
          : 'border-zinc-200 bg-white shadow-sm hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900'
      } ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-zinc-400 dark:ring-zinc-500' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Delete habit button */}
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

        {/* Drag handle */}
        <svg
          className="h-4 w-4 shrink-0 text-zinc-200 opacity-0 transition-all group-hover:opacity-100 dark:text-zinc-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>

        {/* Checkbox */}
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

        {/* Content */}
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

        {/* Completed badge */}
        {done && (
          <span className="shrink-0 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
            ✓ Done
          </span>
        )}
      </div>
    </div>
  );
}
