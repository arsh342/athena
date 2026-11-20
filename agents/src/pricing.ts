import type { Caps, Price, ProviderId, TokenUsage } from './types.js';

/** Hard defaults: a single run can never spend someone's whole limit. */
export const DEFAULT_CAPS = { runUsd: 0.25, dayUsd: 1, runTokens: 150_000, dayTokens: 600_000 } as const;

const cached = (input: number, output: number): Price => ({ input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 });

/** Anthropic first-party prices in USD per million tokens (cache writes are the 5-minute rate). Other providers' prices are not bundled: an unpriced model runs under token caps. */
const ANTHROPIC: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longPromptThreshold: 100_000, long: { input: 0.5, output: 2.5 } },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-opus-5': cached(5, 25),
  'claude-sonnet-5': cached(2, 10),
};

export function priceFor(provider: ProviderId, model: string): Price | null {
  return provider === 'anthropic' ? ANTHROPIC[model] ?? null : null;
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function costOf(usage: TokenUsage, price: Price): number {
  const long = price.long && price.longPromptThreshold !== undefined && usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) > price.longPromptThreshold;
  const input = long ? price.long!.input : price.input;
  const output = long ? price.long!.output : price.output;
  return (usage.inputTokens * input + usage.outputTokens * output + (usage.cacheReadTokens ?? 0) * price.cacheRead + (usage.cacheWriteTokens ?? 0) * price.cacheWrite) / 1_000_000;
}

export interface CapsInput {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  /** User caps (`agents.budget.run`, `agents.budget.day`, or per-run flags). */
  budget?: { runUsd?: number; dayUsd?: number; runTokens?: number; dayTokens?: number };
  /** User price override, USD per million tokens. */
  pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

export interface ResolvedCaps extends Caps {
  price: Price | null;
  local: boolean;
}

/** Caps in dollars when the price is known, in tokens otherwise; local endpoints cost $0. */
export function capsFor(input: CapsInput): ResolvedCaps {
  const local = input.provider === 'openai-compatible' && !!input.baseUrl && isLocalEndpoint(input.baseUrl);
  const price: Price | null = local
    ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    : input.pricing
      ? { input: input.pricing.input, output: input.pricing.output, cacheRead: input.pricing.cacheRead ?? input.pricing.input * 0.1, cacheWrite: input.pricing.cacheWrite ?? input.pricing.input * 1.25 }
      : priceFor(input.provider, input.model);
  const b = input.budget ?? {};
  if (price) return { unit: 'usd', run: b.runUsd ?? DEFAULT_CAPS.runUsd, day: b.dayUsd ?? DEFAULT_CAPS.dayUsd, price, local };
  return { unit: 'tokens', run: b.runTokens ?? DEFAULT_CAPS.runTokens, day: b.dayTokens ?? DEFAULT_CAPS.dayTokens, price: null, local };
}
