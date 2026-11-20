import type { ModelProvider } from '@athena/agents';

/**
 * Test-only provider (ATHENA_AGENTS_FAKE=confirm|refute): answers every candidate the same way, deterministically, and reports a
 * fixed usage. It exists so the CLI integration can be tested without a key or a network.
 */
export function fakeProvider(mode: string): ModelProvider {
  const verdict = mode === 'refute' ? 'refuted' : 'confirmed';
  return {
    id: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    async chat(request) {
      if (request.output?.name === 'threat_model') return { text: '', toolCalls: [], stopReason: 'end', model: 'claude-sonnet-5-5', usage: { inputTokens: 800, outputTokens: 120 }, json: { summary: 'Fake threat model', invariants: ['inputs are validated'], focus: ['injection'] } };
      if (request.tools?.length) {
        // Hunt: look around once, then report nothing (the point is to exercise the plumbing, not to find bugs).
        if (!request.messages.at(-1)!.content.some((b) => b.type === 'tool_result')) {
          return { text: '', toolCalls: [{ id: 'fake-1', name: 'list_dir', input: { path: '.' } }], stopReason: 'tool_use', model: 'claude-sonnet-5-5', usage: { inputTokens: 1500, outputTokens: 40 } };
        }
        return { text: '', toolCalls: [], stopReason: 'end', model: 'claude-sonnet-5-5', usage: { inputTokens: 2500, outputTokens: 60 }, json: { findings: [] } };
      }
      const ids = [...JSON.stringify(request.messages).replace(/\\"/g, '"').matchAll(/<finding id="([^"]+)">/g)].map((m) => m[1]!);
      return {
        text: '', toolCalls: [], stopReason: 'end', model: 'claude-sonnet-5-5',
        usage: { inputTokens: 2000, outputTokens: 300 },
        json: { verdicts: ids.map((id) => ({ id, verdict, reachability: 'reachable from a public route', defenses: 'none on the path', impact: 'attacker controls the value', citations: [], reason: 'fake provider' })) },
      };
    },
    async countTokens() { return { tokens: 2000, exact: true }; },
    capabilities: () => ({ tools: true, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
}
