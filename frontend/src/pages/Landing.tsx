import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { InfraPipeline } from '../components/InfraPipeline';
import { Terminal } from '../components/Terminal';
import { fetchFindings, fetchLandingContent, fetchLandingTerminalLines } from '../services/api';
import type { Finding, LandingContent, LandingStat } from '../types';

const DECISIONS = [
  { num: '001', title: 'Offline first', body: 'The tree-sitter engine, taint tracking, secret detection, dependency intelligence and skills all run on your machine. Nothing is sent anywhere unless you turn AI on.' },
  { num: '002', title: 'Provenance, measured', body: 'An 11-signal score and git history estimate how much of each file was machine-written, shown as a range with its uncertainty, never a single confident number.' },
  { num: '003', title: 'Reachability, not noise', body: 'Findings come with the path from an entry point to the sink, what defends it, and the impact. Look-alikes that cannot be reached are marked for review instead of blocking you.' },
  { num: '004', title: 'Gates where you work', body: 'A pre-commit and pre-push gate, athena review for a diff, an MCP server for coding agents, and a Claude Code plugin. One second on a typical commit.' },
  { num: '005', title: 'Your key, your cap', body: 'Optional AI verification uses your own provider key (Anthropic, OpenAI, Google, OpenRouter and more). You set the spend cap before anything runs, the key is held in memory for one scan and never stored or logged.' },
  { num: '006', title: 'Honest about limits', body: 'Reports list what was not checked and why: skipped files, scanners that were missing, findings the AI did not get to because the cap was reached.' },
] as const;

/* ── Counter animation hook ── */
function useCountUp(end: number, duration = 2000) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const start = performance.now();
        function tick(now: number) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          setValue(Math.floor(progress * end));
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);

  return { value, ref };
}

