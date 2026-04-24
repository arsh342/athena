import assert from 'node:assert/strict';
import test from 'node:test';

import { detectSecrets } from '../src/analyzers/secret-detector.ts';
import type { ScoredUnit } from '../src/types.ts';

function makeScoredUnit(code: string): ScoredUnit {
  return {
    unit: {
      id: 'u1',
      name: 'apiCall',
      kind: 'function',
      filePath: 'src/api.ts',
      startLine: 10,
      endLine: 30,
      code,
      metadata: {
        loc: 20,
        commentLines: 0,
        commentRatio: 0,
        identifiers: [],
        nestingDepth: 1,
        parameters: [],
        hasJSDoc: false,
        complexity: 1,
      },
    },
    score: 70,
    signals: [],
    flagged: true,
    explained: {
      score: 70,
      band: 'HIGH',
      signalsTriggered: 0,
      variance: 0,
      topSignals: [],
    },
  };
}

test('detectSecrets labels hardcoded credential type based on matched key', () => {
  const scored = makeScoredUnit(`
    const password = 'hunter2hunter2';
    const apiKey = 'abcdefghijklmnop';
    const token = 'qrstuvwxyz123456';
    const secret = 'supersecretvalue';
  `);

  const findings = detectSecrets(scored);
  const types = new Set(findings.map((finding) => finding.type));

  assert.equal(types.has('Hardcoded password'), true);
  assert.equal(types.has('Hardcoded API key'), true);
  assert.equal(types.has('Hardcoded token'), true);
  assert.equal(types.has('Hardcoded secret'), true);
});

test('detectSecrets still detects explicit token patterns', () => {
  const scored = makeScoredUnit("const gh = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB';");

  const findings = detectSecrets(scored);

  assert.equal(findings.some((finding) => finding.type === 'GitHub token'), true);
});

test('detectSecrets catches Sequelize positional constructor credentials', () => {
  const scored = makeScoredUnit(`
    import { Sequelize } from 'sequelize';
    const sequelize = new Sequelize('beeii', 'root', '2154', {
      host: 'localhost',
      dialect: 'mysql',
    });
  `);

  const findings = detectSecrets(scored);

  assert.equal(findings.some((finding) => finding.type === 'Hardcoded database credentials'), true);
});
