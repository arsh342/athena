import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertsBanner } from '../components/AlertsBanner';
import { ConfirmButton } from '../components/ConfirmButton';
import { ScoreGauge } from '../components/ScoreGauge';
import { ScanTrend } from '../components/ScanTrend';
import { SeverityBadge } from '../components/SeverityBadge';
import { deleteScan, fetchScans } from '../services/api';
import { getDashboardEmptyState } from '../utils/dashboard';
import { formatProvenance } from '../utils/provenance';
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
  const { isEmpty } = getDashboardEmptyState(scans);

  return (
    <div className="page">
      <section className="page-head-row">
        <div className="page-head">
          <span className="kicker">Dashboard</span>
          <h1>Repository <span className="fx-muted">risk</span></h1>
        </div>
        <Link className="btn btn-solid" to="/scan">Run scan</Link>
      </section>

      <AlertsBanner />

      <section className="tiles" aria-label="Latest scan">
        <article className="tile">
          <ScoreGauge score={latest?.aiPercentage ?? 0} />
          <p className="meta" style={{ textAlign: 'center' }}>Latest scan: {latest?.repoName ?? 'no scan data'}</p>
        </article>
        <article className="tile">
          <span className="tile-label">Critical</span>
          <strong className="tile-value">{totals.critical}</strong>
          <p>Secrets and severe issues that need review now.</p>
        </article>
        <article className="tile">
          <span className="tile-label">High</span>
          <strong className="tile-value">{totals.high}</strong>
          <p>Vulnerabilities likely to block a commit.</p>
        </article>
        <article className="tile">
          <span className="tile-label">Flagged units</span>
          <strong className="tile-value">{totals.flagged}</strong>
          <p>Functions, methods and classes above the threshold.</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>AI share across your scans</h2>
          <span className="meta">hover to read each scan</span>
        </div>
        <ScanTrend scans={scans} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Recent scans</h2>
          <span className="meta">newest first</span>
        </div>
        {isEmpty ? (
          <div className="empty">No scans yet. Run your first scan.</div>
        ) : (
          <div className="list">
            {scans.map((scan) => (
              <div className="list-item" key={scan.scanId}>
                <Link to={`/reports/${scan.scanId}`} className="list-row">
                  <span>
                    <strong>{scan.repoName}</strong>
                    <small>{scan.createdAt}</small>
                  </span>
                  <span>{scan.filesScanned} files</span>
                  <span>{formatProvenance(scan)}</span>
                  <span>{scan.flaggedUnits} flagged</span>
                  <span className={`badge ${scan.status === 'COMPLETED' ? 'badge-ok' : scan.status === 'FAILED' ? 'badge-bad' : 'badge-warn'}`}>{scan.status}</span>
                </Link>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete forever"
                  onConfirm={async () => {
                    await deleteScan(scan.scanId);
                    setScans((current) => current.filter((x) => x.scanId !== scan.scanId));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="legend" aria-label="Severity key">
        <SeverityBadge severity="CRITICAL" />
        <SeverityBadge severity="HIGH" />
        <SeverityBadge severity="MEDIUM" />
        <SeverityBadge severity="LOW" />
      </section>
    </div>
  );
}