/* ── Uptime counter ── */
function useUptime() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const baseDate = new Date('2025-04-18T00:00:00Z');
    function update() {
      const now = new Date();
      const diff = now.getTime() - baseDate.getTime();
      const days = Math.floor(diff / 86400000);
      const hrs = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTime(`${days}d ${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatStat(stat: LandingStat): string {
  return `${stat.value}${stat.suffix}`;
}

function LandingStatCell({ stat }: { stat: LandingStat }) {
  const counter = useCountUp(stat.value, 1800);
  return (
    <div className="br-stat-cell" ref={counter.ref}>
      <strong>{counter.value}{stat.suffix}</strong>
      <span>{stat.label}</span>
    </div>
  );
}

/**
 * Landing page — Brutalist engineering-grade aesthetic.
 * Light warm background, pixel-style mono typography, orange accents,
 * hub-spoke diagram, bento features, infrastructure showcase.
 */
export function Landing() {
  const [activeTab, setActiveTab] = useState(0);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [heroPipelineLines, setHeroPipelineLines] = useState<string[]>([]);
  const [landingContent, setLandingContent] = useState<LandingContent | null>(null);

  const features = landingContent?.features ?? [];
  const integrations = landingContent?.integrations ?? [];
  const stats = landingContent?.stats ?? [];
  const feat = features[activeTab];
    const uptime = useUptime();

  useEffect(() => {
    let active = true;

    Promise.allSettled([fetchFindings(), fetchLandingTerminalLines(), fetchLandingContent()])
      .then(([findingsResult, linesResult, contentResult]) => {
        if (!active) return;

        setFindings(findingsResult.status === 'fulfilled' ? findingsResult.value : []);
        setHeroPipelineLines(linesResult.status === 'fulfilled' ? linesResult.value : []);
        setLandingContent(contentResult.status === 'fulfilled' ? contentResult.value : null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (features.length === 0) return;
    if (activeTab >= features.length) {
      setActiveTab(0);
    }
  }, [activeTab, features.length]);

  /* Scroll-triggered fade-in */
  const observeRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
  }, []);

  return (
    <div className="landing brutalist">
      {/* ═══ HERO ═══ */}
      <section className="br-hero" id="hero">
        <p className="br-hero-kicker">AI code provenance and security scanner for repositories.</p>
        <h1 className="br-hero-title">Know what AI wrote before it ships.</h1>
        <p className="br-hero-sub">
          Athena reads your code the way a careful reviewer does: it maps entry points, traces untrusted input,
          scores how likely each unit is machine-written, and gates the commit. Offline by default. An optional AI check
          runs on your own key, under a spend cap you set.
        </p>
        <div className="br-hero-actions">
          <Link className="br-cta-button" to="/scan" id="hero-cta-scan">
            <span className="br-cta-arrow">→</span>
            <span className="br-cta-text">Scan a repository</span>
          </Link>
          <Link className="br-route-secondary" to="/quickstart" style={{ padding: '14px 20px', fontSize: 13 }}>Quickstart</Link>
        </div>
        <div className="br-hero-diagram" style={{ marginTop: 48 }}>
          <Terminal
            lines={heroPipelineLines}
            playback
            stepDelayMs={520}
            title="athena"
            promptText="pipeline complete. waiting for next commit"
            promptSymbol="#"
          />
        </div>
      </section>

      {/* ═══ DECISIONS ═══ */}
      <section className="ed-section" id="decisions" ref={observeRef}>
        <h2 className="ed-lede">Every check already decided. Skip to the real review.</h2>
        <ol className="ed-list">
          {DECISIONS.map((d) => (
            <li className="ed-item" key={d.num}>
              <h3><span>{d.num} /</span>{d.title}</h3>
              <p>{d.body}</p>
            </li>
          ))}
        </ol>
        <div className="ed-cost" aria-label="What the optional AI layer costs">
          <div><strong>$0</strong>offline scan, no key needed</div>
          <div><strong>$0.25</strong>default cap per AI run</div>
          <div><strong>$1.00</strong>default cap per day</div>
          <div><strong>0</strong>keys stored on our servers</div>
        </div>
      </section>

      {/* ═══ ANNOTATION DIVIDER ═══ */}
      <div className="br-divider">
        <span className="br-divider-line" />
      </div>

      {/* ═══ ABOUT / INFRASTRUCTURE SHOWCASE ═══ */}
      <section className="br-about-infra" id="about" ref={observeRef}>
        <div className="br-section-annotation">
          <span>002 / How it works</span>
          <span />
        </div>

        <div className="br-infra-grid">
          {/* Left — terminal pipeline render */}
          <div className="br-infra-render">
            <div className="br-infra-render-header">
              <span className="br-infra-render-label">analysis pipeline</span>
              <span className="br-infra-live-badge">live</span>
            </div>
            <div className="br-infra-render-canvas">
              <InfraPipeline />
            </div>
          </div>

          {/* Right — Manifest text */}
          <div className="br-infra-manifest">
            <div className="br-infra-manifest-header">
              <span>Manifest</span>
              <span>v0.1.0</span>
            </div>

            <h2 className="br-infra-heading">
              The analysis layer between your AI tools and your repository.
            </h2>
            <p className="br-infra-body">
              We engineer the analysis layer that sits between your AI tools and your repository.
              No abstractions. No magic. Just deterministic scoring, sub-2s analysis,
              and transparent operational control across every code unit in the project.
            </p>
            <p className="br-infra-body">
              Built by engineers who spent years fighting invisible AI-generated bugs.
              We believe code provenance should be inspectable, auditable, and brutally fast.
            </p>

            <div className="br-infra-uptime-bar">
              <span className="br-infra-uptime-dot" />
              <span className="br-infra-uptime-label">UPTIME:</span>
              <span className="br-infra-uptime-value">{uptime}</span>
            </div>

            {/* Stats grid */}
            <div className="br-infra-stats-grid">
              {stats.slice(0, 4).map((stat) => (
                <div className="br-infra-stat-cell" key={`infra-${stat.label}`}>
                  <span className="br-infra-stat-label">{stat.label.toUpperCase().replace(/\s+/g, '_')}</span>
                  <strong className="br-infra-stat-value">{formatStat(stat)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS BAR ═══ */}
      <section className="br-stats" ref={observeRef}>
        {stats.map((stat) => (
          <LandingStatCell key={stat.label} stat={stat} />
        ))}
      </section>

      {/* ═══ FEATURES (BENTO) ═══ */}
      <section className="br-features" id="features" ref={observeRef}>
        <div className="br-section-annotation">
          <span>003 / Capabilities</span>
          <span />
        </div>

        <div className="br-bento">
          {/* Left — tabs */}
          <div className="br-bento-tabs">
            {features.map((f, i) => (
              <button
                key={f.num}
                className={`br-bento-tab ${i === activeTab ? 'active' : ''}`}
                onClick={() => setActiveTab(i)}
                id={`feature-tab-${i}`}
              >
                <span className="br-tab-num">{f.num}</span>
                {f.tab}
              </button>
            ))}
          </div>

          {/* Center — terminal demo */}
          <div className="br-bento-terminal">
            <Terminal
              lines={feat?.terminalLines ?? []}
            />
          </div>

          {/* Right — detail */}
          <div className="br-bento-detail">
            <span className="br-detail-num">{feat?.num ?? '--'}</span>
            <h3>{feat?.title ?? 'Loading capability'}</h3>
            <p>{feat?.description ?? 'Fetching backend capability profile.'}</p>
            <div className="br-detail-note">{feat?.detail ?? 'Awaiting content feed.'}</div>
          </div>
        </div>

        {/* Findings preview row — only shown when real scan data exists */}
        {findings.length > 0 && (
          <div className="br-findings-row">
            {findings.slice(0, 3).map((f) => (
              <div className="br-finding-card" key={f.id}>
                <div className="br-finding-head">
                  <span className={`br-finding-sev br-finding-sev--${f.severity.toLowerCase()}`}>
                    {f.severity}
                  </span>
                  <span className="br-finding-type">{f.type}</span>
                </div>
                <div className="br-finding-file">{f.file}:{f.line}</div>
                <div className="br-finding-msg">{f.message}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ INSTALL CTA ═══ */}
      <section className="br-route-cta" ref={observeRef}>
        <h2 className="br-route-title">Install it in a minute.</h2>
        <p className="br-route-body">
          Install athena globally, run local scan, and gate commits in minutes.
          Use quickstart to go from zero to first report.
        </p>
        <div className="br-install-command-container">
          <div className="br-install-command" aria-label="npm install command">
            <span>$</span>
            <code>npm install -g @arsh342/athena</code>
          </div>
        </div>
        <div className="br-route-actions">
          <Link className="br-cta-button" to="/quickstart" id="route-cta-quickstart">
            <span className="br-cta-arrow">→</span>
            <span className="br-cta-text">Quickstart</span>
          </Link>
          <a
            className="br-route-secondary"
            href="https://www.npmjs.com/package/@arsh342/athena"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on npm
          </a>
        </div>
      </section>

      {/* ═══ INTEGRATIONS ═══ */}
      <section className="br-partners" id="integrations" ref={observeRef}>
        <div className="br-section-annotation">
          <span>004 / Works with</span>
          <span />
        </div>

        <div className="br-partners-grid">
          {integrations.map((tool, i) => (
            <div className="br-partner-cell" key={`${tool}-${i}`}>
              {tool.toUpperCase()}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="br-footer">
        <div className="br-footer-inner">
          <div className="br-footer-brand">
            <strong className="logo-font">athena</strong>
            <span>(c) 2026 athena project.</span>
          </div>
          <div className="br-footer-links">
            <Link to="/privacy-policy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/sitemap">Sitemap</Link>
            <a href="https://github.com/arsh342/athena" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">npm</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
