import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CheckSet } from './guardrails.js';
import { N_DENSE } from './learner.js';

const MAGIC = 'ACS1';
const ROW_BYTES = 1 + 4 + N_DENSE * 4;

function candidateFiles(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '..', '..', 'models', 'check-set.bin'), join(here, 'models', 'check-set.bin'), join(here, '..', 'models', 'check-set.bin')];
}

export function encodeCheckSet(rows: CheckSet['rows']): Buffer {
  const out = Buffer.alloc(8 + rows.length * ROW_BYTES);
  out.write(MAGIC, 0, 'ascii');
  out.writeUInt32LE(rows.length, 4);
  rows.forEach((r, i) => {
    const o = 8 + i * ROW_BYTES;
    out.writeUInt8(r.y, o);
    out.writeFloatLE(r.pBase, o + 1);
    for (let k = 0; k < N_DENSE; k += 1) out.writeFloatLE(r.dense[k] ?? 0, o + 5 + k * 4);
  });
  return out;
}

export function decodeCheckSet(raw: Buffer): CheckSet | null {
  if (raw.length < 8 || raw.toString('ascii', 0, 4) !== MAGIC) return null;
  const n = raw.readUInt32LE(4);
  if (raw.length !== 8 + n * ROW_BYTES) return null;
  const rows: CheckSet['rows'] = [];
  for (let i = 0; i < n; i += 1) {
    const o = 8 + i * ROW_BYTES;
    const y = raw.readUInt8(o);
    if (y !== 0 && y !== 1) return null;
    const dense = new Float32Array(N_DENSE);
    for (let k = 0; k < N_DENSE; k += 1) dense[k] = raw.readFloatLE(o + 5 + k * 4);
    rows.push({ y: y as 0 | 1, pBase: raw.readFloatLE(o + 1), dense });
  }
  return { rows };
}

/** The bundled check set, or null when it is missing or malformed (the hold-out guard still applies). */
export function loadCheckSet(path?: string): CheckSet | null {
  for (const file of path ? [path] : candidateFiles()) {
    try {
      if (existsSync(file)) return decodeCheckSet(readFileSync(file));
    } catch {
      return null;
    }
  }
  return null;
}
