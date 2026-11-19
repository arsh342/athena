import { readFile, stat } from 'node:fs/promises';
import { mergeConfig } from './config.js';
import { analyzeSecurity } from './analyzers/security-analyzer.js';
import { runSemgrep } from './analyzers/semgrep-adapter.js';
import { detectLanguage, LANGUAGE_FAMILY, type LanguageId } from './lang/languages.js';
import { parseFileDetailed, warmParsers } from './parser/ast-parser.js';
import { generateReport } from './report/report-generator.js';
import { scoreUnit } from './scorer/heuristic-scorer.js';
import { buildAiProvenance, markRecordedUnits } from './provenance/aggregate.js';
import { recordedAiLines, type RecordedRepo } from './provenance/git-recorded.js';
import { classifyUnit, loadFastModel, type FastModel } from './provenance/fast-model.js';
import { analyzeProject, isVendoredOrGenerated, loadProjectFiles } from './analysis/project.js';
import { ruleMeta } from './rules/registry.js';
import type { RawFinding } from './rules/types.js';
import { scanTextForSecrets } from './secrets/scan.js';
import { relative } from 'node:path';
import { activationReason, buildProfile, isSkillFixturePath } from './skills/activate.js';
import { compileSkills, runFileRules, type CompiledSkills } from './skills/compile.js';
import { clean, learnedAsSkill, loadSkills } from './skills/loader.js';
import { redactKnownSecrets } from './report/redact.js';
import { createHash } from 'node:crypto';
import { scannerRegistry, type ScannerRegistry } from './scanner-registry.js';
import type { AthenaConfig, CheckCoverage, ExplainedScore, FileCoverage, FileReport, ScanCoverage, ScoredUnit, ScanReport, Severity } from './types.js';

export interface ScanProgressEvent {
  phase:
    | 'prepare'
    | 'files'
    | 'security-analysis'
    | 'external-scanners'
    | 'report';
  filePath: string;
  index: number;
  total: number;
  status: 'scanning' | 'scanned' | 'skipped' | 'missing';
  findings: number;
  detail?: string;
}

interface ScanHooks {
  onFileProgress?: (event: ScanProgressEvent) => void;
  onScannerStage?: (event: ScanProgressEvent) => void;
}

export interface ScanFilesOptions {
  /** Project root for external scanners. Defaults to process.cwd(). */
  root?: string;
  /** Files discovered but excluded by configuration; listed in coverage, never a gap. */
  excludedFiles?: string[];
  recordedProvenance?: boolean;
  registry?: ScannerRegistry;
  /** Override the bundled fast detector (tests). `null` forces the heuristic. */
  fastModel?: FastModel | null;
  /** Config-style text files (.env, YAML, JSON, ...) searched for secrets only. */
  textFiles?: string[];
  /** `false` disables skills; a compiled set overrides discovery (tests). Default: built-in, user and repo skills that apply to the project. */
  skills?: false | CompiledSkills;
  /** Run Athena's own rule packs and taint analysis (default true). */
  analysis?: boolean;
}

