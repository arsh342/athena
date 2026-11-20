import type { ProviderId } from './types.js';

export type Quality = 'economy' | 'balanced' | 'high';

/**
 * Default model per provider and quality. Anthropic's are fixed (balanced = Sonnet 5.5). For every other provider the
 * balanced default is meant to be chosen by running the verification benchmark with that provider's key
 * (bench/ai-verify); until that has been done there is no default, and the user must pass --model.
 */
export function defaultModel(provider: ProviderId, quality: Quality = 'balanced'): string | null {
  if (provider !== 'anthropic') return null;
  return quality === 'economy' ? 'claude-haiku-5-5' : quality === 'high' ? 'claude-opus-5-5' : 'claude-sonnet-5-5';
}
