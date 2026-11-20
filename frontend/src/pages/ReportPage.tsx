import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ReportView } from '../components/ReportView';
import { ScoreGauge } from '../components/ScoreGauge';
import { downloadReportPdf, fetchFindingsByScanId, fetchReportMarkdown, fetchScan, fetchScans } from '../services/api';
import { coverageGaps, coverageLabel, formatProvenance } from '../utils/provenance';
import type { Finding, ScanSummary } from '../types';

export function ReportPage() {
  const { scanId = '' } = useParams();
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [markdown, setMarkdown] = useState('');
  const [resolvedId, setResolvedId] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const markdownHtml = useMemo(() => {
    const rendered = marked.parse(markdown ?? '') as string;
    return DOMPurify.sanitize(rendered);
  }, [markdown]);

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
          setMarkdown('');
          setResolvedId('');
        }
        return;
      }

      setResolvedId(resolvedScanId);

      const [scanData, findingsData, markdownData] = await Promise.all([
        fetchScan(resolvedScanId),
        fetchFindingsByScanId(resolvedScanId),
        fetchReportMarkdown(resolvedScanId).catch(() => ''),
      ]);

      if (active) {
        setScan(scanData);
        setFindings(findingsData);
        setMarkdown(markdownData ?? '');
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
    <div className="page">
      <section className="page-head-row">
        <div className="page-head">
          <span className="kicker">Report</span>
          <h1>{scan?.repoName ?? 'Unknown repository'}</h1>
          <p className="meta">{scan?.repoUrl ?? 'No repository URL available'}</p>
        </div>
        <div className="stack" style={{ justifyItems: 'end' }}>
          <button
            type="button"
            className="btn btn-solid"
            disabled={!resolvedId || pdfLoading}
            onClick={async () => {
              if (!resolvedId) return;
              setPdfLoading(true);
              setPdfError('');
              try {
                const blob = await downloadReportPdf(resolvedId);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${resolvedId}.pdf`;
                link.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                setPdfError(error instanceof Error ? error.message : 'PDF download failed.');
              } finally {
                setPdfLoading(false);
              }
            }}
          >
            {pdfLoading ? 'Generating…' : 'Download PDF'}
          </button>
          {pdfError ? <span className="field-error" role="alert">{pdfError}</span> : null}
        </div>
      </section>

      <section className="tiles tiles-3" aria-label="Summary">
        <article className="tile">
          <span className="tile-label">Provenance</span>
          <ScoreGauge score={scan?.aiPercentage ?? 0} />
          {scan ? <p className="meta" style={{ textAlign: 'center' }}>{formatProvenance(scan)}</p> : null}
        </article>
        <article className="tile">
          <span className="tile-label">Findings</span>
          <strong className="tile-value">{findings.length}</strong>
          <div className="tile-chips">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => {
              const n = findings.filter((f) => f.severity === sev).length;
              return n ? <span key={sev} className={`badge badge-${sev.toLowerCase()}`}>{n} {sev.toLowerCase()}</span> : null;
            })}
          </div>
          <p>From Athena's rules, taint, secrets and dependency checks.</p>
        </article>
        <article className="tile">
          <span className="tile-label">Coverage</span>
          <strong className="tile-value small">{scan ? coverageLabel(scan) : 'Not recorded'}</strong>
          {scan ? coverageGaps(scan).map((gap) => <p key={gap}>{gap}</p>) : null}
          {scan?.coverage?.complete ? <p>Every file and check ran.</p> : null}
          {scan && !scan.coverage ? <p>This scan predates coverage tracking.</p> : null}
        </article>
        <article className="tile">
          <span className="tile-label">AI check</span>
          {scan?.ai ? (
            <>
              <strong className="tile-value">{scan.ai.checked}</strong>
              <p>findings checked with {scan.ai.model} ({scan.ai.mode}), ${scan.ai.costUsd.toFixed(3)} spent{scan.ai.notChecked ? `, ${scan.ai.notChecked} not checked` : ''}.</p>
            </>
          ) : (
            <>
              <strong className="tile-value small">Off</strong>
              <p>This scan ran offline. Add your own key in Settings to have uncertain findings verified.</p>
            </>
          )}
        </article>
        <article className="tile">
          <span className="tile-label">Risk density</span>
          <strong className="tile-value">{scan?.riskDensity.findingsPer1kLoc ?? 0}</strong>
          <p>Findings per 1k lines of code.</p>
        </article>
        <article className="tile">
          <span className="tile-label">Flagged ratio</span>
          <strong className="tile-value">{Math.round((scan?.riskDensity.flaggedRatio ?? 0) * 100)}%</strong>
          <p>Scored code units crossing the threshold.</p>
        </article>
      </section>

      <ReportView findings={findings} />

      <section className="panel">
        <div className="panel-head">
          <h2>Written report</h2>
          <span className="meta">redacted snapshot</span>
        </div>
        {markdown ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
        ) : (
          <p className="empty">No markdown snapshot available yet.</p>
        )}
      </section>
    </div>
  );
}
