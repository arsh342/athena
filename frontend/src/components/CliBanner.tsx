import { useState } from 'react';

/** The server's message when a repository is over the web scanner's memory budget (see backend scanner). */
export const TOO_LARGE_MARKER = /Download the CLI and scan it on your own machine/;

const COMMANDS = [
  { label: 'Install', command: 'npm i -g @arsh342/athena' },
  { label: 'Scan', command: 'athena scan .' },
];

function CopyLine({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the command is selectable text, so copying by hand still works */
    }
  }
  return (
    <div className="cli-banner-line">
      <span className="cli-banner-label">{label}</span>
      <code>{command}</code>
      <button type="button" className="btn btn-small" onClick={() => void copy()} aria-label={`Copy: ${command}`}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/** Shown when the web scanner turned a repository away for size: how to scan it on your own machine instead. */
export function CliBanner() {
  return (
    <aside className="cli-banner" role="status" aria-label="Scan this repository with the command-line tool">
      <div>
        <p className="adv-title">Too large for the web scanner</p>
        <p className="adv-body">
          Use the command-line tool instead. It has no size limit, works offline, supports local AI models, and your code never leaves your computer.
        </p>
      </div>
      <div className="cli-banner-lines">
        {COMMANDS.map((c) => <CopyLine key={c.command} {...c} />)}
      </div>
    </aside>
  );
}
