import { readFileSync } from 'node:fs';
import { parseHevyCsv } from '../lib/fitness/hevy/parser.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const get = (p) => fetch(url + p, { headers }).then((r) => r.json());

const { workouts, warnings } = parseHevyCsv(readFileSync('lib/workout_data (1).csv', 'utf8'));

// Pull the entire stored dataset in 3 queries.
const dbWorkouts = await get('/rest/v1/hevy_workouts?select=id,source_start_time,title');
const dbExercises = await get('/rest/v1/hevy_workout_exercises?select=id,workout_id,name,order_index');
const dbSets = await get('/rest/v1/hevy_workout_sets?select=workout_exercise_id,set_index,weight_kg,reps,duration_seconds');

const workoutBySource = new Map(dbWorkouts.map((w) => [w.source_start_time, w]));
const exercisesByWorkout = new Map();
for (const e of dbExercises) {
  const list = exercisesByWorkout.get(e.workout_id) ?? [];
  list.push(e);
  exercisesByWorkout.set(e.workout_id, list);
}
const setsByExercise = new Map();
for (const s of dbSets) {
  const list = setsByExercise.get(s.workout_exercise_id) ?? [];
  list.push(s);
  setsByExercise.set(s.workout_exercise_id, list);
}

const norm = (n) => (n === null || n === undefined ? null : Number(Number(n).toFixed(2)));

let workoutMismatches = 0;
let exerciseMismatches = 0;
let setMismatches = 0;
const mismatches = [];

for (const w of workouts) {
  const dbW = workoutBySource.get(w.sourceStartTime);
  if (!dbW) {
    workoutMismatches++;
    mismatches.push(`MISSING workout: ${w.sourceStartTime} (${w.title})`);
    continue;
  }
  if ((dbW.title ?? null) !== (w.title ?? null)) {
    workoutMismatches++;
    mismatches.push(`TITLE mismatch ${w.sourceStartTime}: db="${dbW.title}" csv="${w.title}"`);
  }

  const dbExs = (exercisesByWorkout.get(dbW.id) ?? []).sort((a, b) => a.order_index - b.order_index);
  if (dbExs.length !== w.exercises.length) {
    exerciseMismatches++;
    mismatches.push(`EXERCISE COUNT mismatch ${w.sourceStartTime}: db=${dbExs.length} csv=${w.exercises.length}`);
    continue;
  }

  for (let i = 0; i < w.exercises.length; i++) {
    const csvEx = w.exercises[i];
    const dbEx = dbExs[i];
    if (dbEx.name !== csvEx.name) {
      exerciseMismatches++;
      mismatches.push(`EXERCISE NAME mismatch ${w.sourceStartTime} #${i}: db="${dbEx.name}" csv="${csvEx.name}"`);
      continue;
    }
    const dbSets = (setsByExercise.get(dbEx.id) ?? []).sort((a, b) => a.set_index - b.set_index);
    if (dbSets.length !== csvEx.sets.length) {
      setMismatches++;
      mismatches.push(`SET COUNT mismatch ${w.sourceStartTime} / ${csvEx.name}: db=${dbSets.length} csv=${csvEx.sets.length}`);
      continue;
    }
    for (let j = 0; j < csvEx.sets.length; j++) {
      const csvS = csvEx.sets[j];
      const dbS = dbSets[j];
      const okWeight = norm(dbS.weight_kg) === csvS.weightKg;
      const okReps = (dbS.reps ?? null) === (csvS.reps ?? null);
      const okDur = (dbS.duration_seconds ?? null) === (csvS.durationSeconds ?? null);
      if (!okWeight || !okReps || !okDur) {
        setMismatches++;
        mismatches.push(
          `SET mismatch ${w.sourceStartTime} / ${csvEx.name} #${j}: ` +
            `db(${dbS.weight_kg},${dbS.reps},${dbS.duration_seconds}) ` +
            `csv(${csvS.weightKg},${csvS.reps},${csvS.durationSeconds})`,
        );
      }
    }
  }
}

console.log('=== Stage 3 full round-trip validation ===');
console.log(`parsed workouts : ${workouts.length}`);
console.log(`stored workouts : ${dbWorkouts.length}`);
console.log(`stored exercises: ${dbExercises.length}`);
console.log(`stored sets     : ${dbSets.length}`);
console.log(`parse warnings  : ${warnings.length}`);
console.log('');
console.log(`workout mismatches : ${workoutMismatches}`);
console.log(`exercise mismatches: ${exerciseMismatches}`);
console.log(`set mismatches     : ${setMismatches}`);
console.log('');
if (mismatches.length > 0) {
  console.log('DETAILS (first 30):');
  for (const m of mismatches.slice(0, 30)) console.log('  ' + m);
} else {
  console.log('PASS — every stored workout, exercise, and set matches the CSV exactly.');
}

// ── Schema findings (documented for the Stage 3 report) ────────────
console.log('');
console.log('=== Schema findings ===');
const firstRow = readFileSync('lib/workout_data (1).csv', 'utf8').split(/\r?\n/)[0];
console.log('columns:', firstRow.replaceAll('"', ''));
const hasMuscle = /muscle/i.test(firstRow);
const hasIds = /_id\b|workout_id|exercise_id/i.test(firstRow);
const hasPr = /pr|personal/i.test(firstRow);
console.log('muscle-group column present:', hasMuscle);
console.log('id columns present:', hasIds);
console.log('PR marker columns present:', hasPr);
