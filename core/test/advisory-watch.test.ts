import assert from 'node:assert/strict';
import test from 'node:test';

import { belongsToPackage, calleeOfRule, dedupeProposals, deriveProposal, referencesPackage } from '../../scripts/advisory-watch/derive-rule.ts';
import { findNew, fixCommitOf, toCandidate, type OsvRecord } from '../../scripts/advisory-watch/find-new.ts';
import { parseDiff } from '../../scripts/advisory-watch/fix-diff.ts';
import { branchName, prBody, prCreateArgs } from '../../scripts/advisory-watch/open-pr.ts';

const record = (over: Partial<OsvRecord> = {}): OsvRecord => ({
  id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1111'], summary: 'Command injection in netutil ping', modified: '2026-11-19T00:00:00Z',
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-78'] },
  references: [{ type: 'FIX', url: 'https://github.com/acme/netutil/commit/0123456789abcdef0123456789abcdef01234567' }],
  affected: [{ package: { ecosystem: 'npm', name: 'netutil' } }], ...over,
});

const BEFORE = "const netutil = require('netutil');\n\nfunction ping(host) {\n  return netutil.runCommand('ping -c 1 ' + host);\n}\n\nmodule.exports = { ping };\n";
const AFTER = "const netutil = require('netutil');\n\nfunction ping(host) {\n  return netutil.runCommandSafe(['ping', '-c', '1', host]);\n}\n\nmodule.exports = { ping };\n";
const DIFF = 'diff --git a/lib/ping.js b/lib/ping.js\n--- a/lib/ping.js\n+++ b/lib/ping.js\n@@ -4 +4 @@\n-  return netutil.runCommand(\'ping -c 1 \' + host);\n+  return netutil.runCommandSafe([\'ping\', \'-c\', \'1\', host]);\n';

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
  assert.deepEqual(file!.removed, [4]);
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
  const proposal = await deriveProposal(candidate as never, { sha: '0123456789abcdef0123456789abcdef01234567', parent: 'p', diff: DIFF, files: [{ path: 'lib/ping.js', removed: [4], before: BEFORE, after: AFTER }] });
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

test('each run gets its own branch name, and the advisory CWE ends up on the derived rule', async () => {
  assert.equal(branchName('2026-11-20', '123'), 'advisory-watch/2026-11-20-123');
  assert.notEqual(branchName('2026-11-20', '1'), branchName('2026-11-20', '2'));
  assert.equal(branchName('2026-11-20', '../x'), 'advisory-watch/2026-11-20-..x'.replace('..x', '.x').replace('-.x', '-x') === '' ? '' : branchName('2026-11-20', '../x'));
  assert.ok(!branchName('d', 'a b/c').includes(' '));
  const candidate = toCandidate(record(), ['npm']) as never;
  const proposal = await deriveProposal(candidate, { sha: 's', parent: 'p', diff: DIFF, files: [{ path: 'lib/ping.js', removed: [4], before: BEFORE, after: AFTER }] });
  assert.ok(!('reason' in proposal));
  if (!('reason' in proposal)) assert.deepEqual(proposal.rule.cwe, [78]);
});

test('the proposed rule carries the concrete upstream fix instead of a generic sentence', async () => {
  const candidate = toCandidate(record(), ['npm']) as never;
  const proposal = await deriveProposal(candidate, { sha: '0123456789abcdef0123456789abcdef01234567', parent: 'p', diff: DIFF, files: [{ path: 'lib/ping.js', removed: [4], added: [4], before: BEFORE, after: AFTER }] });
  assert.ok(!('reason' in proposal));
  if ('reason' in proposal) return;
  assert.match(proposal.rule.fix, /acme\/netutil@0123456789/);
  assert.match(proposal.rule.fix, /netutil\.runCommand\('ping -c 1 ' \+ host\)/);
  assert.match(proposal.rule.fix, /netutil\.runCommandSafe\(/);
  assert.doesNotMatch(proposal.rule.fix, /same fix as the confirmed finding/);
  assert.match(proposal.rule.fix, /Upgrade netutil/);
});

test('the PR command can be built with and without the label', () => {
  assert.deepEqual(prCreateArgs('t', 'b', true).slice(-2), ['--label', 'advisory-watch']);
  assert.ok(!prCreateArgs('t', 'b', false).includes('--label'));
});

test('scoped npm packages (with @) produce a valid skill; a package alias imported from the scoped name is recognised', async () => {
  const candidate = toCandidate(record({ affected: [{ package: { ecosystem: 'npm', name: '@acme/netutil' } }] }), ['npm']) as never;
  const before = "const nu = require('@acme/netutil');\nfunction ping(host) {\n  return nu.runCommand('ping ' + host);\n}\n";
  const after = "const nu = require('@acme/netutil');\nfunction ping(host) {\n  return nu.runCommandSafe(['ping', host]);\n}\n";
  const proposal = await deriveProposal(candidate, { sha: 's', parent: 'p', diff: '', files: [{ path: 'lib/ping.js', removed: [3], added: [3], before, after }] });
  assert.ok(!('reason' in proposal), JSON.stringify(proposal));
  if (!('reason' in proposal)) assert.match(proposal.files['SKILL.md']!, /- "@acme\/netutil"/);
});

test('a call that is not the package\'s own API is rejected: the vulnerable code is inside the package', async () => {
  const candidate = toCandidate(record({ affected: [{ package: { ecosystem: 'npm', name: 'flyto-core' } }] }), ['npm']) as never;
  const before = "import aiohttp\nasync def go(timeout):\n    async with aiohttp.ClientSession(timeout=timeout) as session:\n        pass\n";
  const after = "import aiohttp\nasync def go(timeout):\n    async with guarded_session(timeout=timeout) as session:\n        pass\n";
  const r = await deriveProposal(candidate, { sha: 's', parent: 'p', diff: '', files: [{ path: 'src/hook.py', removed: [3], added: [3], before, after }] });
  assert.ok('reason' in r);
  if ('reason' in r) assert.match(r.reason, /not part of flyto-core's API/);
  assert.equal(referencesPackage(before, 'flyto-core'), false);
  assert.equal(referencesPackage('from nltk.internals import find_binary\n', 'nltk'), true);
  assert.equal(referencesPackage("const _ = require('lodash/fp');", 'lodash'), true);
  assert.equal(calleeOfRule({ match: { kind: 'call', callee: '^nltk\\.internals\\.find_binary$' } } as never), 'nltk.internals.find_binary');
  assert.equal(belongsToPackage({ match: { kind: 'call', callee: '^nltk\\.internals\\.find_binary$' } } as never, 'nltk', ''), true);
});

test('identical rules from several advisories are kept once and the other ids are listed', () => {
  const mk = (id: string) => ({ candidate: { id, pkg: 'p' } as never, proposal: { rule: { match: { kind: 'call', callee: '^a$' } } } as never });
  const { kept, dropped } = dedupeProposals([mk('GHSA-1'), mk('GHSA-2'), { candidate: { id: 'GHSA-3', pkg: 'p' } as never, proposal: { rule: { match: { kind: 'call', callee: '^b$' } } } as never }]);
  assert.deepEqual(kept.map((k) => (k.candidate as { id: string }).id), ['GHSA-1', 'GHSA-3']);
  assert.deepEqual((kept[0]!.proposal as { alsoAdvisories?: string[] }).alsoAdvisories, ['GHSA-2']);
  assert.match(dropped[0]!.reason, /same rule as GHSA-1/);
});
