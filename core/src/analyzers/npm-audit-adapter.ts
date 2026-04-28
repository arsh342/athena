import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { NpmAuditConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface NpmAuditLegacyAdvisory {
  id?: string | number;
  title?: string;
  severity?: string;
  findings?: Array<{
    paths?: string[];
  }>;
}

interface NpmAuditModernViaObject {
  source?: string | number;
  name?: string;
  dependency?: string;
  title?: string;
  severity?: string;
  url?: string;
  range?: string;
}

interface NpmAuditModernVulnerability {
  name?: string;
  severity?: string;
  via?: Array<string | NpmAuditModernViaObject>;
  effects?: string[];
  range?: string;
  nodes?: string[];
}

type NpmAuditVulnerability = NpmAuditLegacyAdvisory | NpmAuditModernVulnerability;

interface NpmAuditOutput {
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
    };
  };
}

export interface NpmAuditFinding {
  id: string;
  ruleId: string;
  file: string;
  line: number;
  column: number;
  code: string;
  type: string;
  message: string;
  category: string;
  severity: Severity;
}

/**
 * Run npm audit on the project and return normalized findings.
 * Fails open: tool errors produce warnings and no findings.
 */
export async function runNpmAudit(projectRoot: string, config: NpmAuditConfig): Promise<NpmAuditFinding[]> {
  if (!config.enabled) return [];

  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: projectRoot,
      timeout: config.timeoutMs,
    });

    const parsed = safeParseNpmAudit(stdout);
    return normalizeNpmAuditOutput(parsed, projectRoot, config.severityThreshold || 'HIGH');
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    // npm audit exits with non-zero when vulnerabilities are found
    if (withStreams?.stdout && withStreams.stdout.trim().startsWith('{')) {
      const parsed = safeParseNpmAudit(withStreams.stdout);
      return normalizeNpmAuditOutput(parsed, projectRoot, config.severityThreshold || 'HIGH');
    }

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] npm not found; skipping npm audit');
      return [];
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] npm audit execution failed: ${detail}`);
    return [];
  }
}

export function normalizeNpmAuditOutput(
  parsed: NpmAuditOutput,
  projectRoot: string,
  threshold: string,
): NpmAuditFinding[] {
  if (!parsed.vulnerabilities) return [];

  return Object.entries(parsed.vulnerabilities).flatMap(([packageName, vulnerability]) =>
    normalizeNpmAuditFindings(packageName, vulnerability, projectRoot)
      .filter((finding) => meetsSeverityThreshold(unmapSeverity(finding.severity), threshold)),
  );
}

function safeParseNpmAudit(json: string): NpmAuditOutput {
  try {
    return JSON.parse(json) as NpmAuditOutput;
  } catch {
    return { vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };
  }
}

function meetsSeverityThreshold(severity: string, threshold: string): boolean {
  const severityOrder = ['low', 'moderate', 'high', 'critical'];
  const severityIndex = severityOrder.indexOf(severity.toLowerCase());
  const thresholdIndex = severityOrder.indexOf(threshold.toLowerCase());

  return severityIndex >= thresholdIndex;
}

function normalizeNpmAuditFindings(
  packageName: string,
  vulnerability: NpmAuditVulnerability,
  projectRoot: string,
): NpmAuditFinding[] {
  if (isLegacyAdvisory(vulnerability)) {
    return normalizeLegacyFindings(packageName, vulnerability, projectRoot);
  }

  return normalizeModernFindings(packageName, vulnerability, projectRoot);
}

function isLegacyAdvisory(vulnerability: NpmAuditVulnerability): vulnerability is NpmAuditLegacyAdvisory {
  return 'findings' in vulnerability && Array.isArray(vulnerability.findings);
}

function normalizeLegacyFindings(
  packageName: string,
  advisory: NpmAuditLegacyAdvisory,
  projectRoot: string,
): NpmAuditFinding[] {
  const packageJsonPath = resolve(projectRoot, 'package.json');
  const title = advisory.title?.trim() || `Vulnerability in ${packageName}`;
  const advisoryId = String(advisory.id ?? packageName);
  const paths = advisory.findings?.flatMap((finding) => finding.paths ?? []) ?? [];
  const uniquePaths = Array.from(new Set(paths.length > 0 ? paths : [packageName]));

  return uniquePaths.map((path) => ({
    id: createHash('sha1').update(`npm-audit:${advisoryId}:${path}`).digest('hex').slice(0, 10),
    ruleId: `npm-audit:${advisoryId}`,
    file: packageJsonPath,
    line: 1,
    column: 1,
    code: `"${path}"`,
    type: 'Dependency Vulnerability',
    message: `${title} (affected: ${path})`,
    category: 'supply-chain-security',
    severity: mapNpmAuditSeverity(advisory.severity),
  }));
}

function normalizeModernFindings(
  packageName: string,
  vulnerability: NpmAuditModernVulnerability,
  projectRoot: string,
): NpmAuditFinding[] {
  const packageJsonPath = resolve(projectRoot, 'package.json');
  const affectedNodes = Array.from(new Set(
    vulnerability.nodes && vulnerability.nodes.length > 0 ? vulnerability.nodes : [packageName],
  ));
  const objectViaEntries = (vulnerability.via ?? []).filter(isModernViaObject);

  if (objectViaEntries.length > 0) {
    return objectViaEntries.map((via, index) => {
      const advisoryKey = String(via.source ?? via.name ?? `${packageName}-${index}`);
      const affected = affectedNodes[0] ?? packageName;
      const title = via.title?.trim() || `Vulnerability in ${via.name ?? packageName}`;
      const range = via.range?.trim() ? ` ${via.range.trim()}` : '';

      return {
        id: createHash('sha1').update(`npm-audit:${advisoryKey}:${affected}`).digest('hex').slice(0, 10),
        ruleId: `npm-audit:${advisoryKey}`,
        file: packageJsonPath,
        line: 1,
        column: 1,
        code: `"${affected}"`,
        type: 'Dependency Vulnerability',
        message: `${title} (affected: ${packageName}${range})`,
        category: 'supply-chain-security',
        severity: mapNpmAuditSeverity(via.severity ?? vulnerability.severity),
      };
    });
  }

  const fallbackKey = vulnerability.name?.trim() || packageName;
  const fallbackNode = affectedNodes[0] ?? packageName;
  return [{
    id: createHash('sha1').update(`npm-audit:${fallbackKey}:${fallbackNode}`).digest('hex').slice(0, 10),
    ruleId: `npm-audit:${fallbackKey}`,
    file: packageJsonPath,
    line: 1,
    column: 1,
    code: `"${fallbackNode}"`,
    type: 'Dependency Vulnerability',
    message: `Vulnerability in ${packageName}`,
    category: 'supply-chain-security',
    severity: mapNpmAuditSeverity(vulnerability.severity),
  }];
}

function isModernViaObject(entry: string | NpmAuditModernViaObject): entry is NpmAuditModernViaObject {
  return typeof entry === 'object' && entry !== null;
}

function mapNpmAuditSeverity(severity?: string): Severity {
  const value = (severity ?? 'low').toLowerCase();
  if (value === 'critical') return 'CRITICAL';
  if (value === 'high') return 'HIGH';
  if (value === 'moderate') return 'MEDIUM';
  return 'LOW';
}

function unmapSeverity(severity: Severity): string {
  if (severity === 'CRITICAL') return 'critical';
  if (severity === 'HIGH') return 'high';
  if (severity === 'MEDIUM') return 'moderate';
  return 'low';
}
