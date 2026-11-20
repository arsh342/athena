import type { ProviderId, TokenUsage } from '../types.js';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; name: string; content: string; isError?: boolean };

export interface Message {
  role: 'user' | 'assistant';
  content: Block[];
}

export type JsonSchema = Record<string, unknown>;

/** A tool the model may call. The schema must be a strict object schema (`additionalProperties: false`, every property required). */
export interface ToolDef {
  name: string;
  description: string;
  schema: JsonSchema;
}

export interface ChatRequest {
  model: string;
  /** `stable` comes first and is the cacheable prefix (system prompt, output schema, codebase summary); `volatile` follows. */
  system: { stable: string; volatile?: string };
  messages: Message[];
  tools?: ToolDef[];
  /** Ask for one JSON document matching this schema as the answer. */
  output?: { name: string; schema: JsonSchema };
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: StopReason;
  usage: TokenUsage & { /** A fallback model ran: the real bill may be at a higher rate than the requested model's. */ fallback?: boolean };
  model: string;
  /** Parsed structured output, when requested and valid JSON came back. */
  json?: unknown;
  /** Refusal category or message, when `stopReason` is `refusal`. */
  refusal?: string;
}

export interface Capabilities {
  /** Can call tools (required for hunt and deep modes; verify needs none). */
  tools: boolean;
  structuredOutput: boolean;
  caching: 'explicit' | 'implicit' | 'none';
  /** `countTokens` is exact, not an estimate. */
  exactTokenCount: boolean;
  local: boolean;
}

export interface ModelProvider {
  readonly id: ProviderId;
  /** The endpoint requests go to (shown in the consent notice). */
  readonly endpoint: string;
  chat(request: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  countTokens(request: ChatRequest): Promise<{ tokens: number; exact: boolean }>;
  /** Optional: send independent single-turn requests through the provider's cheaper asynchronous batch API (null = that request failed). */
  chatBatch?(requests: ChatRequest[], options?: { signal?: AbortSignal; pollMs?: number; maxWaitMs?: number }): Promise<Array<ChatResponse | null>>;
  capabilities(model: string): Capabilities;
}

export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** A rough size for providers without a token-counting endpoint: about four characters per token. */
export function estimateTokens(request: ChatRequest): number {
  let chars = request.system.stable.length + (request.system.volatile?.length ?? 0);
  for (const m of request.messages) for (const b of m.content) chars += b.type === 'text' ? b.text.length : b.type === 'tool_use' ? JSON.stringify(b.input).length + b.name.length : b.content.length;
  for (const t of request.tools ?? []) chars += JSON.stringify(t.schema).length + t.description.length + t.name.length;
  if (request.output) chars += JSON.stringify(request.output.schema).length;
  return Math.ceil(chars / 4);
}
