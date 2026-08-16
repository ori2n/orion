import { readFileSync } from 'node:fs';
import { parseHevyCsv } from '../lib/fitness/hevy/parser.ts';
import {
  setVolumeKg,
  estimate1RM,
  isoWeekKey,
  addWeeks,
} from '../lib/fitness/hevy/calc.ts';
import {
  DEFAULT_EXERCISE_MUSCLES,
  MUSCLES,
} from '../lib/fitness/hevy/muscle-data.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// ── 1. Pure function unit checks ───────────────────────────────────
console.log('=== Pure function checks ===');
check('estimate1RM(100, 5)', estimate1RM(100, 5), 116.7);
check('estimate1RM(100, 12) reps clamped', estimate1RM(100, 12), 133.3);
check('estimate1RM(null, 5) → null', estimate1RM(null, 5), null);
check('estimate1RM(100, null) → null', estimate1RM(100, null), null);
check('setVolumeKg(70, 8)', setVolumeKg(70, 8), 560);
check('setVolumeKg(null, 8) → 0', setVolumeKg(null, 8), 0);
check('isoWeekKey(Sun 16 Aug 2026 UTC)', isoWeekKey(new Date('2026-08-16T18:23:00Z')), '2026-08-10');
check('addWeeks(2026-08-10, +1)', addWeeks('2026-08-10', 1), '2026-08-17');

// ── 2. Mapping completeness vs the real data ───────────────────────
console.log('\n=== Mapping completeness ===');
const { workouts } = parseHevyCsv(readFileSync('lib/workout_data (1).csv', 'utf8'));
const names = new Set();
for (const w of workouts) for (const e of w.exercises) names.add(e.name);
const missing = [...names].filter((n) => DEFAULT_EXERCISE_MUSCLES[n] === undefined).sort();
const extra = Object.keys(DEFAULT_EXERCISE_MUSCLES).filter((k) => !names.has(k)).sort();
console.log(`distinct exercises in export: ${names.size}`);
console.log(`unmapped (not in default map): ${missing.length}`);
if (missing.length) console.log('  MISSING:', missing);
console.log(`map entries not in data: ${extra.length}`);
if (extra.length) console.log('  EXTRA:', extra);
check('every exercise has a default muscle', missing.length, 0);

// ── 3. Engine output cross-check (same pure fn + map the engine uses) ──
console.log('\n=== Engine cross-check (from CSV; DB == CSV already proven) ===');
const heaviest = new Map();
let totalVolume = 0;
let totalSets = 0;
const muscleSets = new Map();
const muscleWeeks = new Map(); // muscle -> Set(week)
for (const w of workouts) {
  for (const e of w.exercises) {
    const muscle = DEFAULT_EXERCISE_MUSCLES[e.name] ?? 'Unmapped';
    for (const s of e.sets) {
      totalSets++;
      totalVolume += setVolumeKg(s.weightKg, s.reps);
      if (s.weightKg !== null) {
        const cur = heaviest.get(e.name) ?? -1;
        if (s.weightKg > cur) heaviest.set(e.name, s.weightKg);
      }
      muscleSets.set(muscle, (muscleSets.get(muscle) ?? 0) + 1);
      if (w.startTime) {
        const wk = isoWeekKey(w.startTime);
        const set = muscleWeeks.get(muscle) ?? new Set();
        set.add(wk);
        muscleWeeks.set(muscle, set);
      }
    }
  }
}
console.log(`total volume: ${Math.round(totalVolume).toLocaleString()} kg`);
console.log(`total sets  : ${totalSets}`);
console.log(`heaviest weight examples:`);
for (const n of ['Squat (Barbell)', 'Bench Press (Barbell)', 'Lat Pulldown (Machine)', 'Shoulder Press (Dumbbell)']) {
  console.log(`  ${n}: ${heaviest.get(n)} kg`);
}
console.log(`\nper-muscle sets (active weeks):`);
for (const m of [...MUSCLES, 'Unmapped']) {
  if (!muscleSets.has(m)) continue;
  const weeks = muscleWeeks.get(m)?.size ?? 0;
  console.log(`  ${m.padEnd(12)} sets=${String(muscleSets.get(m)).padStart(4)}  active-weeks=${weeks}`);
}
check('total sets matches export', totalSets, 815);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
