export { mergeConfig, defaultConfig, defaultWeights } from './config.js';
export { scanFiles } from './engine.js';
export type { ScanProgressEvent, ScanFilesOptions } from './engine.js';
export { parseFile, parseFileDetailed, parseSource, warmParsers } from './parser/ast-parser.js';
export type { ParseFileResult } from './parser/ast-parser.js';
export { scoreUnit, heuristicProvenance } from './scorer/heuristic-scorer.js';
export { analyzeSecurity } from './analyzers/security-analyzer.js';
export { formatJsonl } from './report/report-generator.js';
export { formatTerminalReport, gateLine } from './report/terminal-formatter.js';
export type { TerminalReportOptions, FailOn } from './report/terminal-formatter.js';
export { scannerRegistry, ScannerRegistry } from './scanner-registry.js';
export type {
  AthenaConfig,
  ClassifiedFinding,
  CodeUnit,
  CodeUnitKind,
  ConfidenceBand,
  FileReport,
  ScanOptions,
  ScanReport,
  ScanDelta,
  ScoredUnit,
  SemgrepConfig,
  ESLintConfig,
  NpmAuditConfig,
  DependenciesConfig,
  NodejsscanConfig,
  BearerConfig,
  Severity,
  SignalResult,
  UnitProvenance,
  FileCoverageStatus,
  CheckStatus,
  FileCoverage,
  CheckCoverage,
  ScanCoverage,
  AiProvenance,
} from './types.js';
export { athenaHome, repoKey } from './util/athena-home.js';
export { recordedAiLines } from './provenance/git-recorded.js';
export type { RecordedFile, RecordedRepo } from './provenance/git-recorded.js';
export { isAiCommit, AI_BOT_LOGINS, AI_EMAIL_PATTERNS, AI_TOOL_NAME, AI_TRAILER_KEYS } from './provenance/ai-markers.js';
export type { CommitMeta } from './provenance/ai-markers.js';
export { buildAiProvenance, markRecordedUnits } from './provenance/aggregate.js';
export { isSecretFinding, redactSecrets, redactKnownSecrets, redactFrameLine } from './report/redact.js';
export { getRuleInfo } from './rules/catalog.js';
export type { RuleInfo } from './rules/catalog.js';
export { formatSarif } from './report/sarif.js';
export * from './lang/languages.js';
export { getParser, ParserUnavailableError, type TreeSitterParser } from './lang/parser-pool.js';
export { loadFastModel, classifyUnit, probabilitiesFromFeatures } from './provenance/fast-model.js';
export type { FastModel, FastModelMeta } from './provenance/fast-model.js';
export { isConfigTextFile } from './util/text-files.js';
export { analyzeProject, isVendoredOrGenerated, loadProjectFiles, type ProjectAnalysis, type ProjectFile } from './analysis/project.js';
export { scanTextForSecrets } from './secrets/scan.js';
export { allRuleMeta, ruleMeta } from './rules/registry.js';
export * from './skills/index.js';

export { analyzeDependencies, type DepsOptions, type DepsResult } from './deps/analyze.js';
export { parseManifests } from './deps/parsers/index.js';
export type { Dependency, Ecosystem } from './deps/types.js';
export { runUpdate, describeUpdate, ecosystemsFor, needsUpdate, dataAgeHours, updateRunning, type UpdateSummary } from './updates/scheduler.js';
export { dbStatus } from './updates/store.js';
export { installPack, rollbackPack, fetchLatestPack, packState, PackRejected } from './updates/packs.js';
export { PACK_PUBLIC_KEY } from './updates/signature.js';
export { FEEDS } from './updates/feeds.js';
export { queryLocal, hasLocal } from './updates/vulndb.js';
export { loadKev } from './updates/kev.js';
export { formatCycloneDx, purl } from './report/cyclonedx.js';
export { newAlerts, alertsForInventory, ADVISORY_ID, type Alert } from './updates/alerts.js';
export { parseUnifiedDiff, wholeFileChanges, isChangedLine, type ChangeSet, type ChangedFile } from './diff/changes.js';
export { applyChangeFilter, recomputeGate, type ReviewInfo } from './diff/filter.js';
export { formatMarkdownReview } from './report/markdown.js';
export { packageTypes, missingApis } from './deps/api-exists.js';
export { enclosingFunction, fnId, type MapIndex } from './investigate/map.js';
