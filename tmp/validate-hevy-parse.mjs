import { readFileSync } from 'node:fs';
import {
  parseHevyCsv,
  computeWorkoutContentHash,
} from '../lib/fitness/hevy/parser.ts';

const text = readFileSync('lib/workout_data (1).csv', 'utf8');
const { workouts, warnings } = parseHevyCsv(text);

let setCount = 0;
let exerciseCount = 0;
for (const w of workouts) {
  exerciseCount += w.exercises.length;
  for (const e of w.exercises) setCount += e.sets.length;
}

const dates = workouts
  .map((w) => w.startTime)
  .filter((d) => d !== null)
  .map((d) => d.getTime());
const min = dates.length ? new Date(Math.min(...dates)) : null;
const max = dates.length ? new Date(Math.max(...dates)) : null;

console.log('workouts parsed :', workouts.length);
console.log('exercises parsed:', exerciseCount);
console.log('sets parsed     :', setCount);
console.log('warnings        :', warnings.length);
for (const w of warnings) console.log('  -', w);
console.log('date range      :', min && min.toISOString(), '->', max && max.toISOString());

const target = workouts.find((w) => w.sourceStartTime === '16 Aug 2026, 19:23');
if (target) {
  console.log('\nSample workout title:', target.title);
  console.log('exercises:', target.exercises.map((e) => `${e.name} (${e.sets.length} sets)`));
  console.log('content hash:', computeWorkoutContentHash(target));
}

const seen = new Set();
const dupes = new Set();
for (const w of workouts) {
  const key = `${w.title}|${w.sourceStartTime}`;
  if (seen.has(key)) dupes.add(key);
  seen.add(key);
}
console.log('\nduplicate workout keys:', dupes.size);

const badDates = workouts.filter((w) => w.startTime === null);
console.log('workouts with unparseable start_time:', badDates.length);

let splitBlocks = 0;
for (const w of workouts) {
  const names = new Set();
  for (const e of w.exercises) {
    if (names.has(e.name)) splitBlocks++;
    names.add(e.name);
  }
}
console.log('exercise name repeated within a workout (split blocks):', splitBlocks);
