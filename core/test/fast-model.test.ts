import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractFeatures, FEATURE_SPEC, HASH_BUCKETS } from '../src/ml/features.ts';
import { classifyUnit, decide, loadFastModel, type FastModelMeta } from '../src/provenance/fast-model.ts';

const N_FEATURES = HASH_BUCKETS + 35 + 9;
const CLASSES = ['human', 'ai', 'refined'];
const CODE = 'def add(a, b):\n    total = a + b\n    # sum\n    return total\n';

function f16(value: number): number {
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, value);
  const x = buf.getUint32(0);
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = (x >>> 13) & 0x3ff;
  if (exp <= 0) return sign;
  if (exp >= 31) { exp = 31; mant = 0; }
  return sign | (exp << 10) | mant;
}

function writeModel(dir: string, over: Partial<FastModelMeta> = {}, truncate = false): void {
  const weights = Buffer.alloc(CLASSES.length * N_FEATURES * 2);
  // class 1 ("ai") likes the 'doc_comment'-free dense slot 4 (avg_line_len): weight 6
  weights.writeUInt16LE(f16(6), (1 * N_FEATURES + HASH_BUCKETS + 4) * 2);
  weights.writeUInt16LE(f16(-6), (0 * N_FEATURES + HASH_BUCKETS + 4) * 2);
  const biases = Buffer.alloc(CLASSES.length * 4);
  biases.writeFloatLE(0.1, 0);
  const bin = Buffer.concat([weights, biases]);
  writeFileSync(join(dir, 'athena-detect-fast-test.bin'), truncate ? bin.subarray(0, 100) : bin);
  const meta: FastModelMeta = {
    version: 'test', featureSpec: FEATURE_SPEC, classes: CLASSES, temperature: 1.5, nFeatures: N_FEATURES,
    languages: { python: { enabled: true, threshold: 0.6 }, go: { enabled: false, threshold: 0.5 } },
    benchmark: {}, ...over,
  };
  writeFileSync(join(dir, 'athena-detect-fast-test.json'), JSON.stringify(meta));
}

test('loadFastModel reads a model and computes temperature-scaled probabilities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(dir);
  const model = loadFastModel(dir)!;
  assert.ok(model);
  const f = extractFeatures({ code: CODE }, 'python');
  const x = f.dense[4]!;
  const logits = [0.1 + -6 * x, 6 * x, 0];
  const exp = logits.map((l) => Math.exp(l / 1.5 - Math.max(...logits) / 1.5));
  const sum = exp.reduce((a, b) => a + b, 0);
  const { probabilities } = classifyUnit(model, { code: CODE }, 'python');
  assert.ok(Math.abs(probabilities.human - exp[0]! / sum) < 1e-6);
  assert.ok(Math.abs(probabilities.ai - exp[1]! / sum) < 1e-6);
  assert.ok(Math.abs(probabilities.refined - exp[2]! / sum) < 1e-6);
  assert.ok(Math.abs(probabilities.human + probabilities.ai + probabilities.refined + probabilities.adversarial - 1) < 1e-9);
});

test('decision rules', () => {
  const p = (human: number, ai: number, refined: number, adversarial = 0) => ({ human, ai, refined, adversarial });
  assert.equal(decide(p(0.2, 0.7, 0.1), 0.6), 'ai');
  assert.equal(decide(p(0.2, 0.5, 0.1, 0.2), 0.6), 'ai'); // adversarial counts as AI
  assert.equal(decide(p(0.45, 0.5, 0.05), 0.6), 'uncertain'); // below the language threshold
  assert.equal(decide(p(0.75, 0.15, 0.1), 0.6), 'human');
  assert.equal(decide(p(0.3, 0.1, 0.6), 0.6), 'mixed');
  assert.equal(decide(p(0.5, 0.2, 0.3), 0.6), 'uncertain');
});

test('disabled and unknown languages are not classified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(dir);
  const model = loadFastModel(dir)!;
  assert.equal(classifyUnit(model, { code: CODE }, 'go'), null);
  assert.equal(classifyUnit(model, { code: CODE }, 'rust'), null);
  assert.deepEqual(model.heuristicLanguages(['python', 'go', 'rust']), ['go', 'rust']);
});

test('missing, corrupt or mismatched model files give null', () => {
  assert.equal(loadFastModel(mkdtempSync(join(tmpdir(), 'athena-fm-'))), null);
  const truncated = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(truncated, {}, true);
  assert.equal(loadFastModel(truncated), null);
  const wrongSpec = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(wrongSpec, { featureSpec: 'fs0' });
  assert.equal(loadFastModel(wrongSpec), null);
  const badJson = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(badJson);
  writeFileSync(join(badJson, 'athena-detect-fast-test.json'), '{not json');
  assert.equal(loadFastModel(badJson), null);
});

import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { formatTerminalReport } from '../src/report/terminal-formatter.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';

const noExternal = {
  eslint: { enabled: false, timeoutMs: 1000 },
  npmAudit: { enabled: false, timeoutMs: 1000 }, };

