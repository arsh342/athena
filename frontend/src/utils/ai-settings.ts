/**
 * Bring-your-own-key settings for AI scans.
 *
 * The key is kept in sessionStorage (this tab only, gone when it closes), never localStorage, and is sent only as headers
 * on a scan the user starts with AI turned on. Nothing here is sent to Athena unless `enabled` is true.
 */
export type AiProvider = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  key: string;
  model: string;
  preset: string;
  mode: 'verify' | 'hunt';
  budgetUsd: number;
  consented: boolean;
}

const STORAGE_KEY = 'athena_ai_settings';
export const DEFAULT_SETTINGS: AiSettings = { enabled: false, provider: 'anthropic', key: '', model: '', preset: '', mode: 'verify', budgetUsd: 0.25, consented: false };

function store(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this page only */
  }
}

export function clearAiSettings(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function aiReady(s: AiSettings): boolean {
  return s.enabled && s.key.trim().length > 0 && s.budgetUsd > 0 && (s.provider === 'anthropic' || s.model.trim().length > 0) && (s.provider !== 'openai-compatible' || s.preset.trim().length > 0);
}

/** Headers for one AI scan, or an empty object when AI is off or incomplete: so no key ever rides along on an ordinary scan. */
export function aiHeaders(s: AiSettings): Record<string, string> {
  if (!aiReady(s)) return {};
  return {
    'X-AI-Provider': s.provider,
    'X-AI-Key': s.key.trim(),
    'X-AI-Budget': String(s.budgetUsd),
    'X-AI-Mode': s.mode,
    ...(s.model.trim() ? { 'X-AI-Model': s.model.trim() } : {}),
    ...(s.provider === 'openai-compatible' && s.preset ? { 'X-AI-Preset': s.preset } : {}),
    ...(s.consented ? { 'X-AI-Consent': 'accepted' } : {}),
  };
}

export function maskedKey(key: string): string {
  const k = key.trim();
  return k.length <= 4 ? '••••' : `••••${k.slice(-4)}`;
}
