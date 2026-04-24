import { FormEvent, useState } from 'react';
import { SandboxTerminal } from '../components/SandboxTerminal';

export function ScanPage() {
  const [repoUrl, setRepoUrl] = useState('');
  const [scanNonce, setScanNonce] = useState(1);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repoUrl.trim()) return;
    setScanNonce((value) => value + 1);
  }

  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// SECTION: REPOSITORY_INPUT</span>
          <span>001</span>
        </div>
        <span className="eyebrow">New scan</span>
        <div>
          <h1>Submit a repository</h1>
          <p>Public GitHub repositories are cloned into a temporary sandbox and scanned with the same core engine as the CLI.</p>
        </div>
      </section>

      <section className="scan-layout">
        <div className="br-section-annotation">
          <span>// SECTION: LIVE_EXECUTION</span>
          <span>002</span>
        </div>
        <form className="scan-form panel" onSubmit={handleSubmit}>
          <label htmlFor="repoUrl">Repository URL</label>
          <input
            id="repoUrl"
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
          />
          <button className="button button-primary" type="submit" disabled={!repoUrl.trim()}>
            Start scan
          </button>
          <div className="scan-rules">
            <span>https repositories only</span>
            <span>120s timeout</span>
            <span>scan-specific findings</span>
            <span>interactive sandbox</span>
          </div>
        </form>
        <SandboxTerminal repoUrl={repoUrl} scanNonce={scanNonce} />
      </section>
    </div>
  );
}
