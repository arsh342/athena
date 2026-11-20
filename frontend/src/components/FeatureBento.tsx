import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * The features section: a hatched page and a bento of three live diagrams.
 *  1. Your changes flow through Athena into a stack of reports that keeps printing.
 *  2. The places Athena runs (CLI, git hooks, MCP, Claude Code), one lit at a time.
 *  3. A chart you can scrub: the AI-written share of a codebase, week by week.
 * The data in the diagrams is illustrative; the copy beside each one is what the product does.
 */

export interface FeatureCopy { title: string; description: string }

const COPY = {
  title: 'Review that reads\nlike a *person* did',
  review: { title: 'Review a change, not the repo', description: 'Staged, uncommitted or ranged changes go through the same analysis, and only what the change introduced can block the commit.' },
  reports: { title: 'Reports with the path to the sink', description: 'Each finding carries the route from an entry point to the dangerous call, what defends it, and what an attacker gains.' },
  places: { title: 'Runs where you work', description: 'A CLI, pre-commit and pre-push gates, an MCP server for coding agents, and a Claude Code plugin. One engine behind all of them.', tools: ['CLI', 'Git hooks', 'MCP', 'Plugin'] },
  trend: { title: 'Provenance over time', description: 'See how much of the code was machine-written, as a range with its uncertainty. Recorded history is a floor; the model is an estimate.', values: [14, 16, 15, 19, 22, 21, 27, 31, 30, 36, 41, 44], estimateFrom: 8 },
} as const;

/* ------------------------------------------------------------------ logic */

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function chartPaths(values: number[], w: number, h: number, pad: number) {
  const n = values.length;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [pad + (n < 2 ? 0 : (i / (n - 1)) * (w - pad * 2)), h - pad - ((v - lo) / span) * (h - pad * 2)] as [number, number]);
  let line = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) { line = `M${x.toFixed(1)},${y.toFixed(1)}`; return; }
    const [px, py] = pts[i - 1]!;
    const cx = (px + x) / 2;
    line += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = n ? `${line} L${pts[n - 1]![0].toFixed(1)},${h - pad} L${pts[0]![0].toFixed(1)},${h - pad} Z` : '';
  return { line, area, points: pts };
}

function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i += 1) if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
  return best;
}

/** "Review that reads\nlike a *person* did": `*word*` is set in the muted tone, `\n` breaks the line. */
function parseTitle(s: string): Array<Array<{ text: string; muted: boolean }>> {
  return s.split('\n').map((line) => {
    const out: Array<{ text: string; muted: boolean }> = [];
    line.split('*').forEach((text, i) => { if (text) out.push({ text, muted: i % 2 === 1 }); });
    return out;
  });
}

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver !== 'function') { setInView(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, threshold]);
  return [ref, inView] as const;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/* ----------------------------------------------------------------- pieces */

function Brackets() {
  return (
    <>
      <span className="fx-c fx-c-tl" aria-hidden="true" />
      <span className="fx-c fx-c-tr" aria-hidden="true" />
      <span className="fx-c fx-c-bl" aria-hidden="true" />
      <span className="fx-c fx-c-br" aria-hidden="true" />
    </>
  );
}

function Mark({ size = 18 }: { size?: number }) {
  // The brand glyph: a folded A.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 21h4.2l1.6-3.6h6.4l1.6 3.6H21zm0 7.4 2 4.4h-4z" fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-4 -6h5l3 3v9h-8z" />
      <path d="M-2 0h4M-2 3h4" />
    </g>
  );
}

function ToolGlyph({ index }: { index: number }) {
  const k = index % 4;
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {k === 0 && (<><rect x="-7" y="-6" width="14" height="12" rx="2" /><path d="m-3.5 -2 2.5 2-2.5 2M0 2.5h3.5" /></>)}
      {k === 1 && (<><circle cx="-4" cy="-4" r="1.8" /><circle cx="-4" cy="4" r="1.8" /><circle cx="4" cy="0" r="1.8" /><path d="M-4 -2.2v4.4M-2.4 -3.4c3 0 4.4 1 5 2.6" /></>)}
      {k === 2 && (<><circle cx="0" cy="0" r="2" /><circle cx="-6" cy="-5" r="1.5" /><circle cx="6" cy="-5" r="1.5" /><circle cx="0" cy="6" r="1.5" /><path d="m-1.6 -1.2-3 -2.6M1.6 -1.2l3 -2.6M0 2v2.6" /></>)}
      {k === 3 && (<><path d="M-5 -6h10v12h-10z" /><path d="M-2 -2h4M-2 1.5h4" /><path d="M5 -3h2M5 2h2" /></>)}
    </g>
  );
}

