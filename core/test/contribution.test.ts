import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTRIBUTION_KEYS, buildContributions, isValidContribution, type ContributionInput } from '../src/learning/contribution.ts';

const meta = { installId: 'a'.repeat(32), cliVersion: '0.4.4', baseTag: 'fast:0.2.1', tuned: false };
const dense = Array.from({ length: 35 }, (_, i) => i / 7 + 0.123456);
const input = (over: Partial<ContributionInput> = {}): ContributionInput => ({ label: 'ai', source: 'recorded', language: 'typescript', lines: 47, dense, pBase: 0.91234, ...over });

test('a record has exactly the allowed keys, rounded numbers, and validates', () => {
  const [r] = buildContributions([input()], meta);
  assert.deepEqual(Object.keys(r!).sort(), [...CONTRIBUTION_KEYS].sort());
  assert.equal(r!.sizeBucket, 50, 'lines are rounded to buckets of 10');
  assert.ok(r!.style.every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9), 'style numbers have 2 decimals');
  assert.equal(r!.probabilities.ai, 0.912);
  assert.deepEqual(r!.modelVersions, { fast: '0.2.1' });
  assert.equal(r!.labelSource, 'git-recorded');
  assert.ok(isValidContribution(r));
});

test('labels map to the documented sources, and the heuristic base is named as such', () => {
  const rs = buildContributions([input({ source: 'pre-2021', label: 'human' }), input({ source: 'mark' })], { ...meta, baseTag: 'heuristic', tuned: true });
  assert.deepEqual(rs.map((r) => r.labelSource), ['pre-2021', 'user-correction']);
  assert.deepEqual(rs[0]!.modelVersions, { heuristic: 'style' });
  assert.equal(rs[0]!.tuned, true);
});

test('code, paths, secrets and hashes on the input never reach the payload (fuzz)', () => {
  const secrets = ['sk-ant-api03-SECRETSECRETSECRET', '/Users/arsh/Developer/athena/src/auth.ts', 'function login(password){ return db.query("select * from u where p=" + password) }', 'a'.repeat(64), 'person@example.com', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'];
  for (let i = 0; i < 200; i += 1) {
    const poisoned = { ...input({ lines: 1 + (i * 7) % 500 }), code: secrets[i % secrets.length], path: secrets[(i + 1) % secrets.length], sha: secrets[3], repo: secrets[4], author: secrets[4], language: i % 2 ? 'python' : 'go' } as ContributionInput;
    const json = JSON.stringify(buildContributions([poisoned], meta));
    for (const s of secrets.filter((x) => x !== secrets[3] && x !== 'a'.repeat(64))) assert.ok(!json.includes(s), `leaked ${s.slice(0, 20)}`);
    assert.ok(!json.includes('"code"') && !json.includes('"path"') && !json.includes('"sha"') && !json.includes('"repo"') && !json.includes('author'));
  }
});

test('a language that is not a plain identifier is dropped rather than sent', () => {
  assert.deepEqual(buildContributions([input({ language: '/Users/me/secret' }), input({ language: 'x y' }), input({ language: '' })], meta), []);
});

test('the server-side validator refuses extra keys, bad types and out-of-range values', () => {
  const [good] = buildContributions([input()], meta);
  assert.ok(isValidContribution(good));
  assert.ok(!isValidContribution({ ...good, code: 'x' }), 'an extra key');
  const { installId: _drop, ...missing } = good!;
  assert.ok(!isValidContribution(missing), 'a missing key');
  assert.ok(!isValidContribution({ ...good, label: 'mixed' }));
  assert.ok(!isValidContribution({ ...good, sizeBucket: 47 }));
  assert.ok(!isValidContribution({ ...good, probabilities: { ai: 1.5 } }));
  assert.ok(!isValidContribution({ ...good, probabilities: { ai: 0.5, human: 0.5 } }));
  assert.ok(!isValidContribution({ ...good, style: Array(100).fill(0) }));
  assert.ok(!isValidContribution({ ...good, installId: 'not-hex' }));
  assert.ok(!isValidContribution({ ...good, modelVersions: { fast: '../../etc/passwd' } }));
  assert.ok(!isValidContribution({ ...good, modelVersions: { other: '1' } }));
  assert.ok(!isValidContribution(null) && !isValidContribution([]) && !isValidContribution('x'));
});
