import { PRESETS, capsFor, consentNotice, defaultModel, isLocalEndpoint, redactKeys, type ProviderId } from '@athena/agents';

/**
 * Bring-your-own-key AI scans on the hosted service.
 *
 * The user's key travels only in request headers of the one scan that uses it, is held in memory for that scan, and is never
 * written to the database, the report or a log. Endpoints are limited to an allowlist so the server cannot be pointed at internal hosts.
 */

export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'openai-compatible'] as const;
export const MAX_RUN_BUDGET_USD = 1;
export const AI_MODES = ['verify', 'hunt'] as const;

/** Hosts a custom OpenAI-compatible base URL may use: the hosted presets, plus any listed in ATHENA_AI_ALLOWED_HOSTS. */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>();
  for (const [name, url] of Object.entries(PRESETS)) if (!isLocalEndpoint(url)) hosts.add(new URL(PRESETS[name]!).hostname);
  for (const extra of (env.ATHENA_AI_ALLOWED_HOSTS ?? '').split(',')) if (extra.trim()) hosts.add(extra.trim().toLowerCase());
  return hosts;
}

/** Remote presets only: Ollama and LM Studio run on the user's machine, which the hosted service cannot reach. */
export function hostedPresets(): string[] {
  return Object.keys(PRESETS).filter((name) => !isLocalEndpoint(PRESETS[name]!));
}

export interface AiScanRequest {
  provider: ProviderId;
  mode: (typeof AI_MODES)[number];
  model: string;
  preset?: string;
  baseUrl?: string;
  budgetUsd: number;
  /** The user's key. Only ever placed in a per-scan in-memory environment. */
  key: string;
}

export type ParsedAi =
  | { kind: 'none' }
  | { kind: 'error'; status: number; error: string }
  | { kind: 'ok'; request: AiScanRequest; consent: string; consented: boolean };

const header = (headers: Record<string, unknown>, name: string): string | undefined => {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
};

export function parseAiHeaders(headers: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): ParsedAi {
  const provider = header(headers, 'x-ai-provider');
  if (!provider) return { kind: 'none' };
  const err = (error: string, status = 400): ParsedAi => ({ kind: 'error', status, error });

  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) return err(`Unknown AI provider. Use one of: ${AI_PROVIDERS.join(', ')}.`);
  const key = header(headers, 'x-ai-key');
  if (!key) return err('An API key is required for AI scans (X-AI-Key). Athena does not store it.');
  if (key.length > 512 || /\s/.test(key)) return err('That does not look like an API key.');

  const budget = Number(header(headers, 'x-ai-budget'));
  if (!Number.isFinite(budget) || budget <= 0) return err('A spend cap is required: set X-AI-Budget to the most you are willing to spend on this scan, in USD.');
  if (budget > MAX_RUN_BUDGET_USD) return err(`The spend cap for one scan is at most $${MAX_RUN_BUDGET_USD.toFixed(2)}.`);

  const mode = (header(headers, 'x-ai-mode') ?? 'verify') as AiScanRequest['mode'];
  if (!(AI_MODES as readonly string[]).includes(mode)) return err(`AI mode must be ${AI_MODES.join(' or ')} on the hosted service.`);

  const preset = header(headers, 'x-ai-preset');
  const baseUrl = header(headers, 'x-ai-base-url');
  if (provider !== 'openai-compatible' && (preset || baseUrl)) return err('A preset or base URL only applies to openai-compatible providers.');
  if (provider === 'openai-compatible') {
    if (preset && baseUrl) return err('Choose either a preset or a base URL, not both.');
    if (!preset && !baseUrl) return err(`openai-compatible needs a preset (${hostedPresets().join(', ')}) or an allowed base URL.`);
    if (preset && !hostedPresets().includes(preset)) return err(`Unknown or local preset. Hosted presets: ${hostedPresets().join(', ')}. Local models (Ollama, LM Studio) need the CLI.`);
    if (baseUrl) {
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        return err('The base URL is not a valid URL.');
      }
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return err('The base URL must be https on the default port, without credentials.');
      if (!allowedHosts(env).has(url.hostname.toLowerCase())) return err('That host is not on the allowlist for hosted AI scans.');
    }
  }

  const model = header(headers, 'x-ai-model') ?? defaultModel(provider as ProviderId) ?? undefined;
  if (!model) return err('Choose a model (X-AI-Model) for this provider.');
  if (model.length > 120 || !/^[\w./:@-]+$/.test(model)) return err('That model name is not valid.');

  const request: AiScanRequest = { provider: provider as ProviderId, mode, model, budgetUsd: budget, key, ...(preset ? { preset } : {}), ...(baseUrl ? { baseUrl } : {}) };
  const endpoint = baseUrl ?? (preset ? PRESETS[preset]! : provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'google' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com');
  return { kind: 'ok', request, consent: aiConsentText(request, endpoint), consented: header(headers, 'x-ai-consent') === 'accepted' };
}

export function aiConsentText(request: Pick<AiScanRequest, 'provider' | 'model' | 'budgetUsd'>, endpoint: string): string {
  const caps = capsFor({ provider: request.provider, model: request.model, budget: { runUsd: request.budgetUsd, dayUsd: request.budgetUsd } });
  return `${consentNotice({ provider: request.provider, model: request.model, endpoint, local: false, caps })}\n  Your key is used for this scan only and is not stored or logged by Athena.`;
}

/** One AI scan at a time per user: each can spend the user's money, and two at once would double the exposure. */
const active = new Set<string>();
export function acquireAiSlot(userId: number | string): (() => void) | null {
  const id = String(userId);
  if (active.has(id)) return null;
  active.add(id);
  return () => { active.delete(id); };
}

/** Strip the key (and anything key-shaped) from text that may be logged or returned. */
export function scrub(text: string, key: string | undefined): string {
  return redactKeys(text, [key]).replace(/\b(sk-[\w-]{8,}|AIza[\w-]{20,}|Bearer\s+[\w.-]{12,})/g, '[redacted]');
}
