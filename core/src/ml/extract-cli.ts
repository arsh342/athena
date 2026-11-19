import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { LanguageId } from '../lang/languages.js';
import { extractFeatures } from './features.js';

interface InRow { id: string; language: LanguageId; code: string }

/** `node extract-cli.js --in units.jsonl --out features.jsonl` */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string): string => {
    const i = args.indexOf(flag);
    if (i < 0 || !args[i + 1]) throw new Error(`missing ${flag}`);
    return args[i + 1]!;
  };
  const out = createWriteStream(get('--out'));
  const rl = createInterface({ input: createReadStream(get('--in')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as InRow;
    const f = extractFeatures({ code: row.code }, row.language);
    const idx = [...f.hashed.keys()].sort((a, b) => a - b);
    out.write(`${JSON.stringify({ id: row.id, dense: Array.from(f.dense), family: Array.from(f.family), idx, val: idx.map((i) => f.hashed.get(i)) })}\n`);
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
