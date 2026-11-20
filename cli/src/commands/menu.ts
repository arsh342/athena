import type { Command } from 'commander';
import { athenaHome } from '@athena/core';
import { keyStatus, removeKey, setKey } from '@athena/agents/light';
import { alertsCommand } from './alerts.js';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
import { explainCommand } from './explain.js';
import { initCommand } from './init.js';
import { provenanceCommand } from './provenance.js';
import { reviewCommand, type ReviewFlags } from './review.js';
import { scanCommand } from './scan.js';
import { skillsList } from './skills.js';
import { uninstallCommand } from './uninstall.js';
import { updateCommand } from './update.js';
import { mainMenu, type Deps } from '../menu/flows.js';
import { TerminalUi } from '../menu/ui.js';
import { bannerLines, dashedLine, truncate } from '../utils/banner.js';
import { c } from '../utils/colors.js';
import { getGitTopLevel } from '../utils/git.js';
import { formatRecentHistory, getRecentScanHistory } from '../utils/history.js';
import { CLI_VERSION } from '../version.js';

/** The real commands behind each menu action. */
export function realDeps(program: Command): Deps {
  return {
    keyStatus: (provider, opts) => keyStatus(provider, opts),
    setKey: (provider, key, opts) => setKey(provider, key, opts),
    removeKey: (provider, opts) => removeKey(provider, opts),
    scan: (dir, flags) => scanCommand(dir, flags),
    review: (flags) => reviewCommand(flags as ReviewFlags),
    check: (flags) => checkCommand([], flags),
    init: (opts) => initCommand(opts),
    uninstall: () => uninstallCommand(),
    update: async () => { process.exitCode = await updateCommand(); },
    alerts: async () => { process.exitCode = await alertsCommand('.'); },
    explain: async (id) => { process.exitCode = await explainCommand(id); },
    skills: async () => { process.exitCode = await skillsList({}); },
    provenance: async () => { process.exitCode = await provenanceCommand('.'); },
    doctor: () => doctorCommand(),
    help: () => program.outputHelp(),
    configRoot: async () => (await getGitTopLevel(process.cwd())) ?? process.cwd(),
    home: athenaHome(),
  };
}

/**
 * The interactive menu: pick what to do and answer a few questions, instead of typing commands and flags.
 * Every screen shows the command it is equivalent to. Falls back to --help when there is no terminal.
 */
export async function menuCommand(program: Command): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    program.outputHelp();
    return;
  }

  const cols = Math.min(process.stdout.columns ?? 80, 72);
  const history = formatRecentHistory(await getRecentScanHistory(3));
  const header = [
    '',
    ...bannerLines().map((line) => `  ${c.accent}${c.bold}${line}${c.reset}`),
    '',
    `  ${c.dim}Security review for AI-assisted code${c.reset}${' '.repeat(Math.max(1, cols - 36 - CLI_VERSION.length - 1))}${c.accent}v${CLI_VERSION}${c.reset}`,
    `  ${c.dim}${truncate(process.cwd(), cols - 4)}${c.reset}`,
    ...(history ? [`  ${c.dim}${truncate(history, cols - 4)}${c.reset}`] : []),
    `  ${dashedLine(cols - 4)}`,
  ];

  const ui = new TerminalUi();
  ui.start();
  try {
    await mainMenu(ui, realDeps(program), header);
  } finally {
    ui.stop();
  }
  console.log(`\n  ${c.dim}athena menu closed${c.reset}\n`);
}
