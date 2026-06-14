/**
 * ORION Energy Score (0–100) — recalculated for speed & insight.
 *
 * Computed in real-time from 4 simplified quick-log inputs:
 *
 *   Sleep     0–35  (avg nightly duration + quality over last 7 days)
 *   Training  0–25  (RPE balance — optimal effort = good, chronic high = drain)
 *   Nutrition 0–15  (daily calories + protein logged)
 *   Recovery  0–25  (energy - inverse(stress) - inverse(soreness))
 *
 * All sub-scores are clamped to their ranges, then summed (capped to 100).
 */

// ─── Input Types ────────────────────────────────────────────────────

export interface SleepData {
  sleep_start: string;
  sleep_end: string;
  quality: number;
}

export interface TrainingData {
  rpe: number;            // 1-10
  created_at: string;
}

export interface NutritionData {
  calories: number;
  protein_g: number;
  created_at: string;
}

export interface RecoveryData {
  energy_level: number;
  stress_level: number;
  soreness_level: number;
}

export interface EnergyScoreInputs {
  sleepHistory?: SleepData[] | null;
  recentTraining?: TrainingData[] | null;
  nutrition?: NutritionData | null;
  recovery?: RecoveryData | null;
}

// ─── Sub-score calculators ──────────────────────────────────────────

function sleepComponent(sleepLogs: SleepData[] | null | undefined): number {
  if (!sleepLogs || sleepLogs.length === 0) return 15; // neutral baseline

  // Average duration and quality across all available logs
  let totalDurationHours = 0;
  let totalQuality = 0;
  let count = 0;

  for (const log of sleepLogs) {
    const start = new Date(log.sleep_start).getTime();
    const end = new Date(log.sleep_end).getTime();
    const durationHours = Math.max(0, (end - start) / (1000 * 60 * 60));
    totalDurationHours += durationHours;
    totalQuality += log.quality;
    count++;
  }

  const avgDuration = totalDurationHours / count;
  const avgQuality = totalQuality / count;

  // Duration: 0–20 points, max at 8+ hours, penalty over 10h
  let durationScore: number;
  if (avgDuration >= 7 && avgDuration <= 9) {
    durationScore = 20; // sweet spot
  } else if (avgDuration < 7) {
    durationScore = (avgDuration / 7) * 20;
  } else {
    durationScore = Math.max(10, 20 - (avgDuration - 9) * 10); // over 9h = diminishing
  }

  // Quality: 0–15 points (1–10 scale)
  const qualityScore = (Math.min(Math.max(avgQuality, 1), 10) / 10) * 15;

  return Math.min(durationScore + qualityScore, 35);
}

function trainingComponent(trainings: TrainingData[] | null | undefined): number {
  if (!trainings || trainings.length === 0) return 12; // neutral baseline

  const now = Date.now();
  const last48h = now - 48 * 60 * 60 * 1000;
  const last7d = now - 7 * 24 * 60 * 60 * 1000;

  const recent48h = trainings.filter((t) => new Date(t.created_at).getTime() > last48h);
  const recent7d = trainings.filter((t) => new Date(t.created_at).getTime() > last7d);

  if (recent7d.length === 0) return 12;

  // Average RPE of recent sessions
  const avgRPE = recent7d.reduce((sum, t) => sum + t.rpe, 0) / recent7d.length;

  // Volume of training (number of sessions in last 7 days)
  const sessionCount = recent7d.length;
  const heavyCount = recent7d.filter((t) => t.rpe >= 8).length;

  // Score calculation:
  // - Optimal RPE range 5-7 → good
  // - Too high RPE (8+) without enough recovery → fatigue
  // - Too many heavy sessions → potential overtraining
  // - Recent heavy session in last 48h → temporary depression

  const rpeScore = Math.max(0, 10 - Math.abs(avgRPE - 6) * 2); // peak at RPE 6

  // Fatigue penalty from heavy sessions
  const heavyPenalty = Math.min(5, Math.max(0, heavyCount - 2) * 1.5);

  // Recency penalty: if heavy session in last 48h, reduce further
  const recencyPenalty = recent48h.some((t) => t.rpe >= 8) ? 3 : 0;

  // Session volume bonus: 3-5 sessions/week is optimal
  const volumeBonus =
    sessionCount >= 3 && sessionCount <= 6 ? 3
    : sessionCount >= 1 ? 1
    : 0;

  return Math.max(0, Math.min(rpeScore + volumeBonus - heavyPenalty - recencyPenalty, 25));
}

