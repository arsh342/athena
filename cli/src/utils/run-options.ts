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
  learning?: boolean;
  npmAudit?: boolean;
  deps?: boolean;
  offline?: boolean;
  nodejsscan?: boolean;
  bearer?: boolean;
  semgrep?: boolean;
  /** `--ai` (verify) or `--ai verify|hunt|deep`. */
  ai?: boolean | string;
  provider?: string;
  model?: string;
  quality?: string;
  budget?: string;
  budgetTokens?: string;
  yes?: boolean;
  baseUrl?: string;
  preset?: string;
  suggestFixes?: boolean;
}

export interface AiRunOptions {
  mode: 'verify' | 'hunt' | 'deep';
  provider: 'anthropic' | 'openai' | 'google' | 'openai-compatible';
  model?: string;
  quality: 'economy' | 'balanced' | 'high';
  budget?: { runUsd?: number; runTokens?: number };
  yes: boolean;
  baseUrl?: string;
  preset?: string;
  /** Deep mode: write reviewed patch suggestions to .athena/patches (never applied). */
  suggestFixes: boolean;
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
  /** Local learning from this repository's trusted labels (`--no-learning` or `learning: false` turns it off). */
  learning: boolean;
  scanners: { eslint: boolean };
  deps: { enabled: boolean; offline: boolean };
  /** The optional AI layer; null unless `--ai` was given. */
  ai: AiRunOptions | null;
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
    learning: flags.learning !== false && config.learning !== false,
    scanners: {
      eslint: flags.eslint !== false,
    },
    deps: { enabled: flags.deps !== false, offline: flags.offline ?? false },
    ai: resolveAi(flags),
    warnings,
  };
}

const PROVIDER_NAMES = ['anthropic', 'openai', 'google', 'openai-compatible'] as const;

function positive(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} must be a positive number, got "${value}"`);
  return n;
}

function resolveAi(flags: RunFlags): AiRunOptions | null {
  const given = flags.ai;
  const others = [flags.provider, flags.model, flags.quality, flags.budget, flags.budgetTokens, flags.baseUrl, flags.preset, flags.suggestFixes].some((v) => v !== undefined);
  if (given === undefined || given === false) {
    if (others) throw new UsageError('--provider, --model, --quality, --budget, --budget-tokens, --base-url and --preset need --ai');
    return null;
  }
  const mode = given === true ? 'verify' : given;
  if (mode !== 'verify' && mode !== 'hunt' && mode !== 'deep') throw new UsageError(`unknown --ai mode "${String(given)}" (use verify, hunt or deep)`);
  const provider = flags.provider ?? 'anthropic';
  if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) throw new UsageError(`unknown --provider "${provider}" (use ${PROVIDER_NAMES.join(', ')})`);
  const quality = flags.quality ?? 'balanced';
  if (quality !== 'economy' && quality !== 'balanced' && quality !== 'high') throw new UsageError(`unknown --quality "${quality}" (use economy or high; balanced is the default)`);
  const runUsd = positive(flags.budget, '--budget');
  const runTokens = positive(flags.budgetTokens, '--budget-tokens');
  if (mode === 'deep' && runUsd === undefined && runTokens === undefined) throw new UsageError('--ai deep needs an explicit spend cap: pass --budget <usd> (or --budget-tokens <n>)');
  if (flags.suggestFixes && mode !== 'deep') throw new UsageError('--suggest-fixes needs --ai deep');
  return {
    mode, provider: provider as AiRunOptions['provider'], quality: quality as AiRunOptions['quality'], yes: flags.yes ?? false, suggestFixes: flags.suggestFixes ?? false,
    ...(flags.model ? { model: flags.model } : {}),
    ...(runUsd !== undefined || runTokens !== undefined ? { budget: { ...(runUsd !== undefined ? { runUsd } : {}), ...(runTokens !== undefined ? { runTokens } : {}) } } : {}),
    ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.preset ? { preset: flags.preset } : {}),
  };
}
