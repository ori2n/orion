import { readFileSync } from 'node:fs';
import { DEFAULT_EXERCISE_MUSCLES } from '../lib/fitness/hevy/muscle-data.ts';

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

const rows = await fetch(url + '/rest/v1/hevy_exercise_meta?select=id,exercise_name&muscle=eq.Back', { headers }).then((r) => r.json());
console.log('rows with muscle=Back:', rows.length);

let updated = 0;
let skipped = 0;
for (const r of rows) {
  const next = DEFAULT_EXERCISE_MUSCLES[r.exercise_name];
  if (!next) {
    console.log('  SKIP (no mapping):', r.exercise_name);
    skipped++;
    continue;
  }
  const res = await fetch(url + '/rest/v1/hevy_exercise_meta?id=eq.' + r.id, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ muscle: next }),
  });
  if (res.status >= 300) {
    console.log('  FAIL', r.exercise_name, res.status, (await res.text()).slice(0, 150));
  } else {
    updated++;
    console.log(`  ${r.exercise_name} → ${next}`);
  }
}
console.log(`updated=${updated} skipped=${skipped}`);

// Confirm no 'Back' remains.
const remaining = await fetch(url + '/rest/v1/hevy_exercise_meta?select=exercise_name&muscle=eq.Back', { headers }).then((r) => r.json());
console.log('remaining muscle=Back rows:', remaining.length);
