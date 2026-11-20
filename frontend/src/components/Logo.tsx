import type { SVGProps } from 'react';

/**
 * The Athena mark: the round owl face from the sign-in page, solid so it stays crisp at small sizes. Inherits the text colour.
 * The stippled version is public/logo.svg; the terminal banner is the same face in braille dots.
 */
export function Logo({ size = 24, ...props }: { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" {...props}>
      <defs>
        <mask id="athena-face-mark" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <circle cx="32" cy="33" r="28" fill="#fff" />
          <circle cx="21.5" cy="29" r="11.5" fill="#000" />
          <circle cx="42.5" cy="29" r="11.5" fill="#000" />
          <circle cx="22" cy="30" r="5.6" fill="#fff" />
          <circle cx="42" cy="30" r="5.6" fill="#fff" />
          <circle cx="20" cy="27.8" r="1.9" fill="#000" />
          <circle cx="40" cy="27.8" r="1.9" fill="#000" />
          <path d="M28.4 38.5h7.2L32 50Z" fill="#000" />
        </mask>
      </defs>
      <rect width="64" height="64" fill="currentColor" mask="url(#athena-face-mark)" />
    </svg>
  );
}
