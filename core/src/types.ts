import type { LanguageId } from './lang/languages.js';
export type CodeUnitKind = 'function' | 'class' | 'method' | 'arrow';
export type ConfidenceBand = 'LOW' | 'UNCERTAIN' | 'HIGH';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSource = 'athena-rules' | 'athena-taint' | 'athena-secrets' | 'athena-investigate' | 'athena-deps' | 'secret-detector' | 'hallucination-detector' | 'security-analyzer' | 'semgrep' | 'eslint' | 'npm-audit' | 'nodejsscan' | 'bearer';

export interface SemgrepConfig {
  enabled: boolean;
  timeoutMs: number;
  config: string;
}

export interface ESLintConfig {
  enabled: boolean;
  timeoutMs: number;
  rules?: string[];
  plugins?: string[];
}

export interface DependenciesConfig {
  enabled: boolean;
  /** Use only cached advisory/registry data. */
  offline: boolean;
  /** Registry lookups (existence, deprecation, freshness, install scripts). OSV is always queried. */
  registryChecks: boolean;
}

export interface UpdatesConfig {
  /** Refresh advisory data in the background when it is older than `intervalHours` (only for ecosystems already synced). */
  auto: boolean;
  intervalHours: number;
  /** Block on known-exploited (CISA KEV) vulnerabilities at any severity. */
  blockKnownExploited: boolean;
}

