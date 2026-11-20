import { emitKeypressEvents } from 'node:readline';
import type { Command } from 'commander';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
import { initCommand } from './init.js';
import { keysStatus } from './keys.js';
import { reviewCommand } from './review.js';
import { updateCommand } from './update.js';
import { scanCommand } from './scan.js';
import { uninstallCommand } from './uninstall.js';
import { dashedLine, printBanner, truncate } from '../utils/banner.js';
import { c } from '../utils/colors.js';
import { formatRecentHistory, getRecentScanHistory } from '../utils/history.js';
import { clearScreen } from '../utils/terminal.js';
import { CLI_VERSION } from '../version.js';

interface MenuItem {
  label: string;
  desc: string;
  command: string;
  detail: string;
  run: () => Promise<void> | void;
}

/**
 * Interactive terminal selector for Athena CLI.
 * Renders a full-screen menu with ASCII banner, navigable item list,
 * and live command preview. Falls back to --help in non-TTY environments.
 */
export async function menuCommand(program: Command): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    program.outputHelp();
    return;
  }

  const items: MenuItem[] = [
    {
      label: 'Scan current directory',
      desc: 'Scan every supported language from here (add --ai for verification).',
      command: 'athena scan .',
      detail: 'Offline: parses code, traces tainted data, finds secrets and risky dependencies, estimates AI provenance, prints a report.',
      run: () => scanCommand('.', { format: 'terminal' }),
    },
    {
      label: 'Review my changes',
      desc: 'Review staged changes and report only what they introduced.',
      command: 'athena review',
      detail: 'Like a code review before you commit. Also: --uncommitted, --range origin/main..HEAD, --base main, --format markdown.',
      run: () => reviewCommand({ format: 'terminal' }),
    },
    {
      label: 'Check staged files',
      desc: 'Fast gate for the commit flow (what the pre-commit hook runs).',
      command: 'athena check',
      detail: 'Scans staged files and exits 1 when a finding reaches your --fail-on level.',
      run: () => checkCommand([], { format: 'terminal' }),
    },
    {
      label: 'Install git hooks',
      desc: 'Add a pre-commit gate (pre-push with --hooks pre-commit,pre-push).',
      command: 'athena init',
      detail: 'Respects Husky, lefthook and core.hooksPath. Skip once with ATHENA_SKIP=1.',
      run: () => initCommand(),
    },
    {
      label: 'Update advisory data',
      desc: 'Refresh the local vulnerability database, KEV and EPSS.',
      command: 'athena update',
      detail: 'Dependency checks then work offline. Use athena alerts to see new advisories for your lockfiles.',
      run: async () => { process.exitCode = await updateCommand(); },
    },
    {
      label: 'AI keys',
      desc: 'See which AI provider keys Athena can use (optional layer).',
      command: 'athena keys status',
      detail: 'Set one with: athena keys set anthropic | openai | google | groq. Keys are stored privately; spend is capped per run and per day.',
      run: () => { process.exitCode = keysStatus(); },
    },
    {
      label: 'Remove git hooks',
      desc: 'Delete Athena\'s git hooks.',
      command: 'athena uninstall',
      detail: 'Removes the hooks Athena installed. Your own hooks are left alone.',
      run: uninstallCommand,
    },
    {
      label: 'Show help',
      desc: 'Print every command and option.',
      command: 'athena --help',
      detail: 'Includes mcp (agent toolbox), skills, provenance, models and explain.',
      run: () => program.outputHelp(),
    },
    {
      label: 'Doctor',
      desc: 'Check node, git and optional tools.',
      command: 'athena doctor',
      detail: 'Useful for debugging a missing toolchain.',
      run: doctorCommand,
    },
    {
      label: 'Exit',
      desc: 'Close selector.',
      command: 'q',
      detail: 'Leave terminal selector without running command.',
      run: () => undefined,
    },
  ];

  enterAltScreen();

  try {
    while (true) {
      const choice = await select(items);
      if (choice === null || items[choice]?.label === 'Exit') {
        break;
      }

      // Leave alternate screen so long scan output remains scrollable in normal terminal scrollback.
      exitAltScreen();
      try {
        await items[choice].run();
        await waitForReturnToMenu();
      } finally {
        enterAltScreen();
      }
    }
  } finally {
    exitAltScreen();
  }

  console.log(`\n  ${c.dim}athena selector closed${c.reset}\n`);
}

