/**
 * Flashback / Memory engine.
 *
 * "Flashbacks" are generated entirely client-side by querying the
 * weight_entries and workout_sets tables for the closest match within
 * ±14 days of an anchor date (e.g. "6 months ago"). This is a cheap
 * one-shot data scan and stays correct when users import back-dated
 * history later.
 *
 * Manual milestones live in `milestones` (kind = 'manual'). Auto
 * milestones detected by the engine are NOT persisted (yet); the UI
 * can compute and display them on demand.
 */
import { supabase } from '@/lib/supabase';
import type {
  Milestone,
  MilestoneKind,
  WorkoutSet,
  WeightEntry,
} from './types';
import {
  buildExerciseStats,
  estimated1RM,
  effectiveReps,
} from './strength';

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

/** Returns the user's bodyweight measurement closest to `targetISO`. */
export function nearestWeight(
  entries: WeightEntry[],
  targetISO: string,
): WeightEntry | null {
  if (entries.length === 0) return null;
  const targetMs = new Date(targetISO).getTime();
  let best: WeightEntry | null = null;
  let bestDelta = Infinity;
  for (const e of entries) {
    const d = Math.abs(new Date(e.recorded_at).getTime() - targetMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = e;
    }
  }
  return best;
}

/** Returns the user's top estimated-1RM set touching `targetISO` window. */
export function bestEstimated1RMInWindow(
  sets: WorkoutSet[],
  centerISO: string,
  windowDays = 14,
): { set: WorkoutSet; est: number; atISO: string } | null {
  if (sets.length === 0) return null;
  const centerMs = new Date(centerISO).getTime();
  const winMs = windowDays * 24 * 60 * 60 * 1000;
  const inWindow = sets.filter((s) => {
    const t = new Date(s.created_at).getTime();
    return Math.abs(t - centerMs) <= winMs;
  });
  if (inWindow.length === 0) return null;
  let best = inWindow[0];
  // Treat NULL reps as 1 so weight-only logs still surface as 1RM
  // lift candidates in flashback comparisons.
  let bestEst = estimated1RM(best.weight_kg, best.reps ?? 1);
  for (const s of inWindow) {
    const e = estimated1RM(s.weight_kg, s.reps ?? 1);
    if (e > bestEst) {
      best = s;
      bestEst = e;
    }
  }
  return { set: best, est: bestEst, atISO: best.created_at };
}

export interface FlashbackCard {
  anchorISO: string;
  anchorLabel: string;
  weight_then_kg: number | null;
  weight_now_kg: number | null;
  estimated_1rm_then: number | null;
  estimated_1rm_now: number | null;
  headline: string;
}

export function buildFlashbackCard(
  anchorISO: string,
  weightEntries: WeightEntry[],
  latestSets: WorkoutSet[],
  pastSets: WorkoutSet[],
): FlashbackCard {
  const then = nearestWeight(weightEntries, anchorISO);
  const now = weightEntries.length > 0
    ? [...weightEntries].sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
      )[0]
    : null;
  const thenLift = bestEstimated1RMInWindow(pastSets, anchorISO);
  const nowLift = bestEstimated1RMInWindow(latestSets, new Date().toISOString());

  const weightDelta = then && now ? Math.round((now.weight_kg - then.weight_kg) * 10) / 10 : null;
  const liftDelta =
    thenLift && nowLift
      ? Math.round((nowLift.est - thenLift.est) * 10) / 10
      : null;

  const anchorLabel = formatAnchorLabel(anchorISO);

  const parts: string[] = [];
  if (then && now && weightDelta !== null && weightDelta !== 0) {
    parts.push(`Weight ${arrowFor(weightDelta)} ${Math.abs(weightDelta).toFixed(1)}kg`);
  }
  if (thenLift && nowLift && liftDelta !== null && liftDelta !== 0) {
    parts.push(`Best lift ${arrowFor(liftDelta)} ${Math.abs(liftDelta).toFixed(1)}kg (1RM)`);
  }

  const headline =
    parts.length > 0
      ? `${anchorLabel}: ${parts.join(' · ')}`
      : `${anchorLabel}: not enough data yet — keep logging to unlock flashbacks.`;

  return {
    anchorISO,
    anchorLabel,
    weight_then_kg: then?.weight_kg ?? null,
    weight_now_kg: now?.weight_kg ?? null,
    estimated_1rm_then: thenLift ? Math.round(thenLift.est * 10) / 10 : null,
    estimated_1rm_now: nowLift ? Math.round(nowLift.est * 10) / 10 : null,
    headline,
  };
}

