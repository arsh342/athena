import { GoogleGenAI } from '@google/genai';

import { parseJson, type Capabilities, type ChatRequest, type ChatResponse, type Message, type ModelProvider, type StopReason } from './types.js';

export interface GoogleLike {
  models: {
    generateContent(params: Record<string, unknown>): Promise<any>;
    countTokens(params: Record<string, unknown>): Promise<{ totalTokens?: number }>;
  };
}

function toContents(messages: Message[]): unknown[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.content.map((b) => {
      if (b.type === 'text') return { text: b.text };
      if (b.type === 'tool_use') return { functionCall: { id: b.id, name: b.name, args: b.input } };
      return { functionResponse: { id: b.toolUseId, name: b.name, response: b.isError ? { error: b.content } : { output: b.content } } };
    }),
  }));
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'RECITATION']);

export class GoogleProvider implements ModelProvider {
  readonly id = 'google' as const;
  readonly endpoint = 'https://generativelanguage.googleapis.com';

  constructor(private readonly client: GoogleLike) {}

  buildParams(request: ChatRequest): Record<string, unknown> {
    return {
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: request.system.volatile ? `${request.system.stable}\n\n${request.system.volatile}` : request.system.stable,
        maxOutputTokens: request.maxTokens,
        ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }] } : {}),
        ...(request.output ? { responseMimeType: 'application/json', responseJsonSchema: request.output.schema } : {}),
      },
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const r = await this.client.models.generateContent(this.buildParams(request));
    const candidate = r.candidates?.[0];
    let text = '';
    const toolCalls: ChatResponse['toolCalls'] = [];
    let n = 0;
    for (const part of (candidate?.content?.parts ?? []) as Array<Record<string, any>>) {
      if (typeof part.text === 'string' && !part.thought) text += part.text;
      if (part.functionCall) toolCalls.push({ id: part.functionCall.id ?? `call_${++n}`, name: part.functionCall.name ?? '', input: (part.functionCall.args ?? {}) as Record<string, unknown> });
    }
    const u = r.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    const blocked = Boolean(r.promptFeedback?.blockReason) || BLOCKED.has(String(candidate?.finishReason ?? ''));
    const finishReason = String(candidate?.finishReason ?? '');
    const stop: StopReason = blocked ? 'refusal' : toolCalls.length ? 'tool_use' : finishReason === 'MAX_TOKENS' ? 'max_tokens' : finishReason === 'STOP' || !finishReason ? 'end' : 'other';
    return {
      text,
      toolCalls,
      stopReason: stop,
      usage: { inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached), outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheReadTokens: cached, cacheWriteTokens: 0 },
      model: r.modelVersion ?? request.model,
      ...(request.output ? { json: parseJson(text) } : {}),
      ...(blocked ? { refusal: String(r.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'blocked') } : {}),
    };
  }

  async countTokens(request: ChatRequest): Promise<{ tokens: number; exact: boolean }> {
    const p = this.buildParams(request);
    const r = await this.client.models.countTokens({ model: p.model, contents: p.contents });
    return { tokens: r.totalTokens ?? 0, exact: true };
  }

  capabilities(): Capabilities {
    return { tools: true, structuredOutput: true, caching: 'implicit', exactTokenCount: true, local: false };
  }
}

export function createGoogle(options: { apiKey?: string } = {}): GoogleProvider {
  const client = new GoogleGenAI({ ...(options.apiKey ? { apiKey: options.apiKey } : {}) });
  return new GoogleProvider(client as unknown as GoogleLike);
}
