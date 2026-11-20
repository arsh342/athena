import { useMemo, useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { SeverityBadge } from './SeverityBadge';
import type { Finding, Severity } from '../types';
import { groupFindings, redactFindingText, shortenPath } from '../utils/report';

interface ReportViewProps {
  findings: Finding[];
}

export function ReportView({ findings }: ReportViewProps) {
  const [showRawSecrets, setShowRawSecrets] = useState(false);
  const [openSeverities, setOpenSeverities] = useState<Record<Severity, boolean>>({
    CRITICAL: false,
    HIGH: false,
    MEDIUM: false,
    LOW: false,
  });

  const grouped = useMemo(() => groupFindings(findings), [findings]);
  const severities: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <section className="report-list" aria-label="Security findings">
      <div className="br-section-annotation">
        <span>003 / Findings</span>
        <span></span>
      </div>
      <div className="report-toolbar">
        <label className="report-toggle">
          <input
            type="checkbox"
            checked={showRawSecrets}
            onChange={(event) => setShowRawSecrets(event.target.checked)}
          />
          Show raw secrets (UI only)
        </label>
      </div>

      {severities.map((severity) => {
        const files = grouped[severity];
        const fileKeys = Object.keys(files);
        return (
          <div className="report-severity" key={severity}>
            <button
              type="button"
              className="report-severity-toggle"
              onClick={() => setOpenSeverities((prev) => ({ ...prev, [severity]: !prev[severity] }))}
            >
              <SeverityBadge severity={severity} />
              <span>{fileKeys.length} {fileKeys.length === 1 ? 'file' : 'files'}</span>
            </button>

            {openSeverities[severity] && fileKeys.map((file) => (
              <div className="report-file" key={file}>
                <div className="report-file-head">
                  <strong>{shortenPath(file)}</strong>
                  <span>{files[file]?.length ?? 0} findings</span>
                </div>
                {files[file]?.map((finding) => (
                  <article className="finding-card" key={finding.id}>
                    <div className="finding-head">
                      <div>
                        <SeverityBadge severity={finding.severity} />
                        <h3>{finding.type}</h3>
                      </div>
                      <span className="finding-id">{finding.id}</span>
                    </div>
                    <p>{showRawSecrets ? finding.message : redactFindingText(finding.message, finding)}</p>
                    <div className="finding-meta">
                      <span>{shortenPath(finding.file)}:{finding.line}</span>
                      <span>{finding.source}</span>
                      <span>AI score {finding.aiScore}</span>
                    </div>
                    {finding.aiVerdict ? (
                      <p className={`ai-verdict ai-verdict--${finding.aiVerdict.verdict}`}>
                        <strong>AI {finding.aiVerdict.verdict === 'needs-human' ? 'could not decide' : finding.aiVerdict.verdict}</strong>
                        {' '}({finding.aiVerdict.model}): {finding.aiVerdict.reason}
                      </p>
                    ) : null}
                    <CodeBlock code={showRawSecrets ? finding.code : redactFindingText(finding.code, finding)} />
                  </article>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
