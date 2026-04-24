/** Shared ANSI terminal color codes for CLI output. */
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  inverse: '\x1b[7m',

  red: '\x1b[38;2;232;122;65m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  brightBlue: '\x1b[94m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  orange: '\x1b[38;2;232;122;65m',

  /** Primary accent — ATHENA orange profile. */
  accent: '\x1b[38;2;232;122;65m',

  /** ATHENA logo box background (#E87A41). */
  bannerBg: '\x1b[48;2;232;122;65m',
  /** ATHENA logo glyph color matches site dark bg (#0f0f0f). */
  bannerFg: '\x1b[38;2;15;15;15m',
} as const;
