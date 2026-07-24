#!/usr/bin/env node
/**
 * supabase-audit-v2.mjs
 *
 * Uses PostgREST's OpenAPI introspection as the source of truth for what
 * the REST API exposes — this is the same list the running Next.js app sees.
 *
 * Strategy:
 *   GET /rest/v1/  (Accept: application/openapi+json)
 *   => returns `{ definitions: { <table>: { properties: { <col>: {...} } } } }`
 *   for every currently-exposed table + column.
 *
 *   Plus a fallback HEAD *→ SELECT(*) for tables we *expect* but that the
 *   OpenAPI call does not list (schema-cache-stale tables).
 *
 *   storage.buckets: listBuckets() returns the canonical bucket inventory.
 *
 * NEVER print the service role key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXPECTED = {
  tags: ['id','name','color','user_id','created_at'],
  habits: ['id','frequency','custom_frequency','tag_id','user_id','name','created_at','duration_minutes','priority'],
  habit_completions: ['id','habit_id','completed_date','user_id','created_at'],
  events: ['id','user_id','type','payload','created_at'],
  user_profiles: ['user_id','birth_date','created_at','updated_at'],

  training_logs: ['id','user_id','workout_type','exercise','weight_lbs','reps','rpe','notes','created_at'],
  recovery_logs: ['id','user_id','energy_level','stress_level','soreness_level','notes','created_at'],

  physique_logs: ['id','user_id','bodyweight','photo_url','notes','created_at'],
  physique_photos: ['id','user_id','taken_at','pose_type','photo_path','body_weight_kg','notes','created_at','session_title','cover_photo_id','is_favourited','featured_at'],

  exercises: ['id','user_id','name','category','notes','is_archived','created_at'],
  workouts: ['id','user_id','name','performed_at','notes','ai_raw_text','created_at'],
  workout_sets: ['id','workout_id','exercise_id','user_id','set_order','weight_kg','reps','rpe','notes','created_at','working_sets_count'],
  weight_entries: ['id','user_id','weight_kg','recorded_at','notes','created_at'],
  weight_target: ['user_id','target_kg','set_at','notes'],
  sleep_entries: ['id','user_id','sleep_date','bedtime','wake_time','hours','quality','notes','created_at'],
  daily_checkins: ['id','user_id','checkin_date','sleep_id','workout_id','notes','created_at'],
  milestones: ['id','user_id','kind','title','description','achieved_at','related_data','created_at'],

  workout_logs: ['id','user_id','workout_type','exercise','set1_weight','set1_reps','set1_failure','set2_weight','set2_reps','set2_failure','warmup','created_at'],

  sleep_logs: ['id','user_id','sleep_start','sleep_end','quality','notes','created_at'],
  activities: ['id','user_id','activity_type','duration_minutes','intensity','notes','created_at'],
  gym_logs: ['id','user_id','exercise','sets','reps','weight','notes','created_at'],
  nutrition_logs: ['id','user_id','water_ml','caffeine_mg','caffeine_time','creatine_taken','created_at','calories','protein_g'],
  manual_inputs: ['id','user_id','energy_level','focus_level','stress_level','soreness_level','mood','created_at'],

  tasks: ['id','user_id','title','status','scheduled_for','duration_minutes','created_at'],

  accounts: ['id','user_id','name','type','balance','interest_rate','is_jisa','birth_date','contribution_ytd','contribution_year','created_at','updated_at'],
  transactions: ['id','user_id','account_id','type','amount','category','description','date','transfer_to_account_id','created_at'],
  future_transactions: ['id','user_id','account_id','age','description','amount','to_account_id','transfer_mode','transfer_value','created_at'],

  calendar_events: ['id','user_id','title','start_at','end_at','location','notes','color','source','created_at','updated_at'],
};
const EXPECTED_BUCKETS = ['progress-pics', 'physique-photos'];

// 1. Pull the OpenAPI definition (canonical REST introspection)
console.log('Querying PostgREST OpenAPI…');
const oapiRes = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/openapi+json',
  },
});
if (!oapiRes.ok) {
  console.error('OpenAPI fetch failed:', oapiRes.status, await oapiRes.text());
  process.exit(1);
}
const oapi = await oapiRes.json();
const liveTables = new Set(Object.keys(oapi.definitions || {}));

// 2. Pull storage bucket list
console.log('Listing storage buckets…');
const buckets = await sb.storage.listBuckets();
const liveBuckets = new Map();
for (const b of buckets.data || []) liveBuckets.set(b.id, b.public);

// 3. Also check schema-cache-stale tables: try a HEAD with no column spec
//    to bypass PostgREST's null-aware column resolution.
async function fallbackProbe(t) {
  try {
    const { error } = await sb.from(t).select('*').limit(0);
    if (!error) return { inOpenApi: false, fallbackPresent: true };
    return { inOpenApi: false, fallbackPresent: false, error: error.message };
  } catch (e) {
    return { inOpenApi: false, fallbackPresent: false, error: String(e) };
  }
}

// 4. Diff
const C_GREEN = '\x1b[32m', C_RED = '\x1b[31m', C_YEL = '\x1b[33m', C_RESET = '\x1b[0m';
const report = { tables: {}, buckets: {} };
let totalMissingTables = 0, totalMissingCols = 0, totalExtraCols = 0, totalCols = 0;
const fullList = new Set([...Object.keys(EXPECTED), ...liveTables]);

console.log('\n=== SCHEMA DIFF (PostgREST OpenAPI) ===');
const sortedTables = [...fullList].sort();
for (const t of sortedTables) {
  const inExpect = EXPECTED[t];
  const inLive = liveTables.has(t);
  const liveCols = inLive
    ? Object.keys((oapi.definitions[t] && oapi.definitions[t].properties) || {})
    : null;

  const rec = { expected: !!inExpect, inOpenApi: inLive, liveColumns: liveCols, expectedColumns: inExpect || null };

  if (!inExpect) {
    console.log(`${C_YEL}EXTRA TABLE${C_RESET}    ${t}  → only in DB, not in SQL files`);
  } else if (!inLive) {
    // Special: maybe table exists in Postgres but not exposed (schema cache stale)
    const fallback = await fallbackProbe(t);
    rec.fallback = fallback;
    totalMissingTables++;
    if (fallback.fallbackPresent) {
      console.log(`${C_YEL}STALE CACHE${C_RESET}   ${t}  → Postgres has it; PostgREST hasn't reloaded`);
    } else {
      console.log(`${C_RED}MISSING TABLE${C_RESET}  ${t}  → ${fallback.error || 'no row'}`);
    }
  } else {
    // Diff columns
    const expSet = new Set(inExpect);
    const lipSet = new Set(liveCols || []);
    const missing = [...expSet].filter((c) => !lipSet.has(c));
    const extra = [...lipSet].filter((c) => !expSet.has(c));
    rec.missing = missing;
    rec.extra = extra;
    totalMissingCols += missing.length;
    totalExtraCols += extra.length;
    totalCols += expSet.size;
    if (missing.length === 0 && extra.length === 0) {
      console.log(`${C_GREEN}MATCH${C_RESET}         ${t.padEnd(22)} ${expSet.size} cols`);
    } else {
      console.log(`${C_YEL}DRIFT${C_RESET}         ${t.padEnd(22)} ${expSet.size} expected / ${lipSet.size} live`);
      for (const c of missing) console.log(`  ${C_RED}-${C_RESET} missing column   ${t}.${c}`);
      for (const c of extra) console.log(`  ${C_YEL}+${C_RESET} unexpected col    ${t}.${c}`);
    }
  }
  report.tables[t] = rec;
}

console.log('\n=== STORAGE BUCKETS ===');
const allBuckets = new Set([...EXPECTED_BUCKETS, ...liveBuckets.keys()]);
for (const id of [...allBuckets].sort()) {
  const inExp = EXPECTED_BUCKETS.includes(id);
  const live = liveBuckets.get(id);
  const rec = { expected: inExp, present: !!live, public: live ?? null };
  report.buckets[id] = rec;
  if (live === undefined && inExp) {
    console.log(`${C_RED}MISSING${C_RESET}  ${id}`);
  } else if (live !== undefined && !inExp) {
    console.log(`${C_YEL}EXTRA${C_RESET}    ${id}${live ? ' (public)' : ' (private)'}`);
  } else {
    console.log(`${C_GREEN}PRESENT${C_RESET}  ${id}${live ? ' (public)' : ' (private)'}`);
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Tables in SQL files:  ${Object.keys(EXPECTED).length}`);
console.log(`Tables exposed:       ${liveTables.size}`);
console.log(`Tables missing:       ${totalMissingTables}`);
console.log(`Columns expected:     ${totalCols}`);
console.log(`Columns missing:      ${totalMissingCols}`);
console.log(`Columns unexpected:   ${totalExtraCols}`);

writeFileSync('tmp/supabase-audit-result.json', JSON.stringify(report, null, 2));
console.log('\nFull JSON written to tmp/supabase-audit-result.json');
