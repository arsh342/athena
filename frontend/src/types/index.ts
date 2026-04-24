export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ConfidenceBand = 'LOW' | 'UNCERTAIN' | 'HIGH';

export type FindingSource = 'secret-detector' | 'hallucination-detector' | 'security-analyzer' | 'semgrep';

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
  topSignals: SignalContribution[];
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
