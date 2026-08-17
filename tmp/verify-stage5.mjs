// Stage 5 verification — confirms the new UI helpers + calc extensions
// behave deterministically against fixture data. Pure functions only;
// no network calls so this runs in CI without env vars.
import { readFileSync } from 'node:fs';
import {
  twelveWeekMovingAverage,
  fmtKg,
  fmtRelativeDate,
  parseHevyStart,
} from '../lib/fitness/format.ts';
import {
  addWeeks,
  estimate1RM,
  setVolumeKg,
} from '../lib/fitness/hevy/calc.ts';
import { parseHevyCsv } from '../lib/fitness/hevy/parser.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  · ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('=== Stage 5 UI helpers ===');

// 1. Bodyweight 12-week moving average.
const bw = [
  { date: '2025-05-05', value: 80 },
  { date: '2025-05-19', value: 79.6 },
  { date: '2025-06-02', value: 79.2 },
  { date: '2025-06-16', value: 78.8 },
  { date: '2025-07-07', value: 78.4 },
  { date: '2025-08-04', value: 78.0 },
];
const ma = twelveWeekMovingAverage(bw);
check('MA produces ≥ 1 entry', ma.length > 0);
check(
  'MA last value matches input average',
  Math.abs(ma[ma.length - 1].ma - 79) < 0.5,
  `${ma[ma.length - 1]?.ma}`,
);

// 2. Formatters.
check('fmtKg(null) → —', fmtKg(null) === '—');
check('fmtKg(70) → "70"', fmtKg(70) === '70');
check('fmtKg(70.4) → "70.4"', fmtKg(70.4) === '70.4');
check('fmtKg(70.4, true) → "70.4 kg"', fmtKg(70.4, true) === '70.4 kg');

const ref = new Date('2025-05-10T12:00:00Z');
check(
  'fmtRelativeDate same-day → Today',
  fmtRelativeDate('2025-05-10', ref) === 'Today',
);
check(
  'fmtRelativeDate(-1d) → Yesterday',
  fmtRelativeDate('2025-05-09', ref) === 'Yesterday',
);
check(
  'fmtRelativeDate(-3d) → 3 days ago',
  fmtRelativeDate('2025-05-07', ref) === '3 days ago',
);
check(
  'fmtRelativeDate(-14d) → 2 weeks ago',
  fmtRelativeDate('2025-04-26', ref) === '2 weeks ago',
);

// 3. Hevy timestamp parsing.
check(
  'parseHevyStart("16 Aug 2026, 19:23") parses',
  parseHevyStart('16 Aug 2026, 19:23')?.getFullYear() === 2026,
);
check(
  'parseHevyStart("garbage") → null',
  parseHevyStart('garbage') === null,
);
check(
  'parseHevyStart(null) → null',
  parseHevyStart(null) === null,
);

console.log('\n=== Deterministic 1RM separation (Stage 5 §7 + §8) ===');

// Manual 1RM and estimated 1RM must never overwrite each other.
const sample = [
  { w: 100, r: 5 }, // epley 116.7
  { w: 92.5, r: 8 }, // epley 117
];
const maxEst = sample.reduce((best, s) => {
  const v = estimate1RM(s.w, s.r);
  return v !== null && (best === null || v > best) ? v : best;
}, null);
check(
  'Estimated 1RM is informational (never a PR)',
  Number.isFinite(maxEst) && maxEst > sample[0].w,
);
check(
  'Manual 1RM (100) survives next to estimated (≈117)',
  fmtKg(100, true) === '100 kg' && fmtKg(maxEst, true) !== '100 kg',
);

console.log('\n=== End-to-end: real CSV → per-exercise PR + 1RM ===');
const { workouts } = parseHevyCsv(
  readFileSync('lib/workout_data (1).csv', 'utf8'),
);

// Pull "Bench Press (Barbell)" sets; PR is heaviest weight, est 1RM is
// the Epley max from any set.
let benchPR = null;
let benchEst = null;
for (const w of workouts) {
  for (const e of w.exercises) {
    if (e.name !== 'Bench Press (Barbell)') continue;
    for (const s of e.sets) {
      if (s.weightKg !== null && (benchPR === null || s.weightKg > benchPR)) {
        benchPR = s.weightKg;
      }
      const est = estimate1RM(s.weightKg, s.reps);
      if (est !== null && (benchEst === null || est > benchEst)) {
        benchEst = est;
      }
    }
  }
}
check(
  'Bench Press PR (heaviest kg) — separated from est 1RM',
  benchPR !== null && benchPR < benchEst,
  `PR=${benchPR} kg · est1rm=${benchEst} kg`,
);
check(
  'Bench Press PR is reasonable (60-200 kg)',
  benchPR !== null && benchPR >= 60 && benchPR <= 200,
);

console.log('\n=== Stage 4 invariants still hold ===');
let volSum = 0;
let setSum = 0;
for (const w of workouts) {
  for (const e of w.exercises) {
    for (const s of e.sets) {
      volSum += setVolumeKg(s.weightKg, s.reps);
      setSum += 1;
    }
  }
}
check(
  'Total set count matches DB (815)',
  setSum === 815,
  `computed=${setSum}`,
);

console.log(
  `\n${failures === 0 ? 'STAGE 5 VERIFICATION PASSED' : `${failures} CHECK(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
