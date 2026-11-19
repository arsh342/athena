import { dirname } from 'node:path';

import type { CodebaseMap, EntryPoint, FileFacts, FnFact } from './types.js';

export interface MapIndex extends CodebaseMap {
  functions: FnFact[];
  reachable: Set<string>;
  entryFiles: Set<string>;
}

export const fnId = (f: FnFact): string => `${f.file}#${f.name || '<anonymous>'}@${f.startLine}`;

/** Entry points, call graph and rough components for a set of analysed files. */
export function buildCodebaseMap(facts: FileFacts[]): MapIndex {
  const live = facts.filter((f) => !f.isTest);
  const functions = live.flatMap((f) => f.functions);
  const byName = new Map<string, FnFact[]>();
  for (const fn of functions) if (fn.name) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn]);

  const callGraph = new Map<string, Set<string>>();
  for (const fn of functions) {
    const edges = new Set<string>();
    for (const callee of fn.calls) for (const target of byName.get(callee) ?? []) edges.add(fnId(target));
    callGraph.set(fnId(fn), edges);
  }

  // Lexical nesting: a function defined inside another one (a callback) runs when its parent runs.
  const perFile = new Map<string, FnFact[]>();
  for (const fn of functions) perFile.set(fn.file, [...(perFile.get(fn.file) ?? []), fn]);
  for (const list of perFile.values()) {
    const sorted = [...list].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
    const stack: FnFact[] = [];
    for (const fn of sorted) {
      while (stack.length > 0 && stack[stack.length - 1]!.endLine < fn.startLine) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent && (parent.startLine !== fn.startLine || parent.endLine !== fn.endLine)) callGraph.get(fnId(parent))?.add(fnId(fn));
      stack.push(fn);
    }
  }

  const entrypoints: EntryPoint[] = live.flatMap((f) => f.entrypoints);
  const roots = new Set<string>();
  const entryFiles = new Set<string>();
  for (const e of entrypoints) {
    entryFiles.add(e.file);
    const inFile = functions.filter((fn) => fn.file === e.file);
    if (e.range) {
      for (const fn of inFile) if (fn.startLine >= e.range[0] && fn.startLine <= e.range[1]) roots.add(fnId(fn));
    }
    if (e.handler) {
      for (const fn of byName.get(e.handler.replace(/^.*[.:>]/, '')) ?? []) roots.add(fnId(fn));
    }
  }
  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of callGraph.get(id) ?? []) queue.push(next);
  }

  const dirs = new Map<string, number>();
  for (const f of live) dirs.set(dirname(f.path), (dirs.get(dirname(f.path)) ?? 0) + 1);
  const components = [...dirs].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files);
  return { entrypoints, callGraph, components, functions, reachable, entryFiles };
}

/** Innermost function containing a line of a file, if any. */
export function enclosingFunction(map: MapIndex, file: string, line: number): FnFact | null {
  let best: FnFact | null = null;
  for (const fn of map.functions) {
    if (fn.file !== file || line < fn.startLine || line > fn.endLine) continue;
    if (!best || fn.endLine - fn.startLine < best.endLine - best.startLine) best = fn;
  }
  return best;
}

/**
 * Can code at this line run in response to an entry point? Without any entry point in the codebase
 * (a library, a script collection) everything counts as reachable: there is nothing to disprove it with.
 */
export function isReachable(map: MapIndex, file: string, line: number): boolean {
  if (map.entrypoints.length === 0 || map.entryFiles.has(file) && !map.functions.some((f) => f.file === file)) return true;
  const fn = enclosingFunction(map, file, line);
  if (!fn) return true; // top-level code runs when the module loads
  if (map.reachable.has(fnId(fn))) return true;
  // A handler defined inline inside an entry range is a root even when anonymous.
  return map.entrypoints.some((e) => e.file === file && e.range && fn.startLine >= e.range[0] && fn.endLine <= e.range[1]);
}

export function entryAt(map: MapIndex, file: string, line: number): EntryPoint | null {
  return map.entrypoints.find((e) => e.file === file && e.range && line >= e.range[0] && line <= e.range[1]) ?? null;
}