export async function scanFiles(
  filePaths: string[],
  configInput: Partial<AthenaConfig> = {},
  hooks: ScanHooks = {},
  options: ScanFilesOptions = {},
): Promise<ScanReport> {
  const startedAt = Date.now();
  const config = mergeConfig(configInput);
  const files: FileReport[] = [];
  let totalLoc = 0;
  let skippedFiles = 0;
  const totalFiles = filePaths.length;
  let processedFiles = 0;
  const fileCoverage: FileCoverage[] = [];
  const registry = options.registry ?? scannerRegistry;
  const languages: Partial<Record<LanguageId, { files: number; units: number; lines: number }>> = {};
  const unavailableParsers = new Set<LanguageId>();
  const fastModel = options.fastModel === undefined ? loadFastModel() : options.fastModel;
  const languagesWithUnits = new Set<LanguageId>();
  await warmParsers([...new Set(filePaths.map((p) => detectLanguage(p)).filter((l): l is LanguageId => l !== null))]);

  hooks.onFileProgress?.({
    phase: 'prepare',
    filePath: '',
    index: 0,
    total: totalFiles,
    status: 'scanning',
    findings: 0,
    detail: 'discovering source files',
  });

  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    hooks.onFileProgress?.({
      phase: 'files',
      filePath,
      index: index + 1,
      total: totalFiles,
      status: 'scanning',
      findings: 0,
      detail: 'parse + score + local checks',
    });

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      fileCoverage.push({ path: filePath, status: 'missing', reason: 'file not found' });
      processedFiles += 1;
      hooks.onFileProgress?.({
        phase: 'files',
        filePath,
        index: processedFiles,
        total: totalFiles,
        status: 'missing',
        findings: 0,
      });
      continue;
    }

    if (fileStat.size > config.maxFileSize) {
      skippedFiles += 1;
      fileCoverage.push({ path: filePath, status: 'skipped-size', reason: `larger than ${config.maxFileSize} bytes` });
      processedFiles += 1;
      hooks.onFileProgress?.({
        phase: 'files',
        filePath,
        index: processedFiles,
        total: totalFiles,
        status: 'skipped',
        findings: 0,
        detail: 'skipped oversized file',
      });
      continue;
    }

    hooks.onFileProgress?.({
      phase: 'security-analysis',
      filePath,
      index: index + 1,
      total: totalFiles,
      status: 'scanning',
      findings: 0,
      detail: 'running secret + hallucination analyzers',
    });

    const { units, error: parseError, language, parserUnavailable, lines } = await parseFileDetailed(filePath);
    if (parserUnavailable && language) unavailableParsers.add(language);
    if (language && !parserUnavailable) {
      const stats = (languages[language] ??= { files: 0, units: 0, lines: 0 });
      stats.files += 1;
      stats.units += units.length;
      stats.lines += lines ?? 0;
    }
    fileCoverage.push(parseError
      ? { path: filePath, status: 'parse-failed', reason: parseError }
      : { path: filePath, status: 'analyzed' });
    const scoredUnits = units.map((unit) => {
      const scored = scoreUnit(unit, config);
      if (fastModel && language && !parserUnavailable) {
        languagesWithUnits.add(language);
        const result = classifyUnit(fastModel, unit, language);
        if (result) {
          scored.provenance = result.provenance;
          scored.flagged = result.provenance === 'ai' || result.provenance === 'mixed';
        }
      }
      return scored;
    });
    const findings = scoredUnits.flatMap((scored) => analyzeSecurity(scored, config));
    totalLoc += units.reduce((sum, unit) => sum + unit.metadata.loc, 0);

    files.push({
      path: filePath,
      units: scoredUnits,
      findings,
    });

    processedFiles += 1;
    hooks.onFileProgress?.({
      phase: 'files',
      filePath,
      index: processedFiles,
      total: totalFiles,
      status: 'scanned',
      findings: findings.length,
      detail: 'file complete',
    });
  }

  const analysisFamilies = new Map<string, number>();
  let skippedMinified = 0;
  const reportsByPath = new Map(files.map((f) => [f.path, f]));
  const addRaw = (path: string, raw: RawFinding): void => {
    const meta = ruleMeta(raw.ruleId) ?? compiledSkills?.metaById.get(raw.ruleId);
    if (!meta) return;
    let report = reportsByPath.get(path);
    if (!report) {
      report = { path, units: [], findings: [] };
      files.push(report);
      reportsByPath.set(path, report);
    }
    const unit = selectUnitForLine(report.units, raw.line);
    // Node text can contain credentials that sit next to a vulnerability: scrub every free-text field.
    const scrub = (text: string): string => redactKnownSecrets(text);
    report.findings.push({
      id: createHash('sha1').update(`${raw.ruleId}:${path}:${raw.line}:${raw.code}`).digest('hex').slice(0, 10),
      severity: meta.severity, type: meta.title, category: meta.category,
      message: scrub(raw.message ?? meta.title), file: path, line: raw.line, column: raw.column ?? 1, code: scrub(raw.code),
      aiScore: unit?.score ?? config.threshold, explainedScore: unit?.explained ?? emptyExplainedScore(),
      source: raw.source, ruleId: raw.ruleId,
      confidence: raw.confidence ?? meta.confidence ?? 'medium',
      ...(raw.evidence && raw.evidence.length > 0 ? { evidence: raw.evidence.map(scrub) } : {}),
      ...(raw.exposure ? { exposure: raw.exposure } : {}),
      ...(raw.priority !== undefined ? { priority: raw.priority } : {}),
      ...(compiledSkills?.ruleSkill.get(raw.ruleId) ? { skill: compiledSkills.ruleSkill.get(raw.ruleId)! } : {}),
      ...(raw.trace ? { trace: raw.trace.map((t) => ({ file: t.file ?? path, line: t.line, note: scrub(t.note) })) } : {}),
    });
  };

  let compiledSkills: CompiledSkills | undefined;
  const skillWarnings: string[] = [];
  const skillNotes: Array<{ name: string; source: string; reason: string; rules: number }> = [];
  const analyzedPaths = fileCoverage.filter((f) => f.status === 'analyzed' || f.status === 'parse-failed').map((f) => f.path);
  if (options.analysis !== false) {
    const projectFiles = await loadProjectFiles(analyzedPaths);
    const root = options.root ?? process.cwd();
    if (options.skills && typeof options.skills === 'object') compiledSkills = options.skills;
    else if (options.skills !== false) {
      const loaded = loadSkills(root);
      const own = projectFiles.filter((f) => !isSkillFixturePath(relative(root, f.path)) && !isVendoredOrGenerated(relative(root, f.path), f.source));
      const profile = buildProfile(root, own, (options.textFiles ?? []).filter((p) => !isSkillFixturePath(relative(root, p))));
      const learned = learnedAsSkill(loaded.learned);
      const active = [...loaded.skills, ...(learned ? [learned] : [])].filter((skill) => {
        const reason = activationReason(skill, profile);
        if (reason) skillNotes.push({ name: skill.meta.name, source: skill.source, reason, rules: skill.rules.length });
        return reason !== null;
      });
      compiledSkills = compileSkills(active);
      for (const w of [...loaded.warnings, ...compiledSkills.warnings]) skillWarnings.push(w);
    }
    const project = await analyzeProject(projectFiles, { publicRoutes: config.publicRoutes ?? [], root, ...(compiledSkills ? { skills: compiledSkills } : {}) });
    for (const family of project.families) analysisFamilies.set(family, 0);
    for (const path of project.failed) {
      const lang = detectLanguage(path);
      const family = lang ? LANGUAGE_FAMILY[lang] : 'js';
      analysisFamilies.set(family, (analysisFamilies.get(family) ?? 0) + 1);
    }
    skippedMinified = project.skippedMinified.length;
    const skipped = new Set(project.skippedMinified);
    for (const entry of fileCoverage) {
      if (skipped.has(entry.path)) {
        entry.status = 'skipped-excluded';
        entry.reason = 'vendored, generated or minified code (not rule-analysed)';
      }
    }
    for (const path of project.timedOut) {
      const lang = detectLanguage(path);
      const family = lang ? LANGUAGE_FAMILY[lang] : 'js';
      analysisFamilies.set(family, (analysisFamilies.get(family) ?? 0) + 1);
    }
    for (const [path, raws] of project.findings) for (const raw of raws) addRaw(path, raw);
  }

  if (config.secretDetection) {
    // Secrets are searched in the whole text of every source file and of config-style text files (.env, YAML, JSON, ...).
    const textPaths = [...new Set(options.textFiles ?? [])];
    for (const path of textPaths) {
      try {
        const info = await stat(path);
        if (info.size > 1_000_000) {
          fileCoverage.push({ path, status: 'skipped-size', reason: 'larger than 1 MB' });
          continue;
        }
        fileCoverage.push({ path, status: 'analyzed' });
      } catch {
        fileCoverage.push({ path, status: 'missing', reason: 'file not found' });
      }
    }
    for (const path of [...analyzedPaths, ...textPaths]) {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      for (const raw of scanTextForSecrets(path, text)) addRaw(path, raw);
    }
  }

  if (compiledSkills && compiledSkills.fileRules.length > 0) {
    for (const path of [...analyzedPaths, ...(options.textFiles ?? [])]) {
      if (isSkillFixturePath(relative(options.root ?? process.cwd(), path))) continue;
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      for (const hit of runFileRules(relative(options.root ?? process.cwd(), path).split('\\').join('/'), text, compiledSkills.fileRules)) addRaw(path, { ruleId: hit.ruleId, line: hit.line, code: hit.code, source: 'athena-rules' });
    }
  }

  const projectRoot = options.root ?? process.cwd();
  const recorded: RecordedRepo = options.recordedProvenance === false
    ? { available: false, reason: 'disabled', files: new Map() }
    : await recordedAiLines(projectRoot, files.map((file) => file.path));
  markRecordedUnits(files, recorded);

  // Run external scanners using the scanner registry
  const scannerOutcome = new Map<string, CheckCoverage['status']>();
  const trackStage: ScanHooks['onScannerStage'] = (event) => {
    const detail = event.detail ?? '';
    const unavailable = detail.match(/^(\S+) unavailable$/);
    const complete = detail.match(/^(\S+) complete$/);
    const failed = detail.match(/^(\S+) failed$/);
    if (unavailable) scannerOutcome.set(unavailable[1], 'unavailable');
    else if (complete) scannerOutcome.set(complete[1], 'ran');
    else if (failed) scannerOutcome.set(failed[1], 'failed');
    hooks.onScannerStage?.(event);
  };
  hooks.onScannerStage?.({
    phase: 'external-scanners',
    filePath: '',
    index: processedFiles,
    total: totalFiles,
    status: 'scanning',
    findings: 0,
    detail: 'starting external scanners',
  });
  const externalFindings = await registry.runEnabledScanners(filePaths, projectRoot, config, trackStage);

  // Merge external findings into file reports
  if (externalFindings.length > 0) {
    const reportsByPath = new Map(files.map((file) => [file.path, file]));

    for (const finding of externalFindings) {
      const existing = reportsByPath.get(finding.file);
      const unitContext = selectUnitForLine(existing?.units ?? [], finding.line);

      const mappedFinding = {
        id: finding.id,
        severity: finding.severity as Severity,
        type: finding.type,
        category: finding.category,
        message: finding.message,
        file: finding.file,
        line: finding.line,
        column: finding.column,
        code: finding.code,
        aiScore: unitContext?.score ?? config.threshold,
        explainedScore: unitContext?.explained ?? emptyExplainedScore(),
        source: finding.source,
        ruleId: finding.ruleId,
      };

      if (existing) {
        existing.findings.push(mappedFinding);
      } else {
        const newReport: FileReport = {
          path: finding.file,
          units: [],
          findings: [mappedFinding],
        };
        files.push(newReport);
        reportsByPath.set(finding.file, newReport);
      }
    }
  }

  hooks.onScannerStage?.({
    phase: 'report',
    filePath: '',
    index: processedFiles,
    total: totalFiles,
    status: 'scanning',
    findings: externalFindings.length,
    detail: 'assembling final report',
  });

  for (const excluded of options.excludedFiles ?? []) {
    fileCoverage.push({ path: excluded, status: 'skipped-excluded', reason: 'excluded by configuration' });
  }
  const enabledHere = fastModel ? [...languagesWithUnits].filter((l) => !fastModel.heuristicLanguages([l]).length) : [];
  const method = fastModel && enabledHere.length > 0
    ? {
        method: 'fast' as const,
        model: `athena-detect-fast ${fastModel.meta.version}`,
        heuristicLanguages: fastModel.heuristicLanguages([...languagesWithUnits].sort()),
      }
    : {
        method: 'heuristic' as const,
        ...(fastModel ? { heuristicDetail: `heuristic · athena-detect-fast ${fastModel.meta.version} not enabled for these languages (below release targets)` } : {}),
      };
  const coverage = buildCoverage(fileCoverage, config, registry, scannerOutcome, recorded, unavailableParsers, method, analysisFamilies, skippedMinified);

  const report = generateReport(startedAt, files, totalLoc, skippedFiles, config, coverage, buildAiProvenance(files, recorded, method));
  if (Object.keys(languages).length > 0) report.summary.languages = languages;
  if (skillNotes.length > 0) report.summary.skills = skillNotes.sort((a, b) => b.rules - a.rules || a.name.localeCompare(b.name)).map(({ rules: _rules, ...rest }) => rest);
  if (compiledSkills?.budgets) for (const [name, b] of compiledSkills.budgets) if (b.spent > b.limit) skillWarnings.push(`skill ${clean(name)} was switched off part-way: its rules used more than ${b.limit} ms`);
  if (skillWarnings.length > 0) report.summary.skillWarnings = skillWarnings.map(clean).slice(0, 20);
  return report;
}

