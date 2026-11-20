import { useEffect, useRef } from 'react';
import { cell } from '../utils/ascii';

const CELL_W = 8;
const CELL_H = 14;
const WORD = 'athena';

/**
 * Full-panel ASCII canvas: the word "athena" built from a character field, a scan band that sweeps down revealing code,
 * a lens around the pointer, and click-and-hold to resolve everything into code. Decorative (aria-hidden); static under reduced motion.
 */
export function AsciiHero() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = wrap.current;
    const cv = canvas.current;
    if (!host || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let cols = 0;
    let rows = 0;
    let mask = new Float32Array(0);
    let raf = 0;
    let last = 0;
    let band = 0;
    let held = false;
    let pointer = { x: -1e4, y: -1e4 };
    let visible = true;

    function resize(): void {
      const rect = host!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv!.width = Math.max(1, Math.floor(rect.width * dpr));
      cv!.height = Math.max(1, Math.floor(rect.height * dpr));
      cv!.style.width = `${rect.width}px`;
      cv!.style.height = `${rect.height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(rect.width / CELL_W));
      rows = Math.max(1, Math.floor(rect.height / CELL_H));
      // Rasterise the lettering at one pixel per cell, then read its coverage.
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const o = off.getContext('2d');
      mask = new Float32Array(cols * rows);
      if (o) {
        o.fillStyle = '#000';
        o.fillRect(0, 0, cols, rows);
        o.fillStyle = '#fff';
        o.textAlign = 'center';
        o.textBaseline = 'middle';
        let size = rows * 0.5;
        o.font = `700 ${size}px Geist, sans-serif`;
        const w = o.measureText(WORD).width;
        size = Math.min(size, size * (cols * 0.86) / Math.max(w, 1));
        o.font = `700 ${size}px Geist, sans-serif`;
        o.fillText(WORD, cols / 2, rows * 0.5);
        const data = o.getImageData(0, 0, cols, rows).data;
        for (let i = 0; i < cols * rows; i += 1) mask[i] = data[i * 4]! / 255;
      }
    }

    function draw(now: number): void {
      const t = now / 1000;
      const w = cols * CELL_W;
      const h = rows * CELL_H;
      ctx!.clearRect(0, 0, cv!.width, cv!.height);
      ctx!.font = `500 ${CELL_H - 3}px "Geist Mono", ui-monospace, monospace`;
      ctx!.textBaseline = 'top';
      const offX = (host!.clientWidth - w) / 2;
      const offY = (host!.clientHeight - h) / 2;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const dx = x * CELL_W + offX + CELL_W / 2 - pointer.x;
          const dy = y * CELL_H + offY + CELL_H / 2 - pointer.y;
          const c = cell({ mask: mask[y * cols + x]!, x, y, rows, t, band, pointer: Math.hypot(dx / CELL_W, dy / CELL_H), held });
          if (c.alpha <= 0 || c.ch === ' ') continue;
          ctx!.fillStyle = `rgba(241,238,231,${c.alpha.toFixed(2)})`;
          ctx!.fillText(c.ch, x * CELL_W + offX, y * CELL_H + offY);
        }
      }
    }

    function frame(now: number): void {
      raf = requestAnimationFrame(frame);
      if (!visible || now - last < 40) return;
      band = (band + (held ? 0.012 : 0.004)) % 1;
      last = now;
      draw(now);
    }

    function move(e: PointerEvent): void {
      const r = host!.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (label.current) {
        label.current.style.transform = `translate(${pointer.x + 16}px, ${pointer.y + 16}px)`;
        label.current.style.opacity = '1';
      }
    }
    const leave = () => { pointer = { x: -1e4, y: -1e4 }; held = false; if (label.current) label.current.style.opacity = '0'; };
    const down = () => { held = true; };
    const up = () => { held = false; };

    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(performance.now()); });
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => { visible = Boolean(e?.isIntersecting); });
    io.observe(host);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);

    const start = () => { if (reduced) draw(1500); else raf = requestAnimationFrame(frame); };
    // Wait for the web fonts so the lettering is rasterised in Geist, not a fallback.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => { resize(); start(); });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div className="ascii-hero" ref={wrap} aria-hidden="true">
      <div className="ascii-hero-label" ref={label}>Click &amp; hold</div>
      <canvas ref={canvas} />
    </div>
  );
}

/** A field of dashes (or dots) used as a section rule. Decorative. */
export function AsciiRule({ char = '-', rows = 1 }: { char?: string; rows?: number }) {
  const line = char.repeat(400);
  return (
    <div className="ascii-rule" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i}>{line}</span>)}
    </div>
  );
}
