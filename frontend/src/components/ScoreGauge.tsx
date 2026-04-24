import type { CSSProperties } from 'react';

interface ScoreGaugeProps {
  score: number;
  label?: string;
}

export function ScoreGauge({ score, label = 'AI involvement' }: ScoreGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score));

  return (
    <div className="score-gauge" style={{ '--score': `${clampedScore * 3.6}deg` } as CSSProperties}>
      <div className="score-ring">
        <div>
          <strong>{clampedScore}%</strong>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
