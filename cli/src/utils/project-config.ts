import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailOn } from './run-options.js';

export interface ProjectConfig {
  failOn?: FailOn;
  exclude?: string[];
  /** Routes that are public on purpose (not flagged for missing authentication). */
  publicRoutes?: string[];
  strict?: boolean;
  /** Local learning from trusted labels in this repository (default on). */
  learning?: boolean;
  /** `"learning": { "share": "off" }` stops anyone who scans this repository from sharing labels. "on" here is ignored: only a user can turn sharing on. */
  learningShare?: 'off' | 'on';
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
  if (data.publicRoutes !== undefined) {
    if (!Array.isArray(data.publicRoutes) || data.publicRoutes.some((item) => typeof item !== 'string')) {
      throw new ConfigError(`${file}: "publicRoutes" must be an array of strings`);
    }
    config.publicRoutes = data.publicRoutes as string[];
  }
  if (data.learning !== undefined) {
    if (typeof data.learning === 'boolean') {
      config.learning = data.learning;
    } else if (typeof data.learning === 'object' && data.learning !== null && !Array.isArray(data.learning)) {
      const l = data.learning as Record<string, unknown>;
      if (l.enabled !== undefined) {
        if (typeof l.enabled !== 'boolean') throw new ConfigError(`${file}: "learning.enabled" must be true or false`);
        config.learning = l.enabled;
      }
      if (l.share !== undefined) {
        if (l.share !== 'on' && l.share !== 'off') throw new ConfigError(`${file}: "learning.share" must be "on" or "off"`);
        config.learningShare = l.share;
      }
    } else {
      throw new ConfigError(`${file}: "learning" must be true, false or an object`);
    }
  }
  if (data.strict !== undefined) {
    if (typeof data.strict !== 'boolean') throw new ConfigError(`${file}: "strict" must be true or false`);
    config.strict = data.strict;
  }
  return config;
}
