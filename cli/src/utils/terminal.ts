import { c } from './colors.js';
import { dashedLine, printBanner, truncate } from './banner.js';

/**
 * Clear current terminal viewport and reset cursor to top-left.
 */
export function clearScreen(): void {
  // 3J clears scrollback in many terminals; 2J clears viewport; H homes cursor.
  process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
}

/**
 * Print styled header before a scan or check run.
 * Shows ASCII banner, mode/target info, and pipeline stages.
 */
export function printRunHeader(mode: string, target: string): void {
  const cols = Math.min(process.stdout.columns ?? 80, 72);

  printBanner();
  console.log('');
  console.log(`  ${c.dim}mode${c.reset} ${c.accent}${mode}${c.reset}   ${c.dim}target${c.reset} ${c.white}${truncate(target, cols - 20)}${c.reset}`);
  console.log(`  ${c.dim}parse → score → analyze → report${c.reset}`);
  console.log('');
  console.log(`  ${dashedLine(cols - 4)}`);
  console.log('');
}

/**
 * Print final gate result after a scan or check run.
 * Uses checkmark/cross with color-coded pass/blocked status.
 */
export function printRunResult(blocked: boolean): void {
  console.log('');
  if (blocked) {
    console.log(`  ${c.red}✗${c.reset} ${c.bold}gate: ${c.red}blocked${c.reset}`);
  } else {
    console.log(`  ${c.green}✓${c.reset} ${c.bold}gate: ${c.green}pass${c.reset}`);
  }
  console.log('');
}
