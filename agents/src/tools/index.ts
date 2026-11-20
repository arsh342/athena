import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeDependencies, analyzeProject, isSupportedSource, loadProjectFiles, type ProjectAnalysis } from '@athena/core';

import type { ToolDef } from '../providers/types.js';
import { capOutput, display, resolveInside } from '../sandbox.js';

export interface AgentTool extends ToolDef {
  execute(input: Record<string, unknown>): Promise<string>;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'target', '.venv', '__pycache__', '.next']);
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 1_000_000;

function walk(root: string, start: string, visit: (path: string) => void, limit = MAX_FILES): void {
  let seen = 0;
  const stack = [start];
  while (stack.length > 0 && seen < limit) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(full);
      } else if (e.isFile()) {
        visit(full);
        seen += 1;
        if (seen >= limit) return;
      }
    }
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) throw new Error(`${name} must be a non-empty string`);
  return v;
};
const optInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

const obj = (properties: Record<string, unknown>): Record<string, unknown> => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });

/**
 * Read-only tools confined to the repository root. None of them writes, runs code, or touches the network
 * (dependency findings use only the local cache). Every result is capped at 16 KB.
 */
/** The offline analysis of a directory (cached by the caller). */
/** The project's supported source files, loaded (bounded). */
export async function analyseFiles(root: string): Promise<Awaited<ReturnType<typeof loadProjectFiles>>> {
  const real = realpathSync(root);
  const paths: string[] = [];
  walk(real, real, (p) => { if (isSupportedSource(p)) { try { if (statSync(p).size <= MAX_FILE_BYTES) paths.push(p); } catch { /* unreadable */ } } });
  return loadProjectFiles(paths);
}

export async function analyseDirectory(root: string): Promise<ProjectAnalysis> {
  const real = realpathSync(root);
  const paths: string[] = [];
  walk(real, real, (p) => { if (isSupportedSource(p)) { try { if (statSync(p).size <= MAX_FILE_BYTES) paths.push(p); } catch { /* unreadable */ } } });
  return analyzeProject(await loadProjectFiles(paths), { root: real });
}

