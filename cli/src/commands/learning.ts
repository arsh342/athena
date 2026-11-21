import { buildContributions, loadLearning, saveLearning, type Contribution } from '@athena/core';
import { getGitTopLevel } from '../utils/git.js';
import { writeInfo, writeResult } from '../utils/output.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { isCi } from '../utils/scan-progress.js';
import { deleteContributions, pendingContributions } from '../utils/share.js';
import { ensureInstallId, loadSettings, saveSettings, shareUrl, sharingState } from '../utils/settings.js';
import { CLI_VERSION } from '../version.js';

const NEVER = 'Never sent: your code, hashes of it, file or repository names, paths, authors, emails, commit ids.';

function sample(root: string, home?: string): { record: Contribution; example: boolean } | null {
  const settings = ensureInstallId(loadSettings(home));
  const meta = { installId: settings.installId!, cliVersion: CLI_VERSION };
  const state = loadLearning(root, home);
  const real = pendingContributions(state, meta, 1).records[0];
  if (real) return { record: real, example: false };
  const [example] = buildContributions([{ label: 'ai', source: 'recorded', language: 'typescript', lines: 40, dense: Array.from({ length: 35 }, (_, i) => (i % 7) / 10), pBase: 0.93 }], { ...meta, baseTag: 'fast:0.2.1', tuned: false });
  return example ? { record: example, example: true } : null;
}

/** `athena learning share on|off [--delete]|status`. Off by default; nothing is sent until a person runs `on` (or says yes to the one-time question). */
export async function shareCommand(action: string, opts: { delete?: boolean; server?: string; path?: string; home?: string } = {}, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const root = (await getGitTopLevel(opts.path ?? process.cwd())) ?? (opts.path ?? process.cwd());
  let settings = loadSettings(opts.home);
  const repoShare = (await loadProjectConfig(root).catch(() => ({}) as { learningShare?: 'off' | 'on' })).learningShare;

  if (action === 'on') {
    if (opts.server) settings = { ...settings, shareUrl: opts.server };
    if (!shareUrl(settings, env)) {
      writeInfo('error: no collection server is configured. Set ATHENA_SHARE_URL, or pass --server <https url>.');
      return 2;
    }
    settings = ensureInstallId({ ...settings, share: 'on', shareAsked: true });
    saveSettings(settings, opts.home);
    writeResult(`Sharing is ON. After a scan, Athena sends labelled style statistics (numbers, not code) to ${shareUrl(settings, env)}.\n${NEVER}\nSee exactly what would be sent: athena learning share status. Stop any time: athena learning share off [--delete].`);
    return 0;
  }

  if (action === 'off') {
    settings = { ...settings, share: 'off', shareAsked: true };
    if (opts.delete) {
      const url = shareUrl(settings, env);
      const ids = [...new Set([...(settings.pastInstallIds ?? []), ...(settings.installId ? [settings.installId] : [])])];
      if (!url && ids.length > 0) {
        saveSettings(settings, opts.home);
        writeInfo('Sharing is off. Nothing could be deleted on the server because no collection server is configured (set ATHENA_SHARE_URL and run this again).');
        return 2;
      }
      const result = ids.length > 0 && url ? await deleteContributions(url, ids) : { deleted: 0, failed: [] as string[] };
      if (result.failed.length > 0) {
        saveSettings(settings, opts.home);
        writeInfo(`Sharing is off, but the server could not delete everything (${result.failed.length} install id(s) failed). Run this again to retry. Nothing was forgotten locally.`);
        return 2;
      }
      const { installId: _i, installIdCreatedAt: _c, pastInstallIds: _p, ...rest } = settings;
      settings = { ...rest, sentTotal: 0 };
      saveSettings(settings, opts.home);
      const state = loadLearning(root, opts.home);
      if (state.sent?.length) saveLearning(root, { ...state, sent: [] }, opts.home);
      writeResult(`Sharing is OFF. The server deleted ${result.deleted} record(s) sent from this install, and the local install id was forgotten.`);
      return 0;
    }
    saveSettings(settings, opts.home);
    writeResult('Sharing is OFF. Nothing more will be sent. (To also delete what was already sent: athena learning share off --delete)');
    return 0;
  }

  if (action === 'status') {
    const state = sharingState(settings, repoShare, env, isCi(env));
    const s = sample(root, opts.home);
    const lines = [
      `Sharing: ${settings.share === 'on' ? 'on' : 'off'}${settings.share === 'on' && !state.on ? ` (but nothing is sent: ${state.reason})` : ''}`,
      `Server:  ${shareUrl(settings, env) ?? 'none configured'}`,
      `Sent so far: ${settings.sentTotal ?? 0} record(s)${settings.installId ? `, install id ${settings.installId.slice(0, 8)}… (rotated every 90 days)` : ''}`,
      '',
      s ? `${s.example ? 'An example record (nothing from your code yet)' : 'The next record that would be sent'}:\n${JSON.stringify(s.record, null, 2)}` : 'No record to show yet.',
      '',
      NEVER,
      'Turn on: athena learning share on    Turn off: athena learning share off [--delete]',
    ];
    writeResult(lines.join('\n'));
    return 0;
  }

  writeInfo(`error: unknown action "${action}" (use on, off or status)`);
  return 2;
}
