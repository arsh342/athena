import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalRouter } from '../src/terminal-router.ts';
import type { TerminalEvent } from '../src/terminal-protocol.ts';
import type { ScanSummary } from '../src/data.ts';

const sampleScan: ScanSummary = {
  scanId: 'scan-1',
  repoName: 'repo',
  repoUrl: 'https://github.com/org/repo',
  status: 'COMPLETED',
  createdAt: new Date().toISOString(),
  aiPercentage: 0,
  flaggedUnits: 0,
  filesScanned: 0,
  totalUnits: 0,
  findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
  duration: 1,
};

test('router returns help lines for help command', async () => {
  const events: TerminalEvent[] = [];
  const router = createTerminalRouter({
    runScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    runUploadScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    getScans: async () => [],
    getFindings: async () => [],
  });

  await router.handleCommand({
    user: { id: 1, email: 'dev@athena.dev' },
    command: 'help',
    send: (event) => events.push(event),
  });

  assert.equal(events[0]?.type, 'line');
  assert.ok(events.some((event) => event.type === 'done'));
});

test('router rejects unsupported commands', async () => {
  const events: TerminalEvent[] = [];
  const router = createTerminalRouter({
    runScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    runUploadScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    getScans: async () => [],
    getFindings: async () => [],
  });

  await router.handleCommand({
    user: { id: 1, email: 'dev@athena.dev' },
    command: 'rm -rf /',
    send: (event) => events.push(event),
  });

  assert.equal(events[0]?.type, 'line');
  assert.ok(events.some((event) => event.type === 'error'));
});
