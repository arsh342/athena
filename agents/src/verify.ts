import { z } from 'zod';

import type { ContextPack } from './context-pack.js';
import type { SpendGuard } from './loop.js';
import { runAgent } from './loop.js';
import type { ChatRequest, ChatResponse, ModelProvider } from './providers/types.js';
import { VERIFY_PROMPT_VERSION, VERIFY_SYSTEM } from './prompts.js';
import type { ProviderId, TokenUsage } from './types.js';
import { createHash } from 'node:crypto';

export interface AiVerdict {
  verdict: 'confirmed' | 'refuted' | 'needs-human';
  reachability: string;
  defenses: string;
  impact: string;
  citations: string[];
  reason: string;
  provider: ProviderId;
  model: string;
  cached: boolean;
  promptVersion: string;
  /** Panel verdicts: how each voter voted (deep mode). */
  votes?: Array<{ voter: string; verdict: 'confirmed' | 'refuted' | 'needs-human' }>;
}

export interface VerdictCache {
  get(key: string): AiVerdict | null;
  set(key: string, value: AiVerdict): void;
}

const text = z.string().transform((s) => s.slice(0, 400));
const VerdictItem = z.object({
  id: z.string(),
  verdict: z.enum(['confirmed', 'refuted', 'needs-human']),
  reachability: text,
  defenses: text,
  impact: text,
  citations: z.array(z.string().max(300)).max(12),
  reason: text,
});
const VerdictDoc = z.object({ verdicts: z.array(z.unknown()) });

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'needs-human'] },
          reachability: { type: 'string' },
          defenses: { type: 'string' },
          impact: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'reachability', 'defenses', 'impact', 'citations', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

export function cacheKey(pack: ContextPack, provider: ProviderId, model: string, voter?: string): string {
  return createHash('sha256').update(JSON.stringify([pack.text, provider, model, VERIFY_PROMPT_VERSION, ...(voter ? [voter] : [])])).digest('hex');
}

export interface VerifyInput {
  provider: ModelProvider;
  providerId: ProviderId;
  model: string;
  candidates: Array<{ id: string; pack: ContextPack }>;
  /** Entry points and components, shared by every batch (part of the cached prefix). */
  mapSummary?: string;
  guard?: SpendGuard;
  cache?: VerdictCache;
  batchSize?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Panel voter: its framing is appended after the shared prefix, so every voter reads the same cached prefix. */
  voter?: { id: string; framing: string };
  /** Send the batches through the provider's asynchronous batch API (cheaper, slower) when it has one. */
  useBatch?: boolean;
  signal?: AbortSignal;
}

export interface VerifyResult {
  verdicts: Map<string, AiVerdict>;
  /** Candidates the AI did not settle, with why (budget, refusal, truncation, no valid answer). */
  notChecked: Array<{ id: string; reason: string }>;
  usage: TokenUsage;
  requests: number;
  cachedHits: number;
}

/**
 * Verify candidates in batches of up to five. Every batch carries the same stable prefix (system prompt, output schema,
 * codebase summary) so it is read from the provider's cache; only the candidate packs differ. Per-candidate results are
 * cached by content, so unchanged code is never paid for twice.
 */
