import { readFile } from 'node:fs/promises';

import type { Advisory } from './osv.js';
import type { Dependency } from './types.js';
import { usesOf, type PackageUse } from './usage.js';

export interface ProjectUsage {
  /** package name (npm/PyPI-normalised or Go import path) -> every place it is imported. */
  byPackage: Map<string, Array<{ file: string; use: PackageUse; source: string }>>;
}

const norm = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, '-');

export async function collectUsage(files: string[]): Promise<ProjectUsage> {
  const byPackage: ProjectUsage['byPackage'] = new Map();
  for (const file of files) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (source.length > 1_000_000) continue;
    for (const use of usesOf(file, source)) {
      const key = /\.py$/.test(file) ? norm(use.pkg) : use.pkg;
      const list = byPackage.get(key) ?? [];
      list.push({ file, use, source });
      byPackage.set(key, list);
    }
  }
  return { byPackage };
}

const lastSegment = (s: string): string => s.split(/[.#:/]/).filter(Boolean).pop() ?? s;

/**
 * Does the project reach the code an advisory is about? Only decidable when the advisory names affected symbols and the
 * project imports the package directly; everything else is `unknown` (a transitive dependency may be reached indirectly).
 */
export function reachabilityOf(usage: ProjectUsage, dep: Dependency, advisory: Advisory): 'reached' | 'not-reached' | 'unknown' {
  if (!['npm', 'PyPI', 'Go'].includes(dep.ecosystem)) return 'unknown';
  const symbols = [...new Set(advisory.symbols.map(lastSegment))].filter((s) => /^[\w$]+$/.test(s));
  if (symbols.length === 0) return 'unknown';
  const key = dep.ecosystem === 'PyPI' ? norm(dep.name) : dep.name;
  const uses = usage.byPackage.get(key);
  if (!uses || uses.length === 0) return 'unknown';
  for (const { use, source } of uses) {
    if (use.opaque) return 'unknown';
    if (symbols.some((s) => use.named.includes(s))) return 'reached';
    for (const binding of use.bindings) {
      for (const s of symbols) if (new RegExp(`\\b${binding.replace(/\$/g, '\\$')}\\.${s}\\b`).test(source)) return 'reached';
    }
    // `import pkg` followed by a member on a deeper path (`pkg.sub.fn`) or a bare side-effect import: cannot tell.
    if (use.named.length === 0 && use.bindings.length === 0) return 'unknown';
  }
  return 'not-reached';
}
