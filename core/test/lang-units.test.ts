import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import type { LanguageId } from '../src/lang/languages.ts';
import { extractUnits } from '../src/lang/units.ts';

interface Expected {
  file: string;
  units: Array<{ name: string; kind: string; startLine: number; endLine: number }>;
  documented: { name: string; startLine: number };
  check: { name: string; complexity: number; parameters: string[] };
}

const dir = join(import.meta.dirname, 'fixtures', 'lang');
const expected = JSON.parse(await readFile(join(dir, 'expected.json'), 'utf8')) as Record<LanguageId, Expected>;
const order = (a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }) =>
  a.startLine - b.startLine || b.endLine - a.endLine;

for (const [lang, exp] of Object.entries(expected) as Array<[LanguageId, Expected]>) {
  test(`${lang}: units, doc comments and metadata`, async () => {
    const path = join(dir, exp.file);
    const source = await readFile(path, 'utf8');
    const result = await extractUnits(path, source, lang);
    assert.equal(result.language, lang);
    assert.equal(result.error, undefined, `unexpected error ${result.error}`);
    const got = result.units
      .map((u) => ({ name: u.name, kind: u.kind, startLine: u.startLine, endLine: u.endLine }))
      .sort(order);
    assert.deepEqual(got, [...exp.units].sort(order));

    for (const unit of result.units) {
      const documented = unit.name === exp.documented.name && unit.startLine === exp.documented.startLine;
      assert.equal(unit.metadata.hasJSDoc, documented, `hasJSDoc for ${unit.name}@${unit.startLine}`);
      assert.ok(unit.metadata.loc >= 3);
      assert.match(unit.id, /^[0-9a-f]{12}$/);
      assert.equal(unit.filePath, path);
      assert.ok(unit.code.length > 0);
    }
    const checked = result.units.find((u) => u.name === exp.check.name && u.kind !== 'class')!;
    assert.ok(checked, `unit ${exp.check.name}`);
    assert.equal(checked.metadata.complexity, exp.check.complexity, 'complexity');
    assert.deepEqual(checked.metadata.parameters, exp.check.parameters, 'parameters');
    assert.ok(checked.metadata.identifiers.length > 0, 'identifiers');
    assert.ok(checked.metadata.nestingDepth >= 0, 'nestingDepth');
  });
}

test('CRLF and BOM copies report the same line numbers', async () => {
  const path = join(dir, 'typescript', 'sample.ts');
  const lf = await readFile(path, 'utf8');
  const lines = (src: string) => async () =>
    (await extractUnits(path, src, 'typescript')).units.map((u) => [u.name, u.startLine, u.endLine]);
  const base = await lines(lf)();
  assert.deepEqual(await lines(lf.replace(/\n/g, '\r\n'))(), base);
  assert.deepEqual(await lines('﻿' + lf)(), base);
});

test('a Python syntax error is reported with its line and earlier units survive', async () => {
  const source = 'def ok():\n    a = 1\n    return a\n\n\ndef f(:\n    pass\n';
  const result = await extractUnits('broken.py', source, 'python');
  assert.match(result.error ?? '', /^syntax error \(line \d+\)$/);
  assert.ok(result.units.some((u) => u.name === 'ok' && u.startLine === 1 && u.endLine === 3));
});

test('comment lines are counted inside a unit', async () => {
  const source = 'function f(a) {\n  // one\n  // two\n  const b = a; // trailing\n  return b;\n}\n';
  const [unit] = (await extractUnits('c.js', source, 'javascript')).units;
  assert.equal(unit!.metadata.commentLines, 3);
  assert.equal(unit!.metadata.loc, 4);
});
