import { resolveKey, redactKeys, type KeyOptions } from '../keys.js';
import { isLocalEndpoint } from '../pricing.js';
import type { ProviderId } from '../types.js';
import { createAnthropic } from './anthropic.js';
import { createGoogle } from './google.js';
import { createOpenAI, PRESETS } from './openai.js';
import type { ModelProvider } from './types.js';

export interface ProviderChoice {
  provider: ProviderId;
  /** For openai-compatible: a preset name (`openrouter`, `ollama`, ...). */
  preset?: string;
  /** For openai-compatible (or a proxy in front of another provider): the endpoint. */
  baseUrl?: string;
  /** Declare that a compatible endpoint's model can call tools (unknown otherwise, so assumed not). */
  tools?: boolean;
}

export class ProviderSetupError extends Error {}

/** Resolve the key and endpoint and build the adapter. Error messages never contain the key. */
export function createProvider(choice: ProviderChoice, keyOptions: KeyOptions = {}): { provider: ModelProvider; endpoint: string; local: boolean; key: string | undefined } {
  const resolved = resolveKey(choice.provider, { ...keyOptions, ...(choice.preset ? { preset: choice.preset } : {}) });
  try {
    if (choice.provider === 'anthropic') {
      const provider = createAnthropic({ ...(resolved.key ? { apiKey: resolved.key } : {}), ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}) });
      return { provider, endpoint: provider.endpoint, local: false, key: resolved.key };
    }
    if (choice.provider === 'google') {
      if (!resolved.key) throw new ProviderSetupError('no Google key: set GEMINI_API_KEY or run "athena keys set google"');
      return { provider: createGoogle({ apiKey: resolved.key }), endpoint: 'https://generativelanguage.googleapis.com', local: false, key: resolved.key };
    }
    if (choice.provider === 'openai') {
      if (!resolved.key && !choice.baseUrl) throw new ProviderSetupError('no OpenAI key: set OPENAI_API_KEY or run "athena keys set openai"');
      const provider = createOpenAI({ kind: 'openai', ...(resolved.key ? { apiKey: resolved.key } : {}), ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}) });
      return { provider, endpoint: provider.endpoint, local: false, key: resolved.key };
    }
    const baseUrl = choice.baseUrl ?? (choice.preset ? PRESETS[choice.preset] : undefined);
    if (!baseUrl) throw new ProviderSetupError(`openai-compatible needs --base-url or a preset (${Object.keys(PRESETS).join(', ')})`);
    const local = isLocalEndpoint(baseUrl);
    if (!local && !baseUrl.startsWith('https://')) throw new ProviderSetupError('remote OpenAI-compatible endpoints must use https');
    if (!local && !resolved.key) throw new ProviderSetupError(`no key for ${choice.preset ?? baseUrl}: set its environment variable or run "athena keys set openai-compatible${choice.preset ? ` --preset ${choice.preset}` : ''}"`);
    const provider = createOpenAI({ kind: 'openai-compatible', baseUrl, ...(resolved.key ? { apiKey: resolved.key } : {}), ...(choice.tools !== undefined ? { tools: choice.tools } : {}), local });
    return { provider, endpoint: baseUrl, local, key: resolved.key };
  } catch (error) {
    if (error instanceof ProviderSetupError) throw error;
    throw new ProviderSetupError(redactKeys(error instanceof Error ? error.message : String(error), [resolved.key]));
  }
}

export { PRESETS };
