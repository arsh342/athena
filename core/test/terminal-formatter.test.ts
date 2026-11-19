import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTerminalReport, gateLine, type TerminalReportOptions } from '../src/report/terminal-formatter.ts';
import type { AiProvenance, ClassifiedFinding, ScanCoverage, ScanReport, ScoredUnit, Severity } from '../src/types.ts';

const explained = { score: 80, band: 'HIGH' as const, signalsTriggered: 1, variance: 0, topSignals: [] };
const SECRET = 'AKIA1234567890ABCDEF';

function finding(id: string, severity: Severity, line: number, over: Partial<ClassifiedFinding> = {}): ClassifiedFinding {
  return {
    id: `${id}0000000`.slice(0, 10), severity, type: `Type ${severity}`, category: 'c', message: 'm',
    file: '/app/src/a.ts', line, column: 1, code: 'x', aiScore: 80, explainedScore: explained,
    source: 'eslint', ruleId: `rule.${severity.toLowerCase()}`, ...over,
  };
}

const unit = (provenance: ScoredUnit['provenance']): ScoredUnit => ({
  unit: { id: 'u', name: 'f', kind: 'function', filePath: '/app/src/a.ts', startLine: 1, endLine: 40, code: '',
    metadata: { loc: 40, commentLines: 0, commentRatio: 0, identifiers: [], nestingDepth: 1, parameters: [], hasJSDoc: false, complexity: 1 } },
  score: 80, signals: [], flagged: true, explained, provenance, recorded: false,
});

const completeCoverage: ScanCoverage = {
  files: [{ path: '/app/src/a.ts', status: 'analyzed' }, { path: '/app/src/b.ts', status: 'analyzed' }, { path: '/app/src/c.ts', status: 'analyzed' }],
  checks: [{ name: 'secrets', status: 'ran' }, { name: 'ai-provenance', status: 'ran', detail: 'heuristic' }, { name: 'semgrep', status: 'disabled' }],
  complete: true, gaps: [],
};

const provenance: AiProvenance = {
  unit: 'lines', totalLines: 100,
  recorded: { lines: 18, available: true },
  estimated: { method: 'heuristic', aiLines: 35, mixedLines: 9, uncertainLines: 7, humanLines: 49 },
  files: [{ path: '/app/src/a.ts', lines: 100, recordedLines: 18, aiLines: 35, mixedLines: 9, uncertainLines: 7 }],
};

function report(findings: ClassifiedFinding[], over: Partial<ScanReport['summary']> = {}, units = [unit('ai')]): ScanReport {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity] += 1;
  return {
    timestamp: 't', duration: 500,
    summary: {
      filesScanned: 3, skippedFiles: 0, totalUnits: 1, flaggedUnits: 1, findings: counts,
      blocked: counts.CRITICAL + counts.HIGH > 0, aiScore: 80, aiFlagRatio: 1, aiPercentage: 35,
      riskDensity: { criticalPer1kLoc: 0, findingsPer1kLoc: 0, flaggedRatio: 0 },
      confidenceBands: { LOW: 0, UNCERTAIN: 0, HIGH: 1 },
      coverage: completeCoverage, aiProvenance: provenance, ...over,
    },
    files: [{ path: '/app/src/a.ts', units, findings }],
  };
}

const opts: TerminalReportOptions = { color: false, version: '0.3.0', mode: 'scan', target: './app', failOn: 'high', root: '/app' };
const blocked = () => report([finding('c1', 'CRITICAL', 12), finding('h1', 'HIGH', 20), finding('l1', 'LOW', 5), finding('l2', 'LOW', 6)]);

