import { useEffect, useRef, useState } from 'react';

interface TerminalProps {
  lines?: string[];
  playback?: boolean;
  stepDelayMs?: number;
  loop?: boolean;
  loopPauseMs?: number;
  promptText?: string;
  title?: string;
}

export function Terminal({
  lines = [],
  playback = false,
  stepDelayMs = 520,
  loop = false,
  loopPauseMs = 1400,
  promptText = 'awaiting next repository',
  title = 'athena',
}: TerminalProps) {
  const [visibleCount, setVisibleCount] = useState(playback ? 0 : lines.length);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!playback) {
      setVisibleCount(lines.length);
      return;
    }

    let timer: number | undefined;
    let loopTimer: number | undefined;

    function run() {
      setVisibleCount(0);
      timer = window.setInterval(() => {
        setVisibleCount((current) => {
          if (current >= lines.length) {
            if (timer) window.clearInterval(timer);
            if (loop) {
              loopTimer = window.setTimeout(run, loopPauseMs);
            }
            return current;
          }
          return current + 1;
        });
      }, stepDelayMs);
    }

    run();

    return () => {
      if (timer) window.clearInterval(timer);
      if (loopTimer) window.clearTimeout(loopTimer);
    };
  }, [lines, loop, loopPauseMs, playback, stepDelayMs]);

  const visibleLines = lines.slice(0, visibleCount);
  const normalizedTitle = title.toLowerCase();
  const isAthenaTitle = normalizedTitle.startsWith('athena');
  const titleBrand = isAthenaTitle ? title.slice(0, 6).toLowerCase() : title;
  const titleRest = isAthenaTitle ? title.slice(6) : '';

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleCount]);

  return (
    <section className="terminal" aria-label="Scan terminal output">
      <div className="terminal-chrome">
        <span />
        <span />
        <span />
        <strong className="terminal-title">
          <h6 className="terminal-title-brand">{titleBrand}</h6>
          {titleRest ? <span className="terminal-title-rest">{titleRest}</span> : null}
        </strong>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {visibleLines.map((line, idx) => (
          <p key={`${line}-${idx}`}>
            <span className="terminal-prefix">&gt;</span>
            {line}
          </p>
        ))}
        <p className="terminal-cursor">
          <span className="terminal-prefix">&gt;</span>
          {promptText}
        </p>
      </div>
    </section>
  );
}
