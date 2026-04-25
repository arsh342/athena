import { c } from './colors.js';
import { dashedLine, printBanner, truncate } from './banner.js';
import type { BufferedConsoleMessage } from './console-buffer.js';

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

export function printScannerNotes(messages: BufferedConsoleMessage[]): void {
  const unique = dedupeMessages(messages);
  if (unique.length === 0) return;

  console.log(`  ${c.bold}Scanner Notes${c.reset}`);
  for (const message of unique) {
    const marker = message.level === 'warn' ? `${c.yellow}!${c.reset}` : `${c.gray}-${c.reset}`;
    console.log(`  ${marker} ${c.dim}${truncate(message.text, Math.min(process.stdout.columns ?? 100, 110) - 6)}${c.reset}`);
  }
  console.log('');
}

function dedupeMessages(messages: BufferedConsoleMessage[]): BufferedConsoleMessage[] {
  const seen = new Set<string>();
  const result: BufferedConsoleMessage[] = [];

  for (const message of messages) {
    const key = `${message.level}:${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }

  return result;
}
