import { useId, useState, type PointerEvent } from 'react';
import type { ScanSummary } from '../types';

/** The AI share of your code across your scans, oldest to newest: a chart you can scrub. Real data from your scan history. */
export function ScanTrend({ scans }: { scans: ScanSummary[] }) {
  const uid = `st${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [hover, setHover] = useState(-1);
  const ordered = [...scans].reverse().slice(-14); // the API returns newest first
  const W = 560;
  const H = 150;
  const pad = 18;

  if (ordered.length < 2) {
    return <p className="empty" style={{ padding: '28px 0 8px' }}>Run at least two scans to see how the AI share of your code changes over time.</p>;
  }

  const values = ordered.map((s) => s.aiPercentage);
  const lo = 0;
  const hi = Math.max(...values, 5) * 1.35; // headroom, so equal values sit mid-chart instead of on the top edge
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (W - pad * 2), H - pad - ((v - lo) / span) * (H - pad * 2)] as [number, number]);
  let line = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) { line = `M${x.toFixed(1)},${y.toFixed(1)}`; return; }
    const [px, py] = pts[i - 1]!;
    const cx = (px + x) / 2;
    line += ` C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)},${H - pad} L${pts[0]![0].toFixed(1)},${H - pad} Z`;
  const i = hover >= 0 ? hover : pts.length - 1;
  const p = pts[i]!;
  const scan = ordered[i]!;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((q, k) => { if (Math.abs(q[0] - x) < Math.abs(pts[best]![0] - x)) best = k; });
    setHover(best);
  };
  const tipX = Math.min(Math.max(p[0], 80), W - 80);

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(-1)} role="img" aria-label="AI share of code across your scans">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--text)" stopOpacity=".14" />
          <stop offset="1" stopColor="var(--text)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H * g} y2={H * g} stroke="var(--line)" />)}
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke="var(--text)" strokeWidth="1.6" opacity=".9" />
      {hover >= 0 ? <line x1={p[0]} x2={p[0]} y1="8" y2={H - pad} stroke="var(--text)" strokeOpacity=".3" /> : null}
      <circle cx={p[0]} cy={p[1]} r="3.6" fill="var(--surface-2)" stroke="var(--text)" strokeWidth="1.6" />
      <g transform={`translate(${tipX},${p[1] < 36 ? p[1] + 24 : p[1] - 14})`}>
        <rect x="-74" y="-12" width="148" height="17" rx="4" fill="var(--text)" />
        <text x="0" y="0" textAnchor="middle" fontSize="9.5" fill="var(--inverse)" fontFamily="var(--font-mono)">{`${scan.repoName} · ${scan.aiPercentage}%`}</text>
      </g>
    </svg>
  );
}
