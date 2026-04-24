import { CodeBlock } from './CodeBlock';
import { SeverityBadge } from './SeverityBadge';
import type { Finding } from '../types';

interface ReportViewProps {
  findings: Finding[];
}

export function ReportView({ findings }: ReportViewProps) {
  return (
    <section className="report-list" aria-label="Security findings">
      <div className="br-section-annotation">
        <span>// SECTION: FINDINGS</span>
        <span>003</span>
      </div>
      {findings.map((finding) => (
        <article className="finding-card" key={finding.id}>
          <div className="finding-head">
            <div>
              <SeverityBadge severity={finding.severity} />
              <h3>{finding.type}</h3>
            </div>
            <span className="finding-id">{finding.id}</span>
          </div>
          <p>{finding.message}</p>
          <div className="finding-meta">
            <span>{finding.file}:{finding.line}</span>
            <span>{finding.source}</span>
            <span>AI score {finding.aiScore}</span>
          </div>
          <CodeBlock code={finding.code} />
          <div className="signal-grid">
            {finding.topSignals.map((signal) => (
              <span key={signal.signal}>
                {signal.signal}
                <strong>{signal.contribution}%</strong>
              </span>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
