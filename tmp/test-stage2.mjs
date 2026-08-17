import { readFileSync } from 'node:fs';
import {
  parseHevyCsv,
  computeWorkoutContentHash,
} from '../lib/fitness/hevy/parser.ts';

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
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};
const returnRep = { ...headers, Prefer: 'return=representation' };

const USER_ID = '84fa49f8-137e-4876-88c1-e851653ae127';
const TEST_SOURCE = '1 Jan 2020, 00:00';
const TEST_FILE = 'stage2-test.csv';

const j = (r) => r.json();
const get = (p) => fetch(url + p, { headers }).then(j);

// ── Cleanup any leftovers from a previous run ──────────────────────
const leftoverWorkouts = await get(`/rest/v1/hevy_workouts?select=id&source_start_time=eq.${encodeURIComponent(TEST_SOURCE)}`);
for (const w of leftoverWorkouts ?? []) {
  const exs = await get(`/rest/v1/hevy_workout_exercises?select=id&workout_id=eq.${w.id}`);
  const exIds = (exs ?? []).map((e) => e.id);
  if (exIds.length) await fetch(url + '/rest/v1/hevy_workout_sets?workout_exercise_id=in.(' + exIds.join(',') + ')', { method: 'DELETE', headers });
  await fetch(url + '/rest/v1/hevy_workout_exercises?workout_id=eq.' + w.id, { method: 'DELETE', headers });
  await fetch(url + '/rest/v1/hevy_workouts?id=eq.' + w.id, { method: 'DELETE', headers });
}
await fetch(url + '/rest/v1/hevy_imports?raw_file_name=eq.' + TEST_FILE, { method: 'DELETE', headers });

// ── Parse the real export ──────────────────────────────────────────
const { workouts } = parseHevyCsv(readFileSync('lib/workout_data (1).csv', 'utf8'));

// ── TEST 1: idempotency (re-import the exact same file) ────────────
const dbWorkouts = await get('/rest/v1/hevy_workouts?select=source_start_time,content_hash');
const dbMap = new Map(dbWorkouts.map((w) => [w.source_start_time, w.content_hash]));
let unchanged = 0, updated = 0, created = 0;
for (const w of workouts) {
  const hash = computeWorkoutContentHash(w);
  const existing = dbMap.get(w.sourceStartTime);
  if (existing === undefined) created++;
  else if (existing !== hash) updated++;
  else unchanged++;
}
console.log(`TEST 1  re-import same file → checked=${workouts.length} unchanged=${unchanged} updated=${updated} created=${created}  ${unchanged === workouts.length && created === 0 && updated === 0 ? 'PASS' : 'FAIL'}`);

// ── TEST 2: change detection (modify a set weight) ─────────────────
const modified = structuredClone(workouts[0]);
outer: for (const ex of modified.exercises) {
  for (const s of ex.sets) {
    if (s.weightKg !== null) { s.weightKg += 0.5; break outer; }
  }
}
const origHash = computeWorkoutContentHash(workouts[0]);
const modHash = computeWorkoutContentHash(modified);
console.log(`TEST 2  change detection → ${origHash} vs ${modHash}  differs=${origHash !== modHash}  ${origHash !== modHash ? 'PASS' : 'FAIL'}`);

// ── TEST 3: a later export containing a new workout ────────────────
const newW = structuredClone(workouts[0]);
newW.title = 'STAGE2 TEST WORKOUT';
newW.sourceStartTime = TEST_SOURCE;
newW.sourceEndTime = '1 Jan 2020, 00:30';
newW.startTime = new Date(2020, 0, 1, 0, 0);
newW.endTime = new Date(2020, 0, 1, 0, 30);
const newHash = computeWorkoutContentHash(newW);
const newWorkouts = [...workouts, newW];
let newCount = 0;
for (const w of newWorkouts) {
  if (!dbMap.has(w.sourceStartTime)) newCount++;
}
console.log(`TEST 3  later export (+1 workout) → new detected=${newCount}  ${newCount === 1 ? 'PASS' : 'FAIL'}`);

