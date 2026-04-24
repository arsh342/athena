#!/usr/bin/env node
import { Command } from 'commander';
import { checkCommand } from './commands/check.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { menuCommand } from './commands/menu.js';
import { scanCommand } from './commands/scan.js';
import { setupAllCommand, setupSemgrepCommand } from './commands/setup.js';
import { uninstallCommand } from './commands/uninstall.js';
import { clearScreen } from './utils/terminal.js';
import { CLI_VERSION } from './version.js';

const program = new Command();

program
  .name('athena')
  .description('AI code provenance tracker for JavaScript and TypeScript repositories')
  .version(CLI_VERSION);

program
  .command('scan')
  .argument('[dir]', 'directory to scan', '.')
  .option('-t, --threshold <number>', 'AI score threshold', '9')
  .option('-f, --format <format>', 'terminal | json | jsonl', 'terminal')
  .option('-m, --max-findings <number|all>', 'max findings to print (default: all)', 'all')
  .option('--no-eslint', 'disable ESLint scanner')
  .option('--no-npm-audit', 'disable npm audit scanner')
  .option('--no-nodejsscan', 'disable nodejsscan scanner')
  .option('--no-bearer', 'disable Bearer scanner')
  .option('--no-semgrep', 'disable Semgrep scanner')
  .description('scan a directory recursively')
  .action(scanCommand);

program
  .command('check')
  .argument('[files...]', 'files to check; defaults to staged JS/TS files')
  .option('-t, --threshold <number>', 'AI score threshold', '9')
  .option('-f, --format <format>', 'terminal | json | jsonl', 'terminal')
  .option('-m, --max-findings <number|all>', 'max findings to print (default: all)', 'all')
  .option('--no-eslint', 'disable ESLint scanner')
  .option('--no-npm-audit', 'disable npm audit scanner')
  .option('--no-nodejsscan', 'disable nodejsscan scanner')
  .option('--no-bearer', 'disable Bearer scanner')
  .option('--no-semgrep', 'disable Semgrep scanner')
  .description('check changed files for blocking findings')
  .action(checkCommand);

program.command('init').description('install Athena pre-commit hook').action(initCommand);
program.command('uninstall').description('remove Athena pre-commit hook').action(uninstallCommand);
program.command('doctor').description('check local toolchain health (node, npm, semgrep, trivy)').action(doctorCommand);

const setupCommand = program
  .command('setup')
  .description('setup optional external scanners');

setupCommand
  .command('semgrep')
  .option('--auto', 'run install command automatically')
  .description('install or print install command for semgrep')
  .action(setupSemgrepCommand);

setupCommand
  .command('all')
  .option('--auto', 'run supported install commands automatically')
  .description('print/setup all scanner dependencies (included + external)')
  .action(setupAllCommand);

program.command('menu').description('open interactive terminal selector').action(() => menuCommand(program));

async function main(): Promise<void> {
  if (process.stdout.isTTY) {
    clearScreen();
  }

  if (process.argv.length <= 2) {
    await menuCommand(program);
  } else {
    await program.parseAsync(process.argv);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
