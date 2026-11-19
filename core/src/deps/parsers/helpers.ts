import type { Dependency, Ecosystem } from '../types.js';

/** Line (1-based) of the first line containing `needle`, searching from `fromLine`; 1 when absent. */
export function lineOf(text: string, needle: string, fromLine = 0): number {
  const lines = text.split('\n');
  for (let i = fromLine; i < lines.length; i += 1) if (lines[i]!.includes(needle)) return i + 1;
  return 1;
}

export function dep(ecosystem: Ecosystem, name: string, version: string, direct: boolean, manifest: string, line: number, extra: Partial<Dependency> = {}): Dependency {
  return { ecosystem, name, version, direct, manifest, line, ...extra };
}

export const PRIVATE_SPEC = /^(?:file:|link:|workspace:|git\+|git:|github:|https?:|npm:|portal:|patch:)|^[\w.-]+\/[\w.-]+$/;
