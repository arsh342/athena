import { createInterface } from 'node:readline/promises';
import { loadLearning, saveLearning } from '@athena/core';
import { isCi } from './scan-progress.js';
import { pendingContributions, sendContributions } from './share.js';
import { ensureInstallId, loadSettings, saveSettings, shareUrl, sharingState } from './settings.js';
import { writeInfo } from './output.js';
import { CLI_VERSION } from '../version.js';

const MAX_REMEMBERED = 5000;

export interface ShareArgs {
  root: string;
  mode: 'scan' | 'check' | 'review';
  /** The scan used local learning (`--no-learning` and `learning: false` turn it off, and then nothing is shared either). */
  learning: boolean;
  /** `learning.share` from athena.config.json. Only "off" has an effect. */
  repoShare?: 'off' | 'on' | undefined;
  quiet: boolean;
  format: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  /** Tests answer the consent question here. */
  ask?: (question: string) => Promise<boolean>;
  timeoutMs?: number;
}

const QUESTION = `Athena found code whose author it can trust (git history, or code from before 2021).
Share anonymous statistics about it to help improve AI-code detection?
  Sent: whether it is AI or human, the language, a size bucket, ~35 style numbers. Never your code, hashes of it, names, paths, authors or emails.
  See exactly what: athena learning share status. Stop any time: athena learning share off [--delete].
Share? [y/N] `;

async function askOnTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/**
 * After a scan: maybe ask the one-time question, then send unsent labelled samples in the background-safe way (short timeout, never throws).
 * The question is asked only for `athena scan`, never for `check` or `review` (what git hooks run), never in CI, and never without a terminal.
 */
export async function shareAfterScan(args: ShareArgs): Promise<void> {
  try {
    if (!args.learning) return;
    const env = args.env ?? process.env;
    const ci = isCi(env);
    let settings = loadSettings(args.home);
    const state = loadLearning(args.root, args.home);
    if (!state.samples.some((s) => s.language && s.lines)) return; // nothing labelled to talk about yet

    const interactive = args.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
    if (settings.share === undefined && !settings.shareAsked && args.mode === 'scan' && interactive && !ci && args.repoShare !== 'off' && shareUrl(settings, env)) {
      const yes = await (args.ask ?? askOnTerminal)(QUESTION);
      settings = ensureInstallId({ ...settings, share: yes ? 'on' : 'off', shareAsked: true });
      saveSettings(settings, args.home);
    }

    if (args.mode === 'check') return; // the commit hook stays fast
    const sharing = sharingState(settings, args.repoShare, env, ci);
    if (!sharing.on) return;

    settings = ensureInstallId(settings);
    const { records, shas } = pendingContributions(state, { installId: settings.installId!, cliVersion: CLI_VERSION });
    if (records.length === 0) return;

    const result = await sendContributions(shareUrl(settings, env)!, records, args.timeoutMs);
    if (!result.ok) return; // offline or a server problem: try again after the next scan
    saveLearning(args.root, { ...state, sent: [...(state.sent ?? []), ...shas].slice(-MAX_REMEMBERED) }, args.home);
    saveSettings({ ...settings, sentTotal: (settings.sentTotal ?? 0) + records.length }, args.home);
    if (!args.quiet && args.format === 'terminal') writeInfo(`sharing labels: on · ${records.length} sent`);
  } catch {
    /* sharing must never affect a scan */
  }
}
