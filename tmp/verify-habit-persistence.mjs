#!/usr/bin/env node
/**
 * verify-habit-persistence.mjs
 *
 * Verification for the Habits completion persistence fix.
 *
 * Mode A (SUPABASE_SERVICE_ROLE_KEY present in .env.local):
 *   Also creates a TEMPORARY test habit, exercises upsert/delete
 *   round-trips against the live database, then deletes the habit
 *   (completions cascade). No existing user data is touched.
 *
 * Mode B (no service key): runs the date-window regression checks only.
 *
 * Never prints the service key.
 */

import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && !l.trim().startsWith('//'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? null;
const LIVE = Boolean(url && key);

const headers = {
  'Content-Type': 'application/json',
  apikey: key ?? '',
  Authorization: `Bearer ${key ?? ''}`,
};
const json = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};
const get = (p) => fetch(url + p, { headers }).then(json);
const send = (method, p, body, prefer) =>
  fetch(url + p, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ── 0. Window regression (always runs) ─────────────────────────────
// Replicates the component's local-date key + grid window exactly.
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function startOfWeek(date) {
  const r = new Date(date);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
function addDays(date, amount) {
  const r = new Date(date);
  r.setDate(r.getDate() + amount);
  return r;
}
// buildDates(): current week first, then previous two weeks (newest → oldest)
const dates = Array.from({ length: 21 }, (_, i) =>
  addDays(startOfWeek(new Date()), -Math.floor(i / 7) * 7 + (i % 7)));
const oldestDay = dateKey(dates[dates.length - 1]);
const newestGridDay = dateKey(addDays(dates[0], 6)); // Sunday ending this week
const today = dateKey(new Date());

console.log('=== 0. Read-back window regression (the bug) ===');
// The fixed component derives bounds via min/max over the grid dates.
const fixedOldest = dates.reduce((min, d) => (d < min ? d : min), dates[0]);
const fixedNewest = dates.reduce((max, d) => (d > max ? d : max), dates[0]);
const fixedOldestKey = dateKey(fixedOldest);
const fixedNewestKey = dateKey(fixedNewest);
console.log(`today=${today}  fixed window=[${fixedOldestKey} .. ${fixedNewestKey}]`);
{
  const buggyUpperBound = dateKey(dates[0]); // Monday of this week (old code)
  check('old upper bound (dates[0]) excluded today — reproduces the bug', today > buggyUpperBound,
    `old bound=${buggyUpperBound}`);
  check('fixed window includes today', today >= fixedOldestKey && today <= fixedNewestKey);
  const allInside = dates.every((d) => { const k = dateKey(d); return k >= fixedOldestKey && k <= fixedNewestKey; });
  check('every one of the 21 grid days is inside the fixed window', allInside);
  check('bounds are ordered (gte <= lte)', fixedOldestKey <= fixedNewestKey);
  check('window width is exactly 21 days',
    Math.round((fixedNewest - fixedOldest) / 86_400_000) === 20);
}

// ── 1. Schema: columns exposed (live) ──────────────────────────────
if (LIVE) {
  console.log('\n=== 1. Schema columns (live OpenAPI) ===');
  const oapi = await fetch(`${url}/rest/v1/`, {
    headers: { ...headers, Accept: 'application/openapi+json' },
  }).then(json);
  const cols = Object.keys(oapi?.definitions?.habit_completions?.properties ?? {});
  for (const c of ['id', 'habit_id', 'completed_date', 'user_id', 'created_at']) {
    check(`habit_completions.${c} exists`, cols.includes(c));
  }

  // ── 2. FK + UNIQUE guard sanity (live, synthetic id only) ────────
  console.log('\n=== 2. Constraint sanity (synthetic id, nothing stored) ===');
  const fakeId = crypto.randomUUID();
  const rejected = await send('POST', '/rest/v1/habit_completions',
    [{ habit_id: fakeId, user_id: fakeId, completed_date: '1970-01-01' }]);
  const code = rejected?.code ?? rejected?.error?.code ?? null;
  check('FK guard rejects completion for non-existent habit (23503)', code === '23503',
    `got ${code ?? JSON.stringify(rejected).slice(0, 120)}`);

  // ── 3-6. Round-trip on a TEMPORARY habit (deleted at the end) ────
  console.log('\n=== 3-6. Round-trip persistence (temporary test habit) ===');
  const created = await send('POST', '/rest/v1/habits?select=id',
    [{ name: '__persist_probe_tmp__', frequency: 'daily' }],
    'return=representation');
  const habitId = Array.isArray(created) ? created[0]?.id : created?.[0]?.id;
  if (!habitId) {
    console.log('SKIP round-trip — could not create temp habit:', JSON.stringify(created).slice(0, 200));
    process.exit(1);
  }
  console.log(`temp habit: ${habitId}`);

  try {
    const upd = (date) => send('POST', '/rest/v1/habit_completions?on_conflict=habit_id,completed_date',
      { habit_id: habitId, user_id: null, completed_date: date },
      'return=representation,resolution=ignore-duplicates');
    const rows = () => get(`/rest/v1/habit_completions?select=habit_id,completed_date&habit_id=eq.${habitId}`);
    const del = (date) => send('DELETE', `/rest/v1/habit_completions?habit_id=eq.${habitId}&completed_date=eq.${date}`);

    let r = await upd(today);
    check('upsert (check) succeeds', !r?.code, JSON.stringify(r).slice(0, 160));
    let read = await rows();
    check('check → read back → still checked (today)',
      read.some((x) => x.completed_date === today), `rows=${JSON.stringify(read)}`);

    r = await upd(today);
    check('re-check (duplicate upsert) does not error', !r?.code, JSON.stringify(r).slice(0, 160));
    read = await rows();
    check('duplicate upsert → exactly one row for today (UNIQUE holds)',
      read.filter((x) => x.completed_date === today).length === 1, JSON.stringify(read));

    r = await del(today);
    check('delete (uncheck) succeeds', !r?.code, JSON.stringify(r).slice(0, 160));
    read = await rows();
    check('uncheck → read back → still unchecked', !read.some((x) => x.completed_date === today));

    const created2 = await send('POST', '/rest/v1/habits?select=id',
      [{ name: '__persist_probe_tmp_2__', frequency: 'daily' }],
      'return=representation');
    const habit2 = Array.isArray(created2) ? created2[0]?.id : created2?.[0]?.id;
    if (habit2) {
      try {
        await upd(today);
        await send('POST', '/rest/v1/habit_completions?on_conflict=habit_id,completed_date',
          { habit_id: habit2, user_id: null, completed_date: today },
          'return=representation,resolution=ignore-duplicates');
        const both = await get(`/rest/v1/habit_completions?select=habit_id,completed_date&habit_id=in.(${habitId},${habit2})&completed_date=eq.${today}`);
        check('habit A and habit B complete independently (same date)', both.length === 2, JSON.stringify(both));
      } finally {
        await send('DELETE', `/rest/v1/habits?id=eq.${habit2}`);
      }
    }

    const yesterday = dateKey(addDays(new Date(), -1));
    await upd(yesterday);
    read = await rows();
    check('same habit: today + yesterday both persist independently',
      read.some((x) => x.completed_date === today) && read.some((x) => x.completed_date === yesterday),
      JSON.stringify(read));
    await del(today);
    read = await rows();
    check('unchecking today leaves yesterday untouched',
      !read.some((x) => x.completed_date === today) && read.some((x) => x.completed_date === yesterday),
      JSON.stringify(read));
  } finally {
    const cleanup = await send('DELETE', `/rest/v1/habits?id=eq.${habitId}`);
    check('temp habit deleted (completions cascade)', !cleanup?.code, JSON.stringify(cleanup).slice(0, 120));
  }
} else {
  console.log('\n(no service key — live round-trip skipped; schema evidence: tmp/supabase-audit-result.json)');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
