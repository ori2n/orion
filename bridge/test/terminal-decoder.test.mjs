import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalDecoder } from '../lib/terminal-decoder.mjs';

const esc = (s) => s.replace(/ESC/g, '\x1b');

/** Feed a decoder and wait for its writes to be fully parsed. */
async function feed(decoder, data) {
  decoder.write(data);
  await decoder.ready();
}

test('renders plain streamed lines into scrollback and live viewport', async () => {
  const d = new TerminalDecoder({ cols: 20, rows: 5 });
  await feed(d, 'one\r\ntwo\r\nthree');

  const snap = d.snapshot();
  assert.deepEqual(snap.scrollback, []);
  assert.deepEqual(snap.live, ['one', 'two', 'three']);
  d.dispose();
});

test('scrollback accumulates as lines scroll off the viewport', async () => {
  const d = new TerminalDecoder({ cols: 20, rows: 3 });
  await feed(d, 'one\r\ntwo\r\nthree\r\nfour\r\nfive');

  const snap = d.snapshot();
  // rows=3 → "one" and "two" scrolled off; "three".."five" are live.
  assert.deepEqual(snap.scrollback, ['one', 'two']);
  assert.deepEqual(snap.live, ['three', 'four', 'five']);
  d.dispose();
});

test('incremental snapshots do not re-emit already-committed scrollback', async () => {
  const d = new TerminalDecoder({ cols: 20, rows: 3 });
  await feed(d, 'a\r\nb\r\nc');
  const first = d.snapshot();
  assert.deepEqual(first.scrollback, []);
  assert.deepEqual(first.live, ['a', 'b', 'c']);

  await feed(d, '\r\nd\r\ne');
  const second = d.snapshot();
  assert.deepEqual(second.scrollback, ['a', 'b']);
  assert.deepEqual(second.live, ['c', 'd', 'e']);
  d.dispose();
});

test('SGR colour codes are consumed, not leaked', async () => {
  const d = new TerminalDecoder({ cols: 30, rows: 5 });
  const data = esc('ESC[38;5;123mESC[1;32m') + 'hello' + esc('ESC[0m') + '\r\n';
  await feed(d, data);
  const snap = d.snapshot();
  assert.deepEqual(snap.live, ['hello']);
  d.dispose();
});

test('cursor addressing + erase + redraw resolves to the final composed screen', async () => {
  const d = new TerminalDecoder({ cols: 30, rows: 4 });
  // Full-screen redraw: clear, home, print two rows, then overwrite row 2.
  const data =
    esc('ESC[2JESC[H') + 'step 1' + '\r\n' + 'step 2' + '\r\n' +
    esc('ESC[2;1H') + 'step 2 (updated)' + '\r\n';
  await feed(d, data);
  const snap = d.snapshot();
  assert.deepEqual(snap.live, ['step 1', 'step 2 (updated)']);
  d.dispose();
});

test('box-drawing glyphs are preserved as clean text', async () => {
  const d = new TerminalDecoder({ cols: 40, rows: 6 });
  const data = '├─ Editing: foo.ts\r\n└─ Done\r\n';
  await feed(d, data);
  const snap = d.snapshot();
  assert.deepEqual(snap.live, ['├─ Editing: foo.ts', '└─ Done']);
  d.dispose();
});

test('alternate screen buffer becomes the live viewport', async () => {
  const d = new TerminalDecoder({ cols: 30, rows: 4 });
  const data =
    esc('ESC[?1049h') + 'TUI frame one\r\n' +
    esc('ESC[2JESC[H') + 'TUI frame two' + '\r\n' + esc('ESC[?1049l');
  await feed(d, data);
  const snap = d.snapshot();
  // The active (alt) buffer content was replaced by the redraw; after
  // leaving the alt buffer the normal buffer is empty.
  assert.deepEqual(snap.live, []);
  d.dispose();
});

test('utf-8 multibyte input is decoded correctly across split writes', async () => {
  const d = new TerminalDecoder({ cols: 40, rows: 5 });
  // "héllo ✓" split mid-codepoint across two writes.
  const buf = Buffer.from('héllo ✓\r\n', 'utf8');
  await feed(d, buf.subarray(0, 3)); // "h" + partial é
  await feed(d, buf.subarray(3)); // remainder
  const snap = d.snapshot();
  assert.deepEqual(snap.live, ['héllo ✓']);
  d.dispose();
});
