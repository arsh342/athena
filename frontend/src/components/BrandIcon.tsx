/**
 * The app icon (the owl tile): dark tile on a dark page, light tile on a light one.
 * Small sizes use the halftone version, because fine stipple falls below a pixel and disappears there.
 */
export function BrandIcon({ size = 32, className }: { size?: number; className?: string }) {
  const base = size < 52 ? '/icon-sm' : '/icon';
  return (
    <picture>
      <source srcSet={`${base}-light.svg`} media="(prefers-color-scheme: light)" />
      <img src={`${base}.svg`} width={size} height={size} alt="athena" className={className} decoding="async" />
    </picture>
  );
}
