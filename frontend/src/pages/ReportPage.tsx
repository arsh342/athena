import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ReportView } from '../components/ReportView';
import { ScoreGauge } from '../components/ScoreGauge';
import { fetchFindingsByScanId, fetchScan, fetchScans } from '../services/api';
import type { Finding, ScanSummary } from '../types';

export function ReportPage() {
  const { scanId = '' } = useParams();
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);

  useEffect(() => {
    let active = true;

    async function loadReport() {
      if (!scanId) {
        if (active) {
          setScan(null);
          setFindings([]);
        }
        return;
      }

      let resolvedScanId = scanId;
      if (scanId === 'latest') {
        const scans = await fetchScans();
        resolvedScanId = scans[0]?.scanId ?? '';
      }

      if (!resolvedScanId) {
        if (active) {
          setScan(null);
          setFindings([]);
        }
        return;
      }

      const [scanData, findingsData] = await Promise.all([
        fetchScan(resolvedScanId),
        fetchFindingsByScanId(resolvedScanId),
      ]);

      if (active) {
        setScan(scanData);
        setFindings(findingsData);
      }
    }

    loadReport().catch(() => {
      if (active) {
        setScan(null);
        setFindings([]);
      }
    });

    return () => {
      active = false;
    };
  }, [scanId]);

  return (
    <div className="page report-page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// SECTION: REPORT_HEADER</span>
          <span>001</span>
        </div>
        <span className="eyebrow">Report</span>
        <div>
          <h1>{scan?.repoName ?? 'Unknown repository'}</h1>
          <p>{scan?.repoUrl ?? 'No repository URL available'}</p>
        </div>
      </section>

      <section className="report-summary">
        <div className="br-section-annotation">
          <span>// SECTION: RISK_SUMMARY</span>
          <span>002</span>
        </div>
        <article className="panel">
          <ScoreGauge score={scan?.aiPercentage ?? 0} />
        </article>
        <article className="panel stat-panel">
          <span>Findings</span>
          <strong>{findings.length}</strong>
          <p>Classified from secret, ESLint, Semgrep, and hallucination checks.</p>
        </article>
        <article className="panel stat-panel">
          <span>Risk density</span>
          <strong>{scan?.riskDensity.findingsPer1kLoc ?? 0}</strong>
          <p>Findings per 1k lines of code.</p>
        </article>
        <article className="panel stat-panel">
          <span>Flagged ratio</span>
          <strong>{Math.round((scan?.riskDensity.flaggedRatio ?? 0) * 100)}%</strong>
          <p>Scored code units crossing threshold 65.</p>
        </article>
      </section>

      <ReportView findings={findings} />
    </div>
  );
}
