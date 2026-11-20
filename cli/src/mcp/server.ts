import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  activationReason, analyzeDependencies, analyzeProject, applyChangeFilter, buildProfile, compileSkills, defaultConfig, detectLanguage, getRuleInfo,
  isConfigTextFile, loadProjectFiles, loadSkills, mergeConfig, missingApis, packageTypes, parseUnifiedDiff, previewVariant, redactKnownSecrets, saveVariant,
  scanFiles, selectSkillSection, validateRulesDocument, wholeFileChanges, type ClassifiedFinding, type ScanReport,
} from '@athena/core';
import { findSourceFilesWithExclusions, isSourceCandidate } from '../utils/file-filter.js';
import { getReviewDiff, type ReviewScope } from '../utils/git.js';
import { CLI_VERSION } from '../version.js';

export const TOOL_NAMES = [
  'athena_scan', 'athena_check_files', 'athena_review', 'athena_explain', 'athena_provenance', 'athena_dependencies', 'athena_api_exists',
  'athena_codebase_map', 'athena_taint_paths', 'athena_find_symbol', 'athena_find_callers', 'athena_add_learned_rule', 'athena_skills', 'athena_skill_section',
] as const;

const PAGE = 10;
const MAX_PAGE = 25;

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Redact recognisable secrets from every string in a result, so a tool can never hand one to the host model. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactKnownSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  return value;
}
const ok = (data: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(redactDeep(data)) }] });
const fail = (message: string): Result => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: message }) }] });

class PathError extends Error {}

export interface McpOptions {
  /** Every path argument must resolve inside this directory (default: the process working directory). */
  root: string;
}