export async function verifyCandidates(input: VerifyInput): Promise<VerifyResult> {
  const verdicts = new Map<string, AiVerdict>();
  const notChecked: VerifyResult['notChecked'] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let requests = 0;
  let cachedHits = 0;
  const voterId = input.voter?.id;

  const misses: typeof input.candidates = [];
  for (const c of input.candidates) {
    const hit = input.cache?.get(cacheKey(c.pack, input.providerId, input.model, voterId));
    if (hit) {
      verdicts.set(c.id, { ...hit, cached: true });
      cachedHits += 1;
    } else misses.push(c);
  }

  const size = Math.max(1, input.batchSize ?? 5);
  const stable = `${VERIFY_SYSTEM}${input.mapSummary ? `\n\nCodebase summary:\n${input.mapSummary}` : ''}`;
  const groups: Array<typeof misses> = [];
  for (let i = 0; i < misses.length; i += size) groups.push(misses.slice(i, i + size));
  const requestFor = (group: typeof misses): ChatRequest => ({
    model: input.model,
    system: { stable, ...(input.voter ? { volatile: input.voter.framing } : {}) },
    output: { name: 'verdicts', schema: VERDICT_SCHEMA },
    maxTokens: 700 * group.length + 300,
    effort: input.effort ?? 'low',
    messages: [{ role: 'user', content: [{ type: 'text', text: `Verify these findings. Ids: ${group.map((c) => c.id).join(', ')}\n\n${group.map((c) => c.pack.text).join('\n\n')}` }] }],
  });
  const add = (u: TokenUsage) => { usage = { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens, cacheReadTokens: (usage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0), cacheWriteTokens: (usage.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0) }; };

  const consume = (group: typeof misses, status: 'done' | 'refused' | 'truncated' | 'other', json: unknown, reason?: string): void => {
    const fail = (why: string) => { for (const c of group) notChecked.push({ id: c.id, reason: why }); };
    if (status === 'refused') return fail(`the model declined (${reason ?? 'policy'})`);
    if (status === 'truncated') return fail('the answer was truncated');
    if (status !== 'done') return fail(`no answer (${reason ?? status})`);
    const doc = VerdictDoc.safeParse(json);
    const asked = new Set(group.map((c) => c.id));
    const got = new Map<string, z.infer<typeof VerdictItem>>();
    for (const raw of doc.success ? doc.data.verdicts : []) {
      const item = VerdictItem.safeParse(raw);
      if (item.success && asked.has(item.data.id) && !got.has(item.data.id)) got.set(item.data.id, item.data);
    }
    for (const c of group) {
      const v = got.get(c.id);
      if (!v) { notChecked.push({ id: c.id, reason: 'no valid verdict came back' }); continue; }
      const verdict: AiVerdict = { verdict: v.verdict, reachability: v.reachability, defenses: v.defenses, impact: v.impact, citations: v.citations, reason: v.reason, provider: input.providerId, model: input.model, cached: false, promptVersion: VERIFY_PROMPT_VERSION };
      verdicts.set(c.id, verdict);
      input.cache?.set(cacheKey(c.pack, input.providerId, input.model, voterId), verdict);
    }
  };

  if (input.useBatch && input.provider.chatBatch && groups.length > 0) {
    // Asynchronous path: reserve every request first, send the ones that fit as one batch, then charge each answer.
    const ok: Array<{ group: typeof misses; request: ChatRequest }> = [];
    for (let i = 0; i < groups.length; i += 1) {
      const request = requestFor(groups[i]!);
      const gate = await input.guard?.beforeCall(request);
      if (gate && !gate.ok) {
        for (const c of groups.slice(i).flat()) notChecked.push({ id: c.id, reason: `${gate.reason}: not checked by AI (budget)` });
        break;
      }
      ok.push({ group: groups[i]!, request });
    }
    if (ok.length > 0) {
      let answers: Array<ChatResponse | null>;
      try {
        answers = await input.provider.chatBatch(ok.map((o) => o.request), input.signal ? { signal: input.signal } : undefined);
      } catch (error) {
        for (const o of ok) input.guard?.release?.(o.request);
        throw error;
      }
      ok.forEach((o, i) => {
        const a = answers[i] ?? null;
        if (!a) { input.guard?.release?.(o.request); consume(o.group, 'other', undefined, 'the batch request failed'); return; }
        input.guard?.afterCall(a.usage, a.model, o.request);
        add(a.usage);
        requests += 1;
        consume(o.group, a.stopReason === 'refusal' ? 'refused' : a.stopReason === 'max_tokens' ? 'truncated' : a.toolCalls.length || a.stopReason === 'other' ? 'other' : 'done', a.json, a.refusal);
      });
    }
    return { verdicts, notChecked, usage, requests, cachedHits };
  }

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]!;
    const request = requestFor(group);
    const result = await runAgent({
      provider: input.provider,
      base: { model: request.model, system: request.system, output: request.output!, maxTokens: request.maxTokens, ...(request.effort ? { effort: request.effort } : {}) },
      messages: request.messages,
      ...(input.guard ? { guard: input.guard } : {}),
      maxTurns: 1,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    add(result.usage);
    if (result.turns > 0) requests += result.turns;
    if (result.status === 'budget') {
      for (const c of groups.slice(i).flat()) notChecked.push({ id: c.id, reason: `${result.reason ?? 'budget reached'}: not checked by AI (budget)` });
      break;
    }
    consume(group, result.status === 'done' ? 'done' : result.status === 'refused' ? 'refused' : result.status === 'truncated' ? 'truncated' : 'other', result.json, result.status === 'refused' ? result.reason : result.status);
  }
  return { verdicts, notChecked, usage, requests, cachedHits };
}
