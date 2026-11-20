import { useEffect, useRef, useState } from 'react';

interface TerminalProps {
  lines?: string[];
  playback?: boolean;
  stepDelayMs?: number;
  loop?: boolean;
  loopPauseMs?: number;
  promptText?: string;
  title?: string;
  promptSymbol?: string;
}

/** A read-only terminal that prints its lines, one at a time when `playback` is on. */
export function Terminal({
  lines = [],
  playback = false,
  stepDelayMs = 520,
  loop = false,
  loopPauseMs = 1400,
  promptText = 'awaiting next repository',
  title = 'athena',
  promptSymbol = '#',
}: TerminalProps) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = playback && !reduced;
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : lines.length);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!animate) {
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
            if (loop) loopTimer = window.setTimeout(run, loopPauseMs);
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
  }, [lines, loop, loopPauseMs, animate, stepDelayMs]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [visibleCount]);

  return (
    <section className="term" aria-label="Scan terminal output">
      <div className="term-bar"><i /><i /><i /><b>{title}</b></div>
      <div className="term-body" ref={bodyRef}>
        {lines.slice(0, visibleCount).map((line, idx) => (
          <p key={`${line}-${idx}`}><span className="pfx">{promptSymbol}</span>{line}</p>
        ))}
        <p className="cursor"><span className="pfx">{promptSymbol}</span>{promptText}</p>
      </div>
    </section>
  );
}
