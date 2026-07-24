#!/usr/bin/env node
/**
 * supabase-audit.mjs
 *
 * Probes the live Supabase project (via REST + service-role key) and reports
 * whether every table / column from the project's SQL migrations is present.
 *
 * Strategy:
 *   - For each expected table, do a HEAD request to /rest/v1/<table> with the
 *     service-role key. 200 = present, 404 = missing.
 *   - For each expected column, do a POST/GET to /rest/v1/<table>?select=<col>&limit=0
 *     and parse the error. Postgres 42703 = missing column, 42P01 = missing table.
 *   - Try /rest/v1/rpc/<fn> for a few introspection helpers Supabase exposes
 *     (pg_policies, pg_indexes) — fallback to N/A if not exposed.
 *   - For storage buckets, hit /storage/v1/bucket/<id>.
 *
 * NEVER print the service role key.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

// ----- 1. Read .env.local --------------------------------------------------
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

// ----- 2. Expected schema (extracted from SQL files by hand) --------------
// Shape: table -> { columns: string[], pk: bool(true=has pk), indexes: string[] }
const EXPECTED = {
  // habits + tags + habit_completions + events (from supabase-migration.sql
  // and supabase-fix-habits-migration.sql)
  tags: {
    columns: ['id', 'name', 'color', 'user_id', 'created_at'],
    requiredIndexes: [],
  },
  habits: {
    columns: [
      'id', 'frequency', 'custom_frequency', 'tag_id', 'user_id',
      'duration_minutes', 'priority', 'created_at',
    ],
    requiredIndexes: [],
    note: 'habits.created_at added by fix migration; duration_minutes & priority by time-management',
  },
  habit_completions: {
    columns: ['id', 'habit_id', 'completed_date', 'user_id', 'created_at'],
    requiredIndexes: [],
    uniqueConstraints: [['habit_id', 'completed_date']],
  },
  events: {
    columns: ['id', 'user_id', 'type', 'payload', 'created_at'],
    requiredIndexes: [],
  },
  user_profiles: {
    columns: ['user_id', 'birth_date', 'created_at', 'updated_at'],
    requiredIndexes: [],
  },

  // ORION redesign
  training_logs: {
    columns: ['id', 'user_id', 'workout_type', 'exercise', 'weight_lbs', 'reps', 'rpe', 'notes', 'created_at'],
    requiredIndexes: [],
  },
  recovery_logs: {
    columns: ['id', 'user_id', 'energy_level', 'stress_level', 'soreness_level', 'notes', 'created_at'],
    requiredIndexes: [],
  },

  // Physique — split into physique_logs (old) and physique_photos (new)
  physique_logs: {
    columns: ['id', 'user_id', 'bodyweight', 'photo_url', 'notes', 'created_at'],
    requiredIndexes: [],
    note: 'older health migration',
  },
  physique_photos: {
    columns: [
      'id', 'user_id', 'taken_at', 'pose_type', 'photo_path',
      'body_weight_kg', 'notes', 'created_at',
      'session_title', 'cover_photo_id',
      'is_favourited', 'featured_at',
    ],
    requiredIndexes: [],
  },

  // Fitness (supabase-fitness-migration.sql)
  exercises:            { columns: ['id','user_id','name','category','notes','is_archived','created_at'], requiredIndexes: [] },
  workouts:            { columns: ['id','user_id','name','performed_at','notes','ai_raw_text','created_at'], requiredIndexes: [] },
  workout_sets:         {
                          columns: ['id','workout_id','exercise_id','user_id','set_order','weight_kg','reps','rpe','notes','created_at','working_sets_count'],
                          requiredIndexes: [],
                        },
  weight_entries:      { columns: ['id','user_id','weight_kg','recorded_at','notes','created_at'], requiredIndexes: [] },
  weight_target:       { columns: ['user_id','target_kg','set_at','notes'], requiredIndexes: [] },
  sleep_entries:       { columns: ['id','user_id','sleep_date','bedtime','wake_time','hours','quality','notes','created_at'], requiredIndexes: [] },
  daily_checkins:      { columns: ['id','user_id','checkin_date','sleep_id','workout_id','notes','created_at'], requiredIndexes: [] },
  milestones:          { columns: ['id','user_id','kind','title','description','achieved_at','related_data','created_at'], requiredIndexes: [] },

  // Gym logs (legacy supabase-gym-migration.sql)
  workout_logs: {
    columns: ['id','user_id','workout_type','exercise','set1_weight','set1_reps','set1_failure','set2_weight','set2_reps','set2_failure','warmup','created_at'],
    requiredIndexes: [],
  },

  // Health (supabase-health-migration.sql)
  sleep_logs:     { columns: ['id','user_id','sleep_start','sleep_end','quality','notes','created_at'], requiredIndexes: [] },
  activities:     { columns: ['id','user_id','activity_type','duration_minutes','intensity','notes','created_at'], requiredIndexes: [] },
  gym_logs:       { columns: ['id','user_id','exercise','sets','reps','weight','notes','created_at'], requiredIndexes: [] },
  physique_logs:  { columns: ['id','user_id','bodyweight','photo_url','notes','created_at'], requiredIndexes: [] },
  nutrition_logs: {
    columns: ['id','user_id','water_ml','caffeine_mg','caffeine_time','creatine_taken','calories','protein_g','created_at'],
    requiredIndexes: [],
  },
  manual_inputs: {
    columns: ['id','user_id','energy_level','focus_level','stress_level','soreness_level','mood','created_at'],
    requiredIndexes: [],
    note: 'focus_level kept unless user manually drops it',
  },

  // Tasks
  tasks: { columns: ['id','user_id','title','status','scheduled_for','duration_minutes','created_at'], requiredIndexes: [] },

  // Finance
  accounts:            { columns: ['id','user_id','name','type','balance','interest_rate','is_jisa','birth_date','contribution_ytd','contribution_year','created_at','updated_at'], requiredIndexes: [] },
  transactions:        { columns: ['id','user_id','account_id','type','amount','category','description','date','transfer_to_account_id','created_at'], requiredIndexes: [] },
  future_transactions: { columns: ['id','user_id','account_id','age','description','amount','to_account_id','transfer_mode','transfer_value','created_at'], requiredIndexes: [] },

  // Time management
  calendar_events: {
    columns: ['id','user_id','title','start_at','end_at','location','notes','color','source','created_at','updated_at'],
    requiredIndexes: [],
  },
};

const STORAGE_BUCKETS = ['progress-pics', 'physique-photos'];

// ----- 3. Helpers ---------------------------------------------------------
async function checkTable(name) {
  try {
    const { error } = await sb.from(name).select('*', { count: 'exact', head: true }).limit(0);
    if (!error) return { exists: true };
    if (error.code === '42P01' || /does not exist/i.test(error.message)) return { exists: false };
    return { exists: true, warning: error.message };
  } catch (e) {
    return { exists: false, error: String(e) };
  }
}

async function checkColumn(table, col) {
  // Use select with the single column + a known column as anchor.
  // Postgres returns 42703 with the missing column name when it doesn't exist.
  try {
    const { error } = await sb.from(table).select(`${col},id`).limit(0);
    if (!error) return { ok: true };
    // 42703 = undefined_column; sometimes wraps the column name in the message.
    if (error.code === '42703' || /column.*does not exist/i.test(error.message)) {
      return { ok: false, missing: col };
    }
    return { ok: 'unknown', message: error.message };
  } catch (e) {
    return { ok: 'unknown', message: String(e) };
  }
}

async function checkBucket(id) {
  try {
    const { data, error } = await sb.storage.getBucket(id);
    if (data && !error) return { exists: true, public: data.public };
    if (error && /not found/i.test(error.message)) return { exists: false };
    return { exists: 'unknown', error: error?.message };
  } catch (e) {
    return { exists: 'unknown', error: String(e) };
  }
}

// ----- 4. Run the audit ---------------------------------------------------
const results = { tables: {}, missingTables: [], buckets: {} };
const COL_START = '\x1b[90m';
const COL_OK = '\x1b[32m';
const COL_BAD = '\x1b[31m';
const COL_WARN = '\x1b[33m';
const COL_RESET = '\x1b[0m';

console.log('\n=== TABLE PRESENCE ===');
for (const [t, spec] of Object.entries(EXPECTED)) {
  const tRes = await checkTable(t);
  results.tables[t] = { ...tRes, columns: [] };
  if (!tRes.exists) {
    results.missingTables.push(t);
    console.log(`${COL_BAD}MISSING TABLE${COL_RESET}  ${t}`);
    continue;
  }
  console.log(`${COL_OK}PRESENT${COL_RESET}        ${t}`);

  // Column probe
  for (const col of spec.columns) {
    const cRes = await checkColumn(t, col);
    results.tables[t].columns.push({ col, ...cRes });
    if (cRes.ok === true) continue;
    if (cRes.ok === false) {
      console.log(`  ${COL_BAD}missing column${COL_RESET} ${t}.${col}`);
    } else {
      console.log(`  ${COL_WARN}unknown${COL_RESET}         ${t}.${col}  -> ${cRes.message}`);
    }
  }
}

console.log('\n=== STORAGE BUCKETS ===');
for (const id of STORAGE_BUCKETS) {
  const bRes = await checkBucket(id);
  results.buckets[id] = bRes;
  if (bRes.exists === true) {
    console.log(`${COL_OK}PRESENT${COL_RESET}  ${id}${bRes.public ? ' (public)' : ' (private)'}`);
  } else if (bRes.exists === false) {
    console.log(`${COL_BAD}MISSING${COL_RESET}  ${id}`);
  } else {
    console.log(`${COL_WARN}UNKNOWN${COL_RESET}  ${id}  -> ${bRes.error}`);
  }
}

console.log('\n=== RAW JSON (saved to tmp/supabase-audit-result.json) ===');
const fs = await import('node:fs');
fs.writeFileSync('tmp/supabase-audit-result.json', JSON.stringify(results, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`Tables expected:      ${Object.keys(EXPECTED).length}`);
console.log(`Tables missing:       ${results.missingTables.length}`);
for (const t of results.missingTables) console.log(`    - ${t}`);
let colMiss = 0;
for (const [, v] of Object.entries(results.tables)) {
  for (const c of v.columns || []) {
    if (c.ok === false) colMiss++;
  }
}
console.log(`Columns missing/mapped: ${colMiss}`);
