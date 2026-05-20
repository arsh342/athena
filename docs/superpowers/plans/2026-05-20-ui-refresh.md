# UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the site aesthetics with Space Grotesk typography and brutalist + retro-futurist + terminal styling while keeping all layouts and content unchanged.

**Architecture:** Pure UI refresh: update font loading, CSS variables, and apply utility classes. No data or layout changes. Keep logo font limited to navbar, hero, and footer logo spots.

**Tech Stack:** React, Vite, TypeScript, CSS

---

## File Structure

- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/index.css`
- Modify: `frontend/src/components/Navbar.tsx`
- Modify: `frontend/src/pages/Landing.tsx`
- Modify: `frontend/src/components/Footer.tsx` (if present)
- Optional: tweak page components for class hooks only (no layout changes)

---

### Task 1: Load Space Grotesk and set font variables

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/styles/index.css`

- [ ] **Step 1: Add font preload + stylesheet to index.html**

```html
<!-- frontend/index.html (inside <head>) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Update font CSS variables**

```css
/* frontend/src/styles/index.css :root */
--font-display: 'Space Grotesk', system-ui, sans-serif;
--font-body: 'Space Grotesk', system-ui, sans-serif;
/* keep mono as-is */
```

- [ ] **Step 3: Run build check (optional)**

Run: `npm run build -w @athena/frontend`
Expected: build success.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/styles/index.css
git commit -m "style: load Space Grotesk and update typography"
```

---

### Task 2: Add UI utility classes (logo + system strips + scanlines)

**Files:**
- Modify: `frontend/src/styles/index.css`

- [ ] **Step 1: Add utility classes**

```css
/* frontend/src/styles/index.css */
.logo-font {
  font-family: 'Null Pointer', var(--font-mono);
  letter-spacing: -0.3px;
}

.system-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border-10);
  background: rgba(255, 255, 255, 0.03);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-ghost);
}

.panel-offset {
  box-shadow: var(--shadow-brutalist);
}

.scanline-overlay {
  position: relative;
}

.scanline-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.03),
    rgba(255, 255, 255, 0.03) 1px,
    transparent 1px,
    transparent 3px
  );
  opacity: 0.25;
  mix-blend-mode: soft-light;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles/index.css
git commit -m "style: add retro utility classes"
```

---

### Task 3: Apply logo font overrides

**Files:**
- Modify: `frontend/src/components/Navbar.tsx`
- Modify: `frontend/src/pages/Landing.tsx`
- Modify: `frontend/src/components/Footer.tsx` (if present)

- [ ] **Step 1: Navbar brand uses logo font**

```tsx
// frontend/src/components/Navbar.tsx
<NavLink className="brand logo-font" to="/" aria-label="athena home">
  <span>athena</span>
</NavLink>
```

- [ ] **Step 2: Hero logo text (Landing)**

```tsx
// frontend/src/pages/Landing.tsx
<h1 className="br-hero-title logo-font" aria-label="Detect. Score. Secure.">
  {heroText}
</h1>
```

- [ ] **Step 3: Footer logo (if present)**

```tsx
// frontend/src/components/Footer.tsx
<span className="logo-font">athena</span>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Navbar.tsx frontend/src/pages/Landing.tsx frontend/src/components/Footer.tsx
git commit -m "style: apply logo font overrides"
```

---

### Task 4: Apply system strips + panel offsets (no layout change)

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/pages/ScanPage.tsx`
- Modify: `frontend/src/pages/ReportPage.tsx`
- Modify: `frontend/src/styles/index.css`

- [ ] **Step 1: Add system strip classes to section annotations**

```tsx
// Example usage
<div className="br-section-annotation system-strip">
  <span>// SECTION: REPORT_HEADER</span>
  <span>001</span>
</div>
```

- [ ] **Step 2: Add panel-offset to key panels**

```tsx
<article className="panel gauge-panel panel-offset">...</article>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/pages/ScanPage.tsx frontend/src/pages/ReportPage.tsx frontend/src/styles/index.css
git commit -m "style: add system strips and panel offsets"
```

---

### Task 5: Landing background overlays

**Files:**
- Modify: `frontend/src/pages/Landing.tsx`
- Modify: `frontend/src/styles/index.css`

- [ ] **Step 1: Add scanline overlay wrapper to hero**

```tsx
<section className="br-hero scanline-overlay" id="hero">
  ...
</section>
```

- [ ] **Step 2: Add subtle grid overlay to landing root**

```css
.landing.brutalist::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.2;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Landing.tsx frontend/src/styles/index.css
git commit -m "style: add landing overlays"
```

---

## Plan Self-Review
- **Spec coverage:** font loading, logo overrides, brutalist/retro/terminal accents covered.
- **Placeholder scan:** no TODO/TBD.
- **Type consistency:** class names defined before use.

---

## Execution Handoff
Plan complete and saved to `docs/superpowers/plans/2026-05-20-ui-refresh.md`.

Two execution options:

1. Subagent-Driven (recommended) — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
