# UI Refresh Design

## Goal
Refresh the entire website UI aesthetics while keeping all layouts, routes, and content intact. Update global typography to Space Grotesk, preserve the existing logo font only for navbar/footer/hero logo. Maintain current color palette and dark/light split, but add brutalist + retro-futurist + terminal cues without neon.

## Non-Goals
- No layout changes or component re-architecture
- No new features or data flows
- No palette changes
- No navigation changes

## Summary of Decisions
- Use Space Grotesk as the global UI font.
- Keep logo font only in navbar brand, hero logo, and footer logo.
- Preserve the existing color system; no neon.
- Add subtle retro-futurist texture (grid + scanlines) with low opacity.
- Increase brutalist edge treatment: sharp borders, squared corners, slight offset shadows.
- Keep terminal cues via micro-labels, system strips, and mono tags.

## Visual System
- **Tone:** Brutalist + retro-futurist + terminal UI, restrained and readable.
- **Texture:** Subtle grid and scanlines across key sections (very low opacity).
- **Surfaces:** Layered panels with thin borders and minimal gradients.
- **Buttons:** Squared, bold labels, slight inset highlight.
- **Motion:** Minimal. Landing page load stagger; gentle hover transitions.

## Typography
- Load Space Grotesk from Google Fonts.
- Set `--font-body` and `--font-display` to Space Grotesk.
- Keep `--font-mono` for terminal and code.
- Add `.logo-font` class to override font for brand/logo elements only.

## Landing Page Updates
- Keep all sections and order.
- Add low-opacity grid/scanline overlay to hero backdrop.
- Boost hero headline contrast and tighten spacing.
- Panels get thicker borders + slight offset shadow for brutalist texture.
- Footer logo uses `.logo-font` only for brand text.

## App Pages Updates (Dashboard/Scan/Report/Login/Register)
- Keep layout, metrics, and controls.
- Add system strip headers above major panels.
- Tables and cards get subtle alternating row tints for scanability.
- Inputs: squared, stronger focus ring, slight inner shadow.
- Report severity headers styled as compact system bars.

## CSS System Updates
- Add utility classes: `logo-font`, `system-strip`, `panel-offset`, `scanline-overlay`.
- Apply to navbar brand, hero logo, footer logo.
- Apply `panel-offset` to key panels/cards.
- Use `scanline-overlay` on landing hero and app page headers.

## Files to Touch (Design Intent)
- `frontend/index.html` (font loading)
- `frontend/src/styles/index.css` (vars + utilities + global styles)
- `frontend/src/components/Navbar.tsx` (logo font class)
- `frontend/src/pages/Landing.tsx` (hero logo class + overlay)
- `frontend/src/components/Footer.tsx` (logo font class) if present
- App pages styles: dashboard, scan, report (CSS only)

## Testing
- Visual review of landing, dashboard, scan, report, login/register.
- Verify font loading and fallback behavior.
- Ensure contrast remains readable in dark + light modes.

## Open Questions
None.
