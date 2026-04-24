import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScoreGauge } from '../components/ScoreGauge';
import { SeverityBadge } from '../components/SeverityBadge';
import { fetchScans } from '../services/api';
import type { ScanSummary } from '../types';

export function Dashboard() {
  const [scans, setScans] = useState<ScanSummary[]>([]);

  useEffect(() => {
    let active = true;
    fetchScans()
      .then((data) => {
        if (active) setScans(data);
      })
      .catch(() => {
        if (active) setScans([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const latest = scans[0];
  const totals = useMemo(() => scans.reduce(
    (acc, scan) => ({
      critical: acc.critical + scan.findings.CRITICAL,
      high: acc.high + scan.findings.HIGH,
      flagged: acc.flagged + scan.flaggedUnits,
    }),
    { critical: 0, high: 0, flagged: 0 },
  ), [scans]);

  return (
    <div className="page dashboard-page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// SECTION: DASHBOARD_OVERVIEW</span>
          <span>001</span>
        </div>
        <span className="eyebrow">Dashboard</span>
        <div>
          <h1>Repository risk telemetry</h1>
          <Link className="button button-primary" to="/scan">Run scan</Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="br-section-annotation">
          <span>// SECTION: RISK_METRICS</span>
          <span>002</span>
        </div>
        <article className="panel gauge-panel">
          <ScoreGauge score={latest?.aiPercentage ?? 0} />
          <p>Latest scan: {latest?.repoName ?? 'No scan data'}</p>
        </article>
        <article className="panel stat-panel">
          <span>Critical</span>
          <strong>{totals.critical}</strong>
          <p>Secrets and severe issues requiring immediate review.</p>
        </article>
        <article className="panel stat-panel">
          <span>High</span>
          <strong>{totals.high}</strong>
          <p>AI-linked vulnerabilities likely to block a commit.</p>
        </article>
        <article className="panel stat-panel">
          <span>Flagged units</span>
          <strong>{totals.flagged}</strong>
          <p>Functions, methods, classes, and arrow functions above threshold.</p>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="br-section-annotation">
          <span>// SECTION: SCAN_HISTORY</span>
          <span>003</span>
        </div>
        <div className="panel-title">
          <h2>Recent scans</h2>
          <span>trend + history</span>
        </div>
        <div className="scan-table">
          {scans.map((scan) => (
            <Link to={`/reports/${scan.scanId}`} className="scan-row" key={scan.scanId}>
              <span>
                <strong>{scan.repoName}</strong>
                <small>{scan.createdAt}</small>
              </span>
              <span>{scan.filesScanned} files</span>
              <span>{scan.aiPercentage}% AI</span>
              <span>{scan.flaggedUnits} flagged</span>
              <span className={`status status-${scan.status.toLowerCase()}`}>{scan.status}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="severity-row">
        <div className="br-section-annotation">
          <span>// SECTION: SEVERITY_LEGEND</span>
          <span>004</span>
        </div>
        <SeverityBadge severity="CRITICAL" />
        <SeverityBadge severity="HIGH" />
        <SeverityBadge severity="MEDIUM" />
        <SeverityBadge severity="LOW" />
      </section>
    </div>
  );
}
