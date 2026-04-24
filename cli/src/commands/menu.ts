import { emitKeypressEvents } from 'node:readline';
import type { Command } from 'commander';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
import { initCommand } from './init.js';
import { scanCommand } from './scan.js';
import { setupSemgrepCommand } from './setup.js';
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
      desc: 'Run full recursive JS/TS scan from cwd.',
      command: 'athena scan .',
      detail: 'Parse code units, score AI provenance, run targeted security checks, print report.',
      run: () => scanCommand('.', { threshold: '9', format: 'terminal', maxFindings: 'all', quietHeader: true }),
    },
    {
      label: 'Check staged files',
      desc: 'Scan staged JS/TS files, same path used by pre-commit hook.',
      command: 'athena check',
      detail: 'Fast gate for commit flow. Reads git staged files and exits 1 on blocking risk.',
      run: () => checkCommand([], { threshold: '9', format: 'terminal', maxFindings: 'all', quietHeader: true }),
    },
    {
      label: 'Install pre-commit hook',
      desc: 'Create .git/hooks/pre-commit and run athena check before commit.',
      command: 'athena init',
      detail: 'Installs local hook in current git repo. Future commits run Athena before write.',
      run: initCommand,
    },
    {
      label: 'Remove pre-commit hook',
      desc: 'Delete Athena pre-commit hook.',
      command: 'athena uninstall',
      detail: 'Removes Athena hook file from .git/hooks/pre-commit.',
      run: uninstallCommand,
    },
    {
      label: 'Show help',
      desc: 'Print CLI commands and options.',
      command: 'athena --help',
      detail: 'Shows all commands, flags, and command descriptions.',
      run: () => program.outputHelp(),
    },
    {
      label: 'Doctor toolchain',
      desc: 'Check node/npm/semgrep/trivy availability.',
      command: 'athena doctor',
      detail: 'Useful for debugging missing external scanner dependencies.',
      run: doctorCommand,
    },
    {
      label: 'Setup Semgrep',
      desc: 'Print Semgrep install command for this OS.',
      command: 'athena setup semgrep',
      detail: 'Install helper for optional Semgrep integration in scan pipeline.',
      run: () => setupSemgrepCommand(),
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
        clear();
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
      if (Number.isInteger(number) && number >= 1 && number <= items.length) {
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
  console.log(`  ${c.dim}AI code provenance tracker${c.reset}${pad(cols - 40)}${c.accent}v${CLI_VERSION}${c.reset}`);
  console.log(`  ${c.dim}${truncate(process.cwd(), cols - 4)}${c.reset}`);

  // ── Separator ──
  console.log('');
  console.log(`  ${dashedLine(cols - 4)}`);
  console.log('');

  // ── Controls ──
  console.log(`  ${c.dim}↑/↓${c.reset} navigate   ${c.dim}enter${c.reset} run   ${c.dim}1-${items.length}${c.reset} jump   ${c.dim}q${c.reset} quit`);
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