export function createAthenaMcpServer(options: McpOptions): McpServer {
  const root = realpathSync(options.root);
  const server = new McpServer({ name: 'athena', version: CLI_VERSION });
  const findings = new Map<string, { finding: ClassifiedFinding; root: string }>();

  /** Resolve a user-supplied path and refuse anything that lands outside the root (including via symlinks). */
  const inside = (input = '.'): string => {
    const abs = resolve(root, input);
    let real = abs;
    let probe = abs;
    // Resolve the deepest existing ancestor, so not-yet-existing paths are judged by where they would be.
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    try {
      real = resolve(realpathSync(probe), relative(probe, abs));
    } catch {
      throw new PathError(`cannot resolve ${input}`);
    }
    if (real !== root && !real.startsWith(root + sep)) throw new PathError(`path ${input} is outside the allowed root`);
    return real;
  };
  const rel = (p: string): string => relative(root, p).split(sep).join('/') || '.';

  const compact = (f: ClassifiedFinding) => ({
    id: f.id.slice(0, 8), severity: f.severity, rule: f.ruleId, file: rel(f.file), line: f.line,
    ...(f.confidence ? { confidence: f.confidence } : {}), ...(f.exposure ? { exposure: f.exposure } : {}), ...(f.kev ? { knownExploited: true } : {}),
    message: f.message.replace(/\s+/g, ' ').slice(0, 200),
  });

  const page = <T>(items: T[], cursor: string | undefined, limit: number | undefined) => {
    const size = Math.min(Math.max(limit ?? PAGE, 1), MAX_PAGE);
    const start = Math.max(0, Number(cursor ?? 0) || 0);
    const next = start + size < items.length ? String(start + size) : undefined;
    return { total: items.length, items: items.slice(start, start + size), ...(next ? { cursor: next } : {}) };
  };

  const summarise = (report: ScanReport, scanRoot: string, cursor?: string, limit?: number) => {
    const all = report.files.flatMap((f) => f.findings).sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.severity) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.severity) || (b.priority ?? 0) - (a.priority ?? 0));
    for (const f of all) findings.set(f.id.slice(0, 8), { finding: f, root: scanRoot });
    const p = page(all, cursor, limit);
    return {
      blocked: report.summary.blocked, counts: report.summary.findings, needsReview: report.summary.needsReview ?? 0, filesScanned: report.summary.filesScanned,
      coverageComplete: report.summary.coverage?.complete ?? true, gaps: report.summary.coverage?.gaps.slice(0, 5) ?? [],
      findings: p.items.map(compact), total: p.total, ...(p.cursor ? { cursor: p.cursor } : {}),
      hint: 'Use athena_explain with a finding id for the code frame, evidence and fix. Reason about medium/low-confidence items; high-confidence ones are already verified offline.',
    };
  };

  const offlineConfig = (failOn: string | undefined) => {
    const blockOn = { critical: ['CRITICAL'], high: ['CRITICAL', 'HIGH'], medium: ['CRITICAL', 'HIGH', 'MEDIUM'], low: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], none: [] }[failOn ?? 'high'] ?? ['CRITICAL', 'HIGH'];
    const config = mergeConfig({ blockOn: blockOn as never });
    config.eslint = { ...config.eslint!, enabled: false };
    return config;
  };
  const failOnSchema = z.enum(['critical', 'high', 'medium', 'low', 'none']).optional();
  const paging = { cursor: z.string().optional().describe('cursor from a previous result'), limit: z.number().int().min(1).max(MAX_PAGE).optional() };

  const guard = <A>(fn: (args: A) => Promise<Result> | Result) => async (args: A): Promise<Result> => {
    try {
      return await fn(args);
    } catch (error) {
      return fail(error instanceof PathError ? error.message : error instanceof Error ? error.message.split('\n')[0]! : String(error));
    }
  };

  server.registerTool('athena_scan', { description: 'Scan a directory offline with Athena (rules, taint, secrets, AI-provenance). Returns counts and the top findings; page with cursor.', inputSchema: { path: z.string().optional(), failOn: failOnSchema, ...paging } },
    guard(async ({ path, failOn, cursor, limit }: { path?: string; failOn?: 'critical' | 'high' | 'medium' | 'low' | 'none'; cursor?: string; limit?: number }) => {
      const dir = inside(path);
      const { files, textFiles } = await findSourceFilesWithExclusions(dir, [...defaultConfig.exclude, 'node_modules', 'dist', 'build']);
      const report = await scanFiles(files, offlineConfig(failOn), {}, { root: dir, textFiles });
      return ok(summarise(report, dir, cursor, limit));
    }));

  server.registerTool('athena_check_files', { description: 'Check specific files (for example the ones you just edited). Returns blocking findings first.', inputSchema: { files: z.array(z.string()).min(1).max(50), failOn: failOnSchema, ...paging } },
    guard(async ({ files, failOn, cursor, limit }: { files: string[]; failOn?: 'critical' | 'high' | 'medium' | 'low' | 'none'; cursor?: string; limit?: number }) => {
      const abs = files.map((f) => inside(f));
      const sources: string[] = [];
      const texts: string[] = [];
      for (const f of abs) {
        if (await isSourceCandidate(f)) sources.push(f);
        else if (isConfigTextFile(f)) texts.push(f);
      }
      const report = await scanFiles(sources, offlineConfig(failOn), {}, { root, textFiles: texts });
      return ok(summarise(report, root, cursor, limit));
    }));

  server.registerTool('athena_review', { description: 'Review a change (staged by default) and report only the findings it introduced.', inputSchema: { scope: z.enum(['staged', 'uncommitted', 'range', 'base']).optional(), value: z.string().optional().describe('range like origin/main..HEAD, or a base branch'), failOn: failOnSchema, ...paging } },
    guard(async ({ scope, value, failOn, cursor, limit }: { scope?: 'staged' | 'uncommitted' | 'range' | 'base'; value?: string; failOn?: 'critical' | 'high' | 'medium' | 'low' | 'none'; cursor?: string; limit?: number }) => {
      const kind = scope ?? 'staged';
      if ((kind === 'range' || kind === 'base') && !value) throw new Error(`scope ${kind} needs a value`);
      const s: ReviewScope = kind === 'range' ? { kind, range: value! } : kind === 'base' ? { kind, base: value! } : { kind };
      const diff = await getReviewDiff(s, root);
      const changes = parseUnifiedDiff(diff.diff);
      for (const extra of wholeFileChanges(diff.untracked)) if (!changes.files.some((f) => f.path === extra.path)) changes.files.push(extra);
      const candidates: string[] = [];
      const texts: string[] = [];
      for (const f of changes.files) {
        if (f.status === 'deleted' || f.binary) continue;
        const abs = resolve(root, f.path);
        if (!existsSync(abs)) continue;
        if (await isSourceCandidate(abs)) candidates.push(abs);
        else if (isConfigTextFile(abs)) texts.push(abs);
      }
      const config = offlineConfig(failOn);
      const report = await scanFiles(candidates, config, {}, { root, textFiles: texts });
      const info = applyChangeFilter(report, changes, root, config, diff.label);
      return ok({ ...summarise(report, root, cursor, limit), scope: diff.label, existingIssues: info.existing.length, skippedBinary: info.skippedBinary, renamed: info.renamed });
    }));

  server.registerTool('athena_explain', { description: 'Explain one finding from a previous scan or review: why it matters, evidence, trace, code frame and how to fix.', inputSchema: { id: z.string().min(4) } },
    guard(async ({ id }: { id: string }) => {
      const hits = [...findings.entries()].filter(([k]) => k.startsWith(id.slice(0, 8)) || id.startsWith(k));
      if (hits.length !== 1) return fail(hits.length === 0 ? `no finding ${id}; run athena_scan, athena_check_files or athena_review first` : `${id} is ambiguous`);
      const { finding: f } = hits[0]![1];
      const info = getRuleInfo(f.ruleId);
      let frame: string[] = [];
      try {
        const lines = readFileSync(f.file, 'utf8').split('\n');
        frame = lines.slice(Math.max(0, f.line - 4), f.line + 3).map((l, i) => `${Math.max(1, f.line - 3) + i}: ${l}`);
      } catch {
        // file may have changed or disappeared
      }
      return ok({ ...compact(f), title: info?.title ?? f.type, why: info?.why, fix: info?.fix, references: info?.references, evidence: f.evidence, trace: f.trace?.map((t) => ({ file: rel(t.file), line: t.line, note: t.note })), frame, ...(f.dependency ? { dependency: f.dependency } : {}) });
    }));

  server.registerTool('athena_provenance', { description: 'Estimate how much of the code is AI-written (by lines), with the most AI-estimated files.', inputSchema: { path: z.string().optional() } },
    guard(async ({ path }: { path?: string }) => {
      const dir = inside(path);
      const { files } = await findSourceFilesWithExclusions(dir, [...defaultConfig.exclude, 'node_modules', 'dist', 'build']);
      const report = await scanFiles(files, offlineConfig('none'), {}, { root: dir });
      const p = report.summary.aiProvenance;
      return ok(p ? { totalLines: p.totalLines, recorded: p.recorded, estimated: p.estimated, topFiles: p.files.filter((f) => f.aiLines > 0).slice(0, 10).map((f) => ({ file: rel(f.path), lines: f.lines, aiLines: f.aiLines })) } : { error: 'no provenance data' });
    }));

  server.registerTool('athena_dependencies', { description: 'Dependency intelligence: vulnerable, malicious, non-existent, typosquatted and deprecated packages. Uses the network unless offline is true.', inputSchema: { path: z.string().optional(), offline: z.boolean().optional(), ...paging } },
    guard(async ({ path, offline, cursor, limit }: { path?: string; offline?: boolean; cursor?: string; limit?: number }) => {
      const dir = inside(path);
      const r = await analyzeDependencies(dir, { offline: offline ?? false });
      const sorted = [...r.findings].sort((a, b) => Number(!!b.kev) - Number(!!a.kev) || ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.severity) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.severity));
      for (const f of sorted) findings.set(f.id.slice(0, 8), { finding: f, root: dir });
      const p = page(sorted, cursor, limit);
      return ok({ dependencies: r.dependencies.length, status: r.status, detail: r.detail, gaps: r.gaps, findings: p.items.map(compact), total: p.total, ...(p.cursor ? { cursor: p.cursor } : {}) });
    }));

  server.registerTool('athena_api_exists', { description: 'Does `member` exist in the installed package\'s type declarations? Answers exists | missing | unknown (not installed or untyped).', inputSchema: { package: z.string().min(1), member: z.string().min(1), path: z.string().optional() } },
    guard(async ({ package: pkg, member, path }: { package: string; member: string; path?: string }) => {
      const dir = inside(path);
      if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(pkg) || !/^[\w$]+$/.test(member)) return fail('invalid package or member name');
      const types = packageTypes(dir, pkg);
      if (!types) return ok({ package: pkg, member, status: 'unknown', reason: 'package not installed here, or it ships no type declarations' });
      return ok({ package: pkg, version: types.version, member, status: types.names.has(member) ? 'exists' : 'missing' });
    }));

  const analysisFor = async (dir: string) => {
    const { files } = await findSourceFilesWithExclusions(dir, [...defaultConfig.exclude, 'node_modules', 'dist', 'build']);
    return analyzeProject((await loadProjectFiles(files)).slice(0, 3000), { root: dir });
  };

  server.registerTool('athena_codebase_map', { description: 'Entry points (routes, CLIs, queues), exposure and rough components of the codebase.', inputSchema: { path: z.string().optional(), ...paging } },
    guard(async ({ path, cursor, limit }: { path?: string; cursor?: string; limit?: number }) => {
      const dir = inside(path);
      const a = await analysisFor(dir);
      const p = page(a.map.entrypoints, cursor, limit);
      return ok({ entrypoints: p.items.map((e) => ({ file: rel(e.file), line: e.line, kind: e.kind, route: e.route, method: e.method, exposure: e.exposure, guards: e.guards, handler: e.handler })), totalEntrypoints: p.total, ...(p.cursor ? { cursor: p.cursor } : {}), components: a.map.components.slice(0, 10).map((c) => ({ path: rel(c.path), files: c.files })), functions: a.map.functions.length });
    }));

  server.registerTool('athena_taint_paths', { description: 'Source-to-sink data flows Athena found (with the files and lines on the path).', inputSchema: { path: z.string().optional(), file: z.string().optional(), ...paging } },
    guard(async ({ path, file, cursor, limit }: { path?: string; file?: string; cursor?: string; limit?: number }) => {
      const dir = inside(path);
      const only = file ? inside(file) : null;
      const a = await analysisFor(dir);
      const flows = [...a.findings].flatMap(([f, list]) => (only && f !== only ? [] : list.filter((x) => x.source === 'athena-taint').map((x) => ({ file: rel(f), ...x }))));
      const p = page(flows, cursor, limit);
      return ok({ total: p.total, flows: p.items.map((x) => ({ file: x.file, line: x.line, rule: x.ruleId, confidence: x.confidence, exposure: x.exposure, trace: x.trace?.map((t) => ({ file: rel(t.file ?? ''), line: t.line, note: t.note })) })), ...(p.cursor ? { cursor: p.cursor } : {}) });
    }));

  server.registerTool('athena_find_symbol', { description: 'Find functions by name (definition file and lines).', inputSchema: { path: z.string().optional(), name: z.string().min(1), ...paging } },
    guard(async ({ path, name, cursor, limit }: { path?: string; name: string; cursor?: string; limit?: number }) => {
      const a = await analysisFor(inside(path));
      const hits = a.map.functions.filter((f) => f.name === name || f.name.includes(name));
      const p = page(hits, cursor, limit);
      return ok({ total: p.total, symbols: p.items.map((f) => ({ name: f.name, file: rel(f.file), startLine: f.startLine, endLine: f.endLine, async: f.isAsync })), ...(p.cursor ? { cursor: p.cursor } : {}) });
    }));

  server.registerTool('athena_find_callers', { description: 'Functions that call a symbol (by name).', inputSchema: { path: z.string().optional(), symbol: z.string().min(1), ...paging } },
    guard(async ({ path, symbol, cursor, limit }: { path?: string; symbol: string; cursor?: string; limit?: number }) => {
      const a = await analysisFor(inside(path));
      const callers = a.map.functions.filter((f) => f.calls.includes(symbol));
      const p = page(callers, cursor, limit);
      return ok({ total: p.total, callers: p.items.map((f) => ({ name: f.name || '<anonymous>', file: rel(f.file), startLine: f.startLine, endLine: f.endLine })), ...(p.cursor ? { cursor: p.cursor } : {}) });
    }));

  server.registerTool('athena_add_learned_rule', { description: 'The only tool that writes: validates a rule and saves it to .athena/learned-rules.json. Requires confirm: true.', inputSchema: { path: z.string().optional(), rule: z.record(z.string(), z.unknown()), confirm: z.boolean().optional() } },
    guard(async ({ path, rule, confirm }: { path?: string; rule: Record<string, unknown>; confirm?: boolean }) => {
      if (confirm !== true) return fail('refused: this tool writes to the repository. Show the user the rule and call again with confirm: true after they agree.');
      const dir = inside(path);
      const { rules, issues } = validateRulesDocument({ rules: [rule] }, 'learned');
      if (rules.length !== 1) return fail(`invalid rule: ${issues[0]?.path}: ${issues[0]?.message}`);
      const files = await loadProjectFiles((await findSourceFilesWithExclusions(dir, [...defaultConfig.exclude, 'node_modules', 'dist', 'build'])).files.slice(0, 2000));
      const preview = await previewVariant(rules[0]!, files, dir);
      if (preview.tooBroad) return fail(`rule is too broad: it matches ${preview.matches.length}+ places`);
      return ok({ saved: rel(saveVariant(dir, rules[0]!)), matches: preview.matches.length });
    }));

  server.registerTool('athena_skills', { description: 'Skills (review checklists and rules) available here, and which apply to this project.', inputSchema: { path: z.string().optional() } },
    guard(async ({ path }: { path?: string }) => {
      const dir = inside(path);
      const loaded = loadSkills(dir);
      const { files, textFiles } = await findSourceFilesWithExclusions(dir, [...defaultConfig.exclude, 'node_modules', 'dist', 'build']);
      const sources = (await loadProjectFiles(files.slice(0, 3000))).map((f) => ({ path: f.path, source: f.source, lang: f.lang }));
      const profile = buildProfile(dir, sources, textFiles);
      void compileSkills;
      return ok({ skills: loaded.skills.map((s) => ({ name: s.meta.name, source: s.source, description: s.meta.description, active: activationReason(s, profile) ?? null, rules: s.rules.length })), warnings: loaded.warnings.slice(0, 5) });
    }));

  server.registerTool('athena_skill_section', { description: 'Read one section of a skill (default: its verification checklist) on demand.', inputSchema: { name: z.string().min(1), section: z.string().optional(), path: z.string().optional() } },
    guard(async ({ name, section, path }: { name: string; section?: string; path?: string }) => {
      const loaded = loadSkills(inside(path));
      const skill = loaded.skills.find((s) => s.meta.name === name);
      if (!skill) return fail(`no skill ${name}`);
      const text = skill.sections[section ?? 'Verification checklist'];
      if (!text) return fail(`no section ${section ?? 'Verification checklist'} (available: ${Object.keys(skill.sections).join(', ')})`);
      void selectSkillSection;
      return ok({ skill: name, section: section ?? 'Verification checklist', source: skill.source, license: skill.meta.license ?? null, text: text.slice(0, 3200) });
    }));

  void isAbsolute;
  void detectLanguage;
  void missingApis;
  return server;
}
