import { capOutput } from './sandbox.js';
import type { AgentTool } from './tools/index.js';
import type { Block, ChatRequest, ChatResponse, Message, ModelProvider } from './providers/types.js';
import type { TokenUsage } from './types.js';

/** Checked before every model call, charged after it. A refusal to proceed ends the loop with the reason. */
export interface SpendGuard {
  beforeCall(request: ChatRequest): { ok: true } | { ok: false; reason: string } | Promise<{ ok: true } | { ok: false; reason: string }>;
  afterCall(usage: ChatResponse['usage'], model: string, request: ChatRequest): void;
  /** The call failed before it produced usage: give back what beforeCall reserved. */
  release?(request: ChatRequest): void;
}

export class ToolsUnsupported extends Error {}

export type LoopStatus = 'done' | 'refused' | 'truncated' | 'budget' | 'max-turns';
export interface LoopResult {
  status: LoopStatus;
  reason?: string;
  text: string;
  json?: unknown;
  usage: TokenUsage;
  turns: number;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; isError: boolean }>;
  messages: Message[];
}

/** Hunt and deep modes need tool calling; a model that cannot do it is refused up front (verify mode needs none). */
export function assertToolsSupported(provider: ModelProvider, model: string): void {
  if (!provider.capabilities(model).tools) throw new ToolsUnsupported(`${provider.id} model ${model} cannot call tools, which this mode needs; use verify mode or a model that supports tool calling`);
}

const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
  cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
});

/**
 * Provider-neutral agent loop: call the model, run its tool calls (in parallel, answered together in ONE user message),
 * repeat until it answers. Tools are only those passed in; a call to anything else is an error result, not an execution.
 */
export async function runAgent(input: {
  provider: ModelProvider;
  base: Omit<ChatRequest, 'messages' | 'tools'>;
  messages: Message[];
  tools?: AgentTool[];
  guard?: SpendGuard;
  maxTurns?: number;
  signal?: AbortSignal;
}): Promise<LoopResult> {
  const tools = input.tools ?? [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages: Message[] = [...input.messages];
  const calls: LoopResult['toolCalls'] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const maxTurns = input.maxTurns ?? 12;
  const finish = (status: LoopStatus, extra: Partial<LoopResult> & { text?: string } = {}, turns = 0): LoopResult => ({ status, text: '', usage, turns, toolCalls: calls, messages, ...extra });

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const request: ChatRequest = { ...input.base, messages, ...(tools.length ? { tools: tools.map(({ name, description, schema }) => ({ name, description, schema })) } : {}) };
    const gate = await input.guard?.beforeCall(request);
    if (gate && !gate.ok) return finish('budget', { reason: gate.reason }, turn - 1);
    let response: ChatResponse;
    try {
      response = await input.provider.chat(request, input.signal ? { signal: input.signal } : undefined);
    } catch (error) {
      input.guard?.release?.(request);
      throw error;
    }
    input.guard?.afterCall(response.usage, response.model, request);
    usage = add(usage, response.usage);

    if (response.stopReason === 'refusal') return finish('refused', { reason: response.refusal ?? 'declined', text: response.text }, turn);
    if (response.toolCalls.length === 0) {
      if (response.stopReason === 'max_tokens') return finish('truncated', { text: response.text, ...(response.json !== undefined ? { json: response.json } : {}) }, turn);
      return finish('done', { text: response.text, ...(response.json !== undefined ? { json: response.json } : {}) }, turn);
    }

    const assistant: Block[] = [...(response.text ? [{ type: 'text' as const, text: response.text }] : []), ...response.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }))];
    messages.push({ role: 'assistant', content: assistant });
    const results = await Promise.all(response.toolCalls.map(async (c): Promise<Block> => {
      const tool = byName.get(c.name);
      if (!tool) {
        calls.push({ name: c.name, input: c.input, isError: true });
        return { type: 'tool_result', toolUseId: c.id, name: c.name, content: `unknown tool ${c.name}`, isError: true };
      }
      try {
        const out = capOutput(await tool.execute(c.input));
        calls.push({ name: c.name, input: c.input, isError: false });
        return { type: 'tool_result', toolUseId: c.id, name: c.name, content: out };
      } catch (error) {
        calls.push({ name: c.name, input: c.input, isError: true });
        return { type: 'tool_result', toolUseId: c.id, name: c.name, content: capOutput(`error: ${error instanceof Error ? error.message : String(error)}`), isError: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  return finish('max-turns', { reason: `no answer after ${maxTurns} turns` }, maxTurns);
}
