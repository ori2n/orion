import { readFileSync } from 'node:fs';
import {
  DEFAULT_EXERCISE_MUSCLES,
  MUSCLES,
} from '../lib/fitness/hevy/muscle-data.ts';
import { setVolumeKg, estimate1RM, isoWeekKey } from '../lib/fitness/hevy/calc.ts';

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
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const get = (p) => fetch(url + p, { headers }).then((r) => ({ status: r.status, body: r.status < 300 ? r.json() : r.text() })).then(async (o) => ({ status: o.status, data: o.status < 300 ? await o.body : await o.body }));

// 1. Resolve the user id from existing data.
const userRows = await fetch(url + '/rest/v1/hevy_workouts?select=user_id&limit=1', { headers }).then((r) => r.json());
const userId = userRows[0]?.user_id;
if (!userId) { console.log('FAIL — no workouts found, cannot determine user id'); process.exit(1); }
console.log('user_id:', userId);

// 2. Check the new table exists.
const metaCheck = await fetch(url + '/rest/v1/hevy_exercise_meta?select=id&limit=1', { headers });
if (metaCheck.status >= 400) {
  console.log('FAIL — hevy_exercise_meta not reachable:', metaCheck.status, (await metaCheck.text()).slice(0, 200));
  process.exit(1);
}
console.log('hevy_exercise_meta table: OK');

// 3. Distinct exercise names currently in the data.
const exs = await fetch(url + '/rest/v1/hevy_workout_exercises?select=name&user_id=eq.' + userId, { headers }).then((r) => r.json());
const names = [...new Set(exs.map((e) => e.name))];
console.log('distinct exercise names in data:', names.length);

// 4. Seed the default mapping (idempotent — ignores existing rows).
const rows = names
  .filter((n) => DEFAULT_EXERCISE_MUSCLES[n] !== undefined)
  .map((n) => ({ user_id: userId, exercise_name: n, muscle: DEFAULT_EXERCISE_MUSCLES[n] }));
const seedRes = await fetch(url + '/rest/v1/hevy_exercise_meta?on_conflict=user_id,exercise_name', {
  method: 'POST',
  headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
  body: JSON.stringify(rows),
});
console.log('seed upsert status:', seedRes.status, '(rows attempted:', rows.length + ')');

// 5. Verify mapping completeness.
const metaRows = await fetch(url + '/rest/v1/hevy_exercise_meta?select=exercise_name,muscle&user_id=eq.' + userId, { headers }).then((r) => r.json());
const mapped = new Set(metaRows.map((m) => m.exercise_name));
const unmapped = names.filter((n) => !mapped.has(n));
console.log('meta rows stored:', metaRows.length);
console.log('unmapped exercises:', unmapped.length, unmapped);

// 6. Replicate the engine aggregation against the live DB.
const [workouts, exercises, sets] = await Promise.all([
  fetch(url + '/rest/v1/hevy_workouts?select=id,start_time&user_id=eq.' + userId, { headers }).then((r) => r.json()),
  fetch(url + '/rest/v1/hevy_workout_exercises?select=id,workout_id,name&user_id=eq.' + userId, { headers }).then((r) => r.json()),
  fetch(url + '/rest/v1/hevy_workout_sets?select=workout_exercise_id,weight_kg,reps&user_id=eq.' + userId, { headers }).then((r) => r.json()),
]);

const muscleByName = new Map(metaRows.map((m) => [m.exercise_name, m.muscle]));
const workoutDate = new Map(workouts.filter((w) => w.start_time).map((w) => [w.id, new Date(w.start_time)]));
const exName = new Map(exercises.map((e) => [e.id, e.name]));
const exWorkout = new Map(exercises.map((e) => [e.id, e.workout_id]));

const muscleSets = new Map();
const muscleSessions = new Map(); // muscle -> Set(workout_id) per week
let totalVolume = 0;
let totalSets = 0;
const heaviest = new Map();

for (const s of sets) {
  const name = exName.get(s.workout_exercise_id);
  if (!name) continue;
  totalSets++;
  totalVolume += setVolumeKg(s.weight_kg, s.reps);
  if (s.weight_kg !== null && (heaviest.get(name) ?? -1) < s.weight_kg) heaviest.set(name, s.weight_kg);
  const muscle = muscleByName.get(name) ?? 'Unmapped';
  muscleSets.set(muscle, (muscleSets.get(muscle) ?? 0) + 1);
  const wid = exWorkout.get(s.workout_exercise_id);
  const d = workoutDate.get(wid);
  if (d && wid) {
    const wk = isoWeekKey(d);
    const sess = muscleSessions.get(muscle) ?? new Map(); // week -> Set
    const set = sess.get(wk) ?? new Set();
    set.add(wid);
    sess.set(wk, set);
    muscleSessions.set(muscle, sess);
  }
}

console.log('\n=== Engine output (live DB) ===');
console.log(`total volume: ${Math.round(totalVolume).toLocaleString()} kg`);
console.log(`total sets  : ${totalSets}`);
console.log(`exercises   : ${heaviest.size}`);
console.log('\nper-muscle sets / active weeks:');
for (const m of [...MUSCLES, 'Unmapped']) {
  if (!muscleSets.has(m)) continue;
  const weeks = muscleSessions.get(m)?.size ?? 0;
  console.log(`  ${m.padEnd(12)} sets=${String(muscleSets.get(m)).padStart(4)}  active-weeks=${weeks}`);
}
console.log('\nheaviest weight (sample):');
for (const n of ['Squat (Barbell)', 'Bench Press (Barbell)', 'Shoulder Press (Dumbbell)']) {
  console.log(`  ${n}: ${heaviest.get(n)} kg`);
}

const ok = unmapped.length === 0 && metaRows.length === names.length;
console.log(`\n${ok ? 'VERIFICATION PASSED' : 'VERIFICATION INCOMPLETE (see unmapped list)'}`);
process.exit(ok ? 0 : 1);
