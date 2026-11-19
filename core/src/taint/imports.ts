import { dirname, join, normalize } from 'node:path';

import type { LanguageFamily } from '../lang/languages.js';
import type { ImportInfo } from './engine.js';

const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

function resolveJs(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), spec));
  const stripped = base.replace(/\.(m?js|cjs)$/, '');
  for (const candidate of [base, stripped]) {
    for (const ext of JS_EXT) if (files.has(candidate + ext)) return candidate + ext;
  }
  return null;
}

function pickNearest(fromFile: string, candidates: string[] | undefined): string | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const from = dirname(fromFile).split('/');
  let best: string | null = null;
  let bestScore = -1;
  let tie = false;
  for (const c of candidates) {
    const dir = dirname(c).split('/');
    let n = 0;
    while (n < from.length && n < dir.length && from[n] === dir[n]) n += 1;
    if (n > bestScore) { best = c; bestScore = n; tie = false; } else if (n === bestScore) tie = true;
  }
  return tie ? null : best; // ambiguous: never guess a file
}

function resolvePython(fromFile: string, module: string, files: Set<string>, byTail: Map<string, string[]>): string | null {
  let dir = dirname(fromFile);
  let name = module;
  const dots = /^\.+/.exec(module)?.[0].length ?? 0;
  if (dots > 0) {
    for (let i = 1; i < dots; i += 1) dir = dirname(dir);
    name = module.slice(dots);
    const rel = name ? name.split('.').join('/') : '';
    for (const candidate of [join(dir, `${rel}.py`), join(dir, rel, '__init__.py')]) if (files.has(candidate)) return candidate;
    return null;
  }
  const rel = name.split('.').join('/');
  return pickNearest(fromFile, byTail.get(`${rel}.py`)) ?? pickNearest(fromFile, byTail.get(`${rel}/__init__.py`));
}

/** Cross-file import resolution for JS/TS and Python (other families: no cross-file flows in this phase). */
export function parseImports(family: LanguageFamily, path: string, source: string, files: Set<string>, byTail: Map<string, string[]>): ImportInfo {
  const info: ImportInfo = { named: new Map(), modules: new Map() };
  if (family === 'js') {
    const addNamed = (list: string, file: string, splitter: RegExp) => {
      for (const part of list.split(',')) {
        const m = splitter.exec(part.trim());
        if (m) info.named.set(m[2] ?? m[1]!, { file, name: m[1]! });
      }
    };
    for (const m of source.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g)) {
      const file = resolveJs(path, m[4]!, files);
      if (!file) continue;
      if (m[2]) addNamed(m[2], file, /^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (m[3]) info.modules.set(m[3], file);
      if (m[1]) {
        info.modules.set(m[1], file);
        info.named.set(m[1], { file, name: 'default' });
      }
    }
    for (const m of source.matchAll(/(?:const|let|var)\s+(?:\{([^}]*)\}|([\w$]+))\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const file = resolveJs(path, m[3]!, files);
      if (!file) continue;
      if (m[1]) addNamed(m[1], file, /^([\w$]+)(?:\s*:\s*([\w$]+))?$/);
      if (m[2]) info.modules.set(m[2], file);
    }
  } else if (family === 'python') {
    for (const m of source.matchAll(/^\s*from\s+([.\w]+)\s+import\s+(\(?[^\n)]*\)?)/gm)) {
      const file = resolvePython(path, m[1]!, files, byTail);
      for (const part of m[2]!.replace(/[()]/g, '').split(',')) {
        const mm = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
        if (!mm) continue;
        if (file) info.named.set(mm[2] ?? mm[1]!, { file, name: mm[1]! });
        const sub = resolvePython(path, `${m[1]!.endsWith('.') ? m[1]! : `${m[1]!}.`}${mm[1]!}`.replace(/^\.\./, '..'), files, byTail);
        if (sub) info.modules.set(mm[2] ?? mm[1]!, sub);
      }
    }
    for (const m of source.matchAll(/^\s*import\s+([.\w]+)(?:\s+as\s+(\w+))?/gm)) {
      const file = resolvePython(path, m[1]!, files, byTail);
      if (file) info.modules.set(m[2] ?? m[1]!.split('.').pop()!, file);
    }
  }
  return info;
}

export function tailIndex(files: Iterable<string>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i += 1) {
      const tail = parts.slice(i).join('/');
      map.set(tail, [...(map.get(tail) ?? []), file]);
    }
  }
  return map;
}
