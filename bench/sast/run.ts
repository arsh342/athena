/**
 * SAST benchmark: runs Athena's own analysis over known-vulnerable apps and scores recall against a
 * hand-verified answer key. Usage: node --import tsx bench/sast/run.ts [--lang js] [--app id] [--write docs]
 * Semgrep/Opengrep are run for comparison only when installed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { analyzeProject, loadProjectFiles } from '../../core/src/analysis/project.ts';
import { isSupportedSource } from '../../core/src/lang/languages.ts';

interface Expected { file: string; line: number; rule: string; note?: string }
interface App { id: string; language: string; repo: string; commit: string; expected: Expected[] }

const here = import.meta.dirname;
const cache = join(here, '.cache');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')) as { apps: App[] };
const args = process.argv.slice(2);
const only = (flag: string): string | null => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);

function sh(cwd: string, ...a: string[]): string {
  return execFileSync('git', a, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8' });
}

function checkout(app: App): string {
  const dir = join(cache, app.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    sh(dir, 'init', '-q');
    sh(dir, 'remote', 'add', 'origin', app.repo);
    sh(dir, 'fetch', '-q', '--depth', '1', 'origin', app.commit);
    sh(dir, 'checkout', '-q', 'FETCH_HEAD');
  }
  return dir;
}

function listSources(dir: string): string[] {
  return sh(dir, 'ls-files', '-z').split('\0').filter((f) => f && isSupportedSource(f) && !/(?:^|\/)(?:node_modules|vendor|test|tests)\//.test(f)).map((f) => join(dir, f));
}

function semgrepAvailable(): boolean {
  return spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0;
}

const lines: string[] = [];
const results: Array<{ app: string; found: number; expected: number; misses: string[]; findings: number }> = [];
for (const app of manifest.apps) {
  if (only('--lang') && app.language !== only('--lang')) continue;
  if (only('--app') && app.id !== only('--app')) continue;
  const dir = checkout(app);
  const analysis = await analyzeProject(await loadProjectFiles(listSources(dir)));
  const findings = [...analysis.findings].flatMap(([path, list]) => list.map((f) => ({ file: relative(dir, path), ...f })));
  const misses: string[] = [];
  let found = 0;
  for (const e of app.expected) {
    const hit = findings.find((f) => f.file === e.file && f.ruleId === e.rule && Math.abs(f.line - e.line) <= 2 && f.confidence !== 'low');
    if (hit) found += 1;
    else misses.push(`${e.file}:${e.line} ${e.rule}${findings.some((f) => f.file === e.file && f.ruleId === e.rule && Math.abs(f.line - e.line) <= 2) ? ' (found, but only as low-confidence "needs review")' : ''}`);
  }
  results.push({ app: app.id, found, expected: app.expected.length, misses, findings: findings.filter((f) => f.confidence !== 'low' && !f.ruleId.startsWith('secret.')).length });
  lines.push(`| ${app.id} | ${app.language} | ${found}/${app.expected.length} | ${(found / app.expected.length * 100).toFixed(0)}% | ${results.at(-1)!.findings} | ${misses.length ? misses.map((m) => `\`${m}\``).join('<br>') : '—'} |`);
}

const comparison = semgrepAvailable() ? 'Semgrep is installed: run `semgrep --config auto <app>` yourself and compare per file.' : 'Semgrep/Opengrep is not installed on this machine, so no side-by-side comparison was run.';
const doc = [
  '# SAST benchmark — Athena own analysis', '',
  `Run: ${new Date().toISOString().slice(0, 10)}. Apps are pinned to the commits in \`bench/sast/manifest.json\`. ${manifest.apps.length ? '' : ''}`,
  'Recall is measured against a **hand-verified, partial** answer key (only issues confirmed by reading the source are listed), so precision is not measured here. "Non-secret findings" counts everything Athena reported at medium/high confidence besides secrets, for scale.', '',
  '| App | Language | Found | Recall | Non-secret findings | Missed |', '|---|---|---|---|---|---|', ...lines, '', comparison, '',
  'Reproduce: `node --import tsx bench/sast/run.ts` (clones into `bench/sast/.cache`, which is git-ignored).', '',
].join('\n');
console.log(doc);
if (only('--write')) {
  mkdirSync(join(here, '..', '..', 'docs', 'athena-bench'), { recursive: true });
  writeFileSync(join(here, '..', '..', 'docs', 'athena-bench', 'SAST.md'), doc);
}
