import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ReportView } from '../components/ReportView';
import { ScoreGauge } from '../components/ScoreGauge';
import { downloadReportPdf, fetchFindingsByScanId, fetchReportMarkdown, fetchScan, fetchScans } from '../services/api';
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
        <div className="report-actions">
          <button
            type="button"
            className="button button-primary"
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
                const message = error instanceof Error ? error.message : 'PDF download failed.';
                setPdfError(message);
              } finally {
                setPdfLoading(false);
              }
            }}
          >
            {pdfLoading ? 'Generating…' : 'Download PDF'}
          </button>
          {pdfError ? <p className="auth-error">{pdfError}</p> : null}
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

      <section className="panel report-markdown">
        <div className="panel-title">
          <h2>Report (Markdown)</h2>
          <span>redacted snapshot</span>
        </div>
        {markdown ? (
          <div className="report-markdown-body" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
        ) : (
          <p className="report-markdown-empty">No markdown snapshot available yet.</p>
        )}
      </section>
    </div>
  );
}
