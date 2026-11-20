import type { CSSProperties } from 'react';

interface ScoreGaugeProps {
  score: number;
  label?: string;
}

export function ScoreGauge({ score, label = 'AI involvement' }: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="gauge">
      <div className="gauge-ring" style={{ '--score': `${clamped * 3.6}deg` } as CSSProperties} role="img" aria-label={`${label}: ${clamped}%`}>
        <div>
          <strong>{clamped}%</strong>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
