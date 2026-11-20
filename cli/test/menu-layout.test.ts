import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutChoose, type LayoutInput } from '../src/menu/ui.ts';

const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const labels = Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`);
const make = (rows: number, index: number, cols = 90): LayoutInput => ({
  rows,
  cols,
  title: 'What would you like to do?',
  lede: 'A line of explanation under the title.',
  header: ['', '  BANNER ROW 1', '  BANNER ROW 2', '', '  subtitle', '  /some/directory', '  ────────'],
  options: labels.map((label, i) => ({ label, hint: `hint for ${label}`, preview: { command: `athena do ${i + 1}`, detail: `detail ${i + 1}` } })),
  index,
  footer: 'footer keys',
});

test('the frame never has more lines than the terminal can show, at any height', () => {
  for (let rows = 6; rows <= 70; rows += 1) {
    for (const index of [0, 5, 10]) {
      const lines = layoutChoose(make(rows, index));
      assert.ok(lines.length <= rows - 1, `rows=${rows} index=${index}: ${lines.length} lines`);
    }
  }
});

test('the highlighted option is always on screen, wherever it is in the list', () => {
  for (const rows of [6, 8, 10, 14, 20, 26, 40]) {
    for (let index = 0; index < labels.length; index += 1) {
      const text = layoutChoose(make(rows, index)).map(strip).join('\n');
      assert.ok(text.includes(`Option ${index + 1} `) || text.includes(`Option ${index + 1}\n`), `rows=${rows} index=${index} is missing from:\n${text}`);
    }
  }
});

test('a tall terminal shows everything: the banner, every hint and the command preview', () => {
  const text = layoutChoose(make(80, 2)).map(strip).join('\n');
  assert.match(text, /BANNER ROW 1/);
  for (const l of labels) assert.ok(text.includes(`hint for ${l}`), `hint for ${l}`);
  assert.match(text, /\$ athena do 3/);
});

test('a short terminal keeps the title and the footer, and says when the list continues', () => {
  const text = layoutChoose(make(9, 5)).map(strip).join('\n');
  assert.match(text, /What would you like to do\?/);
  assert.match(text, /footer keys/);
  assert.match(text, /▲ \d+ more/);
  assert.match(text, /▼ \d+ more/);
  assert.ok(!/BANNER ROW/.test(text), 'the banner goes first when space is short');
});

test('a medium terminal drops hints and the preview before it drops the banner', () => {
  const lines = layoutChoose(make(26, 0)).map(strip).join('\n');
  assert.match(lines, /BANNER ROW 1/);
  assert.ok(!/\$ athena do/.test(lines), 'preview dropped');
  assert.ok(lines.includes('hint for Option 1'), 'the highlighted option keeps its hint');
  assert.ok(!lines.includes('hint for Option 2'), 'the other hints are dropped');
});

test('long text is cut to the terminal width', () => {
  const input = make(40, 0, 40);
  input.options[0]!.hint = 'x'.repeat(200);
  for (const line of layoutChoose(input)) assert.ok(strip(line).length <= 80, `line too wide: ${strip(line).length}`);
});
