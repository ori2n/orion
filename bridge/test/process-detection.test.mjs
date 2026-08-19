import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFreebuffInstances,
  freebuffMatchTokens,
  parseProcessJson,
} from '../lib/process-detection.mjs';

test('parseProcessJson handles empty / single / array output', () => {
  assert.deepEqual(parseProcessJson(''), []);
  assert.deepEqual(parseProcessJson('   \n '), []);
  assert.deepEqual(parseProcessJson('not json'), []);

  const single = parseProcessJson(
    '{"ProcessId":42,"Name":"freebuff.exe","CommandLine":"freebuff"}',
  );
  assert.deepEqual(single, [{ pid: 42, name: 'freebuff.exe', commandLine: 'freebuff' }]);

  const array = parseProcessJson(
    '[{"ProcessId":1,"Name":"a.exe","CommandLine":"x"},{"ProcessId":2,"Name":"b.exe","CommandLine":"y"}]',
  );
  assert.equal(array.length, 2);
  assert.equal(array[1].pid, 2);
});

test('freebuffMatchTokens derives a sanitised token from the configured command', () => {
  const tokens = freebuffMatchTokens();
  assert.ok(tokens.includes('freebuff'));
});

test('detectFreebuffInstances returns only non-owned matches', async () => {
  const fakeQuery = async () => ({
    pid: 9999, // the query's own PowerShell PID — must be excluded
    stdout: JSON.stringify([
      { ProcessId: 100, Name: 'powershell.exe', CommandLine: 'powershell -Command freebuff query' },
      { ProcessId: 9999, Name: 'powershell.exe', CommandLine: 'Get-CimInstance ... freebuff ...' },
      { ProcessId: 200, Name: 'node.exe', CommandLine: 'node C:\\tools\\freebuff\\cli.js' },
    ]),
  });

  const matches = await detectFreebuffInstances({ runQuery: fakeQuery });
  const pids = matches.map((m) => m.pid).sort();
  // 100 is the manual freebuff (powershell), 200 is the node shim; 9999 is
  // the query itself and must be filtered out.
  assert.deepEqual(pids, [100, 200]);
});

test('detectFreebuffInstances excludes explicitly provided PIDs', async () => {
  const fakeQuery = async () => ({
    pid: 7777,
    stdout: JSON.stringify([{ ProcessId: 555, Name: 'freebuff.exe', CommandLine: 'freebuff' }]),
  });
  const matches = await detectFreebuffInstances({
    excludePids: [555],
    runQuery: fakeQuery,
  });
  assert.deepEqual(matches, []);
});

test('detectFreebuffInstances fails open when the query errors', async () => {
  const fakeQuery = async () => { throw new Error('boom'); };
  const matches = await detectFreebuffInstances({ runQuery: fakeQuery });
  assert.deepEqual(matches, []);
});

test('detectFreebuffInstances returns [] on non-Windows platforms', async () => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    const matches = await detectFreebuffInstances({ runQuery: async () => { throw new Error('must not run'); } });
    assert.deepEqual(matches, []);
  } finally {
    Object.defineProperty(process, 'platform', { value: orig });
  }
});
