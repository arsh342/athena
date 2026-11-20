import { defaultConfig, type FailOn, type Severity } from '@athena/core';
import { shouldUseColor } from './colors.js';
import type { ProjectConfig } from './project-config.js';

export type { FailOn };

export class UsageError extends Error {}

export interface RunFlags {
  format?: string;
  output?: string;
  failOn?: string;
  strict?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
  maxFindings?: string;
  showLow?: boolean;
  threshold?: string;
  eslint?: boolean;
  npmAudit?: boolean;
  deps?: boolean;
  offline?: boolean;
  nodejsscan?: boolean;
  bearer?: boolean;
  semgrep?: boolean;
}

export interface RunOptions {
  format: 'terminal' | 'json' | 'jsonl' | 'sarif' | 'cyclonedx' | 'markdown';
  output?: string;
  failOn: FailOn;
  blockOn: Severity[];
  strict: boolean;
  quiet: boolean;
  verbose: boolean;
  color: boolean;
  maxFindings: number;
  showLow: boolean;
  threshold?: number;
  exclude: string[];
  publicRoutes: string[];
  scanners: { eslint: boolean };
  deps: { enabled: boolean; offline: boolean };
  warnings: string[];
}

const FORMATS = ['terminal', 'json', 'jsonl', 'sarif', 'cyclonedx', 'markdown'] as const;
const FAIL_ON: FailOn[] = ['critical', 'high', 'medium', 'low', 'none'];
const BLOCK_ON: Record<FailOn, Severity[]> = {
  critical: ['CRITICAL'],
  high: ['CRITICAL', 'HIGH'],
  medium: ['CRITICAL', 'HIGH', 'MEDIUM'],
  low: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
  none: [],
};

export function resolveRunOptions(
  flags: RunFlags,
  config: ProjectConfig,
  env: NodeJS.ProcessEnv,
  stdoutIsTTY: boolean,
): RunOptions {
  const format = flags.format ?? 'terminal';
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`unknown --format "${format}" (use ${FORMATS.join(', ')})`);
  }

  const failOn = flags.failOn ?? config.failOn ?? 'high';
  if (!FAIL_ON.includes(failOn as FailOn)) {
    throw new UsageError(`unknown --fail-on "${failOn}" (use ${FAIL_ON.join(', ')})`);
  }

  const warnings: string[] = [];
  let threshold: number | undefined;
  for (const [flag, tool] of [['nodejsscan', 'NodeJSScan'], ['bearer', 'Bearer'], ['semgrep', 'Semgrep']] as const) {
    if (flags[flag] === false) warnings.push(`--no-${flag} is deprecated and does nothing: ${tool} was retired (Athena's own engine replaced it)`);
  }
  if (flags.npmAudit === false) warnings.push('--no-npm-audit is deprecated and does nothing: npm audit was replaced by Athena\'s own dependency checks (use --no-deps to skip them)');
  if (flags.threshold !== undefined) {
    threshold = Number(flags.threshold);
    if (!Number.isFinite(threshold)) throw new UsageError(`--threshold must be a number, got "${flags.threshold}"`);
    warnings.push('--threshold is deprecated: it only affects the heuristic fallback');
  }

  let maxFindings = Number.POSITIVE_INFINITY;
  if (flags.maxFindings !== undefined && flags.maxFindings !== 'all') {
    const parsed = Number(flags.maxFindings);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new UsageError(`--max-findings must be a positive number or "all"`);
    maxFindings = Math.floor(parsed);
  }

  return {
    format: format as RunOptions['format'],
    ...(flags.output ? { output: flags.output } : {}),
    failOn: failOn as FailOn,
    blockOn: [...BLOCK_ON[failOn as FailOn]],
    strict: flags.strict ?? config.strict ?? false,
    quiet: flags.quiet ?? false,
    verbose: flags.verbose ?? false,
    // A report written to a file must not contain escape codes, even from a terminal.
    color: flags.output ? false : shouldUseColor({ isTTY: stdoutIsTTY }, flags.color, env),
    maxFindings,
    showLow: flags.showLow ?? false,
    ...(threshold !== undefined ? { threshold } : {}),
    exclude: [...defaultConfig.exclude, ...(config.exclude ?? [])],
    publicRoutes: config.publicRoutes ?? [],
    scanners: {
      eslint: flags.eslint !== false,
    },
    deps: { enabled: flags.deps !== false, offline: flags.offline ?? false },
    warnings,
  };
}
