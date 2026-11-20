import { c } from './colors.js';

/** The Athena name in block characters, two rows tall. */
export const WORDMARK = [
  '▄▀█ ▀█▀ █ █ █▀▀ █▄ █ ▄▀█',
  '█▀█  █  █▀█ ██▄ █ ▀█ █▀█',
];

/** The banner as lines. */
export function bannerLines(): string[] {
  return [...WORDMARK];
}

/**
 * Print the banner to stdout.
 * Skipped when stdout is not a TTY (CI, piped output).
 */
export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  console.log('');
  for (const line of bannerLines()) {
    console.log(`  ${c.accent}${c.bold}${line}${c.reset}`);
  }
}

/** Dashed horizontal rule for section separation. */
export function dashedLine(width: number): string {
  const dashes = '─ '.repeat(Math.floor(width / 2));
  return `${c.gray}${dashes.trimEnd()}${c.reset}`;
}

/** Truncate paths or strings with leading ellipsis for display. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `…${value.slice(value.length - max + 1)}`;
}
