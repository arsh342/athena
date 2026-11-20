import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { aiChoiceFlow, hooksFlow, keysFlow, mainMenu, reviewFlow, scanFlow, settingsFlow, SERVICES, type Deps, type KeySource } from '../src/menu/flows.ts';
import type { ChoiceOption, Ui } from '../src/menu/ui.ts';

type Step = { pick: string } | { back: true } | { text: string | null } | { yes: boolean };

/** A scripted terminal: each call to choose, ask or confirm takes the next step. */
class FakeUi implements Ui {
  titles: string[] = [];
  notes: string[] = [];
  ran: string[] = [];
  constructor(private steps: Step[]) {}
  private next(kind: string): Step {
    const s = this.steps.shift();
    assert.ok(s, `the flow asked for more input than the script gave (${kind})`);
    return s;
  }
  async choose<T>(title: string, options: Array<ChoiceOption<T>>): Promise<T | null> {
    this.titles.push(title);
    const s = this.next(`choose "${title}"`);
    if ('back' in s) return null;
    assert.ok('pick' in s, `expected a pick for "${title}"`);
    const o = options.find((x) => x.label.startsWith(s.pick));
    assert.ok(o, `no option starting "${s.pick}" in "${title}": ${options.map((x) => x.label).join(' | ')}`);
    return o.value;
  }
  async ask(question: string): Promise<string | null> {
    const s = this.next(`ask "${question}"`);
    assert.ok('text' in s, `expected text for "${question}"`);
    return s.text;
  }
  async confirm(): Promise<boolean> {
    const s = this.next('confirm');
    assert.ok('yes' in s);
    return s.yes;
  }
  async note(message: string): Promise<void> { this.notes.push(message); }
  async run(label: string, work: () => Promise<void> | void): Promise<void> { this.ran.push(label); await work(); }
  done(): void { assert.equal(this.steps.length, 0, `unused steps: ${JSON.stringify(this.steps)}`); }
}

function deps(over: Partial<Deps> = {}, saved: Record<string, KeySource> = {}): Deps & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  const slot = (provider: string, preset?: string) => (preset ? `${provider}:${preset}` : provider);
  const d: Deps = {
    keyStatus: (provider, o) => ({ source: saved[slot(provider, o.preset)] ?? (provider === 'anthropic' ? 'sdk-default' : 'none') }),
    setKey: (provider, key, o) => { calls.push(['setKey', { provider, key, preset: o.preset }]); saved[slot(provider, o.preset)] = 'file'; return '/home/.athena/credentials.json'; },
    removeKey: (provider, o) => { calls.push(['removeKey', { provider, preset: o.preset }]); delete saved[slot(provider, o.preset)]; return true; },
    scan: async (dir, flags) => { calls.push(['scan', { dir, flags }]); },
    review: async (flags) => { calls.push(['review', flags]); },
    check: async (flags) => { calls.push(['check', flags]); },
    init: async (o) => { calls.push(['init', o]); },
    uninstall: async () => { calls.push(['uninstall', null]); },
    update: async () => { calls.push(['update', null]); },
    alerts: async () => { calls.push(['alerts', null]); },
    explain: async (id) => { calls.push(['explain', id]); },
    skills: async () => { calls.push(['skills', null]); },
    provenance: async () => { calls.push(['provenance', null]); },
    doctor: async () => { calls.push(['doctor', null]); },
    help: () => { calls.push(['help', null]); },
    configRoot: async () => '/nonexistent',
    home: '/home/.athena',
    ...over,
  };
  return Object.assign(d, { calls });
}

test('keys: pick Groq, paste a key, and it is saved to the groq preset', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Add or replace' }, { pick: 'Groq' }, { text: ' gsk-test-123 ' }, { back: true }]);
  await keysFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, [['setKey', { provider: 'openai-compatible', key: 'gsk-test-123', preset: 'groq' }]]);
  assert.match(ui.notes[0]!, /credentials\.json/);
  assert.ok(!ui.notes.join('\n').includes('gsk-test-123'), 'the key is never echoed back');
});

test('keys: an empty paste or a cancel saves nothing', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Add or replace' }, { pick: 'Anthropic' }, { text: '  ' }, { pick: 'Add or replace' }, { pick: 'OpenAI' }, { text: null }, { back: true }]);
  await keysFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, []);
});

test('keys: remove lists only saved keys and asks before deleting', async () => {
  const d = deps({}, { 'openai-compatible:groq': 'file', openai: 'env' });
  const ui = new FakeUi([{ pick: 'Remove a saved key' }, { pick: 'Groq' }, { yes: true }, { back: true }]);
  await keysFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, [['removeKey', { provider: 'openai-compatible', preset: 'groq' }]]);
  const none = deps();
  const ui2 = new FakeUi([{ pick: 'Remove a saved key' }, { back: true }]);
  await keysFlow(ui2, none);
  assert.match(ui2.notes[0]!, /No saved keys/);
});

test('AI choice: no key means no-key; with a Groq key it asks mode, model and cap and returns the flags', async () => {
  assert.equal(await aiChoiceFlow(new FakeUi([]), deps({}, {})), 'no-key');
  const d = deps({}, { 'openai-compatible:groq': 'file' });
  const ui = new FakeUi([{ pick: 'Verify' }, { text: 'openai/gpt-oss-120b' }, { text: '0.25' }]);
  const flags = await aiChoiceFlow(ui, d);
  ui.done();
  assert.deepEqual(flags, { ai: 'verify', provider: 'openai-compatible', preset: 'groq', model: 'openai/gpt-oss-120b', budget: '0.25' });
});

