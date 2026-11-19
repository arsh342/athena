import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveProposal } from '../../scripts/advisory-watch/derive-rule.ts';
import { findNew, fixCommitOf, toCandidate, type OsvRecord } from '../../scripts/advisory-watch/find-new.ts';
import { parseDiff } from '../../scripts/advisory-watch/fix-diff.ts';
import { prBody } from '../../scripts/advisory-watch/open-pr.ts';

const record = (over: Partial<OsvRecord> = {}): OsvRecord => ({
  id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1111'], summary: 'Command injection in netutil ping', modified: '2026-11-19T00:00:00Z',
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-78'] },
  references: [{ type: 'FIX', url: 'https://github.com/acme/netutil/commit/0123456789abcdef0123456789abcdef01234567' }],
  affected: [{ package: { ecosystem: 'npm', name: 'netutil' } }], ...over,
});

const BEFORE = "const { exec } = require('child_process');\n\nfunction ping(host) {\n  return exec('ping -c 1 ' + host);\n}\n\nmodule.exports = { ping };\n";
const AFTER = "const { execFile } = require('child_process');\n\nfunction ping(host) {\n  return execFile('ping', ['-c', '1', host]);\n}\n\nmodule.exports = { ping };\n";
const DIFF = 'diff --git a/lib/ping.js b/lib/ping.js\n--- a/lib/ping.js\n+++ b/lib/ping.js\n@@ -1,7 +1,7 @@\n-const { exec } = require(\'child_process\');\n+const { execFile } = require(\'child_process\');\n \n function ping(host) {\n-  return exec(\'ping -c 1 \' + host);\n+  return execFile(\'ping\', [\'-c\', \'1\', host]);\n }\n \n module.exports = { ping };\n';

test('fix commit extraction and candidate filtering with explicit skip reasons', () => {
  assert.deepEqual(fixCommitOf(record()), { owner: 'acme', repo: 'netutil', sha: '0123456789abcdef0123456789abcdef01234567' });
  assert.equal('reason' in toCandidate(record(), ['npm']), false);
  assert.deepEqual(toCandidate(record({ references: [] }), ['npm']), { id: 'GHSA-aaaa-bbbb-cccc', reason: 'no fix commit linked' });
  assert.match((toCandidate(record({ database_specific: { severity: 'LOW' } }), ['npm']) as { reason: string }).reason, /below HIGH/);
  assert.match((toCandidate(record({ id: 'CVE-2026-1' }), ['npm']) as { reason: string }).reason, /reviewed GitHub/);
  assert.match((toCandidate(record({ withdrawn: 'x' }), ['npm']) as { reason: string }).reason, /withdrawn/);
});

test('diff parsing yields old line numbers of removed lines', () => {
  const [file] = parseDiff(DIFF);
  assert.equal(file!.path, 'lib/ping.js');
  assert.deepEqual(file!.removed, [1, 4]);
});

test('findNew reads the listing and records, keeping advisories without a fix commit out with a note', async () => {
  const bodies: Record<string, string> = {
    'https://x/npm/modified_id.csv': '2026-11-19T01:00:00Z,GHSA-aaaa-bbbb-cccc\n2026-11-19T00:30:00Z,GHSA-dddd-eeee-ffff\n2026-11-01T00:00:00Z,GHSA-old\n',
    'https://x/npm/GHSA-aaaa-bbbb-cccc.json': JSON.stringify(record()),
    'https://x/npm/GHSA-dddd-eeee-ffff.json': JSON.stringify(record({ id: 'GHSA-dddd-eeee-ffff', references: [] })),
  };
  const r = await findNew({ since: '2026-11-18T00:00:00Z', ecosystem: 'npm', base: 'https://x', fetchText: async (u) => bodies[u]! });
  assert.deepEqual(r.candidates.map((c) => c.id), ['GHSA-aaaa-bbbb-cccc']);
  assert.deepEqual(r.skipped, [{ id: 'GHSA-dddd-eeee-ffff', reason: 'no fix commit linked' }]);
});

test('a recorded advisory yields a rule that matches the vulnerable code and not the fixed code, and a reviewable PR body', async () => {
  const candidate = toCandidate(record(), ['npm']);
  assert.ok(!('reason' in candidate));
  const proposal = await deriveProposal(candidate as never, { sha: '0123456789abcdef0123456789abcdef01234567', parent: 'p', diff: DIFF, files: [{ path: 'lib/ping.js', removed: [1, 4], before: BEFORE, after: AFTER }] });
  assert.ok(!('reason' in proposal), JSON.stringify(proposal));
  if ('reason' in proposal) return;
  assert.match(proposal.name, /^cve-ghsa-aaaa-bbbb-cccc$/);
  assert.equal(proposal.rule.id, 'cve-ghsa-aaaa-bbbb-cccc.variant');
  assert.match(proposal.files['fixtures/vuln/ping.js']!, /EXPECT cve-ghsa-aaaa-bbbb-cccc\.variant/);
  const body = prBody([{ candidate: candidate as never, proposal }], [{ id: 'GHSA-x', reason: 'no fix commit linked' }]);
  assert.match(body, /GHSA-aaaa-bbbb-cccc/);
  assert.match(body, /commit\/0123456789abcdef/);
  assert.match(body, /`vuln` fixture/);
  assert.match(body, /Skipped[\s\S]*GHSA-x: no fix commit linked/);
});

test('a fix that does not change a call with a non-literal argument yields no rule, with a reason', async () => {
  const c = toCandidate(record(), ['npm']) as never;
  const r = await deriveProposal(c, { sha: 's', parent: 'p', diff: '', files: [{ path: 'a.js', removed: [1], before: "const x = 'a';\n", after: "const x = 'b';\n" }] });
  assert.ok('reason' in r);
});
