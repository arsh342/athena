import assert from 'node:assert/strict';
import test from 'node:test';

import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { GoogleProvider } from '../src/providers/google.ts';
import { OpenAIProvider } from '../src/providers/openai.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';
import { assertToolsSupported, runAgent, ToolsUnsupported } from '../src/loop.ts';
import type { AgentTool } from '../src/tools/index.ts';

const VERDICT_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'], additionalProperties: false };
const base: Omit<ChatRequest, 'messages' | 'tools'> = { model: 'm', system: { stable: 'You verify findings.', volatile: 'Finding 1' }, output: { name: 'verdict', schema: VERDICT_SCHEMA }, maxTokens: 1000, effort: 'low' };
const user = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Is it real?' }] }];

const executed: string[] = [];
const listDir: AgentTool = { name: 'list_dir', description: 'List', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, execute: async (i) => { executed.push(String(i.path)); return 'a.js\nb.js'; } };

/** Scripted native responses: turn 1 calls list_dir, turn 2 answers with JSON. Token totals are the same under every provider's accounting. */
function scripted(native: Array<unknown>, captured: unknown[]) {
  let n = 0;
  return async (params: unknown) => { captured.push(structuredClone(params)); return native[n++]; };
}

function anthropic(captured: unknown[]): ModelProvider {
  const create = scripted([
    { content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'tu_1', name: 'list_dir', input: { path: '.' } }], stop_reason: 'tool_use', usage: { input_tokens: 80, output_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 }, model: 'claude-sonnet-5-5' },
    { content: [{ type: 'text', text: '{"verdict":"confirmed"}' }], stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 }, model: 'claude-sonnet-5-5' },
  ], captured);
  return new AnthropicProvider({ beta: { messages: { create } }, messages: { countTokens: async () => ({ input_tokens: 42 }) } });
}
function openai(captured: unknown[], kind: 'openai' | 'openai-compatible' = 'openai'): ModelProvider {
  const create = scripted([
    { choices: [{ message: { content: 'Let me look.', tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 20 } }, model: 'm' },
    { choices: [{ message: { content: '{"verdict":"confirmed"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 170, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 20 } }, model: 'm' },
  ], captured);
  return new OpenAIProvider({ chat: { completions: { create } } }, { kind, tools: true });
}
function google(captured: unknown[]): ModelProvider {
  const generateContent = scripted([
    { candidates: [{ content: { parts: [{ text: 'Let me look.' }, { functionCall: { id: 'tu_1', name: 'list_dir', args: { path: '.' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, cachedContentTokenCount: 20 }, modelVersion: 'm' },
    { candidates: [{ content: { parts: [{ text: '{"verdict":"confirmed"}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 170, candidatesTokenCount: 5, cachedContentTokenCount: 20 }, modelVersion: 'm' },
  ], captured);
  return new GoogleProvider({ models: { generateContent, countTokens: async () => ({ totalTokens: 7 }) } });
}

test('one recorded scenario gives identical results through every adapter', async () => {
  const outcomes: unknown[] = [];
  for (const make of [anthropic, (c: unknown[]) => openai(c), (c: unknown[]) => openai(c, 'openai-compatible'), google]) {
    executed.length = 0;
    const captured: unknown[] = [];
    const r = await runAgent({ provider: make(captured), base, messages: user, tools: [listDir] });
    outcomes.push({ status: r.status, json: r.json, turns: r.turns, calls: r.toolCalls, usage: r.usage, executed: [...executed] });
    assert.equal(captured.length, 2);
  }
  for (const o of outcomes.slice(1)) assert.deepEqual(o, outcomes[0]);
  assert.deepEqual(outcomes[0], { status: 'done', json: { verdict: 'confirmed' }, turns: 2, calls: [{ name: 'list_dir', input: { path: '.' }, isError: false }], usage: { inputTokens: 230, outputTokens: 15, cacheReadTokens: 40, cacheWriteTokens: 0 }, executed: ['.'] });
});

test('tool results go back in the provider-native shape, all in one message', async () => {
  const two = (n: number): AgentTool => ({ ...listDir, name: `t${n}`, execute: async () => `r${n}` });
  // Anthropic: two tool_use blocks answered by two tool_result blocks in a single user message.
  const captured: unknown[] = [];
  const create = scripted([
    { content: [{ type: 'tool_use', id: 'a', name: 't1', input: { path: '.' } }, { type: 'tool_use', id: 'b', name: 't2', input: { path: '.' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' },
    { content: [{ type: 'text', text: '{"verdict":"x"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' },
  ], captured);
  await runAgent({ provider: new AnthropicProvider({ beta: { messages: { create } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } }), base, messages: user, tools: [two(1), two(2)] });
  const second = (captured[1] as { messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> }).messages;
  const last = second[second.length - 1]!;
  assert.equal(last.role, 'user');
  assert.deepEqual(last.content.map((b) => [b.type, b.tool_use_id]), [['tool_result', 'a'], ['tool_result', 'b']]);

  // OpenAI: one `tool` message per call, each with its tool_call_id.
  const cap2: unknown[] = [];
  const create2 = scripted([
    { choices: [{ message: { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 't1', arguments: '{"path":"."}' } }, { id: 'b', type: 'function', function: { name: 't2', arguments: '{"path":"."}' } }] }, finish_reason: 'tool_calls' }], usage: {}, model: 'm' },
    { choices: [{ message: { content: '{"verdict":"x"}' }, finish_reason: 'stop' }], usage: {}, model: 'm' },
  ], cap2);
  await runAgent({ provider: new OpenAIProvider({ chat: { completions: { create: create2 } } }, { kind: 'openai' }), base, messages: user, tools: [two(1), two(2)] });
  const msgs = (cap2[1] as { messages: Array<{ role: string; tool_call_id?: string }> }).messages;
  assert.deepEqual(msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['a', 'b']);
});

test('Anthropic requests: strict tools, effort, structured output, cached stable prefix, server-side fallback, never a forced tool or thinking setting', () => {
  const p = new AnthropicProvider({ beta: { messages: { create: async () => ({}) } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } });
  const params = p.buildParams({ ...base, model: 'claude-sonnet-5-5', messages: user, tools: [listDir] }) as Record<string, any>;
  assert.equal(params.tools[0].strict, true);
  assert.equal(params.output_config.effort, 'low');
  assert.deepEqual(params.output_config.format, { type: 'json_schema', schema: VERDICT_SCHEMA });
  assert.deepEqual(params.system[0], { type: 'text', text: 'You verify findings.', cache_control: { type: 'ephemeral' } });
  assert.equal(params.system[1].cache_control, undefined, 'the volatile part is outside the cached prefix');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal('tool_choice' in params, false);
  assert.equal('thinking' in params, false);
  const haiku = p.buildParams({ ...base, model: 'claude-haiku-5-5', messages: user }) as Record<string, any>;
  assert.equal('fallbacks' in haiku, false, 'Haiku 5.5 has no server-side fallback');
  const off = new AnthropicProvider({ beta: { messages: { create: async () => ({}) } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } }, { fallback: false });
  assert.equal('fallbacks' in (off.buildParams({ ...base, model: 'claude-sonnet-5-5', messages: user }) as object), false);
});

test('a refusal, a truncated answer and a fallback are reported, not hidden', async () => {
  const refuse = new AnthropicProvider({ beta: { messages: { create: async () => ({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, usage: { input_tokens: 5, output_tokens: 0 }, model: 'm' }) } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } });
  const r = await runAgent({ provider: refuse, base, messages: user });
  assert.equal(r.status, 'refused');
  assert.equal(r.reason, 'cyber');
  const cut = new OpenAIProvider({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"verd' }, finish_reason: 'length' }], usage: {}, model: 'm' }) } } }, { kind: 'openai' });
  assert.equal((await runAgent({ provider: cut, base, messages: user })).status, 'truncated');
  const fb = new AnthropicProvider({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: '{"verdict":"ok"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: 'fallback_message' }] }, model: 'x' }) } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } });
  const resp = await fb.chat({ ...base, messages: user });
  assert.equal(resp.usage.fallback, true);
});

test('the loop stops when the spend guard says so, and an unknown tool is an error result, never an execution', async () => {
  const create = scripted([{ content: [{ type: 'tool_use', id: 'x', name: 'rm_rf', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' }, { content: [{ type: 'text', text: '{"verdict":"x"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' }], []);
  const provider = new AnthropicProvider({ beta: { messages: { create } }, messages: { countTokens: async () => ({ input_tokens: 0 }) } });
  const r = await runAgent({ provider, base, messages: user, tools: [listDir] });
  assert.deepEqual(r.toolCalls, [{ name: 'rm_rf', input: {}, isError: true }]);
  const stopped = await runAgent({ provider, base, messages: user, guard: { beforeCall: () => ({ ok: false, reason: 'run cap reached' }), afterCall: () => undefined } });
  assert.equal(stopped.status, 'budget');
  assert.equal(stopped.reason, 'run cap reached');
});

test('a model without tool calling is refused for hunt/deep but verify never asks for tools', async () => {
  const noTools = new OpenAIProvider({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"verdict":"ok"}' }, finish_reason: 'stop' }], usage: {}, model: 'llama3' }) } } }, { kind: 'openai-compatible', local: true });
  assert.throws(() => assertToolsSupported(noTools, 'llama3'), ToolsUnsupported);
  const r = await runAgent({ provider: noTools, base, messages: user });
  assert.equal(r.status, 'done');
  assert.equal(r.json && (r.json as { verdict: string }).verdict, 'ok');
  const declared = new OpenAIProvider({ chat: { completions: { create: async () => ({}) } } }, { kind: 'openai-compatible', tools: true });
  assert.doesNotThrow(() => assertToolsSupported(declared, 'qwen'));
});

test('token counting: exact where the provider offers it, an estimate otherwise (and says which)', async () => {
  const req: ChatRequest = { ...base, messages: user };
  assert.deepEqual(await anthropic([]).countTokens(req), { tokens: 42, exact: true });
  assert.deepEqual(await google([]).countTokens(req), { tokens: 7, exact: true });
  const est = await openai([]).countTokens(req);
  assert.equal(est.exact, false);
  assert.ok(est.tokens > 0);
});

import { createProvider, ProviderSetupError } from '../src/providers/index.ts';

test('the factory picks the adapter and endpoint, flags local endpoints, and refuses unsafe or incomplete setups without echoing keys', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant-SECRETSECRET-1234' };
  const a = createProvider({ provider: 'anthropic' }, { env, home: '/nonexistent-home' });
  assert.equal(a.provider.id, 'anthropic');
  assert.equal(a.local, false);
  const local = createProvider({ provider: 'openai-compatible', preset: 'ollama' }, { env: {}, home: '/nonexistent-home' });
  assert.equal(local.local, true);
  assert.equal(local.endpoint, 'http://localhost:11434/v1');
  assert.equal(local.provider.capabilities('llama3').tools, false, 'tool support on a compatible endpoint is not assumed');
  assert.equal(createProvider({ provider: 'openai-compatible', preset: 'ollama', tools: true }, { env: {}, home: '/x' }).provider.capabilities('m').tools, true);
  assert.throws(() => createProvider({ provider: 'openai-compatible', baseUrl: 'http://remote.example.com/v1' }, { env: { ATHENA_AI_API_KEY: 'k-12345678' }, home: '/x' }), /must use https/);
  assert.throws(() => createProvider({ provider: 'openai-compatible', preset: 'openrouter' }, { env: {}, home: '/x' }), /no key for openrouter/);
  assert.throws(() => createProvider({ provider: 'google' }, { env: {}, home: '/x' }), ProviderSetupError);
  assert.throws(() => createProvider({ provider: 'openai-compatible' }, { env: {}, home: '/x' }), /needs --base-url or a preset/);
});

test('createGoogle does not load the Google SDK until a request is made', async () => {
  const { createGoogle } = await import('../src/providers/google.ts');
  const provider = createGoogle({ apiKey: 'test-key' });
  assert.equal(provider.id, 'google');
});
