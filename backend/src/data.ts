export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSource =
  | 'secret-detector'
  | 'hallucination-detector'
  | 'security-analyzer'
  | 'semgrep'
  | 'eslint'
  | 'npm-audit'
  | 'nodejsscan'
  | 'bearer';

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
  topSignals: Array<{
    signal: string;
    contribution: number;
    score: number;
  }>;
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

let recentScansStore: ScanSummary[] = [];
let findingsByScanIdStore: Record<string, Finding[]> = {};

export function getScans(): ScanSummary[] {
  return recentScansStore;
}

export function getScan(scanId: string): ScanSummary | undefined {
  return recentScansStore.find((scan) => scan.scanId === scanId);
}

export function getFindings(): Finding[] {
  return recentScansStore[0] ? findingsByScanIdStore[recentScansStore[0].scanId] ?? [] : [];
}

export function getFindingsByScanId(scanId: string): Finding[] {
  return findingsByScanIdStore[scanId] ?? [];
}

export function addScan(scan: ScanSummary, findings: Finding[]): void {
  recentScansStore = [scan, ...recentScansStore].slice(0, 20);
  findingsByScanIdStore = {
    ...findingsByScanIdStore,
    [scan.scanId]: findings,
  };

  const validIds = new Set(recentScansStore.map((item) => item.scanId));
  findingsByScanIdStore = Object.fromEntries(
    Object.entries(findingsByScanIdStore).filter(([scanId]) => validIds.has(scanId)),
  );
}

const landingContent: LandingContent = {
  integrations: [
    'ESLint',
    'Semgrep',
    'GitHub',
    'GitLab',
    'Bitbucket',
    'VS Code',
    'JetBrains',
    'Node.js',
    'TypeScript',
    'Bun',
  ],
  features: [
    {
      num: '01',
      tab: 'SMART SCORING',
      title: 'Scoring that explains itself',
      description:
        'Every flagged code unit gets a transparent score built from 11 weighted signals - generic names, boilerplate shape, comment style, repo baseline drift, and more.',
      detail: 'Scores resolved by signal weight, not configuration.',
      terminalLines: [
        'Scoring src/services/github.ts',
        'genericNames: 22%',
        'commentRatio: 18%',
        'boilerplatePatterns: 15%',
        'helperOrdering: 12%',
        'lowNamingEntropy: 10%',
        'Result: AI score 86 - HIGH confidence',
      ],
    },
    {
      num: '02',
      tab: 'PRE-COMMIT GATE',
      title: 'Block before it lands',
      description:
        'Athena installs as a git pre-commit hook. Staged files are scored and commits with critical or high risk get blocked before they reach the repo.',
      detail: 'Diff-aware scanning, not full-repo re-scan.',
      terminalLines: [
        '$ athena check',
        'Scanning 4 staged files',
        'Flagged 2 units above threshold 65',
        'CRITICAL: Hardcoded GitHub token',
        'Gate: BLOCKED - commit rejected',
        'Fix flagged issues and try again',
      ],
    },
    {
      num: '03',
      tab: 'SECURITY PASS',
      title: 'Targeted security where it counts',
      description:
        'ESLint, Semgrep, secret detection, and hallucinated API checks run only on flagged code sections - the parts that need review most.',
      detail: 'Zero wasted cycles on human-written code.',
      terminalLines: [
        'Running ESLint security rules on flagged units',
        'Running native secret detector',
        'Semgrep: security-audit ruleset active',
        'Hallucination check: axios.fetchData not in API',
        'Classified 24 findings across 18 flagged units',
        'Report saved: latest scan artifact',
      ],
    },
    {
      num: '04',
      tab: 'ZERO EXTERNAL',
      title: 'Nothing leaves your machine',
      description:
        'All analysis runs locally. No code sent to external APIs. No cloud dependency. Your codebase stays on your infrastructure.',
      detail: 'Fully offline operation, zero telemetry.',
      terminalLines: [
        'All analysis runs locally',
        'No API keys configured',
        'No outbound network calls detected',
        'Code never leaves this machine',
        'Scan complete in 1.4s',
        'Total external requests: 0',
      ],
    },
  ],
  stats: [
    { value: 11, label: 'Detection Signals', suffix: '' },
    { value: 0, label: 'External Calls', suffix: '' },
    { value: 2, label: 'Seconds Per File', suffix: 's' },
    { value: 100, label: 'Offline', suffix: '%' },
  ],
};

const pipelineStages: PipelineStage[] = [
  {
    id: '01',
    title: 'INGEST DIFF',
    detail: 'Read staged files, commit metadata, and baseline fingerprint.',
    metric: '14 files',
  },
  {
    id: '02',
    title: 'AST PARSE',
    detail: 'Build syntax tree map and extract symbols for scoring.',
    metric: '1,248 symbols',
  },
  {
    id: '03',
    title: '11-SIGNAL SCORE',
    detail: 'Compute weighted provenance score for each risky unit.',
    metric: '86 AI score',
  },
  {
    id: '04',
    title: 'SECURITY PASS',
    detail: 'Run Semgrep, ESLint security rules, and secret detection.',
    metric: '3 findings',
  },
  {
    id: '05',
    title: 'PRE-COMMIT GATE',
    detail: 'Block high/critical commits and emit actionable reasons.',
    metric: 'blocked',
  },
  {
    id: '06',
    title: 'REPORT OUTPUT',
    detail: 'Write terminal, JSONL, and HTML report artifacts.',
    metric: '3 formats',
  },
];

export function getLandingContent(): LandingContent {
  return landingContent;
}

export function getPipelineStages(): PipelineStage[] {
  return pipelineStages;
}

export const landingPipelineLines = [
  '01 ingest diff: 14 staged files',
  '02 parse ast: 1,248 symbols indexed',
  '03 score signals: 11 weighted checks',
  '04 security pass: semgrep + secret scan',
  '05 gate commit: high risk => block',
  '06 emit report: terminal + jsonl + html',
];
