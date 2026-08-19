import pkg from '@xterm/headless';

const { Terminal } = pkg;

/**
 * TerminalDecoder — converts the raw byte stream from a Windows PTY into
 * clean, readable text by running it through xterm.js's real VT/ANSI
 * parser (the headless build, so no browser/DOM is involved).
 *
 * Why this exists: a full-screen TUI such as Freebuff writes escape
 * sequences (SGR colours, cursor addressing, erase-in-display, alternate
 * screen, box-drawing glyphs) and redraws the same cells repeatedly.
 * Streaming those raw bytes straight to the browser produces the garbage
 * seen through ORION — leaked "random numbers" from SGR parameters, box /
 * square glyphs, and terminal control characters. Feeding the same bytes
 * through a genuine terminal emulator and reading back its screen buffer
 * yields exactly the characters a real terminal would show, with all
 * escape sequences consumed and cursor-addressed redraws resolved.
 *
 * Output model (mirrors a real terminal):
 *   - `scrollback` — lines that have scrolled off the top of the normal
 *     buffer. These are final; once a line is here it never changes.
 *   - `live`      — the current visible viewport (the bottom `rows` lines
 *     of the active buffer). These are live and get replaced as the TUI
 *     updates in place.
 *
 * `write()` is asynchronous (xterm processes writes in batches), so a
 * `ready()` helper is provided for callers that need to snapshot only
 * after every pending write has been parsed (e.g. the final flush on
 * process exit).
 */
export class TerminalDecoder {
  constructor({ cols = 100, rows = 32, scrollback = 2000 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.scrollback = scrollback;
    this.term = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    // Index (into the normal buffer) up to which scrollback has already
    // been emitted. Monotonic so we never re-emit a finalized line.
    this.emittedScrollback = 0;
    // Resolves once every write issued so far has been parsed. The last
    // write's callback is queued after all earlier ones, so awaiting this
    // promise guarantees the buffer reflects all preceding writes.
    this._ready = Promise.resolve();
  }

  /** Feed raw PTY bytes (string or Buffer) into the parser. */
  write(data) {
    if (!data) return;
    if (typeof data !== 'string') data = data.toString('utf8');
    if (!data.length) return;
    this._ready = new Promise((resolve) => {
      try {
        this.term.write(data, resolve);
      } catch {
        // Never let a parser hiccup take down the bridge. Resolve so the
        // caller is not left hanging; content already written is kept.
        resolve();
      }
    });
  }

  /** Resolves when all writes issued so far have been parsed. */
  ready() {
    return this._ready;
  }

  /**
   * Snapshot the terminal into { scrollback, live }.
   *  - scrollback: lines that have scrolled off the normal buffer since
   *    the previous snapshot (final, appendable text).
   *  - live: the current visible viewport, trailing empty lines trimmed.
   */
  snapshot() {
    const normal = this.term.buffer.normal;
    const active = this.term.buffer.active;

    const scrollback = [];
    let boundary = Math.min(normal.viewportY, normal.length);
    // Guard against a terminal reset (RIS / clear) which collapses the
    // buffer indices: if the boundary has regressed, treat everything as
    // new and reset our cursor so no lines are skipped.
    if (boundary < this.emittedScrollback) {
      this.emittedScrollback = 0;
      boundary = Math.min(normal.viewportY, normal.length);
    }
    for (let y = this.emittedScrollback; y < boundary; y += 1) {
      const line = normal.getLine(y);
      if (line) {
        const text = line.translateToString(true);
        if (text !== '') scrollback.push(text);
      }
    }
    this.emittedScrollback = Math.max(this.emittedScrollback, boundary);

    const live = [];
    const top = Math.max(0, active.baseY);
    for (let y = 0; y < this.rows; y += 1) {
      const line = active.getLine(top + y);
      live.push(line ? line.translateToString(true) : '');
    }
    while (live.length && live[live.length - 1] === '') live.pop();

    return { scrollback, live };
  }

  dispose() {
    try {
      this.term.dispose();
    } catch {
      // ignore
    }
  }
}

/** One line-oriented stream that never loses scrollback (helper). */
export function decoderFromConfig(config) {
  return new TerminalDecoder({
    cols: config.terminalCols,
    rows: config.terminalRows,
    scrollback: config.terminalScrollback,
  });
}
