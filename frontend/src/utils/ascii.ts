/** Pure helpers for the ASCII hero: kept free of the DOM so they can be tested. */
export const RAMP = ' .:-=+*#%@';
export const CODE_GLYPHS = '{}[]<>/;=01';

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Brightness 0..1 to a character of the density ramp. */
export function rampChar(v: number): string {
  return RAMP[Math.min(RAMP.length - 1, Math.floor(clamp01(v) * RAMP.length))]!;
}

/** Smooth, cheap, deterministic field in 0..1 (sum of three travelling sines). */
export function field(x: number, y: number, t: number): number {
  const n = Math.sin(x * 0.15 + t) + Math.sin(y * 0.2 - t * 1.3) + Math.sin((x + y) * 0.1 + t * 0.7);
  return (n + 3) / 6;
}

export interface CellInput {
  /** Mask coverage of the lettering at this cell, 0..1. */
  mask: number;
  x: number;
  y: number;
  rows: number;
  t: number;
  /** Scan band position, 0..1 down the panel. */
  band: number;
  /** Distance from the pointer in cells (Infinity when away). */
  pointer: number;
  /** Click-and-hold: the lettering resolves into code. */
  held: boolean;
}

export interface Cell { ch: string; alpha: number }

/** One cell: the lettering is dense and alive, the background a sparse dotted field, and a band sweeps down revealing code glyphs. */
export function cell(i: CellInput): Cell {
  const f = field(i.x, i.y, i.t);
  const inBand = Math.abs(i.y / i.rows - i.band) < 0.035;
  const lens = i.pointer < 9 ? 1 - i.pointer / 9 : 0;
  if (i.mask > 0.35) {
    const v = clamp01(0.45 + 0.5 * f + (inBand ? 0.25 : 0) + lens * 0.3);
    if (i.held || inBand) return { ch: CODE_GLYPHS[Math.floor(f * 97 + i.x + i.y) % CODE_GLYPHS.length]!, alpha: clamp01(0.55 + v * 0.45) };
    return { ch: rampChar(v), alpha: clamp01(0.5 + v * 0.5) };
  }
  if (inBand) return { ch: '-', alpha: 0.35 };
  if (lens > 0 && f > 0.45) return { ch: rampChar(0.2 + lens * 0.5), alpha: 0.25 + lens * 0.4 };
  if (f > 0.82) return { ch: '.', alpha: 0.28 };
  return { ch: ' ', alpha: 0 };
}
