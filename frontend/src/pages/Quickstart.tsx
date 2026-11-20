import { Link } from 'react-router-dom';

const STEPS: Array<[string, string, string]> = [
  ['1. Install', 'npm i -g @arsh342/athena@latest', ''],
  ['2. Scan this repository', 'athena scan .', 'Scans every supported language, traces untrusted input, estimates AI provenance and prints the findings.'],
  ['3. Review a change', 'athena review', 'Reviews staged changes and reports only what they introduced.'],
  ['4. Enable the commit gate', 'athena init', 'Installs a pre-commit hook that blocks critical and high-risk commits.'],
  ['Useful flags', 'athena scan . --format json\nathena check --max-findings all\nathena scan . --ai --budget 0.25', ''],
];

export function QuickstartPage() {
  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">CLI</span>
        <h1>Quick<span className="fx-muted">start</span></h1>
        <p>Install athena, run a first scan and turn on commit gating in a few minutes.</p>
      </section>

      <section className="panel stack" style={{ gap: 28 }}>
        {STEPS.map(([title, code, note]) => (
          <div className="stack" style={{ gap: 10 }} key={title}>
            <h2 style={{ fontSize: 20 }}>{title}</h2>
            <pre className="code">{code}</pre>
            {note ? <p>{note}</p> : null}
          </div>
        ))}
        <div className="row">
          <Link className="btn btn-solid" to="/scan">Open the web scanner</Link>
          <a className="btn" href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">npm page</a>
        </div>
      </section>
    </div>
  );
}
