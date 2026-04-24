import { c } from './colors.js';

const BANNER_LARGE = [
  '    _  _____ _   _ _____ _   _    _   ',
  '   / \\|_   _| | | | ____| \\ | |  / \\  ',
  '  / _ \\ | | | |_| |  _| |  \\| | / _ \\ ',
  ' / ___ \\| | |  _  | |___| |\\  |/ ___ \\',
  '/_/   \\_\\_| |_| |_|_____|_| \\_/_/   \\_\\',
];

const BANNER_COMPACT = [
  '▄▀█ ▀█▀ █ █ █▀▀ █▄ █ ▄▀█',
  '█▀█  █  █▀█ ██▄ █ ▀█ █▀█',
];

/**
 * Print large ASCII art banner to stdout.
 * Skipped when stdout is not a TTY (CI, piped output).
 * Falls back to compact 2-line version on narrow terminals.
 */
export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  const cols = process.stdout.columns ?? 80;
  const useLarge = cols >= 56;
  const banner = useLarge ? BANNER_LARGE : BANNER_COMPACT;

  console.log('');
  for (const line of banner) {
    const style = useLarge ? `${c.accent}${c.bold}` : c.accent;
    console.log(`  ${style}${line}${c.reset}`);
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
