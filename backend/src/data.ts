import { db } from './db.js';
import type { PersistedTerminalLine, TerminalLineKind } from './scan-stream.ts';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSource =
  | 'secret-detector'
  | 'hallucination-detector'
  | 'security-analyzer'
  | 'semgrep'
  | 'eslint'
  | 'npm-audit'
  | 'nodejsscan'
  | 'bearer'
  | 'trivy'
  | 'horusec';

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

export interface RunningScanSummary extends ScanSummary {
  status: 'RUNNING';
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

interface ScanSummaryRow {
  scan_id: string;
  repo_name: string;
  repo_url: string;
  status: ScanSummary['status'];
  created_at: Date | string;
  ai_percentage: number;
  flagged_units: number;
  files_scanned: number;
  total_units: number;
  findings: ScanSummary['findings'];
  risk_density: ScanSummary['riskDensity'];
  duration: number;
}

interface FindingRow {
  id: string;
  severity: Severity;
  type: string;
  category: string;
  message: string;
  file: string;
  line: number;
  column: number;
  source: FindingSource;
  ai_score: number;
  code: string;
  rule_id: string;
  top_signals: Finding['topSignals'];
}

interface TerminalLineRow {
  seq: number;
  kind: TerminalLineKind;
  text: string;
  created_at: Date | string;
}

let recentScansStore: ScanSummary[] = [];
let findingsByScanIdStore: Record<string, Finding[]> = {};

function mapScanSummaryRow(row: ScanSummaryRow): ScanSummary {
  return {
    scanId: row.scan_id,
    repoName: row.repo_name,
    repoUrl: row.repo_url,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    aiPercentage: row.ai_percentage,
    flaggedUnits: row.flagged_units,
    filesScanned: row.files_scanned,
    totalUnits: row.total_units,
    findings: row.findings,
    riskDensity: row.risk_density,
    duration: row.duration,
  };
}

function mapFindingRow(row: FindingRow): Finding {
  return {
    id: row.id,
    severity: row.severity,
    type: row.type,
    category: row.category,
    message: row.message,
    file: row.file,
    line: row.line,
    column: row.column,
    source: row.source,
    aiScore: row.ai_score,
    code: row.code,
    ruleId: row.rule_id,
    topSignals: row.top_signals,
  };
}

function mapTerminalLineRow(row: TerminalLineRow): PersistedTerminalLine {
  return {
    seq: row.seq,
    kind: row.kind,
    text: row.text,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function getScans(): ScanSummary[];
export function getScans(userId: number): Promise<ScanSummary[]>;
export function getScans(userId?: number): ScanSummary[] | Promise<ScanSummary[]> {
  if (typeof userId !== 'number') return recentScansStore;
  return db.query<ScanSummaryRow>(
    `
      SELECT scan_id, repo_name, repo_url, status, created_at, ai_percentage,
             flagged_units, files_scanned, total_units, findings, risk_density, duration
      FROM scans
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `,
    [userId],
  ).then((result) => result.rows.map(mapScanSummaryRow));
}

export function getScan(scanId: string): ScanSummary | undefined;
export function getScan(scanId: string, userId: number): Promise<ScanSummary | undefined>;
export function getScan(scanId: string, userId?: number): ScanSummary | undefined | Promise<ScanSummary | undefined> {
  if (typeof userId !== 'number') {
    return recentScansStore.find((scan) => scan.scanId === scanId);
  }
  return db.query<ScanSummaryRow>(
    `
      SELECT scan_id, repo_name, repo_url, status, created_at, ai_percentage,
             flagged_units, files_scanned, total_units, findings, risk_density, duration
      FROM scans
      WHERE scan_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [scanId, userId],
  ).then((result) => (result.rows[0] ? mapScanSummaryRow(result.rows[0]) : undefined));
}

export function getFindings(): Finding[];
export function getFindings(userId: number): Promise<Finding[]>;
export function getFindings(userId?: number): Finding[] | Promise<Finding[]> {
  if (typeof userId !== 'number') {
    return recentScansStore[0] ? findingsByScanIdStore[recentScansStore[0].scanId] ?? [] : [];
  }
  return db.query<{ scan_id: string }>(
    `
      SELECT scan_id
      FROM scans
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  ).then(async (latestScan) => {
    const scanId = latestScan.rows[0]?.scan_id;
    if (!scanId) return [];
    return getFindingsByScanId(scanId, userId);
  });
}

export function getFindingsByScanId(scanId: string): Finding[];
export function getFindingsByScanId(scanId: string, userId: number): Promise<Finding[]>;
export function getFindingsByScanId(scanId: string, userId?: number): Finding[] | Promise<Finding[]> {
  if (typeof userId !== 'number') {
    return findingsByScanIdStore[scanId] ?? [];
  }
  return db.query<FindingRow>(
    `
      SELECT COALESCE(sf.finding_id, sf.id::text) AS id, sf.severity, sf.type, sf.category, sf.message, sf.file, sf.line,
             sf."column" AS column, sf.source, sf.ai_score, sf.code, sf.rule_id, sf.top_signals
      FROM scan_findings sf
      JOIN scans s ON s.scan_id = sf.scan_id
      WHERE sf.scan_id = $1 AND s.user_id = $2
      ORDER BY sf.id ASC
    `,
    [scanId, userId],
  ).then((result) => result.rows.map(mapFindingRow));
}

/** Store or update a redacted report snapshot for a scan. */
export async function addScanReport(userId: number, scanId: string, markdown: string): Promise<void> {
  await db.query(
    `
      INSERT INTO scan_reports (scan_id, user_id, markdown)
      VALUES ($1, $2, $3)
      ON CONFLICT (scan_id)
      DO UPDATE SET markdown = EXCLUDED.markdown, created_at = NOW(), version = scan_reports.version + 1
    `,
    [scanId, userId, markdown],
  );
}

/** Fetch the stored markdown snapshot for a scan. */
export async function getScanReport(scanId: string, userId: number): Promise<string | null> {
  const result = await db.query<{ markdown: string }>(
    `
      SELECT sr.markdown
      FROM scan_reports sr
      JOIN scans s ON s.scan_id = sr.scan_id
      WHERE sr.scan_id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanId, userId],
  );
  return result.rows[0]?.markdown ?? null;
}

export function addScan(scan: ScanSummary, findings: Finding[]): void;
export function addScan(userId: number, scan: ScanSummary, findings: Finding[]): Promise<void>;
export function addScan(
  userOrScan: number | ScanSummary,
  scanOrFindings: ScanSummary | Finding[],
  maybeFindings?: Finding[],
): void | Promise<void> {
  if (typeof userOrScan !== 'number') {
    const scan = userOrScan;
    const findings = scanOrFindings as Finding[];
    recentScansStore = [scan, ...recentScansStore].slice(0, 20);
    findingsByScanIdStore = {
      ...findingsByScanIdStore,
      [scan.scanId]: findings,
    };

    const validIds = new Set(recentScansStore.map((item) => item.scanId));
    findingsByScanIdStore = Object.fromEntries(
      Object.entries(findingsByScanIdStore).filter(([scanId]) => validIds.has(scanId)),
    );
    return;
  }

  const userId = userOrScan;
  const scan = scanOrFindings as ScanSummary;
  const findings = maybeFindings ?? [];
  return (async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO scans (
            scan_id, user_id, repo_name, repo_url, status, created_at,
            ai_percentage, flagged_units, files_scanned, total_units,
            findings, risk_density, duration
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
        `,
        [
          scan.scanId,
          userId,
          scan.repoName,
          scan.repoUrl,
          scan.status,
          scan.createdAt,
          scan.aiPercentage,
          scan.flaggedUnits,
          scan.filesScanned,
          scan.totalUnits,
          JSON.stringify(scan.findings),
          JSON.stringify(scan.riskDensity),
          scan.duration,
        ],
      );

      for (const finding of findings) {
        await client.query(
          `
            INSERT INTO scan_findings (
              finding_id, scan_id, severity, type, category, message, file, line, "column",
              source, ai_score, code, rule_id, top_signals
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
          `,
          [
            finding.id,
            scan.scanId,
            finding.severity,
            finding.type,
            finding.category,
            finding.message,
            finding.file,
            finding.line,
            finding.column,
            finding.source,
            finding.aiScore,
            finding.code,
            finding.ruleId,
            JSON.stringify(finding.topSignals),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })();
}

export async function createRunningScan(userId: number, scan: RunningScanSummary): Promise<void> {
  await db.query(
    `
      INSERT INTO scans (
        scan_id, user_id, repo_name, repo_url, status, created_at,
        ai_percentage, flagged_units, files_scanned, total_units,
        findings, risk_density, duration
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
    `,
    [
      scan.scanId,
      userId,
      scan.repoName,
      scan.repoUrl,
      scan.status,
      scan.createdAt,
      scan.aiPercentage,
      scan.flaggedUnits,
      scan.filesScanned,
      scan.totalUnits,
      JSON.stringify(scan.findings),
      JSON.stringify(scan.riskDensity),
      scan.duration,
    ],
  );
}

export async function appendTerminalLine(scanId: string, line: {
  seq: number;
  kind: TerminalLineKind;
  text: string;
}): Promise<PersistedTerminalLine> {
  const result = await db.query<TerminalLineRow>(
    `
      INSERT INTO scan_terminal_lines (scan_id, seq, kind, text)
      VALUES ($1, $2, $3, $4)
      RETURNING seq, kind, text, created_at
    `,
    [scanId, line.seq, line.kind, line.text],
  );
  return mapTerminalLineRow(result.rows[0]);
}

export async function getTerminalLines(scanId: string, userId: number): Promise<PersistedTerminalLine[]> {
  const result = await db.query<TerminalLineRow>(
    `
      SELECT stl.seq, stl.kind, stl.text, stl.created_at
      FROM scan_terminal_lines stl
      JOIN scans s ON s.scan_id = stl.scan_id
      WHERE stl.scan_id = $1 AND s.user_id = $2
      ORDER BY stl.seq ASC
    `,
    [scanId, userId],
  );
  return result.rows.map(mapTerminalLineRow);
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
