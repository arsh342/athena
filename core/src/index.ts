export { mergeConfig, defaultConfig, defaultWeights } from './config.js';
export { scanFiles } from './engine.js';
export type { ScanProgressEvent, ScanFilesOptions } from './engine.js';
export { parseFile, parseFileDetailed, parseSource } from './parser/ast-parser.js';
export { scoreUnit, heuristicProvenance } from './scorer/heuristic-scorer.js';
export { analyzeSecurity } from './analyzers/security-analyzer.js';
export { formatJsonl } from './report/report-generator.js';
export { formatTerminalReport } from './report/terminal-formatter.js';
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
export { isAiCommit, AI_BOT_LOGINS, AI_IDENTITY_PATTERNS, AI_TRAILER_KEYS } from './provenance/ai-markers.js';
export type { CommitMeta } from './provenance/ai-markers.js';
export { buildAiProvenance, markRecordedUnits } from './provenance/aggregate.js';
