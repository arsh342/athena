import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { background, shockwave } from 'asciify-engine/kit';
import { Terminal } from '../components/Terminal';
import { fetchLandingContent, fetchLandingTerminalLines } from '../services/api';
import type { LandingContent } from '../types';

const PRINCIPLES = [
  ['Offline first', 'The tree-sitter engine, taint tracking, secret detection, dependency intelligence and skills all run on your machine. Nothing is sent anywhere unless you turn AI on.'],
  ['Provenance, measured', 'Git history and a trained detector estimate how much of each file was machine-written, shown as a range with its uncertainty, never one confident number.'],
  ['Reachability, not noise', 'Findings come with the path from an entry point to the sink, what defends it, and the impact. Look-alikes that cannot be reached are marked for review instead of blocking you.'],
  ['Gates where you work', 'A pre-commit and pre-push gate, athena review for a diff, an MCP server for coding agents, and a Claude Code plugin. About a second on a typical commit.'],
  ['Your key, your cap', 'Optional AI verification uses your own provider key. You set the spend cap before anything runs, and the key is held in memory for one scan, never stored or logged.'],
  ['Honest about limits', 'Reports list what was not checked and why: skipped files, scanners that were missing, findings the AI did not reach because the cap was hit.'],
] as const;

const COSTS = [
  ['$0', 'offline scan, no key needed'],
  ['$0.25', 'default cap per AI run'],
  ['$1.00', 'default cap per day'],
  ['0', 'keys stored on our servers'],
] as const;

export function Landing() {
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [content, setContent] = useState<LandingContent | null>(null);
  const [tab, setTab] = useState(0);

  // Wind streaks the visitor can stir; a click sends one ring out. Faint, clear round the headline, still under reduced motion.
  useEffect(() => {
    if (!heroRef.current) return;
    const bg = background(heroRef.current, { preset: shockwave, ...(copyRef.current ? { clear: copyRef.current } : {}) });
    return () => bg.destroy();
  }, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchLandingTerminalLines(), fetchLandingContent()]).then(([l, c]) => {
      if (!active) return;
      setLines(l.status === 'fulfilled' ? l.value : []);
      setContent(c.status === 'fulfilled' ? c.value : null);
    });
    return () => { active = false; };
  }, []);

  const features = content?.features ?? [];
  const feat = features[Math.min(tab, Math.max(0, features.length - 1))];
  const integrations = content?.integrations ?? [];

  return (
    <>
      <section className="hero" ref={heroRef} aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy" ref={copyRef}>
            <p className="kicker">AI code provenance and security scanner</p>
            <h1 id="hero-title">Know what AI wrote before it ships.</h1>
            <p className="hero-sub">
              Athena reads your code the way a careful reviewer does: it maps entry points, traces untrusted input, estimates how much
              of each file was machine-written, and gates the commit. Offline by default.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-solid" to="/scan">Scan a repository</Link>
              <Link className="btn" to="/quickstart">Quickstart</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Analysis pipeline">
        <Terminal lines={lines} playback stepDelayMs={520} title="athena" promptText="pipeline complete. waiting for next commit" />
      </section>

      <section className="section" id="principles">
        <h2>Every check already decided. Skip to the real review.</h2>
        <ol className="principles">
          {PRINCIPLES.map(([title, body], i) => (
            <li className="principle" key={title}>
              <h3><span>{String(i + 1).padStart(3, '0')}</span>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className="tiles costs" aria-label="What the optional AI layer costs">
          {COSTS.map(([value, label]) => (
            <div className="tile" key={label}>
              <span className="tile-value">{value}</span>
              <span className="tile-label">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {features.length > 0 && feat ? (
        <section className="section" id="capabilities">
          <h2>What it does</h2>
          <div className="tabs">
            <div className="tab-list" role="tablist" aria-label="Capabilities">
              {features.map((f, i) => (
                <button key={f.num} role="tab" aria-selected={i === tab} onClick={() => setTab(i)}>
                  <span className="num">{f.num}</span>{f.tab}
                </button>
              ))}
            </div>
            <div className="panel tab-detail">
              <h3>{feat.title}</h3>
              <p>{feat.description}</p>
              <p className="meta">{feat.detail}</p>
              <Terminal lines={feat.terminalLines} title={feat.tab} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="section" id="install">
        <h2>Install it in a minute.</h2>
        <p style={{ maxWidth: '56ch' }}>Install athena globally, run a local scan, and gate commits. The quickstart goes from zero to a first report.</p>
        <div className="install"><span>$</span><code>npm install -g @arsh342/athena</code></div>
        <div className="hero-actions">
          <Link className="btn btn-solid" to="/quickstart">Quickstart</Link>
          <a className="btn" href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">View on npm</a>
        </div>
      </section>

      {integrations.length > 0 ? (
        <section className="section" id="integrations">
          <p className="kicker">Works with</p>
          <div className="tools">{integrations.map((tool, i) => <span key={`${tool}-${i}`}>{tool}</span>)}</div>
        </section>
      ) : null}
    </>
  );
}
