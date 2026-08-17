import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

/**
 * Minimal .env parser — no dependency. Reads KEY=VALUE lines, ignoring
 * comments and blank lines. Quoted values are unquoted. Values already
 * present in process.env are NOT overwritten, so `node --env-file=.env`
 * (or a shell that exports the vars) still works.
 */
function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env file — rely on the process environment instead.
  }
}

loadEnvFile(ENV_PATH);

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  workingDir: process.env.WORKING_DIR ?? 'C:\\Users\\edoar\\second-brain',
  freebuffCommand: process.env.FREEBUFF_COMMAND ?? 'freebuff',
  mainBranch: process.env.MAIN_BRANCH ?? 'main',

  pollIntervalMs: int(process.env.POLL_INTERVAL_MS, 2000),
  initWaitMs: int(process.env.INIT_WAIT_MS, 4000),
  promptSettleMs: int(process.env.PROMPT_SETTLE_MS, 3000),
  followUpSettleMs: int(process.env.FOLLOWUP_SETTLE_MS, 2500),
  stopTimeoutMs: int(process.env.STOP_TIMEOUT_MS, 10000),

  terminalFlushMs: int(process.env.TERMINAL_FLUSH_MS, 600),
  terminalMaxChunks: int(process.env.TERMINAL_MAX_CHUNKS, 2000),

  pushBranch: bool(process.env.PUSH_BRANCH, true),
  pushMainOnApprove: bool(process.env.PUSH_MAIN_ON_APPROVE, true),

  doneMarker: process.env.DONE_MARKER ? new RegExp(process.env.DONE_MARKER) : null,
};

export function assertConfig() {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
        `Copy bridge/.env.example to bridge/.env and fill them in.`,
    );
  }
}
