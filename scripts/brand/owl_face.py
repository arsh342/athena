"""
The Athena mark: the round owl face from the sign-in page (big eyes, beak, no ears), drawn as stipple.

One tone map drives every output, so the website icons, the logo and the terminal banner are the same picture:
  - stippled SVG tiles (dark and light), and a stippled logo in the current colour
  - braille art for the CLI banner (braille cells are 2x4 dots, so they are a real stipple in text)

Run from the repo root with numpy available (the ml/ virtualenv has it):
  ml/.venv/bin/python scripts/brand/owl_face.py
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend' / 'public'
S = 512  # drawing space


def tone(res: int = 512):
    """Brightness of the owl (1 = white paper, 0 = black), and its mask, on a res x res grid over the 512 square."""
    ys, xs = np.mgrid[0:res, 0:res]
    x = (xs + 0.5) * S / res
    y = (ys + 0.5) * S / res
    cx, cy, r = 256.0, 272.0, 214.0   # cy puts the face-plus-beak box on the tile's centre line
    u, v = (x - cx) / r, (y - cy) / r
    rho2 = u * u + v * v
    face = rho2 <= 1.0
    B = np.zeros_like(x, dtype=np.float32)

    def sphere(uu, vv, rr2, base=0.0, span=1.0):
        z = np.sqrt(np.clip(1 - rr2, 0, 1))
        lit = np.clip(z * 0.65 + (uu * -0.35 + vv * -0.45) * -0.55 + 0.15, 0, 1)
        return base + span * lit

    # the face: a lit sphere, darker toward its edge so the round outline holds with no stroke
    B = np.where(face, 0.28 + 0.50 * sphere(u, v, rho2), B)
    B = np.where(face & (rho2 > 0.90), B * np.clip(1 - (rho2 - 0.90) / 0.10 * 0.7, 0.3, 1), B)
    for side in (-1, 1):
        ex, ey, er = side * 0.395, -0.100, 0.365   # a calmer eye than the sign-in art: smaller discs, same layout
        eu, ev = u - ex, v - ey
        er2 = (eu * eu + ev * ev) / (er * er)
        eye = er2 <= 1.0
        # the eye disc: bright, shaded like a bead, with a dark rim where it meets the face
        B = np.where(eye, 0.62 + 0.38 * sphere(eu / er, ev / er, er2), B)
        B = np.where(eye & (er2 > 0.86), B * np.clip(1 - (er2 - 0.86) / 0.14 * 0.75, 0.25, 1), B)
        pupil = (eu * eu + ev * ev) <= 0.185 ** 2
        B = np.where(pupil, 0.06, B)
        hl = ((eu + 0.045) ** 2 + (ev + 0.050) ** 2) <= 0.054 ** 2
        B = np.where(hl, 1.0, B)
        hl2 = ((eu - 0.06) ** 2 + (ev - 0.07) ** 2) <= 0.022 ** 2
        B = np.where(hl2, 0.95, B)
    # the beak: a pointed wedge, light in the middle and dark at its edges
    by0, by1 = 0.326, 0.848
    t = np.clip((v - by0) / (by1 - by0), 0, 1)
    half = 0.141 * (1 - t)
    beak = (v >= by0) & (v <= by1) & (np.abs(u) <= half)
    edge = np.clip(np.abs(u) / np.maximum(half, 1e-3), 0, 1)
    B = np.where(beak, 1.0 - 0.95 * edge ** 1.2, B)
    # a shadow on the face either side of the beak so it stands out
    shade = (v >= by0 - 0.02) & (v <= by1 * 0.9) & (np.abs(u) <= half + 0.07) & ~beak
    B = np.where(shade & face, B * 0.55, B)
    mask = face | beak
    return np.clip(B, 0, 1), mask, x, y


def stipple_svg(tile: str | None, dot: str, light_dots: bool, n: int = 15000, seed: int = 5, rx: int = 112, w0: float = 1.5, wk: float = 2.0) -> str:
    B, M, _, _ = tone()
    # dots stand for ink on a light tile, and for light on a dark one
    D = np.where(M, B if light_dots else (1 - B), 0.0)
    D = np.where(M, np.maximum(D, 0.05), 0.0)
    rg = np.random.default_rng(seed)
    cand = rg.uniform(0, S, size=(500000, 2))
    ix = np.clip(cand[:, 0].astype(int), 0, 511)
    iy = np.clip(cand[:, 1].astype(int), 0, 511)
    t = D[iy, ix]
    keep = rg.uniform(0, 1, len(cand)) < np.clip(t, 0, 1) ** 1.1 * 0.36
    pts, tt = cand[keep], t[keep]
    if len(pts) > n:
        sel = rg.choice(len(pts), n, replace=False)
        pts, tt = pts[sel], tt[sel]
    w = np.round(w0 + wk * np.clip(tt, 0, 1), 1)
    paths = []
    for wv in sorted(set(w.tolist())):
        sub = pts[w == wv]
        paths.append(f'<path d="{"".join(f"M{px:.1f} {py:.1f}h0" for px, py in sub)}" stroke-width="{wv}"/>')
    tile_el = f'<rect width="512" height="512" rx="{rx}" fill="{tile}"/>' if tile else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Athena, the owl of Athena">'
            f'{tile_el}<g stroke="{dot}" stroke-linecap="round" fill="none">{"".join(paths)}</g></svg>\n')


def halftone_svg(tile: str, dot: str, light_dots: bool, n: int = 24, rx: int = 112) -> str:
    """A regular grid of round dots sized by tone: the small-size stipple, since it stays legible down to about 24px."""
    B, M, _, _ = tone(512)
    D = np.where(M, B if light_dots else (1 - B), 0.0)
    cell = 400.0 / n
    off = (512 - 400.0) / 2
    dots = []
    for j in range(n):
        for i in range(n):
            x0, y0 = int((off + i * cell) ), int((off + j * cell))
            x1, y1 = int(off + (i + 1) * cell), int(off + (j + 1) * cell)
            m = M[y0:y1, x0:x1].mean() if x1 > x0 and y1 > y0 else 0
            if m < 0.5:
                continue
            t = float(D[y0:y1, x0:x1].mean())
            if t < 0.08:
                continue
            r = cell * 0.5 * math.sqrt(min(1.0, t)) * 1.05
            dots.append(f'<circle cx="{off + (i + 0.5) * cell:.1f}" cy="{off + (j + 0.5) * cell:.1f}" r="{r:.2f}"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Athena, the owl of Athena">'
            f'<rect width="512" height="512" rx="{rx}" fill="{tile}"/><g fill="{dot}">{"".join(dots)}</g></svg>\n')


def braille_rows(cols: int = 26) -> list[str]:
    """Floyd-Steinberg dither the owl's brightness into braille cells (lit dots = bright), cropped to the owl."""
    W = cols * 2
    B, M, _, _ = tone(512)
    ys, xs = np.nonzero(M)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    side = max(y1 - y0, x1 - x0)
    cyy, cxx = (y0 + y1) // 2, (x0 + x1) // 2
    top, left = max(0, cyy - side // 2), max(0, cxx - side // 2)
    crop_b, crop_m = B[top:top + side, left:left + side], M[top:top + side, left:left + side]
    H = (W * 1)  # square in dots
    H = (H // 4) * 4
    def resize(a, w, h):
        ys_ = np.linspace(0, a.shape[0], h + 1).astype(int)
        xs_ = np.linspace(0, a.shape[1], w + 1).astype(int)
        out = np.zeros((h, w), np.float32)
        for i in range(h):
            for j in range(w):
                out[i, j] = a[ys_[i]:max(ys_[i + 1], ys_[i] + 1), xs_[j]:max(xs_[j + 1], xs_[j] + 1)].mean()
        return out
    b = resize(crop_b * crop_m, W, H)
    m = resize(crop_m.astype(np.float32), W, H) > 0.35
    b = np.where(m, np.clip(b, 0, 1), 0.0)
    g = b.copy()
    on = np.zeros((H, W), bool)
    for yy in range(H):
        for xx in range(W):
            old = g[yy, xx]
            new = 1.0 if old >= 0.5 else 0.0
            if not m[yy, xx]:
                new = 0.0
            on[yy, xx] = new > 0
            e = old - new
            if xx + 1 < W: g[yy, xx + 1] += e * 7 / 16
            if yy + 1 < H:
                if xx > 0: g[yy + 1, xx - 1] += e * 3 / 16
                g[yy + 1, xx] += e * 5 / 16
                if xx + 1 < W: g[yy + 1, xx + 1] += e * 1 / 16
    bits = [(0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08), (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80)]
    rows = []
    for r in range(0, H, 4):
        line = ''
        for c in range(0, W, 2):
            code = 0
            for dx, dy, bit in bits:
                if on[r + dy, c + dx]:
                    code |= bit
            line += chr(0x2800 + code)
        rows.append(line.rstrip('⠀'))
    while rows and not rows[0].strip('⠀'): rows.pop(0)
    while rows and not rows[-1].strip('⠀'): rows.pop()
    return rows


def main() -> None:
    (PUBLIC / 'icon.svg').write_text(stipple_svg('#1c1c1e', '#ededed', light_dots=True))
    (PUBLIC / 'icon-light.svg').write_text(stipple_svg('#d9d9d9', '#16161a', light_dots=False))
    # a regular halftone for small sizes (navbar, favicon): random fine stipple falls below a pixel there and disappears
    (PUBLIC / 'icon-sm.svg').write_text(halftone_svg('#1c1c1e', '#ededed', light_dots=True))
    (PUBLIC / 'icon-sm-light.svg').write_text(halftone_svg('#d9d9d9', '#16161a', light_dots=False))
    # the logo takes the current colour (dark dots on a light page)
    (PUBLIC / 'logo.svg').write_text(stipple_svg(None, 'currentColor', light_dots=False, n=13000))
    rows = braille_rows()
    (ROOT / 'scripts' / 'brand' / 'banner-rows.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print('\n'.join(rows))


if __name__ == '__main__':
    main()
