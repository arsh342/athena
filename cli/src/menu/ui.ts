import { emitKeypressEvents } from 'node:readline';
import { c } from '../utils/colors.js';
import { dashedLine, truncate } from '../utils/banner.js';
import { clearScreen } from '../utils/terminal.js';

export interface ChoiceOption<T> {
  value: T;
  label: string;
  /** One quiet line under the label. */
  hint?: string;
  /** Shown under the list while this option is highlighted: the equivalent command and what it does. */
  preview?: { command: string; detail: string };
}

export interface ChooseOptions {
  /** Lines printed above the title (the banner on the main menu). */
  header?: string[];
  /** Quiet line under the title. */
  lede?: string;
  /** Replace the default key help. */
  footer?: string;
}

export interface AskOptions {
  default?: string;
  /** Echo bullets instead of what is typed (API keys). */
  secret?: boolean;
  hint?: string;
}

/**
 * What the guided flows need from a terminal. The real implementation draws full-screen pickers; tests pass a scripted fake,
 * so every flow can be checked without a keyboard.
 */
export interface Ui {
  /** Pick one option. null means the person went back (esc or q). */
  choose<T>(title: string, options: Array<ChoiceOption<T>>, opts?: ChooseOptions): Promise<T | null>;
  /** Read a line. null means cancelled. */
  ask(question: string, opts?: AskOptions): Promise<string | null>;
  /** Yes or no. Anything but an explicit yes is no. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** A short message, dismissed with any key. */
  note(message: string): Promise<void>;
  /** Leave the full-screen view, run something that prints, wait for a key, come back. */
  run(label: string, work: () => Promise<void> | void): Promise<void>;
}


export interface LayoutInput {
  rows: number;
  cols: number;
  title: string;
  lede?: string;
  header?: string[];
  options: Array<{ label: string; hint?: string; preview?: { command: string; detail: string } }>;
  index: number;
  footer: string;
}

/**
 * Lay a picker out so it never has more lines than the terminal has rows (a taller frame scrolls, and the top is lost).
 * Lower-priority parts go first: hints on the other options, then the command preview, then the banner and intro, and last the
 * list itself scrolls around the highlighted option. The highlighted option is always on screen.
 */
export function layoutChoose(input: LayoutInput): string[] {
  const { rows, cols, title, lede, header = [], options, index, footer } = input;
  const budget = Math.max(5, rows - 1); // never touch the last row: writing to it scrolls the screen

  const option = (i: number, hints: 'all' | 'active' | 'none'): string[] => {
    const o = options[i]!;
    const active = i === index;
    const marker = active ? `${c.accent}●${c.reset}` : `${c.gray}○${c.reset}`;
    const num = i < 9 ? `${c.gray}${i + 1}.${c.reset}` : '  ';
    const label = active ? `${c.inverse} ${o.label} ${c.reset}` : `${c.bold}${o.label}${c.reset}`;
    const out = [`  ${marker} ${num} ${label}`];
    if (o.hint && hints !== 'none' && (hints === 'all' || active)) out.push(`       ${c.dim}${truncate(o.hint, cols - 9)}${c.reset}`);
    return out;
  };
  const preview = (): string[] => {
    const p = options[index]!.preview;
    return p ? ['', `  ${dashedLine(cols - 4)}`, '', `  ${c.accent}$ ${p.command}${c.reset}`, `  ${c.dim}${truncate(p.detail, cols - 4)}${c.reset}`] : [];
  };
  const intro = (withHeader: boolean, withLede: boolean): string[] => [
    ...(withHeader ? header : []),
    '',
    `  ${c.bold}${title}${c.reset}`,
    ...(withLede && lede ? [`  ${c.dim}${truncate(lede, cols - 4)}${c.reset}`] : []),
    '',
  ];
  const foot = (blank: boolean): string[] => [...(blank ? [''] : []), `  ${c.dim}${truncate(footer, cols - 4)}${c.reset}`];

  const tries: Array<{ hints: 'all' | 'active'; preview: boolean; header: boolean; lede: boolean; blank: boolean }> = [
    { hints: 'all', preview: true, header: true, lede: true, blank: true },
    { hints: 'active', preview: true, header: true, lede: true, blank: true },
    { hints: 'active', preview: false, header: true, lede: true, blank: true },
    { hints: 'active', preview: false, header: false, lede: true, blank: true },
    { hints: 'active', preview: false, header: false, lede: false, blank: false },
  ];
  for (const t of tries) {
    const lines = [...intro(t.header, t.lede), ...options.flatMap((_, i) => option(i, t.hints)), ...(t.preview ? preview() : []), ...foot(t.blank)];
    if (lines.length <= budget) return lines;
  }

  // Still too tall: scroll the list, keeping the highlighted option in view.
  const top = [`  ${c.bold}${title}${c.reset}`];
  const bottom = foot(false);
  const room = Math.max(1, budget - top.length - bottom.length);
  const marks = room >= 3; // the "more" lines only when there is space for them
  const cost = (a: number, b: number, h: 'active' | 'none'): number => {
    let n = 0;
    for (let i = a; i < b; i += 1) n += option(i, h).length;
    return n + (marks && a > 0 ? 1 : 0) + (marks && b < options.length ? 1 : 0);
  };
  const h: 'active' | 'none' = cost(index, index + 1, 'active') <= room ? 'active' : 'none';
  let start = index;
  let end = index + 1;
  while (true) {
    const grewDown = end < options.length && cost(start, end + 1, h) <= room;
    if (grewDown) end += 1;
    const grewUp = start > 0 && cost(start - 1, end, h) <= room;
    if (grewUp) start -= 1;
    if (!grewDown && !grewUp) break;
  }
  return [
    ...top,
    ...(marks && start > 0 ? [`  ${c.dim}▲ ${start} more${c.reset}`] : []),
    ...options.slice(start, end).flatMap((_, k) => option(start + k, h)),
    ...(marks && end < options.length ? [`  ${c.dim}▼ ${options.length - end} more${c.reset}`] : []),
    ...bottom,
  ];
}

