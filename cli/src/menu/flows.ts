import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProviderId } from '@athena/agents/light';
import type { RunFlags } from '../utils/run-options.js';
import type { ChoiceOption, Ui } from './ui.js';

/** A place an API key can come from, with how Athena addresses it. */
export interface Service {
  id: string;
  label: string;
  provider: ProviderId;
  preset?: string;
  /** A model to suggest for providers that have no built-in default. */
  model?: string;
  note?: string;
}

export const SERVICES: Service[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic' },
  { id: 'openai', label: 'OpenAI', provider: 'openai' },
  { id: 'google', label: 'Google (Gemini)', provider: 'google', note: 'needs a one-time: npm i -g @google/genai' },
  { id: 'groq', label: 'Groq (has a free tier)', provider: 'openai-compatible', preset: 'groq', model: 'openai/gpt-oss-120b' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', preset: 'openrouter' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', preset: 'deepseek' },
  { id: 'mistral', label: 'Mistral', provider: 'openai-compatible', preset: 'mistral' },
  { id: 'xai', label: 'xAI (Grok)', provider: 'openai-compatible', preset: 'xai' },
  { id: 'together', label: 'Together', provider: 'openai-compatible', preset: 'together' },
];

export type KeySource = 'env' | 'file' | 'sdk-default' | 'none';

/** Everything the flows run, so tests can swap each piece for a spy. */
export interface Deps {
  keyStatus(provider: ProviderId, opts: { preset?: string }): { source: KeySource; masked?: string };
  setKey(provider: ProviderId, key: string, opts: { preset?: string }): string;
  removeKey(provider: ProviderId, opts: { preset?: string }): boolean;
  scan(dir: string, flags: RunFlags): Promise<void>;
  review(flags: Record<string, unknown>): Promise<void>;
  check(flags: RunFlags): Promise<void>;
  init(opts: { hooks?: string }): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
  alerts(): Promise<void>;
  explain(id: string): Promise<void>;
  skills(): Promise<void>;
  provenance(): Promise<void>;
  doctor(): Promise<void>;
  help(): void;
  /** Where athena.config.json lives for this project (the git root, else the working directory). */
  configRoot(): Promise<string>;
  home: string;
}

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

function statusText(d: Deps, s: Service): string {
  const st = d.keyStatus(s.provider, s.preset ? { preset: s.preset } : {});
  if (st.source === 'env') return `key from your environment${st.masked ? ` (${st.masked})` : ''}`;
  if (st.source === 'file') return `key saved${st.masked ? ` (${st.masked})` : ''}`;
  if (st.source === 'sdk-default') return 'no saved key (uses your Anthropic login, if any)';
  return 'no key yet';
}

function hasKey(d: Deps, s: Service): boolean {
  const st = d.keyStatus(s.provider, s.preset ? { preset: s.preset } : {});
  return st.source === 'env' || st.source === 'file';
}

const serviceOptions = (d: Deps, list = SERVICES): Array<ChoiceOption<Service>> =>
  list.map((s) => ({ value: s, label: s.label, hint: statusText(d, s) }));

