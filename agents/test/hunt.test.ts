import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { mergeConfig, type ClassifiedFinding, type ScanReport } from '@athena/core';

import { rankComponents, runHunt, validateHuntFindings } from '../src/hunt.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';

test('components are ranked by exposure x offline signals x AI-estimated share, and only the top three are returned', () => {
  const ranked = rankComponents({
    components: [{ path: '/r/api', files: 5 }, { path: '/r/lib', files: 9 }, { path: '/r/admin', files: 3 }, { path: '/r/utils', files: 2 }, { path: '/r/docs', files: 1 }],
    entrypoints: [{ file: '/r/api/a.js', exposure: 'public' }, { file: '/r/api/b.js', exposure: 'public' }, { file: '/r/admin/x.js', exposure: 'authenticated' }, { file: '/r/lib/y.js', exposure: 'internal' }],
    findingsPerFile: new Map([['/r/api/a.js', 3], ['/r/lib/y.js', 1], ['/r/utils/u.js', 4]]),
    aiShareByFile: new Map([['/r/api/a.js', 0.8], ['/r/admin/x.js', 0.1]]),
  }, 3);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0]!.path, '/r/api');
  assert.ok(!ranked.some((c) => c.path === '/r/docs'), 'no entry points, no findings, no AI code: not worth exploring');
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});

test('a hunt finding must cite a real file and line inside the component, or it is dropped', () => {
  const root = mkdtempSync(join(tmpdir(), 'hunt-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.js'), 'l1\nl2\nl3\n');
  const good = { title: 'IDOR', severity: 'HIGH', file: 'src/a.js', line: 2, explanation: 'no owner check', citations: ['src/a.js:2'] };
  const out = validateHuntFindings(root, [good, { ...good, file: '../outside.js', citations: ['../outside.js:1'] }, { ...good, line: 999 }, { ...good, citations: [] }, { ...good, citations: ['src/a.js:99'] }, { ...good, severity: 'WEIRD' }, { ...good, file: 'missing.js', citations: ['missing.js:1'] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.line, 2);
});

function component() {
  const root = mkdtempSync(join(tmpdir(), 'hunt-'));
  const write = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  for (const dir of ['api', 'admin', 'lib', 'extra']) write(`${dir}/h.js`, `const express = require('express');\nconst app = express();\napp.get('/${dir}', (req, res) => { res.send(String(req.query.q)); });\n`);
  return root;
}
const finding = (file: string): ClassifiedFinding => ({ id: `f-${file}`, severity: 'HIGH', type: 'T', category: 'c', message: 'm', file, line: 3, column: 1, code: 'x', aiScore: 0, explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] }, source: 'athena-taint', ruleId: 'taint.xss', confidence: 'medium' });

function scripted(): { provider: ModelProvider; requests: ChatRequest[]; toolRoots: string[] } {
  const requests: ChatRequest[] = [];
  const toolRoots: string[] = [];
  const provider: ModelProvider = {
    id: 'anthropic', endpoint: 'x',
    async chat(request) {
      requests.push(request);
      const lastIsToolResult = request.messages.at(-1)!.content.some((b) => b.type === 'tool_result');
      const area = /Component: (\S+)/.exec(request.system.volatile ?? '')?.[1] ?? '';
      if (!lastIsToolResult) return { text: '', toolCalls: [{ id: 't1', name: 'read_file', input: { path: 'h.js', startLine: null, endLine: null } }], stopReason: 'tool_use', usage: { inputTokens: 100, outputTokens: 10 }, model: 'm' };
      return { text: '', toolCalls: [], stopReason: 'end', usage: { inputTokens: 300, outputTokens: 50 }, model: 'm', json: { findings: [{ title: `Reflected XSS in ${area.split('/').pop()}`, severity: 'MEDIUM', file: 'h.js', line: 3, explanation: 'query value is echoed', citations: ['h.js:3'] }] } };
    },
    async countTokens() { return { tokens: 1, exact: true }; },
    capabilities: () => ({ tools: true, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
  return { provider, requests, toolRoots };
}

test('hunt explores only the top components, with tools confined to each; cited findings are added as athena-agent findings and known ones are not duplicated', async () => {
  const root = component();
  const report = { timestamp: 't', duration: 1, files: [{ path: join(root, 'api/h.js'), units: [], findings: [finding(join(root, 'api/h.js'))] }], summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false } } as unknown as ScanReport;
  const { provider, requests } = scripted();
  const out = await runHunt(report, { root, provider, providerId: 'anthropic', model: 'claude-sonnet-5-5', config: mergeConfig({}), maxComponents: 3, caps: { runUsd: 5, dayUsd: 50 }, home: mkdtempSync(join(tmpdir(), 'hunt-home-')) });
  assert.equal(out.explored.length, 3, 'only three of four components');
  const added = report.files.flatMap((f) => f.findings).filter((f) => f.source === 'athena-agent');
  assert.ok(added.length >= 2 && added.length <= 3);
  assert.ok(added.every((f) => f.ruleId.startsWith('agent.') && f.confidence === 'low' && f.evidence?.[0]?.includes('cited') && f.evidence[0].includes('not yet verified')));
  const areas = requests.map((r) => /Component: (\S+)/.exec(r.system.volatile ?? '')?.[1]);
  assert.equal(new Set(areas).size, 3);
  assert.ok(requests.every((r) => r.tools!.every((t) => ['read_file', 'list_dir', 'grep', 'find_symbol', 'find_callers', 'taint_paths', 'offline_findings', 'dependency_findings'].includes(t.name))));
  assert.ok(requests.every((r) => /untrusted repository data/.test(r.system.stable)));
});

test('hunt stops at the spend cap and reports the components it could not explore', async () => {
  const root = component();
  const report = { timestamp: 't', duration: 1, files: [], summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false } } as unknown as ScanReport;
  const { provider } = scripted();
  const out = await runHunt(report, { root, provider, providerId: 'anthropic', model: 'claude-sonnet-5-5', config: mergeConfig({}), maxComponents: 3, caps: { runUsd: 0.05, dayUsd: 50 }, home: mkdtempSync(join(tmpdir(), 'hunt-home-')) });
  assert.ok(out.explored.length < 3, `explored ${out.explored.length}`);
  assert.ok(out.notExplored.some((n) => /run cap/.test(n.reason)));
});

test('a model that cannot call tools is refused for hunt', async () => {
  const root = component();
  const report = { timestamp: 't', duration: 1, files: [], summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false } } as unknown as ScanReport;
  const { provider } = scripted();
  const noTools: ModelProvider = { ...provider, capabilities: () => ({ tools: false, structuredOutput: true, caching: 'none', exactTokenCount: false, local: true }) };
  await assert.rejects(runHunt(report, { root, provider: noTools, providerId: 'openai-compatible', model: 'llama3', config: mergeConfig({}), maxComponents: 3, caps: { runUsd: 1, dayUsd: 5 }, home: mkdtempSync(join(tmpdir(), 'hunt-home-')) }), /cannot call tools/);
});
