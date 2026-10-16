"""Turn an approved concept crop sheet (7 rows of crops x 5 growth stages, each on a dirt tile,
drawn as fake-big pixels) back into true pixel art: ui/art/crops.png, 5 columns x 7 rows of
16x24 cells, plant only (the dirt is dropped; the game draws its own soil), plus an 8x preview.

How the plant is cut out (at the sheet's full resolution, before sampling down to pixels):
  1. the backdrop is the backdrop-coloured area connected to the cell's border, nothing else;
  2. the dirt is the dirt-coloured area connected to that backdrop.
Everything else is plant. Neither step ever passes through the plant's outline, and white/cream
inside the plant (a turnip, strawberry petals, shine pixels) is never mistaken for backdrop just
because it is a similar colour: it isn't connected to the backdrop. Dirt-brown parts enclosed by
the plant (a sunflower's centre) stay for the same reason.

usage: uv run --with pillow --with numpy --with scipy python tools/extract_crops.py <sheet.png> <out_dir>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROWS, COLS, ART, CELL_H = 7, 5, 16, 24

src = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
out = Path(sys.argv[2])
H, W, _ = src.shape

bg = np.median(src[:20, :20].reshape(-1, 3), axis=0)
near_bg = np.abs(src - bg).sum(axis=2)
fg = near_bg > 40


def hsv(a):
    a = a / 255.0
    mx, mn = a.max(axis=-1), a.min(axis=-1)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dd = np.maximum(d, 1e-9)
    h = np.select([mx == r, mx == g], [((g - b) / dd) % 6, (b - r) / dd + 2], (r - g) / dd + 4) / 6
    return np.where(d > 0, h, 0), s, mx


HUE, SAT, VAL = hsv(src)
# Soil browns (saturated oranges and golds - carrot, pumpkin, wheat - are excluded), plus the soft
# blend between soil and the light backdrop at the tile's edge (the sheet is a smoothed upscale):
# colours on the line from the backdrop to the soil colour, but not the backdrop end of it, so
# white petals sitting on the soil are never part of it.
SOIL_RGB = np.array([150, 98, 62])
DIRT = (HUE > 0.02) & (HUE < 0.13) & (SAT > 0.2) & (SAT <= 0.7) & (VAL > 0.33) & (VAL <= 0.85)
axis = SOIL_RGB - bg
t = ((src - bg) * axis).sum(axis=2) / (axis * axis).sum()
off = np.linalg.norm(src - (bg + t[..., None] * axis), axis=2)
DIRT |= (t > 0.1) & (t < 1.1) & (off < 20)
CREAM = near_bg <= 60
DARK = VAL < 0.33  # the plants' dark warm-brown outline
DARK_BIAS = 0.8  # outline loses to plant colour covering 1/0.8 times as much (thin blades)
EIGHT = np.ones((3, 3), bool)


def bands(profile, n):
    """The n longest runs where the profile is non-zero."""
    runs, start = [], None
    for i, v in enumerate(list(profile) + [0]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    runs = sorted(sorted(runs, key=lambda r: r[1] - r[0])[-n:])
    return runs


def from_border(mask):
    """The parts of mask connected to the edge of the array."""
    lab, _ = ndimage.label(mask)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return np.isin(lab, edge[edge > 0])


def matte(cell_y0, cell_y1, cell_x0, cell_x1):
    """(plant mask, dirt mask) for a cell, at full resolution."""
    sl = np.s_[cell_y0:cell_y1, cell_x0:cell_x1]
    outside = from_border(CREAM[sl])
    lab, _ = ndimage.label(outside | DIRT[sl])
    soil = np.isin(lab, np.unique(lab[outside]))
    return ~soil, soil & ~outside


def sample(cell, plant, dark, dx0, dy1, px):
    """Sample the cut-out plant down to CELL_H x ART art pixels of size px (the sheet's fake pixels
    are smaller than that, so this shrinks it). Dark outline and small details (eyes, shine
    pixels) are thinner than one art pixel, so they win wherever they cover enough of it, and every
    small detail keeps at least the pixel under its middle."""
    grid = np.zeros((CELL_H, ART, 4), np.uint8)
    ch, cw = plant.shape

    def box(gy, gx, k):
        cy, cx = dy1 - (CELL_H - gy - 0.5) * px, dx0 + (gx + 0.5) * px
        ya, yb = int(round(cy - px * k)), int(round(cy + px * k))
        xa, xb = int(round(cx - px * k)), int(round(cx + px * k))
        return np.s_[max(0, ya):max(0, min(ch, yb)), max(0, xa):max(0, min(cw, xb))]

    for gy in range(CELL_H):
        for gx in range(ART):
            full = box(gy, gx, 0.5)
            m = plant[full]
            if m.size == 0:
                continue
            d = dark[full]
            # outline wins unless the plant colour clearly dominates (thin wheat blades stay green)
            if d.mean() >= max(0.22, DARK_BIAS * (m & ~d).mean()):
                grid[gy, gx] = (*np.median(cell[full][d], axis=0).astype(np.uint8), 255)
                continue
            if m.mean() < 0.5:
                continue
            mid = box(gy, gx, 0.35)
            sel = plant[mid] & ~dark[mid]
            block = cell[mid][sel] if sel.sum() >= 4 else cell[full][m & ~d]
            q = block // 16
            vals, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
            c = block[inv.ravel() == counts.argmax()].mean(axis=0).round()
            grid[gy, gx] = (*c.astype(np.uint8), 255)

    # small details: dark dots (eyes) and bright dots (shine) inside the plant
    hue, sat, val = hsv(cell)
    bright = plant & (val > 0.9) & (sat < 0.25)
    for mask, small in ((dark, px * px * 1.5), (bright, px * px * 1.5)):
        lab, k = ndimage.label(mask, structure=EIGHT)
        for j, sl in enumerate(ndimage.find_objects(lab), 1):
            comp = lab[sl] == j
            area = comp.sum()
            if area < 6 or area > small:
                continue
            yy, xx = np.nonzero(comp)
            cy, cx = yy.mean() + sl[0].start, xx.mean() + sl[1].start
            gy = int(np.floor(CELL_H - (dy1 - cy) / px))
            gx = int(np.floor((cx - dx0) / px))
            if not (0 <= gy < CELL_H and 0 <= gx < ART):
                continue
            c = np.median(cell[sl][comp], axis=0).astype(np.uint8)
            # a bright dot only on an opaque pixel that isn't already light (a turnip is all white)
            if mask is bright and (grid[gy, gx, 3] == 0 or grid[gy, gx, :3].astype(int).sum() > 600):
                continue
            grid[gy, gx] = (*c, 255)
    return grid


rows = bands(fg.sum(axis=1) > 3, ROWS)
cols = bands(fg.sum(axis=0) > 3, COLS)
PAD = 6
sheet = Image.new("RGBA", (COLS * ART, ROWS * CELL_H), (0, 0, 0, 0))
for ri, (y0, y1) in enumerate(rows):
    for ci, (x0, x1) in enumerate(cols):
        y0p, y1p, x0p, x1p = max(0, y0 - PAD), min(H, y1 + PAD), max(0, x0 - PAD), min(W, x1 + PAD)
        cell = src[y0p:y1p, x0p:x1p]
        plant, dirt = matte(y0p, y1p, x0p, x1p)
        # the dirt tile is 16 art pixels wide; its bottom is the cell's ground line
        lab, _ = ndimage.label(dirt, structure=EIGHT)
        tile = lab == np.bincount(lab.ravel())[1:].argmax() + 1
        ys, xs = np.nonzero(tile)
        dx0, dx1, dy1 = xs.min(), xs.max() + 1, ys.max() + 1
        px = (dx1 - dx0) / ART
        grid = sample(cell, plant, DARK[y0p:y1p, x0p:x1p] & plant, dx0, dy1, px)
        # drop specks: pieces under 3 pixels
        alpha = grid[:, :, 3] > 0
        lab, k = ndimage.label(alpha, structure=EIGHT)
        sizes = ndimage.sum(alpha, lab, range(1, k + 1))
        for j, size in enumerate(sizes, 1):
            if size < 3:
                grid[lab == j] = 0
        sheet.paste(Image.fromarray(grid, "RGBA"), (ci * ART, ri * CELL_H))

out.mkdir(parents=True, exist_ok=True)
sheet.save(out / "crops.png")
sheet.resize((sheet.width * 8, sheet.height * 8), Image.NEAREST).save(Path(__file__).parent / "crops_preview.png")  # not shipped
print(f"rows {rows}\ncols {cols}\n-> {out / 'crops.png'}")
