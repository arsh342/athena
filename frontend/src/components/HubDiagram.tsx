/**
 * Hub-spoke wire diagram visualising Athena analysis pipeline.
 * Pure inline SVG — no external dependencies.
 * Centre: Athena engine. Spokes radiate to pipeline stages with value tags.
 */
export function HubDiagram() {
  const pipeline = [
    { label: 'INGEST DIFF', tag: 'STAGED FILES', angle: -150, width: 122 },
    { label: 'AST PARSE', tag: 'TS COMPILER API', angle: -95, width: 110 },
    { label: '11-SIGNAL SCORE', tag: 'RISK WEIGHTS', angle: -35, width: 136 },
    { label: 'SECURITY PASS', tag: 'SEMGREP + SECRETS', angle: 35, width: 142 },
    { label: 'PRE-COMMIT GATE', tag: 'BLOCK HIGH/CRIT', angle: 95, width: 140 },
    { label: 'AUDIT REPORT', tag: 'TERMINAL + JSONL', angle: 150, width: 130 },
  ];

  const cx = 300;
  const cy = 200;
  const hubRadius = 36;
  const spokeLength = 150;

  return (
    <svg
      className="hub-diagram"
      viewBox="0 0 600 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Athena analysis pipeline diagram"
    >
      {/* Grid dots background */}
      <defs>
        <pattern id="hub-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="rgba(0,0,0,0.08)" />
        </pattern>
      </defs>
      <rect width="600" height="400" fill="url(#hub-dots)" />

      {/* Spokes */}
      {pipeline.map((stage) => {
        const rad = (stage.angle * Math.PI) / 180;
        const ex = cx + Math.cos(rad) * spokeLength;
        const ey = cy + Math.sin(rad) * spokeLength;
        return (
          <line
            key={stage.label}
            x1={cx}
            y1={cy}
            x2={ex}
            y2={ey}
            stroke="rgba(0,0,0,0.12)"
            strokeWidth="1"
          />
        );
      })}

      {/* Centre hub */}
      <circle cx={cx} cy={cy} r={hubRadius + 6} fill="none" stroke="rgba(232,122,65,0.2)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={hubRadius} fill="#F5F0EB" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
      {/* Decorative dot at center-left of hub ring */}
      <circle cx={cx - hubRadius - 6} cy={cy} r="3" fill="#E87A41" />
      {/* Asterisk glyph */}
      <text
        x={cx}
        y={cy - 7}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="18"
        fontFamily="'IBM Plex Mono', monospace"
        fontWeight="700"
        fill="#1A1A1A"
      >
        ATHENA
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9"
        letterSpacing="1"
        fontFamily="'IBM Plex Mono', monospace"
        fontWeight="600"
        fill="#6B6560"
      >
        DETERMINISTIC ENGINE
      </text>

      {/* Pipeline nodes */}
      {pipeline.map((stage) => {
        const rad = (stage.angle * Math.PI) / 180;
        const nx = cx + Math.cos(rad) * spokeLength;
        const ny = cy + Math.sin(rad) * spokeLength;
        const pillWidth = stage.width;
        const pillHeight = 34;
        const tagWidth = stage.width - 18;
        const tagHeight = 16;
        return (
          <g key={stage.label}>
            <rect
              x={nx - pillWidth / 2}
              y={ny - pillHeight / 2}
              width={pillWidth}
              height={pillHeight}
              rx="17"
              fill="#F5F0EB"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="1"
            />
            <text
              x={nx}
              y={ny - 4}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="10"
              letterSpacing="0.6"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight="700"
              fill="#1A1A1A"
            >
              {stage.label}
            </text>
            <rect
              x={nx - tagWidth / 2}
              y={ny + 2}
              width={tagWidth}
              height={tagHeight}
              rx="8"
              fill="rgba(0,0,0,0.03)"
            />
            <text
              x={nx}
              y={ny + 10}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="8"
              letterSpacing="0.6"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight="600"
              fill="#6B6560"
            >
              {stage.tag}
            </text>
          </g>
        );
      })}

      <text
        x="24"
        y="26"
        fontSize="9"
        letterSpacing="1"
        fontFamily="'IBM Plex Mono', monospace"
        fill="#9B9590"
      >
        // PIPELINE: DETECT → SCORE → SECURE
      </text>
    </svg>
  );
}
