import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { athenaHome } from '@athena/core';

import { PROVIDERS, type ProviderId } from './types.js';

export interface KeyOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** For `openai-compatible`: the preset name (openrouter, deepseek, ...) whose environment variable applies. */
  preset?: string;
}

export type KeySource = 'env' | 'file' | 'sdk-default' | 'none';
export interface ResolvedKey {
  provider: ProviderId;
  source: KeySource;
  key?: string;
}

const ENV_VARS: Record<ProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'openai-compatible': ['ATHENA_AI_API_KEY'],
};
const PRESET_ENV: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY', deepseek: 'DEEPSEEK_API_KEY', mistral: 'MISTRAL_API_KEY', groq: 'GROQ_API_KEY', xai: 'XAI_API_KEY', together: 'TOGETHER_API_KEY',
};

function credentialsPath(home = athenaHome()): string {
  return join(home, 'credentials.json');
}

function readStore(home?: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(home), 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>, home = athenaHome()): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = credentialsPath(home);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}

function assertProvider(provider: string): asserts provider is ProviderId {
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new Error(`unknown provider "${provider}" (use ${PROVIDERS.join(', ')})`);
}

const slotOf = (provider: ProviderId, preset?: string): string => (provider === 'openai-compatible' && preset ? `${provider}:${preset}` : provider);

/** Environment variable, then the credentials file, then (Anthropic only) the SDK's own default chain. */
export function resolveKey(provider: ProviderId, options: KeyOptions = {}): ResolvedKey {
  assertProvider(provider);
  const env = options.env ?? process.env;
  const names = [...(options.preset && PRESET_ENV[options.preset] ? [PRESET_ENV[options.preset]!] : []), ...ENV_VARS[provider]];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { provider, source: 'env', key: value };
  }
  const stored = readStore(options.home)[slotOf(provider, options.preset)];
  if (stored) return { provider, source: 'file', key: stored };
  // The Anthropic SDK also finds `ant auth login` profiles and workload identity; whether one exists is only known when a request is made.
  return provider === 'anthropic' ? { provider, source: 'sdk-default' } : { provider, source: 'none' };
}

export function setKey(provider: ProviderId, key: string, options: KeyOptions = {}): string {
  assertProvider(provider);
  const trimmed = key.trim();
  if (!trimmed) throw new Error('the key is empty');
  const store = readStore(options.home);
  store[slotOf(provider, options.preset)] = trimmed;
  return writeStore(store, options.home);
}

export function removeKey(provider: ProviderId, options: KeyOptions = {}): boolean {
  assertProvider(provider);
  const store = readStore(options.home);
  const slot = slotOf(provider, options.preset);
  if (!(slot in store)) return false;
  delete store[slot];
  writeStore(store, options.home);
  return true;
}

/** `••••` plus the last four characters; short values reveal nothing. */
export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

export function keyStatus(provider: ProviderId, options: KeyOptions = {}): { provider: ProviderId; source: KeySource; masked?: string } {
  const r = resolveKey(provider, options);
  return { provider, source: r.source, ...(r.key ? { masked: maskKey(r.key) } : {}) };
}

/** Remove every occurrence of the given keys from `text` (error messages, logs, reports). */
export function redactKeys(text: string, keys: Array<string | undefined>): string {
  let out = text;
  for (const key of keys) {
    if (key && key.length >= 8) out = out.split(key).join('[redacted key]');
  }
  return out;
}

export function credentialsFileExists(home?: string): boolean {
  return existsSync(credentialsPath(home));
}
