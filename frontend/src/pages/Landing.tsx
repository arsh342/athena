import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { background, shockwave } from 'asciify-engine/kit';
import { Advantages } from '../components/Advantages';
import { FeatureBento } from '../components/FeatureBento';

const PRINCIPLES = [
  { title: 'Offline first', body: 'The tree-sitter engine, taint tracking, secret detection, dependency intelligence and skills all run on your machine. Nothing is sent anywhere unless you turn AI on.' },
  { title: 'Provenance, measured', body: 'Git history and a trained detector estimate how much of each file was machine-written, shown as a range with its uncertainty, never one confident number.' },
  { title: 'Reachability, not noise', body: 'Findings come with the path from an entry point to the sink, what defends it, and the impact. Look-alikes that cannot be reached are marked for review instead of blocking you.' },
  { title: 'Gates where you work', body: 'A pre-commit and pre-push gate, athena review for a diff, an MCP server for coding agents, and a Claude Code plugin. About a second on a typical commit.' },
  { title: 'The CLI for bigger jobs', body: 'The web scanner handles smaller projects. For larger repositories, AI verification with your own key, or fully offline use, install the command-line tool: your code never leaves your machine.' },
  { title: 'Honest about limits', body: 'Reports list what was not checked and why: skipped files, scanners that were missing, findings the AI did not reach because the cap was hit.' },
] as const;

export function Landing() {
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  // Wind streaks the visitor can stir; a click sends one ring out. Faint, clear round the headline, still under reduced motion.
  useEffect(() => {
    if (!heroRef.current) return;
    const bg = background(heroRef.current, { preset: shockwave, ...(copyRef.current ? { clear: copyRef.current } : {}) });
    return () => bg.destroy();
  }, []);



  return (
    <>
      <section className="hero" ref={heroRef} aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy" ref={copyRef}>
            <p className="kicker">Security review for AI-assisted code</p>
            <h1 id="hero-title">Ship AI-written code you have actually checked.</h1>
            <p className="hero-sub">
              Athena traces untrusted input to the dangerous call, estimates how much of each file a model wrote, and stops the risky
              commit before it lands. It runs on your machine, with no account and no key.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-solid" to="/scan">Scan a repository</Link>
              <Link className="btn" to="/quickstart">Quickstart</Link>
            </div>
          </div>
        </div>
      </section>

      <Advantages
        badge="How it works"
        title="Every check already decided. Skip to the real review."
        lede="Athena runs the checks a careful reviewer would, so your time goes to the findings that matter."
        items={PRINCIPLES}
      />

      <FeatureBento />

      <section className="section" id="install">
        <h2>Install it in a minute.</h2>
        <p style={{ maxWidth: '56ch' }}>Install athena globally, run a local scan, and gate commits. The quickstart goes from zero to a first report.</p>
        <div className="install"><span>$</span><code>npm i -g @arsh342/athena@latest</code></div>
        <div className="hero-actions">
          <Link className="btn btn-solid" to="/quickstart">Quickstart</Link>
          <a className="btn" href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">View on npm</a>
        </div>
      </section>

    </>
  );
}