export interface NpmAuditConfig {
  enabled: boolean;
  timeoutMs: number;
  severityThreshold?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface NodejsscanConfig {
  enabled: boolean;
  timeoutMs: number;
  requireDocker: boolean;
}

export interface BearerConfig {
  enabled: boolean;
  timeoutMs: number;
  reportType?: 'security' | 'data-privacy' | 'all';
}

export interface CodeUnitMetadata {
  loc: number;
  commentLines: number;
  commentRatio: number;
  identifiers: string[];
  nestingDepth: number;
  parameters: string[];
  hasJSDoc: boolean;
  complexity: number;
}

export interface CodeUnit {
  id: string;
  name: string;
  kind: CodeUnitKind;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  metadata: CodeUnitMetadata;
}

export interface SignalResult {
  signal: string;
  score: number;
  maxWeight: number;
  evidence: string;
}

export interface ExplainedScore {
  score: number;
  band: ConfidenceBand;
  signalsTriggered: number;
  variance: number;
  topSignals: {
    signal: string;
    contribution: number;
    score: number;
  }[];
}

export type UnitProvenance = 'ai' | 'human' | 'mixed' | 'uncertain';
export type FileCoverageStatus = 'analyzed' | 'parse-failed' | 'skipped-size' | 'skipped-excluded' | 'missing';
export type CheckStatus = 'ran' | 'unavailable' | 'failed' | 'disabled';

export interface FileCoverage {
  path: string;
  status: FileCoverageStatus;
  reason?: string;
}

export interface CheckCoverage {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface ScanCoverage {
  files: FileCoverage[];
  checks: CheckCoverage[];
  complete: boolean;
  gaps: string[];
}

export interface AiProvenance {
  unit: 'lines';
  totalLines: number;
  recorded: { lines: number; available: boolean; reason?: string };
  estimated: {
    method: 'heuristic' | 'fast';
    /** Model that produced the estimate for the languages it covers, e.g. `athena-detect-fast 1.0.0`. */
    model?: string;
    /** Languages in this scan that fell back to the heuristic (no enabled model). */
    heuristicLanguages?: LanguageId[];
    aiLines: number;
    mixedLines: number;
    uncertainLines: number;
    humanLines: number;
  };
  files: Array<{
    path: string;
    lines: number;
    recordedLines: number;
    aiLines: number;
    mixedLines: number;
    uncertainLines: number;
  }>;
}

export interface ScoredUnit {
  unit: CodeUnit;
  score: number;
  signals: SignalResult[];
  flagged: boolean;
  explained: ExplainedScore;
  provenance: UnitProvenance;
  recorded: boolean;
}

export interface ClassifiedFinding {
  id: string;
  severity: Severity;
  type: string;
  category: string;
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  aiScore: number;
  explainedScore: ExplainedScore;
  source: FindingSource;
  ruleId: string;
  /** How sure Athena is after its offline checks (reachability, defenses, impact). `low` never blocks. */
  confidence?: 'high' | 'medium' | 'low';
  /** Why the confidence is what it is, one line per lens. */
  evidence?: string[];
  /** Skill that produced the finding (additive). */
  skill?: string;
  /** Who can reach the code: from the entry point that contains it, when one does. */
  exposure?: 'public' | 'authenticated' | 'internal';
  /** severity x exposure x confidence; used to order findings. */
  priority?: number;
  /** Source-to-sink path for taint findings (additive). */
  trace?: Array<{ file: string; line: number; note: string }>;
  /** The package a dependency finding is about (additive). */
  dependency?: { ecosystem: string; name: string; version: string; manifest: string };
  /** Listed in CISA's Known Exploited Vulnerabilities catalogue. */
  kev?: boolean;
  /** FIRST EPSS probability of exploitation in the next 30 days. */
  epss?: { score: number; percentile: number };
}

export interface FileReport {
  path: string;
  units: ScoredUnit[];
  findings: ClassifiedFinding[];
}

export interface ScanReport {
  timestamp: string;
  /** Present for `athena review`: what the change filter did (scope, skipped binaries, renames, existing issues). */
  review?: import('./diff/filter.js').ReviewInfo;
  /** Dependencies found in this scan (lockfiles and manifests); exported as an SBOM and re-checked by `athena alerts`. */
  inventory?: Array<{ ecosystem: string; name: string; version: string; direct: boolean; manifest: string }>;
  duration: number;
  summary: {
    filesScanned: number;
    skippedFiles: number;
    totalUnits: number;
    flaggedUnits: number;
    findings: Record<Severity, number>;
    /** Findings Athena could not confirm (low confidence): shown, never blocking. */
    needsReview?: number;
    /** Skills that were active for this scan and why. */
    skills?: Array<{ name: string; source: string; reason: string }>;
    /** Problems loading skills (overrides refused, invalid skills ignored, slow skills switched off). */
    skillWarnings?: string[];
    blocked: boolean;
    aiScore: number;
    aiFlagRatio: number;
    aiPercentage: number;
    riskDensity: {
      criticalPer1kLoc: number;
      findingsPer1kLoc: number;
      flaggedRatio: number;
    };
    confidenceBands: Record<ConfidenceBand, number>;
    aiOrigin?: {
      score: number;
      flaggedUnits: number;
      flagRatio: number;
      percentage: number;
      confidenceBands: Record<ConfidenceBand, number>;
    };
    security?: {
      findings: Record<Severity, number>;
      blocked: boolean;
      riskDensity: {
        criticalPer1kLoc: number;
        findingsPer1kLoc: number;
        flaggedRatio: number;
      };
    };
    weightedContributions?: Array<{
      signal: string;
      contribution: number;
      score: number;
      maxWeight: number;
    }>;
    calibration?: {
      thresholdUsed: number;
      source: 'default' | 'calibrated';
      targetPrecision?: number;
      targetRecall?: number;
      corpusVersion?: string;
    };
    delta?: ScanDelta;
    coverage?: ScanCoverage;
    aiProvenance?: AiProvenance;
    /** Per-language totals for files that were parsed (additive, phase 2). */
    languages?: Partial<Record<LanguageId, { files: number; units: number; lines: number }>>;
  };
  files: FileReport[];
}

export interface ScanDelta {
  baseline: boolean;
  previousTimestamp?: string;
  riskScore: {
    current: number;
    previous: number;
    change: number;
  };
  findings: {
    current: number;
    previous: number;
    change: number;
    new: number;
    resolved: number;
    newBySeverity: Record<Severity, number>;
    resolvedBySeverity: Record<Severity, number>;
  };
  folders: Array<{
    folder: string;
    currentRisk: number;
    previousRisk: number;
    change: number;
  }>;
  regressionAlert: boolean;
}

export interface AthenaConfig {
  /** Routes that are public on purpose; convention mining will not flag them for missing auth. */
  publicRoutes?: string[];
  threshold: number;
  blockOn: Severity[];
  exclude: string[];
  secretDetection: boolean;
  hallucinationDetection: boolean;
  /** Deprecated and ignored: Semgrep, NodeJSScan and Bearer were retired (Athena's own engine replaced them). */
  semgrep?: SemgrepConfig;
  eslint?: ESLintConfig;
  /** Deprecated and ignored: `npm audit` was replaced by dependency intelligence (`dependencies`). */
  npmAudit?: NpmAuditConfig;
  dependencies?: DependenciesConfig;
  updates?: UpdatesConfig;
  nodejsscan?: NodejsscanConfig;
  bearer?: BearerConfig;
  maxFileSize: number;
  weights: Record<string, number>;
}

export interface ScanOptions {
  cwd?: string;
  threshold?: number;
  format?: 'terminal' | 'json' | 'jsonl';
}
