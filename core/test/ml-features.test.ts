import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DENSE_FEATURE_NAMES, extractFeatures, FAMILIES, FEATURE_SPEC, HASH_BUCKETS } from '../src/ml/features.ts';
import { murmur3 } from '../src/ml/murmur3.ts';

const CODE = 'def add(a, b):\n    """Add."""\n    # sum them\n    total = a + b\n    return total\n';

test('murmur3 known vectors', () => {
  assert.equal(murmur3('', 0), 0);
  assert.equal(murmur3('hello', 0), 0x248bfa47);
  assert.equal(murmur3('', 1), 0x514e28b7);
  assert.equal(murmur3('The quick brown fox jumps over the lazy dog', 0), 0x2e4ff723);
});

test('features are deterministic and well-formed', () => {
  const a = extractFeatures({ code: CODE }, 'python');
  const b = extractFeatures({ code: CODE }, 'python');
  assert.equal(FEATURE_SPEC, 'fs1');
  assert.equal(a.dense.length, DENSE_FEATURE_NAMES.length);
  assert.deepEqual(Array.from(a.dense), Array.from(b.dense));
  assert.deepEqual([...a.hashed], [...b.hashed]);
  for (const v of a.dense) assert.ok(Number.isFinite(v));
  for (const bucket of a.hashed.keys()) assert.ok(bucket >= 0 && bucket < HASH_BUCKETS);
  const norm = Math.sqrt([...a.hashed.values()].reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5, `L2 norm ${norm}`);
  assert.equal(a.family[FAMILIES.indexOf('python')], 1);
  assert.equal(a.family.reduce((s, v) => s + v, 0), 1);
});

test('different code gives different features', () => {
  const a = extractFeatures({ code: CODE }, 'python');
  const b = extractFeatures({ code: 'function f(x) {\n  return x * 2;\n}\n' }, 'javascript');
  assert.notDeepEqual(Array.from(a.dense), Array.from(b.dense));
});

test('extract CLI round-trips three rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-fx-'));
  const input = join(dir, 'in.jsonl');
  const output = join(dir, 'out.jsonl');
  const rows = [['a', 'python', CODE], ['b', 'javascript', 'function f(x) {\n  return x;\n}\n'], ['c', 'go', 'func f() int {\n\treturn 1\n}\n']];
  writeFileSync(input, rows.map(([id, language, code]) => JSON.stringify({ id, language, code })).join('\n') + '\n');
  const cli = join(import.meta.dirname, '..', 'src', 'ml', 'extract-cli.ts');
  execFileSync(process.execPath, ['--import', 'tsx', cli, '--in', input, '--out', output]);
  const out = readFileSync(output, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'c']);
  const direct = extractFeatures({ code: CODE }, 'python');
  assert.deepEqual(out[0].dense, Array.from(direct.dense));
  assert.equal(out[0].idx.length, direct.hashed.size);
  assert.equal(out[0].idx.length, out[0].val.length);
});