// ── TEST 4: full create → delete round-trip (proves deletion) ──────
const before = (await get('/rest/v1/hevy_workouts?select=id')).length;

// 4a. create import record
const imp = await fetch(url + '/rest/v1/hevy_imports', {
  method: 'POST', headers: returnRep,
  body: JSON.stringify({
    user_id: USER_ID, status: 'completed',
    started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    workouts_checked: 1, workouts_created: 1, sets_processed: 1,
    raw_file_name: TEST_FILE,
  }),
}).then(j);
const importId = Array.isArray(imp) ? imp[0]?.id : imp?.id;
if (!importId) { console.log('TEST 4  FAIL — could not create import record:', JSON.stringify(imp).slice(0, 200)); process.exit(1); }

// 4b. create workout + first exercise + first set
const wk = await fetch(url + '/rest/v1/hevy_workouts', {
  method: 'POST', headers: returnRep,
  body: JSON.stringify({
    user_id: USER_ID, source_start_time: newW.sourceStartTime, title: newW.title,
    start_time: newW.startTime.toISOString(), end_time: newW.endTime.toISOString(),
    content_hash: newHash, source_import_id: importId,
  }),
}).then(j);
const workoutId = Array.isArray(wk) ? wk[0]?.id : wk?.id;
const firstEx = newW.exercises[0];
const ex = await fetch(url + '/rest/v1/hevy_workout_exercises', {
  method: 'POST', headers: returnRep,
  body: JSON.stringify({
    user_id: USER_ID, workout_id: workoutId, name: firstEx.name,
    order_index: 0,
  }),
}).then(j);
const exerciseId = Array.isArray(ex) ? ex[0]?.id : ex?.id;
await fetch(url + '/rest/v1/hevy_workout_sets', {
  method: 'POST', headers: returnRep,
  body: JSON.stringify({
    user_id: USER_ID, workout_exercise_id: exerciseId, set_index: 0,
    set_type: 'normal', weight_kg: 10, reps: 10,
  }),
}).then(j);

const during = (await get('/rest/v1/hevy_workouts?select=id')).length;
console.log(`TEST 4a create synthetic import → workouts ${before} → ${during}  ${during === before + 1 ? 'PASS' : 'FAIL'}`);

// 4c. delete it (mirrors deleteHevyImport: sets → exercises → workouts → import)
const exs = await get(`/rest/v1/hevy_workout_exercises?select=id&workout_id=eq.${workoutId}`);
const exIds = exs.map((e) => e.id);
const setCount = exIds.length
  ? (await get(`/rest/v1/hevy_workout_sets?select=id&workout_exercise_id=in.(${exIds.join(',')})`)).length
  : 0;
if (exIds.length) await fetch(url + '/rest/v1/hevy_workout_sets?workout_exercise_id=in.(' + exIds.join(',') + ')', { method: 'DELETE', headers });
await fetch(url + '/rest/v1/hevy_workout_exercises?workout_id=eq.' + workoutId, { method: 'DELETE', headers });
await fetch(url + '/rest/v1/hevy_workouts?source_import_id=eq.' + importId, { method: 'DELETE', headers });
await fetch(url + '/rest/v1/hevy_imports?id=eq.' + importId, { method: 'DELETE', headers });

const after = (await get('/rest/v1/hevy_workouts?select=id')).length;
const importsLeft = (await get('/rest/v1/hevy_imports?select=id&raw_file_name=eq.' + TEST_FILE)).length;
const realWorkoutsLeft = (await get('/rest/v1/hevy_workouts?select=id&source_import_id=not.is.null')).length;
console.log(`TEST 4b delete synthetic import → workouts ${during} → ${after}, sets removed=${setCount}, import rows left=${importsLeft}  ${after === before && importsLeft === 0 ? 'PASS' : 'FAIL'}`);
console.log(`        (real import intact: ${realWorkoutsLeft} workouts still have a source_import_id)`);