interface Key { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean }

const enterAltScreen = (): void => { process.stdout.write('\x1b[?1049h'); };
const exitAltScreen = (): void => { process.stdout.write('\x1b[?1049l'); };

/** Read keys until `onKey` returns true. Raw mode is always restored. */
function readKeys(onKey: (str: string | undefined, key: Key) => boolean): Promise<void> {
  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    const handler = (str: string | undefined, key: Key = {}) => {
      if (key.ctrl && key.name === 'c') {
        // Leave the terminal tidy, then stop: the person asked to quit.
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        exitAltScreen();
        process.stdout.write('\x1b[?25h');
        process.exit(130);
      }
      if (onKey(str, key)) {
        process.stdin.off('keypress', handler);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
      }
    };
    process.stdin.on('keypress', handler);
  });
}

/** The real, full-screen terminal UI. Call start() once, and stop() when done. */
export class TerminalUi implements Ui {
  private active = false;

  start(): void {
    if (this.active) return;
    this.active = true;
    enterAltScreen();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    exitAltScreen();
    process.stdout.write('\x1b[?25h');
  }

  async choose<T>(title: string, options: Array<ChoiceOption<T>>, opts: ChooseOptions = {}): Promise<T | null> {
    if (options.length === 0) return null;
    let index = 0;
    const draw = (): void => {
      clearScreen();
      const lines = layoutChoose({
        rows: process.stdout.rows ?? 60,
        cols: Math.min(process.stdout.columns ?? 80, 78),
        title,
        ...(opts.lede ? { lede: opts.lede } : {}),
        header: opts.header ?? [],
        options,
        index,
        footer: opts.footer ?? '↑/↓ move   enter select   esc back   1-9 jump   ctrl-c quit',
      });
      process.stdout.write(lines.join('\n'));
    };
    draw();
    process.stdout.on('resize', draw);
    let result: T | null = null;
    try {
      await readKeys((_str, key) => {
        if (key.name === 'up') { index = (index - 1 + options.length) % options.length; draw(); return false; }
        if (key.name === 'down') { index = (index + 1) % options.length; draw(); return false; }
        if (key.name === 'return') { result = options[index]!.value; return true; }
        if (key.name === 'escape' || key.name === 'q' || key.name === 'left') { result = null; return true; }
        const n = Number(key.sequence);
        if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, options.length)) { result = options[n - 1]!.value; return true; }
        return false;
      });
    } finally {
      process.stdout.off('resize', draw);
    }
    return result;
  }

  async ask(question: string, opts: AskOptions = {}): Promise<string | null> {
    let value = '';
    let cancelled = false;
    const draw = (): void => {
      clearScreen();
      const shown = opts.secret ? '•'.repeat(value.length) : value;
      const lines = ['', `  ${c.bold}${question}${c.reset}`];
      if (opts.hint) lines.push(`  ${c.dim}${opts.hint}${c.reset}`);
      if (opts.default && !opts.secret) lines.push(`  ${c.dim}enter keeps: ${opts.default}${c.reset}`);
      lines.push('', `  ${c.accent}›${c.reset} ${shown}${c.dim}▏${c.reset}`, '', `  ${c.dim}enter confirm   esc cancel${opts.secret ? '   (what you type is hidden)' : ''}${c.reset}`);
      process.stdout.write(lines.join('\n'));
    };
    draw();
    process.stdout.write('\x1b[?25l');
    await readKeys((str, key) => {
      if (key.name === 'return') return true;
      if (key.name === 'escape') { cancelled = true; return true; }
      if (key.name === 'backspace') { value = value.slice(0, -1); draw(); return false; }
      if (str && !key.ctrl && !key.meta && key.name !== 'tab' && !str.startsWith('\x1b')) { value += str; draw(); return false; }
      return false;
    });
    process.stdout.write('\x1b[?25h');
    if (cancelled) return null;
    return value.length > 0 ? value : (opts.default ?? '');
  }

  async confirm(question: string, defaultYes = false): Promise<boolean> {
    const yes: ChoiceOption<boolean> = { value: true, label: 'Yes' };
    const no: ChoiceOption<boolean> = { value: false, label: 'No' };
    return (await this.choose<boolean>(question, defaultYes ? [yes, no] : [no, yes])) === true;
  }

  async note(message: string): Promise<void> {
    clearScreen();
    process.stdout.write(`\n  ${message.split('\n').join('\n  ')}\n\n  ${c.dim}press any key to continue${c.reset}`);
    await readKeys(() => true);
  }

  async run(label: string, work: () => Promise<void> | void): Promise<void> {
    // Long output belongs in the normal screen so it stays in the terminal's scrollback.
    exitAltScreen();
    process.stdout.write('\x1b[?25h');
    console.log(`\n  ${c.dim}${label}${c.reset}\n`);
    try {
      await work();
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      process.exitCode = undefined; // a blocked scan must not become the menu's own exit code
    }
    console.log(`\n  ${c.dim}press any key to return to the menu${c.reset}`);
    await readKeys(() => true);
    if (this.active) enterAltScreen();
  }
}
