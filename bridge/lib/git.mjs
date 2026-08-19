import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.mjs';

const execFileP = promisify(execFile);

/**
 * Run a git command in the working directory. Returns
 * `{ ok, stdout, stderr }` and NEVER throws — callers decide how to
 * handle failure. No shell is involved (args are passed directly), so
 * there is no injection surface.
 */
async function run(args) {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd: config.workingDir,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: config.gitTimeoutMs,
    });
    return { ok: true, stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim() };
  } catch (e) {
    const timedOut = e?.killed === true;
    return {
      ok: false,
      stdout: (e?.stdout ?? '').toString().trim(),
      stderr: timedOut
        ? `git command timed out after ${config.gitTimeoutMs} ms`
        : ((e?.stderr ?? e?.message ?? '') + '').trim(),
    };
  }
}

export function gitCurrentBranch() {
  return run(['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function gitCheckoutMain() {
  return run(['checkout', config.mainBranch]);
}

export function gitCreateBranch(name) {
  return run(['checkout', '-b', name]);
}

export function gitRevParseHead() {
  return run(['rev-parse', 'HEAD']);
}

/** Files changed on the current branch relative to main. */
export function gitChangedFiles() {
  return run(['diff', '--name-only', `${config.mainBranch}...HEAD`]);
}

export function gitMergeToMain(branch) {
  return run(['checkout', config.mainBranch]).then((co) => {
    if (!co.ok) return co;
    return run(['merge', '--no-ff', branch]);
  });
}

export function gitDeleteBranch(branch) {
  return run(['checkout', config.mainBranch]).then((co) => {
    if (!co.ok) return co;
    return run(['branch', '-D', branch]);
  });
}

export function gitPushBranch(branch) {
  return run(['push', '-u', 'origin', branch]);
}

export function gitPushMain() {
  return run(['push', 'origin', config.mainBranch]);
}
