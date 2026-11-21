import assert from 'node:assert/strict';
import test from 'node:test';
import { getParser, parseTolerant } from '../src/lang/parser-pool.ts';
import { extractUnits } from '../src/lang/units.ts';

test('a bare & in JSX text parses (JavaScript and TSX), with the same offsets', async () => {
  for (const lang of ['javascript', 'tsx'] as const) {
    const parser = await getParser(lang);
    for (const src of ['const a = <b>Encrypt & Create</b>;', 'const a = <b>A &</b>;', 'const a = <p>Terms &Conditions</p>;']) {
      const tree = parseTolerant(parser, src, lang)!;
      assert.equal(tree.rootNode.hasError, false, `${lang}: ${src}`);
      assert.equal(tree.rootNode.endIndex, src.length, 'same length as the original');
      tree.delete();
    }
  }
});

test('real code operators and entities are left alone, and genuinely broken code still reports an error', async () => {
  const parser = await getParser('javascript');
  for (const src of ['const a = x && y;', 'const a = x & y;', 'let f = 1; f &= 2;', 'const a = <b>A &amp; B</b>;']) {
    const tree = parseTolerant(parser, src, 'javascript')!;
    assert.equal(tree.rootNode.hasError, false, src);
    tree.delete();
  }
  const broken = parseTolerant(parser, 'function (', 'javascript')!;
  assert.equal(broken.rootNode.hasError, true);
  broken.delete();
});

test('a component with & in its text yields code units instead of a parse failure', async () => {
  const src = 'export function Terms() {\n  return (\n    <button onClick={go}>\n      I Accept These Terms & Continue\n    </button>\n  );\n}\n';
  const result = await extractUnits('Terms.js', src, 'javascript');
  assert.equal(result.error, undefined);
  assert.ok(result.units.length >= 1);
  assert.ok(result.units.some((u) => u.code.includes('Terms & Continue')), 'the unit keeps the original text');
});