function buildCoverage(
  files: FileCoverage[],
  config: AthenaConfig,
  registry: ScannerRegistry,
  scannerOutcome: Map<string, CheckCoverage['status']>,
  recorded: RecordedRepo,
  unavailableParsers: Set<LanguageId> = new Set(),
  method: { method: 'fast' | 'heuristic'; model?: string; heuristicLanguages?: LanguageId[]; heuristicDetail?: string } = { method: 'heuristic' },
  analysisFamilies: Map<string, number> = new Map(),
  skippedMinified = 0,
): ScanCoverage {
  const checks: CheckCoverage[] = [
    { name: 'secrets', status: config.secretDetection ? 'ran' : 'disabled' },
    { name: 'hallucination', status: config.hallucinationDetection ? 'ran' : 'disabled' },
    { name: 'ai-provenance', status: 'ran', detail: method.method === 'fast' ? method.model : method.heuristicDetail ?? 'heuristic · fast model unavailable' },
    recorded.reason === 'disabled'
      ? { name: 'recorded-provenance', status: 'disabled' }
      : recorded.available
        ? { name: 'recorded-provenance', status: 'ran' }
        : { name: 'recorded-provenance', status: 'unavailable', detail: recorded.reason },
  ];
  for (const [family, timedOut] of [...analysisFamilies].sort()) {
    checks.push({ name: `rules:${family}`, status: 'ran' });
    checks.push(timedOut > 0
      ? { name: `taint:${family}`, status: 'failed', detail: `${timedOut} file(s) exceeded the time budget or could not be analysed` }
      : { name: `taint:${family}`, status: 'ran' });
  }
  if (skippedMinified > 0) checks.push({ name: 'rules-skipped', status: 'ran', detail: `${skippedMinified} minified or generated file(s) not rule-analyzed` });
  for (const lang of [...unavailableParsers].sort()) {
    checks.push({ name: `parser:${lang}`, status: 'unavailable', detail: 'grammar failed to load' });
  }
  for (const scanner of registry.getAllScanners()) {
    const scannerConfig = config[scanner.name as keyof AthenaConfig] as { enabled?: boolean } | undefined;
    if (!scannerConfig || typeof scannerConfig !== 'object' || !scannerConfig.enabled) {
      checks.push({ name: scanner.name, status: 'disabled' });
    } else {
      checks.push({ name: scanner.name, status: scannerOutcome.get(scanner.name) ?? 'failed' });
    }
  }

  const count = (status: FileCoverage['status']) => files.filter((f) => f.status === status).length;
  const gaps: string[] = [];
  const notParsed = files.filter((f) => f.status === 'parse-failed' && f.reason !== 'parser unavailable').length;
  if (notParsed > 0) gaps.push(`${notParsed} file(s) not parsed`);
  if (count('skipped-size') > 0) gaps.push(`${count('skipped-size')} file(s) skipped: larger than ${config.maxFileSize} bytes`);
  if (count('missing') > 0) gaps.push(`${count('missing')} file(s) missing`);
  for (const check of checks) {
    // Recorded provenance depends on the input (not a git repo, shallow clone); shown in its own section.
    if (check.status === 'unavailable' && check.name !== 'recorded-provenance') gaps.push(`${check.name} unavailable`);
  }
  for (const check of checks) {
    if (check.status === 'failed') gaps.push(`${check.name} failed`);
  }

  return { files, checks, complete: gaps.length === 0, gaps };
}

function selectUnitForLine(units: ScoredUnit[], line: number): ScoredUnit | null {
  for (const unit of units) {
    if (line >= unit.unit.startLine && line <= unit.unit.endLine) return unit;
  }
  return null;
}

function emptyExplainedScore(): ExplainedScore {
  return {
    score: 0,
    band: 'LOW',
    signalsTriggered: 0,
    variance: 0,
    topSignals: [],
  };
}
