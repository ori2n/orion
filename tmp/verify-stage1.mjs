import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  'Content-Type': 'application/json',
  apikey: key,
  Authorization: `Bearer ${key}`,
  Prefer: 'count=exact',
};

async function count(table) {
  const r = await fetch(`${url}/rest/v1/${table}?select=id`, { headers });
  const contentRange = r.headers.get('content-range');
  const total = contentRange ? parseInt(contentRange.split('/')[1], 10) : null;
  return { status: r.status, total, error: r.status >= 300 ? (await r.text()).slice(0, 200) : null };
}

console.log('=== Stage 1 verification ===\n');

for (const t of ['hevy_imports', 'hevy_workouts', 'hevy_workout_exercises', 'hevy_workout_sets']) {
  const c = await count(t);
  console.log(`${t.padEnd(24)} rows=${c.total}  (http ${c.status})${c.error ? '  ERROR: ' + c.error : ''}`);
}

console.log('\n=== Import records ===');
const imports = await fetch(
  `${url}/rest/v1/hevy_imports?select=id,status,workouts_checked,workouts_created,workouts_updated,workouts_unchanged,sets_processed,date_min,date_max,warnings,raw_file_name,created_at&order=created_at.desc`,
  { headers },
).then((r) => r.json());
if (Array.isArray(imports)) {
  for (const imp of imports) {
    console.log(JSON.stringify(imp, null, 2));
  }
} else {
  console.log('imports response:', JSON.stringify(imports).slice(0, 500));
}

console.log('\n=== Duplicate check (source_start_time) ===');
const wks = await fetch(
  `${url}/rest/v1/hevy_workouts?select=source_start_time&order=source_start_time.asc`,
  { headers },
).then((r) => r.json());
if (Array.isArray(wks)) {
  const seen = new Map();
  const dupes = [];
  for (const w of wks) {
    const k = w.source_start_time;
    if (seen.has(k)) dupes.push(k);
    else seen.set(k, 1);
  }
  console.log(`total workouts=${wks.length}, unique source_start_time=${seen.size}, duplicates=${dupes.length}`);
  if (dupes.length) console.log('DUPLICATES:', dupes);
} else {
  console.log('workouts response:', JSON.stringify(wks).slice(0, 300));
}

console.log('\n=== Date range ===');
const range = await fetch(
  `${url}/rest/v1/hevy_workouts?select=start_time&order=start_time.asc&limit=1`,
  { headers },
).then((r) => r.json());
const range2 = await fetch(
  `${url}/rest/v1/hevy_workouts?select=start_time&order=start_time.desc&limit=1`,
  { headers },
).then((r) => r.json());
console.log('earliest:', Array.isArray(range) ? range[0]?.start_time : range);
console.log('latest:  ', Array.isArray(range2) ? range2[0]?.start_time : range2);

console.log('\n=== Spot-check: "Sharnd" 16 Aug 2026, 19:23 ===');
const sharnd = await fetch(
  `${url}/rest/v1/hevy_workouts?select=id,title,start_time&source_start_time=eq.%2216 Aug 2026, 19:23%22`,
  { headers },
).then((r) => r.json());
if (Array.isArray(sharnd) && sharnd.length > 0) {
  const wid = sharnd[0].id;
  const exs = await fetch(
    `${url}/rest/v1/hevy_workout_exercises?select=id,name,order_index&workout_id=eq.${wid}&order=order_index.asc`,
    { headers },
  ).then((r) => r.json());
  console.log('workout:', sharnd[0].title, sharnd[0].start_time, `(${exs.length} exercises)`);
  for (const ex of exs) {
    const sets = await fetch(
      `${url}/rest/v1/hevy_workout_sets?select=set_index,weight_kg,reps&workout_exercise_id=eq.${ex.id}&order=set_index.asc`,
      { headers },
    ).then((r) => r.json());
    const setStr = sets.map((s) => `${s.weight_kg ?? 'bw'}x${s.reps ?? '-'}`).join(', ');
    console.log(`  ${ex.name}: ${setStr}`);
  }
} else {
  console.log('Sharnd workout NOT FOUND — response:', JSON.stringify(sharnd).slice(0, 300));
}
