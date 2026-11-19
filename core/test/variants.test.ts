import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ProjectFile } from '../src/analysis/project.ts';
import { deriveVariantRule, previewVariant, saveVariant } from '../src/skills/variants.ts';

const js = (path: string, source: string): ProjectFile => ({ path, source, lang: 'javascript' });

const CONFIRMED = "function a(req) {\n  return db.run('select * from t where n = ' + req.query.n);\n}\n";
const finding = { ruleId: 'taint.sql-injection', file: '/p/a.js', line: 2, code: "db.run('select * from t where n = ' + req.query.n)" };

test('a confirmed finding generalises to a call rule with the unsafe argument shape', async () => {
  const rule = await deriveVariantRule(finding, CONFIRMED, 'javascript');
  assert.ok(rule);
  assert.match(rule!.id, /^learned\.[0-9a-f]{8}$/);
  assert.equal(rule!.severity, 'HIGH');
  assert.deepEqual(rule!.cwe, [89]);
  assert.equal(rule!.match.kind, 'call');
  assert.equal((rule!.match as { callee: string }).callee, '^db\\.run$');
  assert.deepEqual((rule!.match as { where: unknown[] }).where, [{ op: 'argIsConcat', index: 0 }]);
});

test('the rule finds two cousin call sites and not the parameterised one or the original', async () => {
  const rule = (await deriveVariantRule(finding, CONFIRMED, 'javascript'))!;
  const files = [
    js('/p/a.js', CONFIRMED),
    js('/p/b.js', "function b(id) {\n  db.run('select * from u where id = ' + id);\n  db.run(`delete from u where id = ${id}`);\n  db.run('select 1 where id = ?', [id]);\n  other.run('select ' + id);\n}\n"),
  ];
  const preview = await previewVariant(rule, files, '/p', finding);
  assert.deepEqual(preview.matches.map((m) => `${m.file.split('/').pop()}:${m.line}`).sort(), ['b.js:2', 'b.js:3']);
  assert.equal(preview.matches.every((m) => m.line !== finding.line || m.file !== finding.file), true);
});

test('saved rules are loaded by the next scan; an over-broad rule needs --force', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-var-'));
  const rule = (await deriveVariantRule(finding, CONFIRMED, 'javascript'))!;
  const saved = saveVariant(root, rule);
  assert.match(saved, /\.athena\/learned-rules\.json$/);
  const doc = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(doc.rules.length, 1);
  assert.equal(saveVariant(root, rule), saved);
  assert.equal(JSON.parse(readFileSync(saved, 'utf8')).rules.length, 1, 'saving twice does not duplicate');

  const { loadSkills } = await import('../src/skills/loader.ts');
  const loaded = loadSkills(root, { builtinDir: null, userDir: '/nope' });
  assert.equal(loaded.learned.length, 1);
  assert.deepEqual(loaded.warnings, []);

  const many = js('/p/m.js', Array.from({ length: 60 }, (_, i) => `db.run('select ' + v${i});`).join('\n') + '\n');
  const broad = await previewVariant(rule, [many], '/p');
  assert.equal(broad.matches.length, 60);
  assert.equal(broad.tooBroad, true);
  writeFileSync(join(root, 'x'), '');
});

test('a finding that is not a call produces no rule', async () => {
  assert.equal(await deriveVariantRule({ ruleId: 'crypto.weak-hash', file: '/p/a.js', line: 1, code: 'x' }, 'const x = 1;\n', 'javascript'), null);
});
