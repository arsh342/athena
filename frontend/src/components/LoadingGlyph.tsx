import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A one-character braille spinner for buttons. Static under reduced motion. */
export function LoadingGlyph() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, []);
  return <span className="glyph" aria-hidden="true">{FRAMES[frame]}</span>;
}
