export { mergeConfig, defaultConfig, defaultWeights } from './config.js';
export { scanFiles } from './engine.js';
export type { ScanProgressEvent } from './engine.js';
export { parseFile, parseSource } from './parser/ast-parser.js';
export { scoreUnit } from './scorer/heuristic-scorer.js';
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
} from './types.js';
