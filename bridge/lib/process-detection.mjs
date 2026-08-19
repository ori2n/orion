import { spawn } from 'node:child_process';
import { config } from './config.mjs';

/**
 * Process detection — finds a Freebuff instance already running on this PC
 * that this Bridge does NOT own.
 *
 * The Bridge must never silently kill or replace a session the user opened
 * manually in their own PowerShell window. Before starting a remote task it
 * asks Windows which processes look like `freebuff` (by image name or
 * command line), excludes its own process and its own query, and treats any
 * remaining match as "Freebuff is busy".
 *
 * The query is fully injectable (`runQuery`) so the logic can be unit
 * tested against canned Win32_Process output without spawning PowerShell or
 * a real Freebuff instance.
 */

/** The tokens used to recognise a Freebuff process (sanitised). */
export function freebuffMatchTokens() {
  const cmd = (config.freebuffCommand || 'freebuff').trim();
  const basename = cmd
    .split(/[\\/]/)
    .pop()
    .replace(/\.(cmd|bat|exe|ps1|js|mjs|cjs|bin)$/i, '');
  const sanitized = basename.replace(/[^a-zA-Z0-9_-]/g, '');
  const tokens = new Set(['freebuff']);
  if (sanitized) tokens.add(sanitized);
  return [...tokens];
}

/**
 * Run a PowerShell Win32_Process query. Resolves with
 * `{ pid, code, stdout, stderr }`; `pid` is the spawned PowerShell's own PID
 * (used to exclude the query from its own results).
 */
export function runPowerShellProcessQuery(script, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (e) {
      reject(e);
      return;
    }

    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('Freebuff process detection timed out'));
    }, timeoutMs ?? config.processDetectTimeoutMs);

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, code, stdout: out, stderr: err });
    });
  });
}

/** Parse `ConvertTo-Json -Compress` output (object, array, or empty). */
export function parseProcessJson(stdout) {
  const text = (stdout ?? '').trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .map((p) => ({
      pid: p?.ProcessId,
      name: p?.Name,
      commandLine: p?.CommandLine,
    }))
    .filter((p) => p && p.pid);
}

/**
 * Detect Freebuff instances not owned by this process.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.excludePids] extra PIDs to ignore
 * @param {(script: string) => Promise<{pid?:number, code?:number, stdout:string}>} [opts.runQuery]
 * @returns {Promise<Array<{pid:number, name:string, commandLine:string}>>}
 */
export async function detectFreebuffInstances({
  excludePids = [],
  runQuery = runPowerShellProcessQuery,
} = {}) {
  if (process.platform !== 'win32') return [];

  const exclude = new Set(
    [String(process.pid), ...excludePids.map(String)].filter(Boolean),
  );
  const tokens = freebuffMatchTokens();
  const nameCond = tokens.map((t) => `$_.Name -like '*${t}*'`).join(' -or ');
  const cmdCond = tokens.map((t) => `$_.CommandLine -like '*${t}*'`).join(' -or ');
  const script =
    'Get-CimInstance Win32_Process | Where-Object { ' +
    `(${nameCond}) -or (${cmdCond}) } | ` +
    'Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress';

  let result;
  try {
    result = await runQuery(script);
  } catch {
    // Detection failure must never block a task: fail open (treat as free)
    // but let the caller surface the warning if it wants the detail.
    return [];
  }

  if (result?.pid) exclude.add(String(result.pid));

  return parseProcessJson(result?.stdout).filter(
    (p) => !exclude.has(String(p.pid)),
  );
}
