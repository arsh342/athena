import { useEffect, useState, useMemo } from 'react';

interface Particle {
  id: number;
  duration: number;
  delay: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  color: string;
  transparentStop: number;
}

interface ParticleAnimationProps {
  /** Number of particles to render */
  particleCount?: number;
  /** Color palette for particle gradients */
  colors?: string[];
  /** Min/max animation duration in seconds */
  animationDuration?: [number, number];
  /** CSS perspective value for 3D depth */
  perspective?: string;
  /** Particle width as CSS value */
  particleWidth?: string;
  /** Particle height as CSS value */
  particleHeight?: string;
}

/** Random value between min and max */
function random(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * 3D particle animation inspired by "time travel" effect.
 * Particles expand outward from center with random 3D rotations.
 * Pure CSS animations — no canvas, no Tailwind, no style jsx.
 */
export function ParticleAnimation({
  particleCount = 500,
  colors = ['#00ffff', '#0089ff', '#0007cd', '#2ee678'],
  animationDuration = [1, 5],
  perspective = '10vmin',
  particleWidth = '40%',
  particleHeight = '1px',
}: ParticleAnimationProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const newParticles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      duration: random(animationDuration[0], animationDuration[1]),
      delay: -random(0.1, 2),
      rotateX: random(-180, 180),
      rotateY: random(-180, 180),
      rotateZ: random(-180, 180),
      color: colors[Math.floor(Math.random() * colors.length)],
      transparentStop: random(50, 100),
    }));
    setParticles(newParticles);
    // Only regenerate on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build keyframe stylesheet once from particle data
  const styleSheet = useMemo(() => {
    if (particles.length === 0) return '';
    return particles
      .map(
        (p) => `
@keyframes particle-${p.id} {
  0% {
    transform: translateX(50%) rotateX(${p.rotateX}deg) rotateY(${p.rotateY}deg) rotateZ(${p.rotateZ}deg) scale(0);
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    transform: translateX(50%) rotateX(${p.rotateX}deg) rotateY(${p.rotateY}deg) rotateZ(${p.rotateZ}deg) scale(2);
    opacity: 0;
  }
}`,
      )
      .join('\n');
  }, [particles]);

  return (
    <div
      className="particle-container"
      style={{ perspective }}
    >
      <div className="particle-stage">
        {particles.map((p) => (
          <div
            key={p.id}
            className="particle"
            style={{
              width: particleWidth,
              height: particleHeight,
              background: `linear-gradient(to left, ${p.color}, transparent ${p.transparentStop}%)`,
              animation: `particle-${p.id} ${p.duration}s linear infinite`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>
      <style dangerouslySetInnerHTML={{ __html: styleSheet }} />
    </div>
  );
}