test('scan uses the fast model where enabled, heuristic elsewhere, and says so', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-fm-scan-'));
  writeModel(dir);
  const model = loadFastModel(dir)!;
  const py = join(dir, 'a.py');
  const go = join(dir, 'b.go');
  writeFileSync(py, 'def f(a):\n    x = a + 1\n    y = x * 2\n    z = y - 3\n    return z\n');
  writeFileSync(go, 'package m\n\nfunc F(a int) int {\n\tx := a + 1\n\ty := x * 2\n\treturn y\n}\n');
  const options = { root: dir, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: model };
  const report = await scanFiles([py, go], mergeConfig(noExternal), {}, options);
  const est = report.summary.aiProvenance!.estimated;
  assert.equal(est.method, 'fast');
  assert.equal(est.model, 'athena-detect-fast test');
  assert.deepEqual(est.heuristicLanguages, ['go']);
  assert.deepEqual(report.summary.coverage!.checks.find((c) => c.name === 'ai-provenance'), { name: 'ai-provenance', status: 'ran', detail: 'athena-detect-fast test' });
  const text = formatTerminalReport(report, { version: '1', mode: 'scan', target: '.', color: false } as never);
  assert.match(text, /method: athena-detect-fast test · heuristic for: go/);

  const fallback = await scanFiles([py], mergeConfig(noExternal), {}, { ...options, fastModel: null });
  assert.equal(fallback.summary.aiProvenance!.estimated.method, 'heuristic');
  assert.match(fallback.summary.coverage!.checks.find((c) => c.name === 'ai-provenance')!.detail!, /fast model unavailable/);
});

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { probabilitiesFromFeatures } from '../src/provenance/fast-model.ts';
import type { LanguageId } from '../src/lang/languages.ts';

test('TypeScript inference matches the Python reference within 1e-6 on the bundled model', () => {
  const model = loadFastModel();
  assert.ok(model, 'bundled model missing: run the ml training');
  const fixture = JSON.parse(gunzipSync(readFileSync(join(import.meta.dirname, 'fixtures', 'fast-parity.json.gz'))).toString('utf8')) as {
    model: string;
    vectors: Array<{ language: LanguageId; dense: number[]; idx: number[]; val: number[]; probs: Record<string, number> }>;
  };
  assert.equal(fixture.vectors.length, 200);
  assert.equal(fixture.model, `athena-detect-fast-${model.meta.version}`);
  for (const v of fixture.vectors) {
    const got = probabilitiesFromFeatures(model, { dense: v.dense, hashed: new Map(v.idx.map((b, i) => [b, v.val[i]!])) }, v.language);
    for (const [cls, expected] of Object.entries(v.probs)) {
      assert.ok(Math.abs(got[cls as keyof typeof got] - expected) < 1e-6, `${cls}: ${got[cls as keyof typeof got]} vs ${expected}`);
    }
  }
});

test('structurally invalid model metadata returns null instead of crashing or misclassifying', () => {
  const cases: Array<[string, Partial<FastModelMeta> | Record<string, unknown>]> = [
    ['languages missing', { languages: undefined }],
    ['languages null', { languages: null }],
    ['zero temperature', { temperature: 0 }],
    ['NaN temperature', { temperature: Number.NaN }],
    ['unknown class', { classes: ['human', 'ai', 'bogus'] }],
    ['no human class', { classes: ['ai', 'refined', 'adversarial'] }],
    ['bad threshold', { languages: { python: { enabled: true, threshold: 0.2 } } }],
    ['threshold missing', { languages: { python: { enabled: true } } }],
    ['enabled not boolean', { languages: { python: { enabled: 'yes', threshold: 0.6 } } }],
  ];
  for (const [name, over] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'athena-fm-'));
    writeModel(dir, over as Partial<FastModelMeta>);
    assert.equal(loadFastModel(dir), null, name);
  }
  const nan = mkdtempSync(join(tmpdir(), 'athena-fm-'));
  writeModel(nan);
  const bin = join(nan, 'athena-detect-fast-test.bin');
  const buf = readFileSync(bin);
  buf.writeUInt16LE(0x7e00, 10); // float16 NaN
  writeFileSync(bin, buf);
  assert.equal(loadFastModel(nan), null, 'NaN weight');
});

test('report estimated block carries no internal fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-fm-keys-'));
  const f = join(dir, 'a.py');
  writeFileSync(f, 'def f(a):\n    x = a + 1\n    y = x * 2\n    z = y - 3\n    return z\n');
  writeModel(dir, { languages: { python: { enabled: false, threshold: 0.5 } } });
  const report = await scanFiles([f], mergeConfig(noExternal), {}, { root: dir, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: loadFastModel(dir) });
  assert.deepEqual(Object.keys(report.summary.aiProvenance!.estimated).sort(), ['aiLines', 'humanLines', 'method', 'mixedLines', 'uncertainLines']);
});
