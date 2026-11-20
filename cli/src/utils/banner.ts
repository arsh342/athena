import { c } from './colors.js';

/**
 * The Athena mark, the round owl face from the sign-in page, as braille dots: a braille cell is a 2 x 4 dot grid, so this is a
 * true stipple in text. Generated from the same tone map as the website icons by scripts/brand/owl_face.py.
 */
export const LOGO = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⡀⢄⢄⠢⡂⢆⠢⡂⡄⢄',
  '⠀⠀⠀⠀⠀⡠⠢⡑⡜⢔⢅⢇⢣⢣⢣⢣⢣⠣⡃⡇⣂⢀',
  '⠀⠀⠀⡠⡊⡢⡃⡇⡎⡎⡎⡎⣎⢎⢮⢪⡪⣪⢣⡣⡣⡣⣂',
  '⠀⠀⢔⢢⢱⢡⢣⣣⣣⡣⡳⡹⣸⢪⣣⢳⢹⣸⣸⡸⡪⡎⣎⢎⠄',
  '⠀⢌⢆⢣⡲⣽⡳⠳⠳⢯⣷⣝⢼⡱⣱⣳⡻⠺⠺⢽⣗⣧⢣⢇⢧',
  '⠠⡱⢸⢰⣻⡇⠰⡶⠀⠀⢿⡾⡮⣚⣞⣞⠠⢶⠂⠀⢹⣾⡗⣝⢜⡄',
  '⠨⡸⡘⡜⡷⣧⡀⠀⢐⣠⣿⢿⢕⣇⢿⣺⣀⠀⠐⢂⣼⣿⢇⣗⢵⠅',
  '⠈⡆⡇⡇⣏⢿⣻⣿⢿⣻⢞⢯⡳⣳⢝⡽⣻⡿⣿⡿⣟⢯⡺⣜⢎⠇',
  '⠀⠕⡜⡜⣜⢜⢦⢳⢝⢮⠫⢓⢽⣕⢛⢪⣗⡵⣳⢵⣳⡳⣝⢎⠧⠁',
  '⠀⠈⢪⢪⢪⢎⢗⣝⢵⡫⣏⠢⣹⡗⡨⣪⢞⣞⡽⣕⣗⣝⢮⢫⠁',
  '⠀⠀⠀⠱⡱⢕⢧⢳⠵⣝⢞⡬⢸⡃⢎⢾⢝⣞⢮⡳⡵⡕⡇⠁',
  '⠀⠀⠀⠀⠈⠊⠮⡪⣫⢪⡳⣕⢕⢵⡹⣝⢵⣓⢗⡝⠎⠊',
  '⠀⠀⠀⠀⠀⠀⠀⠁⠑⠱⠱⠣⡫⢣⠫⠪⠃⠃⠁',
];

/** The name beside the mark. */
export const WORDMARK = [
  '▄▀█ ▀█▀ █ █ █▀▀ █▄ █ ▄▀█',
  '█▀█  █  █▀█ ██▄ █ ▀█ █▀█',
];

const LOGO_WIDTH = Math.max(...LOGO.map((l) => l.length));
const GAP = 4;
/** Columns the full banner needs: indent + logo + gap + wordmark. */
const FULL_WIDTH = 2 + LOGO_WIDTH + GAP + Math.max(...WORDMARK.map((l) => l.length));
/** Rows the logo is worth showing at: the menu below it is tall. A shorter terminal gets the two-line name. */
const FULL_ROWS = 52;

/** The banner as lines: the mark with the name beside its middle, or just the name when the terminal is narrow or short. */
export function bannerLines(cols: number, rows = Infinity): string[] {
  if (cols < FULL_WIDTH || rows < FULL_ROWS) return [...WORDMARK];
  const top = Math.floor((LOGO.length - WORDMARK.length) / 2);
  return LOGO.map((line, i) => {
    const name = WORDMARK[i - top];
    return name ? `${line.padEnd(LOGO_WIDTH, ' ')}${' '.repeat(GAP)}${name}` : line;
  });
}

/**
 * Print the logo banner to stdout.
 * Skipped when stdout is not a TTY (CI, piped output).
 */
export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  console.log('');
  for (const line of bannerLines(process.stdout.columns ?? 80, process.stdout.rows ?? Infinity)) {
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
