import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { credentialsFileExists, keyStatus, PROVIDERS, removeKey, setKey, type ProviderId } from '@athena/agents/light';
import { writeInfo, writeResult } from '../utils/output.js';
import { UsageError } from '../utils/run-options.js';

function provider(name: string): ProviderId {
  if (!(PROVIDERS as readonly string[]).includes(name)) throw new UsageError(`unknown provider "${name}" (use ${PROVIDERS.join(', ')})`);
  return name as ProviderId;
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  // Interactive: prompt without echoing what is typed.
  const muted = new Writable({ write: (_c, _e, done) => done() });
  process.stderr.write('Key (input is hidden): ');
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return (await rl.question('')).trim();
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}

/** `athena keys set <provider>`: the key comes from stdin or a hidden prompt, never from an argument (shell history). */
export async function keysSet(name: string, opts: { preset?: string } = {}): Promise<number> {
  const p = provider(name);
  const key = await readSecret();
  if (!key) {
    writeInfo('error: no key was given (pipe it in, or type it at the prompt)');
    return 2;
  }
  setKey(p, key, opts.preset ? { preset: opts.preset } : {});
  writeInfo(`saved the ${p}${opts.preset ? ` (${opts.preset})` : ''} key to your private credentials file`);
  return 0;
}

export function keysStatus(): number {
  const lines = ['Provider            Source        Key'];
  for (const p of PROVIDERS) {
    const s = keyStatus(p);
    lines.push(`${p.padEnd(19)} ${s.source.padEnd(13)} ${s.masked ?? (s.source === 'sdk-default' ? 'resolved by the Anthropic SDK when used' : '-')}`);
  }
  if (!credentialsFileExists()) lines.push('', 'No keys are stored. Set one with: athena keys set <provider>');
  writeResult(lines.join('\n'));
  return 0;
}

export function keysRemove(name: string, opts: { preset?: string } = {}): number {
  const p = provider(name);
  const removed = removeKey(p, opts.preset ? { preset: opts.preset } : {});
  writeInfo(removed ? `removed the stored ${p} key` : `no stored ${p} key`);
  return removed ? 0 : 2;
}