test('blocked report shows gate, findings sorted, LOW collapsed, explain hint', () => {
  const out = formatTerminalReport(blocked(), opts);
  assert.match(out, /^athena 0\.3\.0 · scan \.\/app · 3 files · 0\.5s$/m);
  assert.match(out, /^ BLOCKED {2}1 critical · 1 high {3}\(fail-on: high\)$/m);
  assert.ok(out.indexOf('Type CRITICAL') < out.indexOf('Type HIGH'));
  assert.match(out, /\+ 2 low \(use --show-low\)/);
  assert.match(out, /src\/a\.ts:12/);
  assert.match(out, /^Next: athena explain [0-9a-f]{6} --path \.\/app$/m);
  assert.doesNotMatch(out, /\x1b\[/);
});

test('--show-low lists LOW findings', () => {
  const out = formatTerminalReport(blocked(), { ...opts, showLow: true });
  assert.match(out, /Type LOW/);
  assert.doesNotMatch(out, /use --show-low/);
});

test('incomplete clean scan is PASS (incomplete) with gaps listed', () => {
  const coverage: ScanCoverage = {
    files: [{ path: '/app/src/a.ts', status: 'analyzed' }, { path: '/app/src/bad.js', status: 'parse-failed', reason: 'Unexpected token (line 4)' }],
    checks: [{ name: 'semgrep', status: 'unavailable' }], complete: false, gaps: ['1 file(s) not parsed', 'semgrep unavailable'],
  };
  const out = formatTerminalReport(report([], { coverage }), opts);
  assert.match(out, /^ PASS \(incomplete\) {2}1 file\(s\) not parsed · semgrep unavailable$/m);
  assert.match(out, /! 1 file\(s\) not parsed/);
  assert.match(out, /bad\.js.*Unexpected token \(line 4\)/);
  assert.match(out, /! semgrep unavailable → athena doctor/);
  assert.match(out, /1\/2 files analyzed/);
});

test('clean complete scan is PASS', () => {
  const out = formatTerminalReport(report([]), opts);
  assert.match(out, /^ PASS {2}no findings at or above high$/m);
});

test('code frame is numbered, marked and redacted for secrets', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  lines[11] = `const key = '${SECRET}'`;
  const f = finding('s1', 'CRITICAL', 12, { source: 'secret-detector', ruleId: 'secret.aws-access-key' });
  const out = formatTerminalReport(report([f]), { ...opts, readLines: () => lines });
  assert.match(out, /^ +> 12 │ .*\[REDACTED\]/m);
  assert.match(out, /^ +11 │ line 11$/m);
  assert.doesNotMatch(out, /AKIA[0-9A-Z]{16}/);
  assert.match(out, /in AI-estimated code/);
});

test('AI provenance section: recorded floor, estimated range, uncertain, method', () => {
  const out = formatTerminalReport(blocked(), opts);
  assert.match(out, /^AI provenance {2}\(by lines\)$/m);
  assert.match(out, /recorded: 18% \(floor\)/);
  assert.match(out, /estimated: 35–44%/);
  assert.match(out, /uncertain: 7%/);
  assert.match(out, /method: heuristic \(low confidence\)/);
  assert.match(out, /most AI-estimated: src\/a\.ts 35%/);
});

test('recorded unavailable prints its reason', () => {
  const p: AiProvenance = { ...provenance, recorded: { lines: 0, available: false, reason: 'not a git repository' } };
  const out = formatTerminalReport(report([], { aiProvenance: p }), opts);
  assert.match(out, /recorded: not available \(not a git repository\)/);
});

test('color: true uses bright red for CRITICAL and never brand orange for severities', () => {
  const out = formatTerminalReport(blocked(), { ...opts, color: true });
  assert.match(out, /\x1b\[91m[^\n]*CRITICAL/);
  assert.doesNotMatch(out, /\x1b\[38;2;232;122;65m[^\n]*CRITICAL/);
});

test('gateLine: blocked beats incomplete', () => {
  const cov: ScanCoverage = { ...completeCoverage, complete: false, gaps: ['x'] };
  assert.equal(gateLine(report([finding('c', 'CRITICAL', 1)], { coverage: cov }), 'high').status, 'BLOCKED');
});

test('delta line summarises new and resolved findings', () => {
  const delta = {
    baseline: false, riskScore: { current: 1, previous: 0, change: 1 },
    findings: { current: 1, previous: 3, change: -2, new: 1, resolved: 3,
      newBySeverity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 }, resolvedBySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 3 } },
    folders: [], regressionAlert: false,
  };
  const out = formatTerminalReport(report([], { delta }), opts);
  assert.match(out, /^Since last scan: \+1 critical · −3 low$/m);
});

test('code frames redact secrets even when the finding itself is not a secret finding', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  lines[11] = `const password = "hunter2hunter2xyz"; axios.fetchData(password);`;
  const f = finding('h1', 'HIGH', 12, { source: 'hallucination-detector', type: 'Hallucinated API call', ruleId: 'hallucination.invalid-api-call', message: 'axios.fetchData is not part of the known API surface.' });
  const out = formatTerminalReport(report([f]), { ...opts, readLines: () => lines });
  assert.doesNotMatch(out, /hunter2/);
  assert.match(out, /\[REDACTED\]/);
});

test('explain hint carries --path when the target is not the current directory', () => {
  const out = formatTerminalReport(blocked(), { ...opts, target: 'leak/src' });
  assert.match(out, /^Next: athena explain [0-9a-f]{6} --path leak\/src$/m);
  const here = formatTerminalReport(blocked(), { ...opts, target: '.' });
  assert.match(here, /^Next: athena explain [0-9a-f]{6}$/m);
});

test('header lists files per language family, most common first', () => {
  const r = report([], { filesScanned: 5, languages: { python: { files: 1, units: 1, lines: 10 }, typescript: { files: 2, units: 3, lines: 40 }, tsx: { files: 1, units: 1, lines: 5 }, go: { files: 1, units: 1, lines: 9 } } });
  const out = formatTerminalReport(r, opts);
  assert.match(out, /· 5 files \(js 3 · go 1 · py 1\)/);
});
