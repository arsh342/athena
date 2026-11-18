import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailOn } from './run-options.js';

export interface ProjectConfig {
  failOn?: FailOn;
  exclude?: string[];
  strict?: boolean;
}

export class ConfigError extends Error {}

const FAIL_ON = ['critical', 'high', 'medium', 'low', 'none'];

/** Reads <root>/athena.config.json if present. Unknown keys are ignored. */
export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = join(root, 'athena.config.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${file}: expected a JSON object`);
  }

  const data = parsed as Record<string, unknown>;
  const config: ProjectConfig = {};
  if (data.failOn !== undefined) {
    if (typeof data.failOn !== 'string' || !FAIL_ON.includes(data.failOn)) {
      throw new ConfigError(`${file}: "failOn" must be one of ${FAIL_ON.join(', ')}`);
    }
    config.failOn = data.failOn as FailOn;
  }
  if (data.exclude !== undefined) {
    if (!Array.isArray(data.exclude) || data.exclude.some((item) => typeof item !== 'string')) {
      throw new ConfigError(`${file}: "exclude" must be an array of strings`);
    }
    config.exclude = data.exclude as string[];
  }
  if (data.strict !== undefined) {
    if (typeof data.strict !== 'boolean') throw new ConfigError(`${file}: "strict" must be true or false`);
    config.strict = data.strict;
  }
  return config;
}