function arrowFor(delta: number): string {
  return delta > 0 ? '↑' : '↓';
}

function formatAnchorLabel(iso: string): string {
  const months = Math.round(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30),
  );
  if (months <= 0) return 'Today';
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/** Quarter-master function — returns a list of flashback cards at common intervals. */
export function buildFlashbacks(
  weightEntries: WeightEntry[],
  allSets: WorkoutSet[],
  intervals: Array<{ monthsAgo: number; label: string }> = [
    { monthsAgo: 1, label: '1 month ago' },
    { monthsAgo: 3, label: '3 months ago' },
    { monthsAgo: 6, label: '6 months ago' },
    { monthsAgo: 12, label: '1 year ago' },
  ],
): FlashbackCard[] {
  const cards: FlashbackCard[] = [];
  for (const iv of intervals) {
    const anchorISO = new Date(
      Date.now() - iv.monthsAgo * 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    cards.push(buildFlashbackCard(anchorISO, weightEntries, [], allSets));
  }
  return cards;
}

// ─── Manual milestones CRUD ──────────────────────────────────────

export async function listMilestones(
  userId: string | null,
  limit = 50,
): Promise<Milestone[]> {
  if (!userId) return [];
  return safeRun('listMilestones', async () => {
    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('user_id', userId)
      .order('achieved_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[fitness] listMilestones error:', error.message);
      return [];
    }
    return (data ?? []) as Milestone[];
  }, []);
}

export async function createMilestone(input: {
  user_id: string;
  kind: MilestoneKind;
  title: string;
  description?: string | null;
  achieved_at?: string;
  related_data?: Record<string, unknown> | null;
}): Promise<Milestone | null> {
  return safeRun('createMilestone', async () => {
    const { data, error } = await supabase
      .from('milestones')
      .insert({
        user_id: input.user_id,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        achieved_at: input.achieved_at ?? new Date().toISOString(),
        related_data: input.related_data ?? null,
      })
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] createMilestone error:', error.message);
      return null;
    }
    return data as Milestone;
  }, null);
}

export async function deleteMilestone(id: string): Promise<boolean> {
  return safeRun('deleteMilestone', async () => {
    const { error } = await supabase.from('milestones').delete().eq('id', id);
    if (error) {
      console.warn('[fitness] deleteMilestone error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Detect PR-level milestones for a Strength page banner card.
 * Returns e.g. "Bench Press: 75kg for 1 (PR)" for the most recent set
 * that beats any existing best at the same rep count.
 */
export interface RecentPR {
  exercise_name: string;
  weight_kg: number;
  reps: number;
  achieved_at: string;
}

export function detectRecentPRs(
  sets: WorkoutSet[],
  exercises: Array<{ id: string; name: string }>,
  sinceHours = 48,
): RecentPR[] {
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  const exMap = new Map(exercises.map((e) => [e.id, e.name]));
  const out: RecentPR[] = [];
  const seenPR = new Set<string>(); // dedupe (exerciseId, repCount)

  // Newest first.
  const sorted = [...sets].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // For each rep count / exercise: track the prior max weight.
  const priorMaxByExRep = new Map<string, number>();

  for (const s of sorted) {
    const er = effectiveReps(s.reps);
    const key = `${s.exercise_id}|${er}`;
    const prior = priorMaxByExRep.get(key);
    const newer = new Date(s.created_at).getTime() >= cutoff;
    if (newer && (prior === undefined || s.weight_kg > prior)) {
      const exName = exMap.get(s.exercise_id);
      if (exName && !seenPR.has(key)) {
        out.push({
          exercise_name: exName,
          weight_kg: s.weight_kg,
          // Use the effective rep count so the surfaced record is
          // always a number and the UI's `× {p.reps}` is never null.
          reps: er,
          achieved_at: s.created_at,
        });
        seenPR.add(key);
      }
    }
    // Update running max (we're iterating newest-first so we want
    // the OLDER prior; do nothing here, but on a second pass we want
    // the running max going backwards).
    const cur = priorMaxByExRep.get(key);
    if (cur === undefined || s.weight_kg > cur) priorMaxByExRep.set(key, s.weight_kg);
  }
  return out;
}

/** Convenience wrapper around buildExerciseStats for the latest set pulled. */
export const _internalBuildExerciseStats = buildExerciseStats;