const FILES = [
  { x: 58, y: 38, name: 'auth.ts · about 72% AI' },
  { x: 104, y: 22, name: 'billing.py · human' },
  { x: 150, y: 40, name: 'routes.go · about 40% AI' },
  { x: 46, y: 92, name: 'schema.sql · human' },
  { x: 146, y: 114, name: 'build.sh · unchecked' },
];

function FlowCard({ uid, reduced, inView }: { uid: string; reduced: boolean; inView: boolean }) {
  const [reports, setReports] = useState(128);
  const [side, setSide] = useState<'' | 'left' | 'right'>('');
  useEffect(() => {
    if (reduced || !inView) return;
    const t = setInterval(() => setReports((n) => n + 1), 2800);
    return () => clearInterval(t);
  }, [reduced, inView]);

  const L1 = 'M117,67 C196,67 210,100 262,100';
  const L2 = 'M117,73 C186,73 206,120 262,120';
  const R1 = 'M378,100 C412,100 418,86 450,86';
  const R2 = 'M378,120 C412,120 418,134 450,134';
  const glow = `${uid}glow`;

  return (
    <div className="fx-frame fx-frame-hover fx-wide">
      <Brackets />
      <div className="fx-card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg className="fx-diagram" viewBox="0 0 640 178" role="img" aria-label="Changed files flow through Athena into finished review reports">
          <defs>
            <radialGradient id={glow} cx="320" cy="110" r="190" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--surface-2)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--surface-2)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="640" height="178" fill={`url(#${glow})`} />

          <g onMouseEnter={() => setSide('left')} onMouseLeave={() => setSide('')}>
            <rect x="20" y="8" width="170" height="130" fill="transparent" />
            {FILES.map((m, i) => <line key={`l${i}`} x1={m.x} y1={m.y} x2="104" y2="70" stroke="var(--line-strong)" strokeDasharray="2 3" />)}
            <g transform="translate(91,57)">
              <rect width="26" height="26" rx="5" className="fx-node" />
              <g transform="translate(5,5)" style={{ color: 'var(--text)' }}><Mark size={16} /></g>
            </g>
            {FILES.map((m, i) => (
              <g key={i} className="fx-av" tabIndex={0} role="img" aria-label={m.name}>
                <rect x={m.x - 11} y={m.y - 11} width="22" height="22" rx="6" className="fx-node" />
                <g transform={`translate(${m.x},${m.y})`} style={{ color: 'var(--text)' }}><FileGlyph /></g>
                <circle cx={m.x + 9} cy={m.y + 9} r="2.8" fill={i === 1 || i === 3 ? 'var(--bg)' : 'var(--text)'} stroke="var(--text)" strokeWidth="1" className={i === 4 ? undefined : 'fx-presence'} />
                <g className="fx-av-tip" transform={`translate(${m.x},${m.y - 18})`}>
                  <rect x={-m.name.length * 2.45 - 6} y="-9" width={m.name.length * 4.9 + 12} height="14" rx="3" fill="var(--text)" />
                  <text x="0" y="1" textAnchor="middle" fontSize="7.5" fill="var(--inverse)" fontFamily="var(--font-sans)">{m.name}</text>
                </g>
              </g>
            ))}
          </g>

          {[L1, L2].map((d, i) => <path key={d} d={d} className={`fx-flow${side === 'left' ? ' fx-flow-on' : ''}${i ? ' fx-dash' : ''}`} />)}
          {[R1, R2].map((d, i) => <path key={d} d={d} className={`fx-flow${side === 'right' ? ' fx-flow-on' : ''}${i ? ' fx-dash' : ''}`} />)}
          {!reduced && [L1, L2, R1, R2].map((d, i) => (
            <circle key={`p${i}`} r="2.2" className="fx-pkt">
              <animateMotion dur={`${2.2 + (i % 2) * 0.6}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" path={d} />
            </circle>
          ))}

          <g transform="translate(262,88)">
            <rect x="-4" y="-4" width="124" height="52" rx="8" fill="none" stroke="var(--line)" className={reduced ? undefined : 'fx-glow'} />
            <rect width="116" height="44" rx="6" className="fx-node" />
            <g transform="translate(13,14)" style={{ color: 'var(--text)' }}><Mark size={16} /></g>
            <text x="36" y="26" fontSize="8.5" letterSpacing="1.4" fontWeight="600" fill="var(--text-2)" fontFamily="var(--font-sans)">ATHENA</text>
            <path d="M100 18l4 4-4 4" fill="none" stroke="var(--text-3)" strokeWidth="1.3" />
          </g>

          <g onMouseEnter={() => setSide('right')} onMouseLeave={() => setSide('')}>
            {[2, 1, 0].map((k) => (
              <g key={reports - k} transform={`translate(${450 + k * 12},${40 - k * 10})`} opacity={1 - k * 0.25}>
                <g className={`fx-sheet${k === 0 ? ' fx-sheet-new' : ''}`}>
                  <rect width="138" height="102" rx="4" fill="var(--surface-2)" stroke="var(--line-strong)" />
                  {k === 0 ? (
                    <>
                      <text x="10" y="16" fontSize="7" fill="var(--text-3)" fontFamily="var(--font-mono)">{`REVIEW #${reports}`}</text>
                      <rect x="10" y="24" width="64" height="5" rx="1" fill="var(--text)" opacity=".75" />
                      <rect x="10" y="33" width="92" height="3" rx="1" fill="var(--line-strong)" />
                      <rect x="10" y="39" width="80" height="3" rx="1" fill="var(--line-strong)" />
                      {[18, 26, 14, 30, 22, 34].map((h, j) => <rect key={j} x={12 + j * 13} y={92 - h} width="8" height={h} fill="var(--text)" opacity={0.25 + j * 0.12} />)}
                      <path d="M92 64h34M92 72h28M92 80h32" stroke="var(--line-strong)" strokeWidth="2.5" />
                    </>
                  ) : null}
                </g>
              </g>
            ))}
          </g>
        </svg>
        <div className="fx-wide-copy" style={{ padding: '0 22px 20px' }}>
          <div><h3>{COPY.review.title}</h3><p>{COPY.review.description}</p></div>
          <div><h3>{COPY.reports.title}</h3><p>{COPY.reports.description}</p></div>
        </div>
      </div>
    </div>
  );
}

