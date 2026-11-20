import { createStatus } from '../utils/scan-progress.js';
import { createInterface } from 'node:readline/promises';
import type { AthenaConfig, ScanReport } from '@athena/core';
import type { AiRunOptions } from '../utils/run-options.js';
import { writeInfo } from '../utils/output.js';

async function confirmOnTerminal(notice: string, yes: boolean): Promise<boolean> {
  writeInfo(notice);
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    writeInfo('AI verification needs your agreement to send code excerpts: re-run with --yes (or in a terminal to be asked).');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question('Send these excerpts to the provider? [y/N] ')).trim());
  } finally {
    rl.close();
  }
}

async function confirmDeep(estimate: string, yes: boolean): Promise<boolean> {
  writeInfo(estimate);
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    writeInfo('Deep mode needs your agreement in a non-interactive run: re-run with --yes (and your --budget).');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question('Run deep mode? [y/N] ')).trim());
  } finally {
    rl.close();
  }
}

/** The optional AI step: only medium/low confidence findings, under hard spend caps. Failures here never fail the scan. */
export async function runAiStep(report: ScanReport, config: Pick<AthenaConfig, 'blockOn' | 'updates'>, ai: AiRunOptions, root: string, showStatus = false): Promise<void> {
  const label = ai.mode === 'deep' ? 'Running deep analysis' : ai.mode === 'hunt' ? 'Hunting with AI' : 'Verifying with AI';
  let status = { stop: () => undefined as void };
  const begin = () => { status = createStatus({ enabled: showStatus, stream: process.stderr, label }); };
  // A prompt and a spinner cannot share the line: stop the spinner while the user is being asked something.
  const paused = async <T>(ask: () => Promise<T>): Promise<T> => {
    status.stop();
    try {
      return await ask();
    } finally {
      begin();
    }
  };
  try {
    const agents = await import('@athena/agents');
    const fake = process.env.ATHENA_AGENTS_FAKE ? (await import('./ai-fake.js')).fakeProvider(process.env.ATHENA_AGENTS_FAKE) : undefined;
    if (fake) writeInfo('warning: ATHENA_AGENTS_FAKE is set: using a fake test provider, nothing is sent anywhere');
    begin();
    await agents.runAiVerify(report, {
      root, config, provider: ai.provider, quality: ai.quality, mode: ai.mode,
      ...(ai.model ? { model: ai.model } : {}),
      ...(ai.baseUrl ? { baseUrl: ai.baseUrl } : {}),
      ...(ai.preset ? { preset: ai.preset } : {}),
      ...(ai.budget ? { budget: ai.budget } : {}),
      ...(fake ? { providerOverride: fake } : {}),
      ...(ai.mode === 'deep' ? { budgetExplicit: Boolean(ai.budget), confirmDeep: (estimate: string) => paused(() => confirmDeep(estimate, ai.yes)), suggestFixes: ai.suggestFixes } : {}),
      // Without a person at the keyboard the panel goes through the provider's batch API (half the price, slower).
      ...(ai.mode === 'deep' && !(process.stdin.isTTY && process.stderr.isTTY) ? { useBatch: true } : {}),
      confirm: (notice) => paused(() => confirmOnTerminal(notice, ai.yes)),
    });
  } catch (error) {
    status.stop();
    writeInfo(`warning: AI verification was skipped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    status.stop();
  }
}