async function select(items: MenuItem[]): Promise<number | null> {
  const historyText = formatRecentHistory(await getRecentScanHistory(3));

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let index = 0;
  render(items, index, historyText);

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('keypress', onKeypress);
    };

    const done = (value: number | null) => {
      cleanup();
      resolve(value);
    };

    const onKeypress = (_input: string, key: { name?: string; sequence?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') done(null);
      if (key.name === 'q' || key.name === 'escape') done(null);
      if (key.name === 'up') {
        index = (index - 1 + items.length) % items.length;
        render(items, index, historyText);
      }
      if (key.name === 'down') {
        index = (index + 1) % items.length;
        render(items, index, historyText);
      }
      if (key.name === 'return') done(index);

      const number = Number(key.sequence);
      if (Number.isInteger(number) && number >= 1 && number <= Math.min(9, items.length)) {
        done(number - 1);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

function render(items: MenuItem[], selected: number, historyText: string): void {
  clear();
  const cols = Math.min(process.stdout.columns ?? 80, 72);
  const selectedItem = items[selected];

  // ── Banner ──
  printBanner();
  console.log('');
  console.log(`  ${c.dim}Security review for AI-assisted code${c.reset}${pad(cols - 40)}${c.accent}v${CLI_VERSION}${c.reset}`);
  console.log(`  ${c.dim}${truncate(process.cwd(), cols - 4)}${c.reset}`);

  // ── Separator ──
  console.log('');
  console.log(`  ${dashedLine(cols - 4)}`);
  console.log('');

  // ── Controls ──
  console.log(`  ${c.dim}↑/↓${c.reset} navigate   ${c.dim}enter${c.reset} run   ${c.dim}1-${Math.min(9, items.length)}${c.reset} jump   ${c.dim}q${c.reset} quit`);
  console.log(`  ${c.dim}${truncate(historyText, cols - 4)}${c.reset}`);
  console.log('');

  // ── Menu items ──
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const active = i === selected;
    const marker = active ? `${c.accent}●${c.reset}` : `${c.gray}○${c.reset}`;
    const num = `${c.gray}${i + 1}.${c.reset}`;
    const label = active
      ? `${c.inverse} ${item.label} ${c.reset}`
      : `${c.bold}${item.label}${c.reset}`;

    console.log(`  ${marker} ${num} ${label}`);
    console.log(`       ${c.dim}${item.desc}${c.reset}`);
    if (i < items.length - 1) console.log('');
  }

  // ── Preview ──
  console.log('');
  console.log(`  ${dashedLine(cols - 4)}`);
  console.log('');
  console.log(`  ${c.bold}Preview${c.reset}`);
  console.log(`  ${c.accent}$ ${selectedItem.command}${c.reset}`);
  console.log(`  ${c.dim}${selectedItem.detail}${c.reset}`);
  console.log('');
}

function clear(): void {
  clearScreen();
}

function enterAltScreen(): void {
  process.stdout.write('\x1b[?1049h');
}

function exitAltScreen(): void {
  process.stdout.write('\x1b[?1049l');
}

function pad(n: number): string {
  return ' '.repeat(Math.max(1, n));
}

async function waitForReturnToMenu(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  console.log(`  ${c.dim}press any key to return to selector${c.reset}`);

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('keypress', onKeypress);
    };

    const onKeypress = () => {
      cleanup();
      resolve();
    };

    process.stdin.on('keypress', onKeypress);
  });
}