function PlacesCard({ reduced }: { reduced: boolean }) {
  const [hover, setHover] = useState(-1);
  const [auto, setAuto] = useState(0);
  useEffect(() => {
    if (reduced || hover >= 0) return;
    const t = setInterval(() => setAuto((a) => (a + 1) % 4), 1700);
    return () => clearInterval(t);
  }, [reduced, hover]);
  const on = hover >= 0 ? hover : reduced ? -1 : auto;
  const tiles = [{ x: 66, y: 34 }, { x: 66, y: 116 }, { x: 234, y: 34 }, { x: 234, y: 116 }];
  const path = (i: number) => {
    const t = tiles[i]!;
    const dir = t.x < 150 ? -1 : 1;
    return `M${150 + dir * 17},75 H${150 + dir * 42} V${t.y} H${t.x - dir * 15}`;
  };
  const tools = COPY.places.tools;
  return (
    <div className="fx-frame fx-frame-hover">
      <Brackets />
      <div className="fx-card">
        <svg className="fx-diagram" viewBox="0 0 300 150" role="group" aria-label="Where Athena runs">
          {tiles.map((_, i) => <path key={i} d={path(i)} className={`fx-flow${on === i ? ' fx-flow-on' : ''}`} />)}
          {!reduced && on >= 0 ? (
            <circle key={on} r="2.2" className="fx-pkt"><animateMotion dur="1.1s" repeatCount="indefinite" path={path(on)} /></circle>
          ) : null}
          <g transform="translate(133,58)">
            <rect width="34" height="34" rx="7" className="fx-node" />
            <g transform="translate(8,8)" style={{ color: 'var(--text)' }}><Mark size={18} /></g>
          </g>
          {tiles.map((t, i) => (
            <g
              key={i}
              className={`fx-tool${on === i ? ' fx-tool-on' : ''}`}
              tabIndex={0}
              role="img"
              aria-label={tools[i]}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(-1)}
            >
              <rect x={t.x - 15} y={t.y - 15} width="30" height="30" rx="7" className="fx-node" />
              <g transform={`translate(${t.x},${t.y})`} style={{ color: 'var(--text)' }}><ToolGlyph index={i} /></g>
              <text x={t.x} y={t.y + (t.y < 75 ? -21 : 28)} textAnchor="middle" fontSize="8" fill="var(--text-2)" fontFamily="var(--font-sans)" opacity={on === i ? 1 : 0} style={{ transition: 'opacity .25s' }}>{tools[i]}</text>
            </g>
          ))}
          <text x="150" y="112" textAnchor="middle" fontSize="7" fill="var(--text-3)" fontFamily="var(--font-mono)">
            {on >= 0 ? `running · ${tools[on]!.toLowerCase()}` : '4 surfaces'}
          </text>
        </svg>
        <div style={{ marginTop: 'auto' }}>
          <h3>{COPY.places.title}</h3>
          <p>{COPY.places.description}</p>
        </div>
      </div>
    </div>
  );
}

