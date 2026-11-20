import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class SandboxError extends Error {}

/** Every tool result is capped, so one call can never flood the model's context (or the bill). */
export const MAX_TOOL_OUTPUT = 16 * 1024;

export function capOutput(text: string, max = MAX_TOOL_OUTPUT): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  const cut = Buffer.from(text, 'utf8').subarray(0, max - 80).toString('utf8').replace(/�$/, '');
  return `${cut}\n… [output truncated at ${max} bytes; ask for a narrower range]`;
}

/** Resolve a model-supplied path inside `root`; anything that lands outside (`..`, absolute paths, symlinks) is refused. */
export function resolveInside(root: string, input: string): string {
  const realRoot = realpathSync(root);
  const abs = resolve(realRoot, input);
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = resolve(realpathSync(probe), relative(probe, abs));
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new SandboxError(`path ${JSON.stringify(input)} is outside the repository`);
  return real;
}

/** Repository-relative, forward-slash path for display. Works whether the root or the path is spelled through a symlink or not. */
export function display(root: string, absolute: string): string {
  const roots = [resolve(root), realpathSync(root)];
  const targets = [absolute];
  try { targets.push(realpathSync(absolute)); } catch { /* path may not exist */ }
  for (const r of roots) {
    for (const t of targets) {
      const rel = relative(r, t);
      if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/') || '.';
    }
  }
  return absolute;
}