export function makeReadOnlyTools(givenRoot: string): AgentTool[] {
  // One canonical root for everything (walking, analysis, display, comparisons): symlinked temp dirs must not mix path spellings.
  const root = realpathSync(givenRoot);
  let analysis: Promise<ProjectAnalysis> | null = null;
  const analyse = (): Promise<ProjectAnalysis> => {
    analysis ??= (async () => {
      const paths: string[] = [];
      walk(root, root, (p) => { if (isSupportedSource(p) && statSize(p) <= MAX_FILE_BYTES) paths.push(p); });
      return analyzeProject(await loadProjectFiles(paths), { root });
    })();
    return analysis;
  };
  const statSize = (p: string): number => { try { return statSync(p).size; } catch { return Number.POSITIVE_INFINITY; } };
  const rel = (p: string): string => display(root, p);

  const tools: AgentTool[] = [
    {
      name: 'read_file', description: 'Read a file (or a line range) from the repository.',
      schema: obj({ path: { type: 'string', description: 'Repository-relative path' }, startLine: nullable('integer', '1-based first line, or null'), endLine: nullable('integer', '1-based last line, or null') }),
      async execute(input) {
        const file = resolveInside(root, str(input.path, 'path'));
        if (!statSync(file).isFile()) throw new Error('not a file');
        const lines = readFileSync(file, 'utf8').split('\n');
        const a = Math.max(1, optInt(input.startLine) ?? 1);
        const b = Math.min(lines.length, optInt(input.endLine) ?? a + 199);
        return capOutput(lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n'));
      },
    },
    {
      name: 'list_dir', description: 'List the entries of a directory in the repository.',
      schema: obj({ path: { type: 'string', description: 'Repository-relative directory ("." for the root)' } }),
      async execute(input) {
        const dir = resolveInside(root, str(input.path, 'path'));
        const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !SKIP.has(e.name)).map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`);
        return capOutput(entries.slice(0, 500).join('\n') || '(empty)');
      },
    },
    {
      name: 'grep', description: 'Find lines containing a literal text (case-sensitive) in the repository.',
      schema: obj({ text: { type: 'string', description: 'Literal text to find' }, path: nullable('string', 'Repository-relative directory to search, or null for everything'), maxResults: nullable('integer', 'Result limit, default 50') }),
      async execute(input) {
        const needle = str(input.text, 'text');
        const start = input.path ? resolveInside(root, str(input.path, 'path')) : resolveInside(root, '.');
        const limit = Math.min(optInt(input.maxResults) ?? 50, 200);
        const hits: string[] = [];
        walk(root, start, (p) => {
          if (hits.length >= limit || statSize(p) > MAX_FILE_BYTES || !/\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|php|rb|sh|c|h|cc|cpp|hpp|json|ya?ml|toml|md)$/i.test(p)) return;
          readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (hits.length < limit && line.includes(needle)) hits.push(`${rel(p)}:${i + 1}: ${line.trim().slice(0, 200)}`); });
        });
        return capOutput(hits.join('\n') || 'no matches');
      },
    },
    {
      name: 'find_symbol', description: 'Find functions by (partial) name: file and line range.',
      schema: obj({ name: { type: 'string', description: 'Function name or part of it' } }),
      async execute(input) {
        const name = str(input.name, 'name');
        const a = await analyse();
        const hits = a.map.functions.filter((f) => f.name === name || f.name.includes(name)).slice(0, 50);
        return capOutput(hits.map((f) => `${f.name || '<anonymous>'} ${rel(f.file)}:${f.startLine}-${f.endLine}`).join('\n') || 'no matches');
      },
    },
    {
      name: 'find_callers', description: 'Functions that call a symbol (by name).',
      schema: obj({ symbol: { type: 'string', description: 'Callee name' } }),
      async execute(input) {
        const symbol = str(input.symbol, 'symbol');
        const a = await analyse();
        const hits = a.map.functions.filter((f) => f.calls.includes(symbol)).slice(0, 50);
        return capOutput(hits.map((f) => `${f.name || '<anonymous>'} ${rel(f.file)}:${f.startLine}-${f.endLine}`).join('\n') || 'no callers found');
      },
    },
    {
      name: 'taint_paths', description: 'Source-to-sink data flows found by the offline analysis.',
      schema: obj({ file: nullable('string', 'Repository-relative file, or null for all') }),
      async execute(input) {
        const only = input.file ? resolveInside(root, str(input.file, 'file')) : null;
        const a = await analyse();
        const lines: string[] = [];
        for (const [path, list] of a.findings) {
          if (only && path !== only) continue;
          for (const f of list) if (f.source === 'athena-taint') lines.push(`${f.ruleId} ${rel(path)}:${f.line} [${f.confidence ?? '?'}] ${f.trace?.map((t) => `${t.file ? rel(t.file) : rel(path)}:${t.line} ${t.note}`).join(' -> ') ?? ''}`);
        }
        return capOutput(lines.slice(0, 100).join('\n') || 'no taint flows');
      },
    },
    {
      name: 'offline_findings', description: 'All findings from the offline analysis (rules, taint, investigation) with confidence.',
      schema: obj({ file: nullable('string', 'Repository-relative file, or null for all') }),
      async execute(input) {
        const only = input.file ? resolveInside(root, str(input.file, 'file')) : null;
        const a = await analyse();
        const lines: string[] = [];
        for (const [path, list] of a.findings) {
          if (only && path !== only) continue;
          for (const f of list) lines.push(`${f.ruleId} ${rel(path)}:${f.line} [${f.confidence ?? '?'}] ${f.code.slice(0, 120)}`);
        }
        return capOutput(lines.slice(0, 150).join('\n') || 'no findings');
      },
    },
    {
      name: 'dependency_findings', description: 'Known-vulnerable or suspicious dependencies (from locally cached advisory data only).',
      schema: obj({}),
      async execute() {
        const r = await analyzeDependencies(root, { offline: true, registryChecks: false });
        return capOutput(r.findings.slice(0, 50).map((f) => `${f.severity} ${f.dependency?.name}@${f.dependency?.version} ${f.message.slice(0, 160)}`).join('\n') || `no dependency findings (${r.detail})`);
      },
    },
  ];
  return tools;
}
