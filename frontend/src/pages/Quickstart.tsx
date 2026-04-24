import { Link } from 'react-router-dom';

export function QuickstartPage() {
  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// SECTION: QUICKSTART</span>
          <span>001</span>
        </div>
        <span className="eyebrow">CLI</span>
        <div>
          <h1>Quickstart</h1>
          <p>Install athena, run first scan, and enable pre-commit gating in under 3 minutes.</p>
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '18px' }}>
        <div>
          <h2>1. Install</h2>
          <pre className="quickstart-code">npm install -g @arsh342/athena</pre>
        </div>

        <div>
          <h2>2. Scan Current Repository</h2>
          <pre className="quickstart-code">athena scan .</pre>
          <p>Runs recursive JS/TS scan, scores AI provenance, and prints full findings report.</p>
        </div>

        <div>
          <h2>3. Check Staged Files</h2>
          <pre className="quickstart-code">athena check</pre>
          <p>Fast pre-commit style check on staged files only.</p>
        </div>

        <div>
          <h2>4. Enable Commit Gate</h2>
          <pre className="quickstart-code">athena init</pre>
          <p>Installs local pre-commit hook to block critical/high risk commits.</p>
        </div>

        <div>
          <h2>Useful Flags</h2>
          <pre className="quickstart-code">athena scan . --format json\nathena check --max-findings all\nathena scan . --threshold 12</pre>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link className="button button-primary" to="/scan">Open Web Scanner</Link>
          <a className="button" href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">Open npm page</a>
        </div>
      </section>
    </div>
  );
}
