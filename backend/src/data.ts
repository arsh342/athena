import { db } from './db.js';
import type { PersistedTerminalLine, TerminalLineKind } from './scan-stream.ts';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
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

export interface AiProvenanceSummary {
  unit: 'lines';
  totalLines: number;
  recorded: { lines: number; available: boolean; reason?: string };
  estimated: { method: 'heuristic' | 'fast'; model?: string; heuristicLanguages?: string[]; aiLines: number; mixedLines: number; uncertainLines: number; humanLines: number };
  topFiles: Array<{ path: string; lines: number; recordedLines: number; aiLines: number; mixedLines: number; uncertainLines: number }>;
}

export interface AiVerdict {
  verdict: 'confirmed' | 'refuted' | 'needs-human';
  reason: string;
  provider: string;
  model: string;
  citations: string[];
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
  /** Null for scans saved before provenance was measured. */
  aiProvenance?: AiProvenanceSummary | null;
  /** Present only on a scan that used the user's AI key: what the AI step did and spent. Never holds the key. */
  ai?: { mode: string; provider: string; model: string; costUsd: number; checked: number; notChecked: number };
  coverage?: CoverageSummary | null;
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
  /** Offline verification result; `low` means "needs review" and is not counted in the summary. */
  confidence?: 'high' | 'medium' | 'low';
  evidence?: string[];
  trace?: Array<{ file: string; line: number; note: string }>;
  exposure?: 'public' | 'authenticated' | 'internal';
  /** The user's AI verdict on this finding, when the scan used their key. */
  aiVerdict?: AiVerdict;
  topSignals: Array<{
    signal: string;
    contribution: number;
    score: number;
  }>;
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
  ai_provenance?: AiProvenanceSummary | null;
  coverage?: CoverageSummary | null;
  ai_summary?: ScanSummary['ai'] | null;
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
  confidence?: Finding['confidence'] | null;
  evidence?: Finding['evidence'] | null;
  trace?: Finding['trace'] | null;
  exposure?: Finding['exposure'] | null;
  ai_verdict?: AiVerdict | null;
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
    aiProvenance: row.ai_provenance ?? null,
    coverage: row.coverage ?? null,
    ...(row.ai_summary ? { ai: row.ai_summary } : {}),
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
    ...(row.confidence ? { confidence: row.confidence } : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
    ...(row.trace ? { trace: row.trace } : {}),
    ...(row.exposure ? { exposure: row.exposure } : {}),
    ...(row.ai_verdict ? { aiVerdict: row.ai_verdict } : {}),
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
export function getScans(userId: number | string): Promise<ScanSummary[]>;
export function getScans(userId?: number | string): ScanSummary[] | Promise<ScanSummary[]> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return recentScansStore;
  return db.query<ScanSummaryRow>(
    `
      SELECT scan_id, repo_name, repo_url, status, created_at, ai_percentage,
             flagged_units, files_scanned, total_units, findings, risk_density, duration,
             ai_provenance, coverage, ai_summary
      FROM scans
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `,
    [parsedUserId],
  ).then((result) => result.rows.map(mapScanSummaryRow));
}

export function getScan(scanId: string): ScanSummary | undefined;
export function getScan(scanId: string, userId: number | string): Promise<ScanSummary | undefined>;
export function getScan(scanId: string, userId?: number | string): ScanSummary | undefined | Promise<ScanSummary | undefined> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) {
    return recentScansStore.find((scan) => scan.scanId === scanId);
  }
  return db.query<ScanSummaryRow>(
    `
      SELECT scan_id, repo_name, repo_url, status, created_at, ai_percentage,
             flagged_units, files_scanned, total_units, findings, risk_density, duration,
             ai_provenance, coverage, ai_summary
      FROM scans
      WHERE scan_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [scanId, parsedUserId],
  ).then((result) => (result.rows[0] ? mapScanSummaryRow(result.rows[0]) : undefined));
}

export function getFindings(): Finding[];
export function getFindings(userId: number | string): Promise<Finding[]>;
export function getFindings(userId?: number | string): Finding[] | Promise<Finding[]> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) {
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
    [parsedUserId],
  ).then(async (latestScan) => {
    const scanId = latestScan.rows[0]?.scan_id;
    if (!scanId) return [];
    return getFindingsByScanId(scanId, parsedUserId);
  });
}

export function getFindingsByScanId(scanId: string): Finding[];
export function getFindingsByScanId(scanId: string, userId: number | string): Promise<Finding[]>;
export function getFindingsByScanId(scanId: string, userId?: number | string): Finding[] | Promise<Finding[]> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) {
    return findingsByScanIdStore[scanId] ?? [];
  }
  return db.query<FindingRow>(
    `
      SELECT COALESCE(sf.finding_id, sf.id::text) AS id, sf.severity, sf.type, sf.category, sf.message, sf.file, sf.line,
             sf."column" AS column, sf.source, sf.ai_score, sf.code, sf.rule_id, sf.top_signals,
             sf.confidence, sf.evidence, sf.trace, sf.exposure, sf.ai_verdict
      FROM scan_findings sf
      JOIN scans s ON s.scan_id = sf.scan_id
      WHERE sf.scan_id = $1 AND s.user_id = $2
      ORDER BY sf.id ASC
    `,
    [scanId, parsedUserId],
  ).then((result) => result.rows.map(mapFindingRow));
}


/** Store or update a redacted report snapshot for a scan. */
export async function addScanReport(userId: number | string, scanId: string, markdown: string): Promise<void> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return;
  await db.query(
    `
      INSERT INTO scan_reports (scan_id, user_id, markdown)
      VALUES ($1, $2, $3)
      ON CONFLICT (scan_id)
      DO UPDATE SET markdown = EXCLUDED.markdown, created_at = NOW(), version = scan_reports.version + 1
    `,
    [scanId, parsedUserId, markdown],
  );
}

/** Fetch the stored markdown snapshot for a scan. */
export async function getScanReport(scanId: string, userId: number | string): Promise<string | null> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return null;
  const result = await db.query<{ markdown: string }>(
    `
      SELECT sr.markdown
      FROM scan_reports sr
      JOIN scans s ON s.scan_id = sr.scan_id
      WHERE sr.scan_id = $1 AND s.user_id = $2
      LIMIT 1
    `,
    [scanId, parsedUserId],
  );
  return result.rows[0]?.markdown ?? null;
}

export function addScan(scan: ScanSummary, findings: Finding[]): void;
export function addScan(userId: number | string, scan: ScanSummary, findings: Finding[]): Promise<void>;
export function addScan(
  userOrScan: number | string | ScanSummary,
  scanOrFindings: ScanSummary | Finding[],
  maybeFindings?: Finding[],
): void | Promise<void> {
  if (typeof userOrScan !== 'number' && typeof userOrScan !== 'string') {
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

  const parsedUserId = typeof userOrScan === 'string' ? parseInt(userOrScan, 10) : userOrScan;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return;
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
            findings, risk_density, duration, ai_provenance, coverage, ai_summary
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14::jsonb, $15::jsonb, $16::jsonb)
        `,
        [
          scan.scanId,
          parsedUserId,
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
          scan.aiProvenance ? JSON.stringify(scan.aiProvenance) : null,
          scan.coverage ? JSON.stringify(scan.coverage) : null,
          scan.ai ? JSON.stringify(scan.ai) : null,
        ],
      );

      for (const finding of findings) {
        await client.query(
          `
            INSERT INTO scan_findings (
              finding_id, scan_id, severity, type, category, message, file, line, "column",
              source, ai_score, code, rule_id, top_signals, confidence, evidence, trace, exposure, ai_verdict
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb, $17::jsonb, $18, $19::jsonb)
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
            finding.confidence ?? null,
            finding.evidence ? JSON.stringify(finding.evidence) : null,
            finding.trace ? JSON.stringify(finding.trace) : null,
            finding.exposure ?? null,
            finding.aiVerdict ? JSON.stringify(finding.aiVerdict) : null,
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

export async function createRunningScan(userId: number | string, scan: RunningScanSummary): Promise<void> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return;
  await db.query(
    `
      INSERT INTO scans (
        scan_id, user_id, repo_name, repo_url, status, created_at,
        ai_percentage, flagged_units, files_scanned, total_units,
        findings, risk_density, duration, ai_provenance, coverage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14::jsonb, $15::jsonb)
    `,
    [
      scan.scanId,
      parsedUserId,
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
      scan.aiProvenance ? JSON.stringify(scan.aiProvenance) : null,
      scan.coverage ? JSON.stringify(scan.coverage) : null,
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

export async function getTerminalLines(scanId: string, userId: number | string): Promise<PersistedTerminalLine[]> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return [];
  const result = await db.query<TerminalLineRow>(
    `
      SELECT stl.seq, stl.kind, stl.text, stl.created_at
      FROM scan_terminal_lines stl
      JOIN scans s ON s.scan_id = stl.scan_id
      WHERE stl.scan_id = $1 AND s.user_id = $2
      ORDER BY stl.seq ASC
    `,
    [scanId, parsedUserId],
  );
  return result.rows.map(mapTerminalLineRow);
}

export type DeleteScanResult = 'deleted' | 'not-found' | 'running';

/** A scan that started this recently is probably still running; one that has sat in RUNNING longer is a leftover and can be removed. */
const RUNNING_GRACE_MINUTES = 15;

/** Delete one of the user's own scans. Its findings, report, terminal output, dependency list and alerts go with it (cascade). */
export async function deleteScan(scanId: string, userId: number | string): Promise<DeleteScanResult> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return 'not-found';
  const found = await db.query<{ status: string; running_recently: boolean }>(
    `
      SELECT status, (status = 'RUNNING' AND created_at > NOW() - ($3 || ' minutes')::interval) AS running_recently
      FROM scans
      WHERE scan_id = $1 AND user_id = $2
    `,
    [scanId, parsedUserId, String(RUNNING_GRACE_MINUTES)],
  );
  const row = found.rows[0];
  if (!row) return 'not-found';
  if (row.running_recently) return 'running';
  await db.query('DELETE FROM scans WHERE scan_id = $1 AND user_id = $2', [scanId, parsedUserId]);
  return 'deleted';
}

/** Delete all of the user's scans except one that is running right now. Returns how many were removed. */
export async function deleteAllScans(userId: number | string): Promise<number> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId !== 'number' || isNaN(parsedUserId)) return 0;
  const result = await db.query(
    `
      DELETE FROM scans
      WHERE user_id = $1
        AND NOT (status = 'RUNNING' AND created_at > NOW() - ($2 || ' minutes')::interval)
    `,
    [parsedUserId, String(RUNNING_GRACE_MINUTES)],
  );
  return result.rowCount ?? 0;
}