/** AI keys: see status, add or replace a key, remove one. */
export async function keysFlow(ui: Ui, d: Deps): Promise<void> {
  for (;;) {
    const action = await ui.choose<'status' | 'add' | 'remove'>('AI keys', [
      { value: 'add', label: 'Add or replace a key', hint: 'pick a service, paste the key (hidden)' },
      { value: 'status', label: 'See which keys are set', hint: 'where each key comes from, masked' },
      { value: 'remove', label: 'Remove a saved key', hint: 'deletes it from this machine' },
    ], { lede: 'Optional: the AI check settles findings Athena is unsure about, with a spend cap. Keys stay on this machine (mode 0600).' });
    if (!action) return;

    if (action === 'add') {
      const s = await ui.choose<Service>('Which service is the key for?', serviceOptions(d));
      if (!s) continue;
      const key = await ui.ask(`Paste your ${s.label.split(' (')[0]} key`, { secret: true, hint: s.note ?? 'It is saved privately and never printed.' });
      if (!key || !key.trim()) continue;
      try {
        d.setKey(s.provider, key.trim(), s.preset ? { preset: s.preset } : {});
        await ui.note(`Saved the ${s.label.split(' (')[0]} key to ${join(d.home, 'credentials.json')} (private, mode 0600).\nTry it: choose Scan, then "Scan with the AI check".`);
      } catch (error) {
        await ui.note(`Could not save the key: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (action === 'status') {
      await ui.run('athena keys status', async () => {
        for (const s of SERVICES) console.log(`  ${s.label.padEnd(26)} ${statusText(d, s)}`);
      });
    } else {
      const saved = SERVICES.filter((s) => d.keyStatus(s.provider, s.preset ? { preset: s.preset } : {}).source === 'file');
      if (saved.length === 0) { await ui.note('No saved keys to remove. (Keys from environment variables are not stored by Athena.)'); continue; }
      const s = await ui.choose<Service>('Remove which key?', serviceOptions(d, saved));
      if (!s) continue;
      if (await ui.confirm(`Remove the saved ${s.label.split(' (')[0]} key?`)) {
        d.removeKey(s.provider, s.preset ? { preset: s.preset } : {});
        await ui.note(`Removed the ${s.label.split(' (')[0]} key.`);
      }
    }
  }
}

/** Pick a service that has a key, a mode, a model if needed and a spend cap. Returns flags, or null to go back, or 'none' if there is no key. */
export async function aiChoiceFlow(ui: Ui, d: Deps): Promise<Partial<RunFlags> | null | 'no-key'> {
  const ready = SERVICES.filter((s) => hasKey(d, s));
  if (ready.length === 0) return 'no-key';
  const s = ready.length === 1 ? ready[0]! : await ui.choose<Service>('Which service should check the findings?', serviceOptions(d, ready));
  if (!s) return null;
  const mode = await ui.choose<'verify' | 'hunt' | 'deep'>('How much should the AI do?', [
    { value: 'verify', label: 'Verify (recommended)', hint: 'checks only the findings Athena was unsure about' },
    { value: 'hunt', label: 'Hunt', hint: 'also explores the riskiest components' },
    { value: 'deep', label: 'Deep', hint: 'threat model and a three-voter panel; needs a spend cap' },
  ]);
  if (!mode) return null;
  const flags: Partial<RunFlags> = { ai: mode, provider: s.provider };
  if (s.preset) flags.preset = s.preset;
  if (s.provider !== 'anthropic') {
    const model = await ui.ask(`Which ${s.label.split(' (')[0]} model?`, { default: s.model ?? '', hint: 'Required for this service. Example: ' + (s.model ?? 'the model id from your provider') });
    if (model === null) return null;
    if (!model.trim()) { await ui.note('A model id is needed for this service. Nothing was run.'); return null; }
    flags.model = model.trim();
  }
  const budget = await ui.ask('Spend cap for this run, in US dollars', { default: mode === 'deep' ? '1.00' : '0.25', hint: 'Athena stops before a call could exceed it.' });
  if (budget === null) return null;
  const n = Number(budget);
  if (!Number.isFinite(n) || n <= 0) { await ui.note('The cap must be a positive number. Nothing was run.'); return null; }
  flags.budget = String(n);
  return flags;
}

const commandOf = (verb: string, dir: string | null, flags: RunFlags & Record<string, unknown>): string => {
  const parts = ['athena', verb];
  if (dir) parts.push(dir);
  if (flags.ai) parts.push(flags.ai === true ? '--ai' : `--ai ${String(flags.ai)}`);
  if (flags.provider) parts.push(`--provider ${flags.provider}`);
  if (flags.preset) parts.push(`--preset ${flags.preset}`);
  if (flags.model) parts.push(`--model ${flags.model}`);
  if (flags.budget) parts.push(`--budget ${flags.budget}`);
  if (flags.failOn) parts.push(`--fail-on ${flags.failOn}`);
  if (flags.format && flags.format !== 'terminal') parts.push(`--format ${flags.format}`);
  if (flags.deps === false) parts.push('--no-deps');
  for (const k of ['staged', 'uncommitted']) if (flags[k]) parts.push(`--${k}`);
  for (const k of ['base', 'range']) if (flags[k]) parts.push(`--${k} ${String(flags[k])}`);
  return parts.join(' ');
};

/** Scan: quick, with the AI check, another folder, or custom options. */
export async function scanFlow(ui: Ui, d: Deps): Promise<void> {
  const what = await ui.choose<'quick' | 'ai' | 'folder' | 'custom'>('Scan', [
    { value: 'quick', label: 'Scan this folder', hint: 'offline, every supported language', preview: { command: 'athena scan .', detail: 'Parses code, traces tainted data, finds secrets and risky dependencies, estimates AI provenance.' } },
    { value: 'ai', label: 'Scan with the AI check', hint: 'uses a key you added; capped spend', preview: { command: 'athena scan . --ai verify', detail: 'Also has an AI model settle the findings Athena was unsure about.' } },
    { value: 'folder', label: 'Scan a different folder or file', hint: 'type a path' },
    { value: 'custom', label: 'Choose options', hint: 'what blocks, the output format, dependency checks' },
  ]);
  if (!what) return;
  let dir = '.';
  let flags: RunFlags & Record<string, unknown> = { format: 'terminal' };

  if (what === 'folder') {
    const p = await ui.ask('Which folder or file?', { default: '.', hint: 'A path relative to where you started Athena.' });
    if (p === null) return;
    dir = p.trim() || '.';
  } else if (what === 'ai') {
    const ai = await aiChoiceFlow(ui, d);
    if (ai === 'no-key') {
      if (await ui.confirm('No AI key is set yet. Add one now?', true)) await keysFlow(ui, d);
      return;
    }
    if (!ai) return;
    flags = { ...flags, ...ai };
  } else if (what === 'custom') {
    const failOn = await ui.choose<string>('What should block (exit code 1)?', [
      { value: 'high', label: 'High and above (default)' },
      { value: 'critical', label: 'Critical only' },
      { value: 'medium', label: 'Medium and above' },
      { value: 'low', label: 'Anything' },
      { value: 'none', label: 'Never block' },
    ]);
    if (!failOn) return;
    const format = await ui.choose<string>('How should the report look?', [
      { value: 'terminal', label: 'In the terminal' },
      { value: 'markdown', label: 'Markdown (pull-request ready)' },
      { value: 'json', label: 'JSON' },
      { value: 'sarif', label: 'SARIF (GitHub code scanning)' },
    ]);
    if (!format) return;
    const deps = await ui.choose<boolean>('Check dependencies for known vulnerabilities?', [
      { value: true, label: 'Yes', hint: 'looks up package names and versions online' },
      { value: false, label: 'No, stay fully offline' },
    ]);
    if (deps === null) return;
    flags = { ...flags, failOn, format, ...(deps ? {} : { deps: false }) };
  }
  await ui.run(commandOf('scan', dir === '.' ? '.' : dir, flags), () => d.scan(dir, flags));
}

/** Review a change: staged, everything uncommitted, against a branch, or a commit range; optionally with the AI check. */
export async function reviewFlow(ui: Ui, d: Deps): Promise<void> {
  const scope = await ui.choose<'staged' | 'uncommitted' | 'base' | 'range'>('Review which changes?', [
    { value: 'staged', label: 'What I have staged', hint: 'the default', preview: { command: 'athena review', detail: 'Reviews staged changes and reports only what they introduced.' } },
    { value: 'uncommitted', label: 'Everything uncommitted', hint: 'staged, unstaged and new files' },
    { value: 'base', label: 'Everything since a branch', hint: 'for example, since main' },
    { value: 'range', label: 'A commit range', hint: 'for example origin/main..HEAD' },
  ]);
  if (!scope) return;
  const flags: Record<string, unknown> = { format: 'terminal' };
  if (scope === 'staged') flags.staged = true;
  if (scope === 'uncommitted') flags.uncommitted = true;
  if (scope === 'base') {
    const b = await ui.ask('Compare against which branch?', { default: 'main' });
    if (!b) return;
    flags.base = b.trim();
  }
  if (scope === 'range') {
    const r = await ui.ask('Which range?', { default: 'origin/main..HEAD', hint: 'two refs joined by two dots' });
    if (!r) return;
    flags.range = r.trim();
  }
  const anyKey = SERVICES.some((s) => hasKey(d, s));
  if (anyKey) {
    const withAi = await ui.choose<boolean>('Add the AI check?', [
      { value: false, label: 'No, offline only' },
      { value: true, label: 'Yes', hint: 'checks only the lines this change touched' },
    ]);
    if (withAi === null) return;
    if (withAi) {
      const ai = await aiChoiceFlow(ui, d);
      if (!ai || ai === 'no-key') return;
      Object.assign(flags, ai);
    }
  }
  await ui.run(commandOf('review', null, flags as RunFlags & Record<string, unknown>), () => d.review(flags));
}

/** Git hooks: install the pre-commit gate (and optionally pre-push), or remove them. */
export async function hooksFlow(ui: Ui, d: Deps): Promise<void> {
  const what = await ui.choose<'commit' | 'both' | 'remove'>('Git hooks', [
    { value: 'commit', label: 'Check every commit', hint: 'a pre-commit gate, about a second on a typical commit', preview: { command: 'athena init', detail: 'Installs a pre-commit hook. Skip once with ATHENA_SKIP=1 git commit.' } },
    { value: 'both', label: 'Check every commit and every push', hint: 'adds a pre-push review of what you are about to push', preview: { command: 'athena init --hooks pre-commit,pre-push', detail: 'Husky, lefthook and core.hooksPath are detected and respected.' } },
    { value: 'remove', label: 'Remove Athena\'s hooks', hint: 'your own hooks are left alone', preview: { command: 'athena uninstall', detail: 'Deletes the hooks Athena installed.' } },
  ]);
  if (!what) return;
  if (what === 'remove') {
    if (!(await ui.confirm('Remove Athena\'s git hooks from this repository?'))) return;
    await ui.run('athena uninstall', () => d.uninstall());
    return;
  }
  const hooks = what === 'both' ? 'pre-commit,pre-push' : undefined;
  await ui.run(hooks ? `athena init --hooks ${hooks}` : 'athena init', () => d.init(hooks ? { hooks } : {}));
}

/** Project settings: what level blocks a commit, written to athena.config.json. */
export async function settingsFlow(ui: Ui, d: Deps): Promise<void> {
  const root = await d.configRoot();
  const file = join(root, 'athena.config.json');
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>; } catch { /* none yet */ }
  const level = await ui.choose<string>('What should block a commit or fail a scan?', [
    { value: 'high', label: 'High and above', hint: current.failOn === 'high' || !current.failOn ? 'current (default)' : undefined },
    { value: 'critical', label: 'Critical only', hint: current.failOn === 'critical' ? 'current' : undefined },
    { value: 'medium', label: 'Medium and above', hint: current.failOn === 'medium' ? 'current' : undefined },
    { value: 'low', label: 'Anything', hint: current.failOn === 'low' ? 'current' : undefined },
    { value: 'none', label: 'Never block', hint: current.failOn === 'none' ? 'current' : undefined },
  ] as Array<ChoiceOption<string>>, { lede: `Saved to ${file}. Flags such as --fail-on still override it.` });
  if (!level) return;
  current.failOn = level;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(current, null, 2)}\n`);
  await ui.note(`Saved: failOn is now "${level}" in\n${file}`);
}

/** The top-level menu, flow by flow. */
export async function mainMenu(ui: Ui, d: Deps, header: string[]): Promise<void> {
  type Action = 'scan' | 'review' | 'check' | 'hooks' | 'keys' | 'update' | 'explain' | 'more' | 'settings' | 'help' | 'doctor';
  for (;;) {
    const action = await ui.choose<Action>('What would you like to do?', [
      { value: 'scan', label: 'Scan', hint: 'this folder, with or without the AI check', preview: { command: 'athena scan .', detail: 'Parse code, trace tainted data, find secrets and risky dependencies, estimate AI provenance.' } },
      { value: 'review', label: 'Review my changes', hint: 'staged, uncommitted, a branch or a range', preview: { command: 'athena review', detail: 'Like a code review before you commit. Only what the change introduced counts.' } },
      { value: 'check', label: 'Check staged files', hint: 'the fast gate the pre-commit hook runs', preview: { command: 'athena check', detail: 'Exits 1 when a finding reaches your fail-on level.' } },
      { value: 'hooks', label: 'Git hooks', hint: 'install or remove the commit and push gates', preview: { command: 'athena init', detail: 'Respects Husky, lefthook and core.hooksPath.' } },
      { value: 'keys', label: 'AI keys', hint: 'add, see or remove a key for Anthropic, OpenAI, Google, Groq and more', preview: { command: 'athena keys set <service>', detail: 'Keys stay on this machine. Spend is capped per run and per day.' } },
      { value: 'update', label: 'Vulnerability data', hint: 'update advisories, or see what is new for your lockfiles', preview: { command: 'athena update', detail: 'Refreshes the local OSV database, KEV and EPSS so dependency checks work offline.' } },
      { value: 'explain', label: 'Explain a finding', hint: 'type the id from a report', preview: { command: 'athena explain <id>', detail: 'Why it matters and how to fix it.' } },
      { value: 'more', label: 'Skills and provenance', hint: 'what rules are active, who wrote what', preview: { command: 'athena skills list', detail: 'Skills switch on when your project uses a framework; provenance shows AI-written files.' } },
      { value: 'settings', label: 'Project settings', hint: 'what blocks a commit', preview: { command: 'athena.config.json', detail: 'Saved in your repository so everyone gets the same gate.' } },
      { value: 'doctor', label: 'Doctor', hint: 'check Node, git and optional tools', preview: { command: 'athena doctor', detail: 'Useful for debugging a missing tool.' } },
      { value: 'help', label: 'All commands', hint: 'the full command and flag reference', preview: { command: 'athena --help', detail: 'Everything the menu does, plus mcp, models and more.' } },
    ], { header, footer: '↑/↓ move   enter select   1-9 jump   q quit' });
    if (!action) return;

    switch (action) {
      case 'scan': await scanFlow(ui, d); break;
      case 'review': await reviewFlow(ui, d); break;
      case 'check': await ui.run('athena check', () => d.check({ format: 'terminal' })); break;
      case 'hooks': await hooksFlow(ui, d); break;
      case 'keys': await keysFlow(ui, d); break;
      case 'settings': await settingsFlow(ui, d); break;
      case 'doctor': await ui.run('athena doctor', () => d.doctor()); break;
      case 'help': await ui.run('athena --help', () => d.help()); break;
      case 'update': {
        const w = await ui.choose<'update' | 'alerts'>('Vulnerability data', [
          { value: 'update', label: 'Update now', hint: 'download the latest advisories and rule packs', preview: { command: 'athena update', detail: 'Only public data is downloaded; nothing about your code is sent.' } },
          { value: 'alerts', label: 'What is new for my project?', hint: 'new vulnerabilities since your last scan', preview: { command: 'athena alerts', detail: 'Exits 1 if any are found.' } },
        ]);
        if (w === 'update') await ui.run('athena update', () => d.update());
        if (w === 'alerts') await ui.run('athena alerts', () => d.alerts());
        break;
      }
      case 'explain': {
        const id = await ui.ask('Finding id', { hint: 'The short id from a report, 4 or more characters. Example: 40fd25' });
        if (id && id.trim()) await ui.run(`athena explain ${id.trim()}`, () => d.explain(id.trim()));
        break;
      }
      case 'more': {
        const w = await ui.choose<'skills' | 'provenance'>('Skills and provenance', [
          { value: 'skills', label: 'Which skills are active?', hint: 'rules that switch on for your frameworks', preview: { command: 'athena skills list', detail: 'Also: athena skills show <name>.' } },
          { value: 'provenance', label: 'Which files look AI-written?', hint: 'per-file provenance for this folder', preview: { command: 'athena provenance .', detail: 'Recorded history is a floor; the model is an estimate.' } },
        ]);
        if (w === 'skills') await ui.run('athena skills list', () => d.skills());
        if (w === 'provenance') await ui.run('athena provenance .', () => d.provenance());
        break;
      }
    }
  }
}
