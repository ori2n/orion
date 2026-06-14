/**
 * ORION Insights — answer the 4 core questions from raw data.
 *
 * 1. What affects energy?   — correlation between sleep/training/nutrition/recovery
 * 2. Am I recovering?       — sleep trend, RPE trend, recovery score trend
 * 3. Am I progressing?      — training volume/weight trend, PRs
 * 4. Am I gaining weight?   — bodyweight trend, calorie vs protein trend
 */
import type { SleepLog, WorkoutLog, NutritionLog, RecoveryLog, PhysiqueLog } from './storage';
import { computeEnergyScoreBreakdown } from './energy-score';

// ─── Helpers ────────────────────────────────────────────────────────

export function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmtDurationShort(ms: number): string {
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.round((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h${m}m`;
}

// ─── Question 1: What affects energy? ──────────────────────────────

export interface EnergyFactors {
  /** Latest energy score (0-100) */
  score: number;
  /** Breakdown by pillar */
  breakdown: {
    sleep: number;
    training: number;
    nutrition: number;
    recovery: number;
  };
  /** The single biggest drag factor (lowest contributor) */
  limitingFactor: { factor: string; score: number; max: number } | null;
  /** Trend direction */
  trend: 'up' | 'down' | 'stable';
}

/**
 * Analyzes what's affecting energy by comparing each pillar's
 * contribution against its maximum possible score.
 */
export function analyzeEnergyFactors(
  sleepLogs: SleepLog[],
  trainingLogs: WorkoutLog[],
  nutritionLog: NutritionLog | null,
  recoveryLog: RecoveryLog | null,
): EnergyFactors {
  // Use the canonical energy score computation from energy-score.ts
  const breakDown = computeEnergyScoreBreakdown({
    sleepHistory: sleepLogs,
    recentTraining: trainingLogs,
    nutrition: nutritionLog,
    recovery: recoveryLog
      ? {
          energy_level: recoveryLog.energy_level,
          stress_level: recoveryLog.stress_level,
          soreness_level: recoveryLog.soreness_level,
        }
      : null,
  });

  // Find limiting factor
  const factors = [
    { factor: 'Sleep', score: breakDown.sleep, max: 35 },
    { factor: 'Training', score: breakDown.training, max: 25 },
    { factor: 'Nutrition', score: breakDown.nutrition, max: 15 },
    { factor: 'Recovery', score: breakDown.recovery, max: 25 },
  ];
  const scored = factors.map((f) => ({ ...f, pct: f.score / f.max })).sort((a, b) => a.pct - b.pct);
  const limitingFactor = scored.length > 0 && scored[0].pct < 0.5
    ? { factor: scored[0].factor, score: scored[0].score, max: scored[0].max }
    : null;

  // Trend: compare first half vs second half of sleep logs
  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (sleepLogs.length >= 4) {
    const sorted = [...sleepLogs].sort(
      (a, b) => new Date(a.sleep_start).getTime() - new Date(b.sleep_start).getTime(),
    );
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = avg(sorted.slice(0, mid).map((l) => l.quality));
    const secondHalf = avg(sorted.slice(mid).map((l) => l.quality));
    if (secondHalf > firstHalf + 0.5) trend = 'up';
    else if (secondHalf < firstHalf - 0.5) trend = 'down';
  }

  return {
    score: breakDown.total,
    breakdown: {
      sleep: Math.round(breakDown.sleep),
      training: Math.round(breakDown.training),
      nutrition: Math.round(breakDown.nutrition),
      recovery: Math.round(breakDown.recovery),
    },
    limitingFactor,
    trend,
  };
}

// ─── Question 2: Am I recovering? ──────────────────────────────────

export interface RecoveryInsight {
  /** Average sleep duration over the period */
  avgSleepDuration: string;
  /** Average sleep quality */
  avgSleepQuality: number;
  /** Sleep duration trend (comparing recent vs older) */
  sleepDurationTrend: 'up' | 'down' | 'stable';
  /** Sleep quality trend */
  sleepQualityTrend: 'up' | 'down' | 'stable' | 'insufficient_data';
  /** Average RPE over the period (lower = recovering) */
  avgRPE: number;
  /** Average recovery score (energy - stress - soreness) */
  avgRecoveryScore: number;
  /** Recovery trend */
  recoveryTrend: 'up' | 'down' | 'stable' | 'insufficient_data';
  /** Overall verdict */
  verdict: 'recovering' | 'maintaining' | 'declining';
}

export function analyzeRecovery(
  sleepLogs: SleepLog[],
  trainingLogs: WorkoutLog[],
  recoveryLogs: RecoveryLog[],
): RecoveryInsight {
  // Sleep analysis
  let avgSleepDuration = '--';
  let avgSleepQuality = 0;
  let sleepDurationTrend: 'up' | 'down' | 'stable' = 'stable';
  let sleepQualityTrend: 'up' | 'down' | 'stable' | 'insufficient_data' = 'insufficient_data';

  if (sleepLogs.length > 0) {
    const durations = sleepLogs.map(
      (l) => new Date(l.sleep_end).getTime() - new Date(l.sleep_start).getTime(),
    );
    avgSleepDuration = fmtDurationShort(avg(durations));
    avgSleepQuality = Math.round(avg(sleepLogs.map((l) => l.quality)) * 10) / 10;

    if (sleepLogs.length >= 4) {
      const sorted = [...sleepLogs].sort(
        (a, b) => new Date(a.sleep_start).getTime() - new Date(b.sleep_start).getTime(),
      );
      const mid = Math.floor(sorted.length / 2);

      const firstHalfDur = avg(sorted.slice(0, mid).map(
        (l) => new Date(l.sleep_end).getTime() - new Date(l.sleep_start).getTime(),
      ));
      const secondHalfDur = avg(sorted.slice(mid).map(
        (l) => new Date(l.sleep_end).getTime() - new Date(l.sleep_start).getTime(),
      ));
      sleepDurationTrend = secondHalfDur > firstHalfDur + 15 * 60 * 1000 ? 'up'
        : secondHalfDur < firstHalfDur - 15 * 60 * 1000 ? 'down'
        : 'stable';

      const firstHalfQual = avg(sorted.slice(0, mid).map((l) => l.quality));
      const secondHalfQual = avg(sorted.slice(mid).map((l) => l.quality));
      sleepQualityTrend = secondHalfQual > firstHalfQual + 0.5 ? 'up'
        : secondHalfQual < firstHalfQual - 0.5 ? 'down'
        : 'stable';
    }
  }

  // RPE analysis
  const avgRPE = trainingLogs.length > 0
    ? Math.round(avg(trainingLogs.map((l) => l.rpe)) * 10) / 10
    : 0;

  // Recovery analysis
  let avgRecoveryScore = 0;
  let recoveryTrend: 'up' | 'down' | 'stable' | 'insufficient_data' = 'insufficient_data';

  if (recoveryLogs.length > 0) {
    const scores = recoveryLogs.map((l) =>
      (l.energy_level + (10 - l.stress_level) + (10 - l.soreness_level)) / 3,
    );
    avgRecoveryScore = Math.round(avg(scores) * 10) / 10;

    if (scores.length >= 3) {
      const mid = Math.floor(scores.length / 2);
      const firstHalf = avg(scores.slice(0, mid));
      const secondHalf = avg(scores.slice(mid));
      recoveryTrend = secondHalf > firstHalf + 0.5 ? 'up'
        : secondHalf < firstHalf - 0.5 ? 'down'
        : 'stable';
    }
  }

  // Overall verdict
  const recoveringConditions = [
    sleepQualityTrend === 'up',
    sleepDurationTrend === 'up',
    recoveryTrend === 'up',
    avgSleepQuality >= 7,
    avgRecoveryScore >= 6,
  ];
  const goodCount = recoveringConditions.filter(Boolean).length;
  const verdict = goodCount >= 4 ? 'recovering'
    : goodCount >= 2 ? 'maintaining'
    : 'declining';

  return {
    avgSleepDuration,
    avgSleepQuality,
    sleepDurationTrend,
    sleepQualityTrend,
    avgRPE,
    avgRecoveryScore,
    recoveryTrend,
    verdict,
  };
}

// ─── Question 3: Am I progressing? ─────────────────────────────────

export interface ProgressInsight {
  /** Total workouts logged in period */
  totalWorkouts: number;
  /** Total exercises logged */
  totalExercises: number;
  /** Average RPE over period */
  avgRPE: number;
  /** Best weight lifted per exercise */
  personalRecords: { exercise: string; weight: number; reps: number }[];
  /** Progress indicator */
  verdict: 'progressing' | 'maintaining' | 'stalled';
}

export function analyzeProgress(trainingLogs: WorkoutLog[]): ProgressInsight {
  if (trainingLogs.length === 0) {
    return {
      totalWorkouts: 0,
      totalExercises: 0,
      avgRPE: 0,
      personalRecords: [],
      verdict: 'stalled',
    };
  }

  // Group by exercise to find PRs
  const exerciseMap = new Map<string, { weight: number; reps: number }>();
  for (const log of trainingLogs) {
    const exName = log.exercise.toLowerCase();
    const existing = exerciseMap.get(exName);
    const bestWeight = log.weight_lbs ?? 0;
    if (!existing || bestWeight > existing.weight) {
      exerciseMap.set(exName, { weight: bestWeight, reps: log.reps ?? 0 });
    }
  }

  const personalRecords = Array.from(exerciseMap.entries())
    .map(([exercise, data]) => ({ exercise, ...data }))
    .filter((pr) => pr.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const uniqueExercises = new Set(trainingLogs.map((l) => l.exercise.toLowerCase()));
  const avgRPE = Math.round(avg(trainingLogs.map((l) => l.rpe)) * 10) / 10;

  // Verdict: if they have recent PRs and training consistently, they're progressing
  const verdict = personalRecords.length >= 2 && trainingLogs.length >= 5
    ? 'progressing'
    : trainingLogs.length >= 3
    ? 'maintaining'
    : 'stalled';

  return {
    totalWorkouts: trainingLogs.length,
    totalExercises: uniqueExercises.size,
    avgRPE,
    personalRecords,
    verdict,
  };
}

// ─── Question 4: Am I gaining weight? ──────────────────────────────

export interface WeightInsight {
  /** Latest bodyweight */
  currentWeight: number | null;
  /** Weight change over the period */
  weightChange: number | null;
  /** Weight change direction */
  trend: 'gaining' | 'losing' | 'stable' | 'insufficient_data';
  /** Average daily calories */
  avgCalories: number;
  /** Average daily protein */
  avgProtein: number;
  /** Nutrition status */
  nutritionStatus: 'surplus' | 'deficit' | 'maintenance' | 'insufficient_data';
}

export function analyzeWeight(
  physiqueLogs: PhysiqueLog[],
  nutritionLogs: NutritionLog[],
): WeightInsight {
  // Weight analysis
  const weightLogs = physiqueLogs
    .filter((l) => l.bodyweight != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const currentWeight = weightLogs.length > 0
    ? Number(weightLogs[weightLogs.length - 1].bodyweight)
    : null;

  let weightChange: number | null = null;
  let trend: 'gaining' | 'losing' | 'stable' | 'insufficient_data' = 'insufficient_data';

  if (weightLogs.length >= 2) {
    const first = Number(weightLogs[0].bodyweight);
    const last = Number(weightLogs[weightLogs.length - 1].bodyweight);
    weightChange = Math.round((last - first) * 10) / 10;
    trend = weightChange > 0.5 ? 'gaining'
      : weightChange < -0.5 ? 'losing'
      : 'stable';
  }

  // Nutrition analysis
  const avgCalories = nutritionLogs.length > 0
    ? Math.round(avg(nutritionLogs.map((l) => l.calories)))
    : 0;
  const avgProtein = nutritionLogs.length > 0
    ? Math.round(avg(nutritionLogs.map((l) => l.protein_g)))
    : 0;

  let nutritionStatus: 'surplus' | 'deficit' | 'maintenance' | 'insufficient_data';
  if (nutritionLogs.length === 0) {
    nutritionStatus = 'insufficient_data';
  } else if (avgCalories > 2500) {
    nutritionStatus = 'surplus';
  } else if (avgCalories < 1800) {
    nutritionStatus = 'deficit';
  } else {
    nutritionStatus = 'maintenance';
  }

  return {
    currentWeight,
    weightChange,
    trend,
    avgCalories,
    avgProtein,
    nutritionStatus,
  };
}
