export type CodeUnitKind = 'function' | 'class' | 'method' | 'arrow';
export type ConfidenceBand = 'LOW' | 'UNCERTAIN' | 'HIGH';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSource = 'secret-detector' | 'hallucination-detector' | 'security-analyzer' | 'semgrep' | 'eslint' | 'npm-audit' | 'nodejsscan' | 'bearer';

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

export interface ScoredUnit {
  unit: CodeUnit;
  score: number;
  signals: SignalResult[];
  flagged: boolean;
  explained: ExplainedScore;
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
}

export interface FileReport {
  path: string;
  units: ScoredUnit[];
  findings: ClassifiedFinding[];
}

export interface ScanReport {
  timestamp: string;
  duration: number;
  summary: {
    filesScanned: number;
    skippedFiles: number;
    totalUnits: number;
    flaggedUnits: number;
    findings: Record<Severity, number>;
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
  };
  files: FileReport[];
}

export interface AthenaConfig {
  threshold: number;
  blockOn: Severity[];
  exclude: string[];
  secretDetection: boolean;
  hallucinationDetection: boolean;
  semgrep: SemgrepConfig;
  eslint?: ESLintConfig;
  npmAudit?: NpmAuditConfig;
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
