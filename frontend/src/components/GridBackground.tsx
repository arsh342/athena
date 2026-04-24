import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  z: number;
  color: string;
  size: number;
}

const COLORS = [
  'rgba(0, 255, 255, 0.7)',
  'rgba(0, 137, 255, 0.6)',
  'rgba(0, 7, 205, 0.5)',
  'rgba(0, 255, 255, 0.4)',
  'rgba(0, 150, 255, 0.5)',
  'rgba(46, 230, 120, 0.3)',
];

const PARTICLE_COUNT = 180;
const SPEED = 0.004;

/**
 * Animated pixel grid lines flowing from back to front with perspective.
 * Canvas-based — composio-style hero background effect.
 */
export function GridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;

    function resize() {
      width = canvas!.parentElement?.clientWidth ?? window.innerWidth;
      height = canvas!.parentElement?.clientHeight ?? window.innerHeight;
      canvas!.width = width * window.devicePixelRatio;
      canvas!.height = height * window.devicePixelRatio;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    resize();
    window.addEventListener('resize', resize);

    // Init particles in 3D space
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 2 + Math.random() * 4,
    }));

    function project(p: Particle) {
      const perspective = 0.8;
      const scale = perspective / (perspective + p.z);
      const cx = width / 2;
      const cy = height / 2;
      return {
        x: cx + p.x * width * 0.6 * scale,
        y: cy + p.y * height * 0.6 * scale,
        scale,
      };
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        // Move toward camera
        p.z -= SPEED;
        if (p.z <= 0) {
          p.z = 1;
          p.x = (Math.random() - 0.5) * 2;
          p.y = (Math.random() - 0.5) * 2;
          p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        }

        const { x, y, scale } = project(p);
        const pixelSize = p.size * scale * 3;

        // Skip if off screen
        if (x < -pixelSize || x > width + pixelSize || y < -pixelSize || y > height + pixelSize) continue;

        ctx!.globalAlpha = Math.min(1, (1 - p.z) * 1.5) * scale;
        ctx!.fillStyle = p.color;

        // Draw as pixel/square for that grid-pixel look
        ctx!.fillRect(
          Math.round(x - pixelSize / 2),
          Math.round(y - pixelSize / 2),
          Math.ceil(pixelSize),
          Math.ceil(pixelSize),
        );

        // Draw trailing line toward vanishing point
        const trailLength = 12 * scale;
        const cx = width / 2;
        const cy = height / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          ctx!.globalAlpha *= 0.3;
          ctx!.fillRect(
            Math.round(x - nx * trailLength - pixelSize * 0.3),
            Math.round(y - ny * trailLength - pixelSize * 0.3),
            Math.ceil(pixelSize * 0.6),
            Math.ceil(pixelSize * 0.6),
          );
        }
      }

      ctx!.globalAlpha = 1;
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="grid-bg"
      aria-hidden="true"
    />
  );
}
