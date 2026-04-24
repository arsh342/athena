import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { InfraPipeline } from '../components/InfraPipeline';
import { Terminal } from '../components/Terminal';
import { fetchFindings, fetchLandingContent, fetchLandingTerminalLines } from '../services/api';
import type { Finding, LandingContent, LandingStat } from '../types';

/* ── Scramble-text effect hook ── */
function useScrambleText(text: string, speed = 40) {
  const [display, setDisplay] = useState('');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._';

  useEffect(() => {
    let frame = 0;
    const maxFrames = text.length * 3;
    const interval = setInterval(() => {
      frame++;
      const resolved = Math.floor((frame / maxFrames) * text.length);
      let result = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ' || text[i] === '.') {
          result += text[i];
        } else if (i < resolved) {
          result += text[i];
        } else {
          result += chars[Math.floor(Math.random() * chars.length)];
        }
      }
      setDisplay(result);
      if (frame >= maxFrames) {
        clearInterval(interval);
        setDisplay(text);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return display;
}

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
  const heroText = useScrambleText('DETECT. SCORE. SECURE.');
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
      <div className="br-dotted-canvas" aria-hidden="true" />

      {/* ═══ HERO ═══ */}
      <section className="br-hero" id="hero">
        <h1 className="br-hero-title" aria-label="Detect. Score. Secure.">
          {heroText}
        </h1>

        <div className="br-hero-diagram">
          <Terminal
            lines={heroPipelineLines}
            playback
            stepDelayMs={520}
            title="athena"
            promptText="pipeline complete. waiting for next commit"
          />
        </div>

        <p className="br-hero-sub">
          Athena is the deterministic analysis layer between
          your AI-generated code and your repository. 11-signal scoring.
          Pre-commit gating. Full operational control.
        </p>

        <Link className="br-cta-button" to="/scan" id="hero-cta-scan">
          <span className="br-cta-arrow">→</span>
          GET STARTED
        </Link>
      </section>

      {/* ═══ ANNOTATION DIVIDER ═══ */}
      <div className="br-divider">
        <span className="br-divider-line" />
      </div>

      {/* ═══ ABOUT / INFRASTRUCTURE SHOWCASE ═══ */}
      <section className="br-about-infra" id="about" ref={observeRef}>
        <div className="br-section-annotation">
          <span>// SECTION: ABOUT_SYS.INT</span>
          <span>002</span>
        </div>

        <div className="br-infra-grid">
          {/* Left — terminal pipeline render */}
          <div className="br-infra-render">
            <div className="br-infra-render-header">
              <span className="br-infra-render-label">RENDER: ANALYSIS_PIPELINE.OBJ</span>
              <span className="br-infra-live-badge">LIVE</span>
            </div>
            <div className="br-infra-render-canvas">
              <InfraPipeline />
            </div>
          </div>

          {/* Right — Manifest text */}
          <div className="br-infra-manifest">
            <div className="br-infra-manifest-header">
              <span>MANIFEST.MD</span>
              <span>V0.1.0</span>
            </div>

            <h2 className="br-infra-heading">
              Infrastructure built for<br />
              <em>raw intelligence</em>
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
          <span>// SECTION: CAPABILITIES</span>
          <span>003</span>
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
        <h2 className="br-route-title">INSTALL.</h2>
        <p className="br-route-body">
          Install athena globally, run local scan, and gate commits in minutes.
          Use quickstart to go from zero to first report.
        </p>
        <div className="br-install-command" aria-label="npm install command">
          <span>$</span>
          <code>npm install -g @arsh342/athena</code>
        </div>
        <div className="br-route-actions">
          <Link className="br-cta-button" to="/quickstart" id="route-cta-quickstart">
            <span className="br-cta-arrow">→</span>
            QUICKSTART
          </Link>
          <a
            className="br-route-secondary"
            href="https://www.npmjs.com/package/@arsh342/athena"
            target="_blank"
            rel="noopener noreferrer"
          >
            VIEW ON NPM
          </a>
        </div>
      </section>

      {/* ═══ INTEGRATIONS ═══ */}
      <section className="br-partners" id="integrations" ref={observeRef}>
        <div className="br-section-annotation">
          <span>// PARTNERS: TOOLCHAIN_ECOSYSTEM</span>
          <span>008</span>
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
            <strong>athena</strong>
            <span>(c) 2026 athena project.</span>
          </div>
          <div className="br-footer-links">
            <Link to="/privacy-policy">PRIVACY POLICY</Link>
            <Link to="/terms">TERMS</Link>
            <Link to="/sitemap">SITEMAP</Link>
            <a href="https://github.com/example/athena" target="_blank" rel="noopener noreferrer">GITHUB</a>
            <a href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
