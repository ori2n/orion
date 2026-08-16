/**
 * Hevy CSV parser — pure functions, no Supabase / React imports.
 *
 * Parses a Hevy CSV export into workouts → exercises → sets. Designed to
 * be idempotent-friendly: it does NOT generate ids or talk to the
 * database; it only turns text into a stable, ordered structure.
 *
 * The Hevy export is a standard CSV where every row is one set. Fields
 * are quoted (start_time contains a comma, e.g. "16 Aug 2026, 19:23").
 */
import type {
  HevyExercise,
  HevyParseResult,
  HevySet,
  HevyWorkout,
} from './types';

/** Minimal RFC-4180 CSV reader (quoted fields, escaped quotes, \r\n). */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // Skip — part of a \r\n pair.
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop a trailing empty row produced by a final newline.
  while (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop();
  }

  return rows;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** Parse "16 Aug 2026, 19:23" into a local-time Date (null if malformed). */
export function parseHevyDateTime(raw: string): Date | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  const d = new Date(+m[3], month, +m[1], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

const toStr = (v: string | undefined): string | null => {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const toNum = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const toInt = (v: string | undefined): number | null => {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
};

const REQUIRED_COLUMNS = ['title', 'start_time', 'end_time', 'exercise_title', 'set_index'];

/**
 * Parse a Hevy CSV export into workouts.
 *
 * Rows for the same workout are contiguous in the export, so a new
 * workout starts whenever (title, start_time) changes. Within a workout,
 * a new exercise block starts whenever the exercise title changes — which
 * preserves an exercise that appears in two separate blocks of the same
 * workout rather than silently merging them.
 */
export function parseHevyCsv(text: string): HevyParseResult {
  const warnings: string[] = [];
  const rows = parseCsv(text);

  if (rows.length === 0) {
    return { workouts: [], warnings: ['The file is empty.'] };
  }

  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const missing = REQUIRED_COLUMNS.filter((n) => col(n) === -1);
  if (missing.length > 0) {
    return {
      workouts: [],
      warnings: [
        `Missing required column(s): ${missing.join(', ')}. ` +
          'Is this a Hevy CSV export?',
      ],
    };
  }

  const c = {
    title: col('title'),
    start: col('start_time'),
    end: col('end_time'),
    description: col('description'),
    exercise: col('exercise_title'),
    superset: col('superset_id'),
    notes: col('exercise_notes'),
    setIndex: col('set_index'),
    setType: col('set_type'),
    weight: col('weight_kg'),
    reps: col('reps'),
    distance: col('distance_km'),
    duration: col('duration_seconds'),
    rpe: col('rpe'),
  };

  const workouts: HevyWorkout[] = [];
  let current: HevyWorkout | null = null;
  let currentExercise: HevyExercise | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = (row[c.title] ?? '').trim();
    const start = (row[c.start] ?? '').trim();
    const end = (row[c.end] ?? '').trim();
    const exercise = (row[c.exercise] ?? '').trim();

    // Ignore fully-blank lines.
    if (title === '' && start === '' && exercise === '') continue;

    if (!current || current.sourceStartTime !== start || current.title !== (title || null)) {
      current = {
        title: title === '' ? null : title,
        description: toStr(row[c.description]),
        sourceStartTime: start,
        sourceEndTime: end,
        startTime: start === '' ? null : parseHevyDateTime(start),
        endTime: end === '' ? null : parseHevyDateTime(end),
        exercises: [],
      };
      workouts.push(current);
      currentExercise = null;
    }

    if (exercise === '') {
      warnings.push(
        `Skipped a row with no exercise title (workout "${title}", ${start}).`,
      );
      continue;
    }

    if (!currentExercise || currentExercise.name !== exercise) {
      currentExercise = {
        name: exercise,
        supersetId: toInt(row[c.superset]),
        notes: toStr(row[c.notes]),
        orderIndex: current.exercises.length,
        sets: [],
      };
      current.exercises.push(currentExercise);
    }

    const set: HevySet = {
      setIndex: toInt(row[c.setIndex]) ?? 0,
      setType: toStr(row[c.setType]),
      weightKg: toNum(row[c.weight]),
      reps: toInt(row[c.reps]),
      distanceKm: toNum(row[c.distance]),
      durationSeconds: toInt(row[c.duration]),
      rpe: toNum(row[c.rpe]),
    };
    currentExercise.sets.push(set);
  }

  return { workouts, warnings };
}

// ─── Content fingerprinting (change detection) ─────────────────────

/** FNV-1a 32-bit hash, returned as 8 lowercase hex chars. */
export function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable, order-preserving fingerprint of a parsed workout. */
export function computeWorkoutContentHash(workout: HevyWorkout): string {
  const parts: string[] = [];
  for (const ex of workout.exercises) {
    parts.push(`E:${ex.name}|${ex.supersetId ?? ''}|${ex.notes ?? ''}`);
    for (const s of ex.sets) {
      parts.push(
        `S:${s.setIndex}|${s.setType ?? ''}|${s.weightKg ?? ''}|${s.reps ?? ''}|` +
          `${s.distanceKm ?? ''}|${s.durationSeconds ?? ''}|${s.rpe ?? ''}`,
      );
    }
  }
  const canonical = parts.join('\n');
  // Two differently-seeded passes → ~64 bits of collision resistance.
  return fnv1a32(canonical) + fnv1a32(canonical.split('').reverse().join(''));
}