function TrendCard({ uid, reduced }: { uid: string; reduced: boolean }) {
  const [ref, inView] = useInView(0.3);
  const [hover, setHover] = useState(-1);
  const W = 300;
  const H = 130;
  const vals = [...COPY.trend.values];
  const { line, area, points } = chartPaths(vals, W, H, 14);
  const split = clamp(COPY.trend.estimateFrom, 1, vals.length - 1);
  const fill = `${uid}area`;
  const last = points[points.length - 1]!;
  const i = hover >= 0 ? hover : points.length - 1;
  const p = points[i]!;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(points.map((q) => q[0]), ((e.clientX - r.left) / r.width) * W));
  };
  return (
    <div className="fx-frame fx-frame-hover" ref={ref as never} data-in={inView}>
      <Brackets />
      <div className="fx-card">
        <svg className="fx-diagram fx-chart" viewBox={`0 0 ${W} ${H + 6}`} onPointerMove={onMove} onPointerLeave={() => setHover(-1)} role="img" aria-label={`${COPY.trend.title}, illustrative chart`}>
          <defs>
            <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--text)" stopOpacity=".12" />
              <stop offset="1" stopColor="var(--text)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="14" x2={W - 14} y1={H * g} y2={H * g} stroke="var(--line)" />)}
          <path d={area} fill={`url(#${fill})`} />
          <path d={line} fill="none" stroke="var(--text)" strokeWidth="1.4" pathLength={1} className="fx-line-draw" opacity=".85" />
          <line x1={points[split]![0]} x2={points[split]![0]} y1="10" y2={H - 14} stroke="var(--line-strong)" strokeDasharray="2 3" />
          <text x={points[split]![0] - 4} y={H - 18} textAnchor="end" fontSize="7" fill="var(--text-3)" fontFamily="var(--font-mono)">ESTIMATED</text>
          {hover >= 0 ? <line x1={p[0]} x2={p[0]} y1="8" y2={H - 14} stroke="var(--text)" strokeOpacity=".35" /> : null}
          {!reduced && hover < 0 ? <circle cx={last[0]} cy={last[1]} r="7" fill="var(--text)" opacity=".15" className="fx-glow" /> : null}
          <circle cx={p[0]} cy={p[1]} r="3.2" fill="var(--surface-2)" stroke="var(--text)" strokeWidth="1.5" />
          <g transform={`translate(${clamp(p[0], 40, W - 40)},${p[1] < 34 ? p[1] + 22 : p[1] - 12})`}>
            <rect x="-34" y="-11" width="68" height="15" rx="3" fill="var(--text)" />
            <text x="0" y="-1" textAnchor="middle" fontSize="7.5" fill="var(--inverse)" fontFamily="var(--font-mono)">{`${i >= split ? 'est ' : 'rec '}wk ${i + 1} · ${vals[i]}%`}</text>
          </g>
        </svg>
        <div style={{ marginTop: 'auto' }}>
          <h3>{COPY.trend.title}</h3>
          <p>{COPY.trend.description}</p>
        </div>
      </div>
    </div>
  );
}

function Title({ text }: { text: string }): ReactNode {
  return (
    <h2 className="fx-h2">
      {parseTitle(text).map((line, i) => (
        <span key={i}>{line.map((run, j) => (run.muted ? <span key={j} className="fx-muted">{run.text}</span> : run.text))}</span>
      ))}
    </h2>
  );
}

export function FeatureBento() {
  const uid = `fx${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduced = useReducedMotion();
  const [ref, inView] = useInView(0.12);
  return (
    <div className="fx-root" id="features">
      <div className="fx-shell">
        <section className="fx-sec" aria-labelledby={`${uid}t`}>
          <div className="fx-reveal" ref={ref as never} data-in={inView}>
            <div className="fx-head" id={`${uid}t`}>
              <Title text={COPY.title} />
            </div>
            <div className="fx-bento">
              <FlowCard uid={uid} reduced={reduced} inView={inView} />
              <PlacesCard reduced={reduced} />
              <TrendCard uid={uid} reduced={reduced} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
