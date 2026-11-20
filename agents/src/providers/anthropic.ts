import Anthropic from '@anthropic-ai/sdk';

import { parseJson, type Capabilities, type ChatRequest, type ChatResponse, type Message, type ModelProvider, type StopReason } from './types.js';

/** The slice of the SDK this adapter uses (also what tests fake). */
export interface AnthropicLike {
  beta: { messages: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<any> } };
  messages: {
    countTokens(params: Record<string, unknown>): Promise<{ input_tokens: number }>;
    batches?: {
      create(params: { requests: Array<{ custom_id: string; params: Record<string, unknown> }> }): Promise<{ id: string }>;
      retrieve(id: string): Promise<{ processing_status: string }>;
      results(id: string): Promise<AsyncIterable<{ custom_id: string; result: { type: string; message?: any } }>>;
    };
  };
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models whose refusals can be retried server-side on a substitute model (`fallbacks: "default"`). Haiku 5.5 has no server-side fallback. */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

function toMessages(messages: Message[]): unknown[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
    }),
  }));
}

const stopReason = (reason: string | null | undefined): StopReason => (reason === 'end_turn' || reason === 'stop_sequence' ? 'end' : reason === 'tool_use' ? 'tool_use' : reason === 'max_tokens' ? 'max_tokens' : reason === 'refusal' ? 'refusal' : 'other');

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly endpoint: string;

  constructor(private readonly client: AnthropicLike, options: { endpoint?: string; fallback?: boolean } = {}) {
    this.endpoint = options.endpoint ?? 'https://api.anthropic.com';
    this.fallback = options.fallback ?? true;
  }

  private readonly fallback: boolean;

  /** Request body. Never forces a tool (`tool_choice` is left at its default), never sets `thinking`, and puts the stable prefix behind a cache breakpoint. */
  buildParams(request: ChatRequest): Record<string, unknown> {
    const system: unknown[] = [{ type: 'text', text: request.system.stable, cache_control: { type: 'ephemeral' } }];
    if (request.system.volatile) system.push({ type: 'text', text: request.system.volatile });
    const useFallback = this.fallback && FALLBACK_MODELS.has(request.model);
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      system,
      messages: toMessages(request.messages),
      ...(request.tools?.length ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, strict: true, input_schema: t.schema })) } : {}),
      ...(request.effort || request.output
        ? { output_config: { ...(request.effort ? { effort: request.effort } : {}), ...(request.output ? { format: { type: 'json_schema', schema: request.output.schema } } : {}) } }
        : {}),
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    };
  }

  /**
   * Message Batches: the same requests at half the price, answered within the hour. Batch requests use the plain (non-beta)
   * endpoint, so server-side fallbacks and their beta header are left out.
   */
  async chatBatch(requests: ChatRequest[], options: { signal?: AbortSignal; pollMs?: number; maxWaitMs?: number } = {}): Promise<Array<ChatResponse | null>> {
    const batches = this.client.messages.batches;
    if (!batches) throw new Error('the Anthropic client has no batches API');
    const strip = (p: Record<string, unknown>): Record<string, unknown> => { const { betas: _b, fallbacks: _f, ...rest } = p; return rest; };
    const created = await batches.create({ requests: requests.map((r, i) => ({ custom_id: `r${i}`, params: strip(this.buildParams(r)) })) });
    const started = Date.now();
    for (;;) {
      if (options.signal?.aborted) throw new Error('aborted');
      if ((await batches.retrieve(created.id)).processing_status === 'ended') break;
      if (Date.now() - started > (options.maxWaitMs ?? 3_600_000)) throw new Error('the batch did not finish in time');
      await new Promise((r) => setTimeout(r, options.pollMs ?? 15_000));
    }
    const out: Array<ChatResponse | null> = requests.map(() => null);
    for await (const item of await batches.results(created.id)) {
      const i = Number(item.custom_id.slice(1));
      if (item.result.type === 'succeeded' && item.result.message && i >= 0 && i < out.length) out[i] = this.fromMessage(item.result.message, requests[i]!);
    }
    return out;
  }

  async chat(request: ChatRequest, options: { signal?: AbortSignal } = {}): Promise<ChatResponse> {
    const r = await this.client.beta.messages.create(this.buildParams(request), options.signal ? { signal: options.signal } : undefined);
    return this.fromMessage(r, request);
  }

  private fromMessage(r: any, request: ChatRequest): ChatResponse {
    let text = '';
    const toolCalls: ChatResponse['toolCalls'] = [];
    for (const block of (r.content ?? []) as Array<Record<string, any>>) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    const u = r.usage ?? {};
    const fallback = Array.isArray(u.iterations) && u.iterations.some((i: { type?: string }) => i?.type === 'fallback_message');
    const category = r.stop_details?.category as string | null | undefined;
    return {
      text,
      toolCalls,
      stopReason: stopReason(r.stop_reason),
      usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, ...(fallback ? { fallback: true } : {}) },
      model: r.model ?? request.model,
      ...(request.output ? { json: parseJson(text) } : {}),
      ...(r.stop_reason === 'refusal' ? { refusal: category ?? 'declined' } : {}),
    };
  }

  async countTokens(request: ChatRequest): Promise<{ tokens: number; exact: boolean }> {
    const p = this.buildParams(request);
    const r = await this.client.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, ...(p.tools ? { tools: p.tools } : {}) });
    return { tokens: r.input_tokens, exact: true };
  }

  capabilities(): Capabilities {
    return { tools: true, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false };
  }
}

export function createAnthropic(options: { apiKey?: string; baseUrl?: string; fallback?: boolean } = {}): AnthropicProvider {
  const client = new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseUrl ? { baseURL: options.baseUrl } : {}) });
  return new AnthropicProvider(client as unknown as AnthropicLike, { ...(options.baseUrl ? { endpoint: options.baseUrl } : {}), ...(options.fallback !== undefined ? { fallback: options.fallback } : {}) });
}