function nutritionComponent(nutrition: NutritionData | null | undefined): number {
  if (!nutrition) return 7; // neutral baseline

  // Calorie adequacy: assume 2000-2500 is maintenance for most
  // Score based on being reasonable (not starving, not binge)
  const cal = nutrition.calories;
  let calScore: number;
  if (cal >= 1800 && cal <= 3000) {
    calScore = 8; // good range
  } else if (cal >= 1200 && cal < 1800) {
    calScore = 4 + ((cal - 1200) / 600) * 4; // 4 → 8
  } else if (cal > 3000 && cal <= 4000) {
    calScore = 8 - ((cal - 3000) / 1000) * 4; // 8 → 4
  } else if (cal > 0 && cal < 1200) {
    calScore = Math.max(1, (cal / 1200) * 4); // 0 → 4
  } else {
    calScore = 0; // 0 calories logged = no data
  }

  // Protein: aim for 1.6-2.2g per kg — simplified: 100-200g is good
  const protein = nutrition.protein_g;
  let proteinScore: number;
  if (protein >= 100 && protein <= 250) {
    proteinScore = 7; // good
  } else if (protein >= 50 && protein < 100) {
    proteinScore = 3 + ((protein - 50) / 50) * 4; // 3 → 7
  } else if (protein > 250 && protein <= 350) {
    proteinScore = 7 - ((protein - 250) / 100) * 4; // 7 → 3
  } else if (protein > 0 && protein < 50) {
    proteinScore = Math.max(1, (protein / 50) * 3); // 0 → 3
  } else {
    proteinScore = 0;
  }

  return Math.min((calScore + proteinScore) / 2 * 2, 15); // scale up to 15 max
}

function recoveryComponent(recovery: RecoveryData | null | undefined): number {
  if (!recovery) return 12; // neutral baseline

  const energy = Math.min(Math.max(recovery.energy_level, 1), 10);
  const stress = Math.min(Math.max(recovery.stress_level, 1), 10);
  const soreness = Math.min(Math.max(recovery.soreness_level, 1), 10);

  // Recovery = energy + high inverse-stress + low soreness
  // All on 1-10 scale
  const energyPart = (energy / 10) * 9;
  const stressPart = ((10 - stress) / 10) * 8;
  const sorenessPart = ((10 - soreness) / 10) * 8;

  return Math.min(energyPart + stressPart + sorenessPart, 25);
}

// ─── Main computation ───────────────────────────────────────────────

/** @returns true if NO data has ever been logged for any category. */
export function hasAnyData(inputs: EnergyScoreInputs): boolean {
  return !!(
    (inputs.sleepHistory && inputs.sleepHistory.length > 0) ||
    (inputs.recentTraining && inputs.recentTraining.length > 0) ||
    inputs.nutrition ||
    inputs.recovery
  );
}

export function computeEnergyScore(inputs: EnergyScoreInputs): number {
  const safeInputs: EnergyScoreInputs = {
    sleepHistory: inputs.sleepHistory ?? [],
    recentTraining: inputs.recentTraining ?? [],
    nutrition: inputs.nutrition ?? null,
    recovery: inputs.recovery ?? null,
  };

  const sleep = sleepComponent(safeInputs.sleepHistory);
  const training = trainingComponent(safeInputs.recentTraining);
  const nutrition = nutritionComponent(safeInputs.nutrition);
  const recovery = recoveryComponent(safeInputs.recovery);

  const total = sleep + training + nutrition + recovery;
  return Math.round(Math.min(total, 100));
}

export interface EnergyScoreBreakdown {
  total: number;
  sleep: number;
  training: number;
  nutrition: number;
  recovery: number;
}

export function computeEnergyScoreBreakdown(
  inputs: EnergyScoreInputs,
): EnergyScoreBreakdown {
  const safeInputs: EnergyScoreInputs = {
    sleepHistory: inputs.sleepHistory ?? [],
    recentTraining: inputs.recentTraining ?? [],
    nutrition: inputs.nutrition ?? null,
    recovery: inputs.recovery ?? null,
  };

  return {
    total: computeEnergyScore(safeInputs),
    sleep: sleepComponent(safeInputs.sleepHistory),
    training: trainingComponent(safeInputs.recentTraining),
    nutrition: nutritionComponent(safeInputs.nutrition),
    recovery: recoveryComponent(safeInputs.recovery),
  };
}
