import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { BearerConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface BearerFinding {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe?: string[];
  file?: {
    path: string;
    line?: number;
    column?: number;
  };
  snippet?: {
    code: string;
  };
  data_types?: string[];
  category: string;
}

interface BearerReport {
  findings?: BearerFinding[];
  summary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface BearerFindingNormalized {
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
 * Run Bearer on the project and return normalized findings.
 * Bearer provides privacy-focused security analysis and data flow tracking.
 * Fails open: tool errors produce warnings and no findings.
 */
export async function runBearer(projectRoot: string, config: BearerConfig): Promise<BearerFindingNormalized[]> {
  if (!config.enabled) return [];

  try {
    const reportType = config.reportType || 'security';
    const bearerArgs = [
      'scan',
      projectRoot,
      '--format',
      'json',
      '--report',
      reportType,
      '--quiet',
    ];

    const output = await execBearer(bearerArgs, config.timeoutMs);
    if (!output) return [];

    const parsed = safeParseBearer(output);
    return (parsed.findings ?? []).map(finding => normalizeBearerFinding(finding, projectRoot)).filter(Boolean) as BearerFindingNormalized[];
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] Bearer CLI not found; skipping Bearer scan. Install with: npm install -g @bearer/cli');
      return [];
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] Bearer execution failed: ${detail}`);
    return [];
  }
}

async function execBearer(args: string[], timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('bearer', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    // Bearer may exit non-zero when findings are present. Try parsing stdout first.
    if (withStreams?.stdout && withStreams.stdout.trim().startsWith('{')) {
      return withStreams.stdout;
    }

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] Bearer CLI not installed; skipping Bearer scan');
      return null;
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] Bearer execution failed: ${detail}`);
    return null;
  }
}

function safeParseBearer(json: string): BearerReport {
  try {
    return JSON.parse(json) as BearerReport;
  } catch {
    return { findings: [] };
  }
}

function normalizeBearerFinding(finding: BearerFinding, projectRoot: string): BearerFindingNormalized | null {
  const filePath = finding.file?.path;
  if (!filePath) return null;

  const file = resolve(projectRoot, filePath);
  const line = finding.file?.line || 1;
  const column = finding.file?.column || 1;
  const code = finding.snippet?.code || '';
  const severity = mapBearerSeverity(finding.severity);
  const dataTypes = finding.data_types || [];

  // Enhance message with data types if available
  let message = finding.description || finding.title || 'Bearer finding';
  if (dataTypes.length > 0) {
    message += ` (data types: ${dataTypes.join(', ')})`;
  }

  return {
    id: createHash('sha1').update(`bearer:${file}:${line}:${finding.title}`).digest('hex').slice(0, 10),
    ruleId: `bearer:${finding.category.replace(/\s+/g, '-').toLowerCase()}`,
    file,
    line,
    column,
    code,
    type: formatBearerType(finding.category, dataTypes),
    message,
    category: getBearerCategory(finding.category, dataTypes),
    severity,
  };
}

function mapBearerSeverity(severity: string): Severity {
  const value = (severity || '').toLowerCase();
  if (value === 'critical') return 'CRITICAL';
  if (value === 'high') return 'HIGH';
  if (value === 'medium') return 'MEDIUM';
  return 'LOW';
}

function formatBearerType(category: string, dataTypes: string[]): string {
  const baseType = `Bearer ${category.replace(/[-_]/g, ' ')}`;
  if (dataTypes.length > 0) {
    return `${baseType} (${dataTypes[0]})`;
  }
  return baseType;
}

function getBearerCategory(category: string, dataTypes: string[]): string {
  const lowerCategory = category.toLowerCase();

  // Privacy and data protection categories
  if (dataTypes.length > 0) {
    return 'data-privacy';
  }

  // Security categories
  if (lowerCategory.includes('injection') || lowerCategory.includes('sql')) {
    return 'injection';
  }
  if (lowerCategory.includes('xss') || lowerCategory.includes('cross-site')) {
    return 'xss';
  }
  if (lowerCategory.includes('auth') || lowerCategory.includes('authentication')) {
    return 'authentication';
  }
  if (lowerCategory.includes('crypto') || lowerCategory.includes('encryption')) {
    return 'weak-cryptography';
  }
  if (lowerCategory.includes('header') || lowerCategory.includes('cors')) {
    return 'misconfiguration';
  }

  // Default to Bearer's category
  return lowerCategory.replace(/\s+/g, '-');
}