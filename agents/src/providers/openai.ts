import OpenAI from 'openai';

import { estimateTokens, parseJson, type Capabilities, type ChatRequest, type ChatResponse, type Message, type ModelProvider, type StopReason } from './types.js';

export interface OpenAILike {
  chat: { completions: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<any> } };
}

export const PRESETS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  together: 'https://api.together.xyz/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
};

export interface OpenAIOptions {
  /** `openai` for OpenAI itself, `openai-compatible` for any service that speaks the same chat API. */
  kind: 'openai' | 'openai-compatible';
  endpoint?: string;
  /** Whether the model behind a compatible endpoint can call tools (unknown unless declared). */
  tools?: boolean;
  local?: boolean;
}

function toMessages(request: ChatRequest): unknown[] {
  const out: unknown[] = [{ role: 'system', content: request.system.volatile ? `${request.system.stable}\n\n${request.system.volatile}` : request.system.stable }];
  for (const m of request.messages as Message[]) {
    const results = m.content.filter((b) => b.type === 'tool_result');
    for (const b of results) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const calls = m.content.filter((b) => b.type === 'tool_use');
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((b) => (b.type === 'tool_use' ? { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } } : null)) } : {}),
      });
    } else if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

const finish = (reason: string | null | undefined): StopReason => (reason === 'stop' ? 'end' : reason === 'tool_calls' ? 'tool_use' : reason === 'length' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : 'other');

export class OpenAIProvider implements ModelProvider {
  readonly id: 'openai' | 'openai-compatible';
  readonly endpoint: string;

  constructor(private readonly client: OpenAILike, private readonly options: OpenAIOptions) {
    this.id = options.kind;
    this.endpoint = options.endpoint ?? 'https://api.openai.com/v1';
  }

  buildParams(request: ChatRequest): Record<string, unknown> {
    const strictTools = this.options.kind === 'openai';
    return {
      model: request.model,
      messages: toMessages(request),
      // OpenAI deprecated `max_tokens` for `max_completion_tokens`; other services still expect `max_tokens`.
      ...(this.options.kind === 'openai' ? { max_completion_tokens: request.maxTokens } : { max_tokens: request.maxTokens }),
      ...(request.tools?.length ? { tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema, ...(strictTools ? { strict: true } : {}) } })) } : {}),
      ...(request.output ? { response_format: { type: 'json_schema', json_schema: { name: request.output.name, schema: request.output.schema, strict: true } } } : {}),
    };
  }

  async chat(request: ChatRequest, options: { signal?: AbortSignal } = {}): Promise<ChatResponse> {
    const r = await this.client.chat.completions.create(this.buildParams(request), options.signal ? { signal: options.signal } : undefined);
    const choice = r.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const text: string = typeof message.content === 'string' ? message.content : '';
    const toolCalls: ChatResponse['toolCalls'] = (message.tool_calls ?? []).map((c: any) => ({ id: c.id, name: c.function?.name ?? '', input: (parseJson(c.function?.arguments ?? '{}') as Record<string, unknown> | undefined) ?? {} }));
    const u = r.usage ?? {};
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    const refused = message.refusal || choice.finish_reason === 'content_filter';
    return {
      text,
      toolCalls,
      stopReason: refused ? 'refusal' : toolCalls.length ? 'tool_use' : finish(choice.finish_reason),
      usage: { inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached), outputTokens: u.completion_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 },
      model: r.model ?? request.model,
      ...(request.output ? { json: parseJson(text) } : {}),
      ...(refused ? { refusal: typeof message.refusal === 'string' ? message.refusal : 'content_filter' } : {}),
    };
  }

  async countTokens(request: ChatRequest): Promise<{ tokens: number; exact: boolean }> {
    return { tokens: estimateTokens(request), exact: false };
  }

  capabilities(): Capabilities {
    return {
      tools: this.options.kind === 'openai' ? true : this.options.tools ?? false,
      structuredOutput: true,
      caching: 'implicit',
      exactTokenCount: false,
      local: this.options.local ?? false,
    };
  }
}

export function createOpenAI(options: { kind: 'openai' | 'openai-compatible'; apiKey?: string; baseUrl?: string; tools?: boolean; local?: boolean }): OpenAIProvider {
  const client = new OpenAI({ apiKey: options.apiKey ?? 'not-needed', ...(options.baseUrl ? { baseURL: options.baseUrl } : {}) });
  return new OpenAIProvider(client as unknown as OpenAILike, { kind: options.kind, ...(options.baseUrl ? { endpoint: options.baseUrl } : {}), ...(options.tools !== undefined ? { tools: options.tools } : {}), ...(options.local !== undefined ? { local: options.local } : {}) });
}
