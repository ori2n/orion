// v4 cleanup — even simpler. Walk backwards from `function PlanPlaceholder`,
// skip blank/comment lines (those belong either to the preceding function's
// trailing comment OR to the next function's section header — both are fine
// to consume), then take the first `^}\s*$` we hit. That `}` is the
// closing brace of `CalendarTodayPanel`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const target = path.resolve(__dirname, '..', 'app', 'actions', 'page.tsx');

const before = readFileSync(target, 'utf8');
const originalLen = before.length;
const lines = before.split('\n');

// ── 1. `interface CalendarEvent` (no nested braces; naive count works)
const ifaceStart = lines.findIndex((l) => /^interface CalendarEvent\b/.test(l));
if (ifaceStart === -1) throw new Error('Could not locate `interface CalendarEvent`.');
let depth = 0;
let ifaceEnd = -1;
for (let i = ifaceStart; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { ifaceEnd = i; break; } }
  }
  if (ifaceEnd !== -1) break;
}
if (ifaceEnd === -1) throw new Error('Could not close `interface CalendarEvent`.');
const ifaceDelEnd = Math.min(lines.length - 1, ifaceEnd + 1);

// ── 2. `function CalendarTodayPanel` — scan-based detection
const fnStart = lines.findIndex((l) => /^function CalendarTodayPanel\s*\(/.test(l));
if (fnStart === -1) throw new Error('Could not locate `function CalendarTodayPanel`.');

// Walk BACKWARDS from the line above fnStart, looking for the
// `function PlanPlaceholder` declaration (next sibling function).
// Then walk BACKWARDS from that declaration, skipping blank lines
// and `// ...` comment lines, to find the column-0 `}` that closes
// CalendarTodayPanel.
const nextFnIdx = lines.findIndex((l, i) =>
  i > fnStart && /^function\s+\w+\s*\(/.test(l),
);
if (nextFnIdx === -1) throw new Error('Could not locate next top-level function.');

// Skip PlanPlaceholder's section-header comment + blank line + any other
// blanks backwards, finding the column-0 `}`.
let fnEnd = -1;
for (let i = nextFnIdx - 1; i > fnStart; i--) {
  const ln = lines[i];
  if (/^\s*$/.test(ln)) continue;            // blank line
  if (/^}\s*$/.test(ln)) { fnEnd = i; break; } // column-0 `}`
  if (ln.trim().startsWith('//')) continue;  // comment line
  break;                                     // anything else — abort
}
if (fnEnd === -1) throw new Error('Could not find column-0 `}` closing `CalendarTodayPanel`.');

// Walk backwards from fnStart to find the section header comment block
// (e.g., `// ─── Calendar "Today" panel — ...`). Stop when we hit a
// non-blank, non-comment line.
let headerLine = fnStart - 1;
while (headerLine > 0 && (lines[headerLine].trim().startsWith('//') || lines[headerLine].trim() === '')) {
  headerLine -= 1;
}
headerLine += 1;

// ── Apply ─────────────────────────────────────────────────────────
const ranges = [
  { start: ifaceStart, end: ifaceDelEnd, label: 'CalendarEvent interface' },
  { start: headerLine, end: fnEnd,         label: 'CalendarTodayPanel header + body' },
].sort((a, b) => b.start - a.start);

const newLines = [...lines];
for (const r of ranges) {
  console.log(`Removing ${r.label}: lines ${r.start + 1}–${r.end + 1}`);
  newLines.splice(r.start, r.end - r.start + 1);
}

const after = newLines.join('\n');
const stillTodayPanel = after.split('\n').filter((l) => /CalendarTodayPanel/.test(l)).length;
const stillCalEvent = after.split('\n').filter((l) => /CalendarEvent/.test(l)).length;
console.log(`After — CalendarTodayPanel: ${stillTodayPanel}, CalendarEvent: ${stillCalEvent}`);
console.log(`Bytes: ${originalLen} → ${after.length} (Δ ${originalLen - after.length})`);

if (stillTodayPanel !== 0 || stillCalEvent !== 0) {
  console.error('Stray references remain — aborting.');
  process.exit(1);
}
writeFileSync(target, after, 'utf8');
console.log('Wrote app/actions/page.tsx.');
