export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ConfidenceBand = 'LOW' | 'UNCERTAIN' | 'HIGH';

export type FindingSource =
  | 'secret-detector'
  | 'athena-secrets'
  | 'athena-rules'
  | 'athena-taint'
  | 'athena-investigate'
  | 'athena-deps'
  | 'athena-agent'
  | 'hallucination-detector'
  | 'security-analyzer'
  | 'semgrep'
  | 'eslint'
  | 'npm-audit'
  | 'nodejsscan'
  | 'bearer'
  | 'trivy'
  | 'horusec';

export interface AuthUser {
  id: number;
  email: string;
}

export interface SignalContribution {
  signal: string;
  contribution: number;
  score: number;
}

export interface Finding {
  id: string;
  severity: Severity;
  type: string;
  category: string;
  message: string;
  file: string;
  line: number;
  column: number;
  source: FindingSource;
  aiScore: number;
  code: string;
  ruleId: string;
  confidence?: 'high' | 'medium' | 'low';
  evidence?: string[];
  trace?: Array<{ file: string; line: number; note: string }>;
  exposure?: 'public' | 'authenticated' | 'internal';
  /** The user's AI verdict, when the scan used their own key. */
  aiVerdict?: { verdict: 'confirmed' | 'refuted' | 'needs-human'; reason: string; provider: string; model: string; citations: string[] };
  topSignals: SignalContribution[];
}

export interface AiProvenanceSummary {
  unit: 'lines';
  totalLines: number;
  recorded: { lines: number; available: boolean; reason?: string };
  estimated: { method: 'heuristic' | 'fast'; model?: string; heuristicLanguages?: string[]; aiLines: number; mixedLines: number; uncertainLines: number; humanLines: number };
  topFiles: Array<{ path: string; lines: number; recordedLines: number; aiLines: number; mixedLines: number; uncertainLines: number }>;
}

export interface CoverageSummary {
  complete: boolean;
  gaps: string[];
  analyzedFiles: number;
  totalFiles: number;
}

export interface ScanSummary {
  scanId: string;
  repoName: string;
  repoUrl: string;
  status: 'COMPLETED' | 'RUNNING' | 'FAILED';
  createdAt: string;
  aiPercentage: number;
  flaggedUnits: number;
  filesScanned: number;
  totalUnits: number;
  findings: Record<Severity, number>;
  riskDensity: {
    findingsPer1kLoc: number;
    criticalPer1kLoc: number;
    flaggedRatio: number;
  };
  duration: number;
  /** Null or missing for scans saved before provenance was measured. */
  aiProvenance?: AiProvenanceSummary | null;
  /** What the user's own AI key did on this scan (mode, model, spend). Never the key. */
  ai?: { mode: string; provider: string; model: string; costUsd: number; checked: number; notChecked: number };
  coverage?: CoverageSummary | null;
}

export interface LandingStat {
  value: number;
  label: string;
  suffix: string;
}

export interface LandingFeature {
  num: string;
  tab: string;
  title: string;
  description: string;
  detail: string;
  terminalLines: string[];
}

export interface LandingContent {
  integrations: string[];
  features: LandingFeature[];
  stats: LandingStat[];
}

export interface PipelineStage {
  id: string;
  title: string;
  detail: string;
  metric: string;
}