test('AI choice: a bad cap or a missing model runs nothing', async () => {
  const d = deps({}, { 'openai-compatible:groq': 'file' });
  const ui = new FakeUi([{ pick: 'Verify' }, { text: 'm' }, { text: 'free' }]);
  assert.equal(await aiChoiceFlow(ui, d), null);
  assert.match(ui.notes[0]!, /positive number/);
  const ui2 = new FakeUi([{ pick: 'Verify' }, { text: '' }]);
  assert.equal(await aiChoiceFlow(ui2, d), null);
  assert.match(ui2.notes[0]!, /model id is needed/);
});

test('scan: quick runs an offline scan of the current folder and shows the equivalent command', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Scan this folder' }]);
  await scanFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, [['scan', { dir: '.', flags: { format: 'terminal' } }]]);
  assert.deepEqual(ui.ran, ['athena scan .']);
});

test('scan: custom options become flags, and turning dependency checks off adds --no-deps', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Choose options' }, { pick: 'Critical only' }, { pick: 'Markdown' }, { pick: 'No, stay fully offline' }]);
  await scanFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls[0], ['scan', { dir: '.', flags: { format: 'markdown', failOn: 'critical', deps: false } }]);
  assert.equal(ui.ran[0], 'athena scan . --fail-on critical --format markdown --no-deps');
});

test('scan with AI and no key offers to add one, and runs nothing when declined', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Scan with the AI check' }, { yes: false }]);
  await scanFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, []);
});

test('scan with AI and a Groq key runs the AI flags', async () => {
  const d = deps({}, { 'openai-compatible:groq': 'file' });
  const ui = new FakeUi([{ pick: 'Scan with the AI check' }, { pick: 'Verify' }, { text: 'openai/gpt-oss-120b' }, { text: '0.10' }]);
  await scanFlow(ui, d);
  ui.done();
  const call = d.calls[0] as ['scan', { dir: string; flags: Record<string, unknown> }];
  assert.equal(call[1].flags.ai, 'verify');
  assert.equal(call[1].flags.preset, 'groq');
  assert.equal(call[1].flags.budget, '0.1');
  assert.match(ui.ran[0]!, /^athena scan \. --ai verify --provider openai-compatible --preset groq --model openai\/gpt-oss-120b --budget 0\.1/);
});

test('review: since a branch asks for the branch; no key means no AI question', async () => {
  const d = deps();
  const ui = new FakeUi([{ pick: 'Everything since a branch' }, { text: 'develop' }]);
  await reviewFlow(ui, d);
  ui.done();
  assert.deepEqual(d.calls, [['review', { format: 'terminal', base: 'develop' }]]);
  assert.equal(ui.ran[0], 'athena review --base develop');
});

test('review: staged with a key can add the AI check', async () => {
  const d = deps({}, { anthropic: 'env' });
  const ui = new FakeUi([{ pick: 'What I have staged' }, { pick: 'Yes' }, { pick: 'Verify' }, { text: '0.25' }]);
  await reviewFlow(ui, d);
  ui.done();
  const flags = (d.calls[0] as ['review', Record<string, unknown>])[1];
  assert.equal(flags.staged, true);
  assert.equal(flags.ai, 'verify');
  assert.equal(flags.provider, 'anthropic');
});

test('hooks: install both, and removing needs a yes', async () => {
  const d = deps();
  await hooksFlow(new FakeUi([{ pick: 'Check every commit and every push' }]), d);
  assert.deepEqual(d.calls, [['init', { hooks: 'pre-commit,pre-push' }]]);
  const d2 = deps();
  await hooksFlow(new FakeUi([{ pick: 'Remove' }, { yes: false }]), d2);
  assert.deepEqual(d2.calls, []);
  await hooksFlow(new FakeUi([{ pick: 'Remove' }, { yes: true }]), d2);
  assert.deepEqual(d2.calls, [['uninstall', null]]);
});

test('settings: writes failOn to athena.config.json and keeps the other settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athena-menu-'));
  await writeFile(join(root, 'athena.config.json'), JSON.stringify({ exclude: ['generated/'], failOn: 'high' }));
  const d = deps({ configRoot: async () => root });
  const ui = new FakeUi([{ pick: 'Critical only' }]);
  await settingsFlow(ui, d);
  const saved = JSON.parse(await readFile(join(root, 'athena.config.json'), 'utf8'));
  assert.deepEqual(saved, { exclude: ['generated/'], failOn: 'critical' });
});

test('main menu: explain asks for an id, vulnerability data offers update, and q leaves', async () => {
  const d = deps();
  const ui = new FakeUi([
    { pick: 'Explain a finding' }, { text: ' 40fd25 ' },
    { pick: 'Vulnerability data' }, { pick: 'Update now' },
    { pick: 'Check staged files' },
    { back: true },
  ]);
  await mainMenu(ui, d, []);
  ui.done();
  assert.deepEqual(d.calls, [['explain', '40fd25'], ['update', null], ['check', { format: 'terminal' }]]);
});

test('every service has a label, a provider and a unique id', () => {
  assert.equal(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length);
  assert.ok(SERVICES.every((s) => s.label && s.provider));
  assert.ok(SERVICES.filter((s) => s.provider === 'openai-compatible').every((s) => s.preset));
});
