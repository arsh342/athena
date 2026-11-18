import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { formatSarif } from '../src/report/sarif.ts';
import type { ClassifiedFinding, ScanReport, Severity } from '../src/types.ts';

const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-2.1.0.json', import.meta.url), 'utf8'));
const root = '/repo';
const explained = { score: 50, band: 'UNCERTAIN' as const, signalsTriggered: 1, variance: 0, topSignals: [] };

function finding(over: Partial<ClassifiedFinding>): ClassifiedFinding {
  return {
    id: 'abcdef1234', severity: 'HIGH', type: 'Hardcoded secret', category: 'credential-exposure', message: 'found',
    file: '/repo/src/a.ts', line: 3, column: 2, code: 'x', aiScore: 50, explainedScore: explained,
    source: 'secret-detector', ruleId: 'secret.hardcoded-secret', ...over,
  };
}

function report(findings: ClassifiedFinding[]): ScanReport {
  const unit = {
    unit: { id: 'u', name: 'f', kind: 'function' as const, filePath: '/repo/src/a.ts', startLine: 1, endLine: 10, code: '', metadata: { loc: 10, commentLines: 0, commentRatio: 0, identifiers: [], nestingDepth: 1, parameters: [], hasJSDoc: false, complexity: 1 } },
    score: 80, signals: [], flagged: true, explained: explained, provenance: 'ai' as const, recorded: false,
  };
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity] += 1;
  return {
    timestamp: new Date().toISOString(), duration: 1,
    summary: { filesScanned: 1, skippedFiles: 0, totalUnits: 1, flaggedUnits: 1, findings: counts, blocked: false, aiScore: 1, aiFlagRatio: 1, aiPercentage: 1,
      riskDensity: { criticalPer1kLoc: 0, findingsPer1kLoc: 0, flaggedRatio: 0 }, confidenceBands: { LOW: 0, UNCERTAIN: 0, HIGH: 0 } },
    files: [{ path: '/repo/src/a.ts', units: [unit], findings }],
  };
}

const opts = { toolVersion: '0.3.0', root };

test('SARIF output validates against the 2.1.0 schema', () => {
  const ajv = new Ajv({ strict: false });
  const applyFormats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats) as typeof addFormats;
  applyFormats(ajv);
  const out = JSON.parse(formatSarif(report([finding({}), finding({ id: 'b1', severity: 'LOW', ruleId: 'x', source: 'eslint', type: 'T' })]), opts));
  assert.equal(ajv.validate(schema, out), true, ajv.errorsText());
});

test('SARIF maps severities to levels and uses relative forward-slash uris', () => {
  const out = JSON.parse(formatSarif(report([
    finding({ id: '1', severity: 'CRITICAL' }), finding({ id: '2', severity: 'MEDIUM' }), finding({ id: '3', severity: 'LOW' }),
  ]), opts));
  assert.deepEqual(out.runs[0].results.map((r: { level: string }) => r.level), ['error', 'warning', 'note']);
  const loc = out.runs[0].results[0].locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, 'src/a.ts');
  assert.equal(loc.region.startLine, 3);
  assert.equal(out.runs[0].results[0].partialFingerprints.athenaFindingId, '1');
  assert.equal(out.runs[0].results[0].properties.aiProvenance, 'ai');
});

test('SARIF never contains a raw secret', () => {
  const raw = 'AKIA1234567890ABCDEF';
  const out = formatSarif(report([finding({ message: `Key ${raw} leaked`, code: raw, ruleId: 'secret.aws-access-key' })]), opts);
  assert.doesNotMatch(out, /AKIA[0-9A-Z]{16}/);
});
