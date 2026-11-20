export const PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from the provider's prompt cache (billed at the cache-read rate). */
  cacheReadTokens?: number;
  /** Tokens written to the provider's prompt cache. */
  cacheWriteTokens?: number;
}

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prompts longer than this many tokens bill at `long` instead. */
  longPromptThreshold?: number;
  long?: { input: number; output: number };
}

export type CapUnit = 'usd' | 'tokens';
export interface Caps {
  unit: CapUnit;
  run: number;
  day: number;
}
