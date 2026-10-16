"""Cut every object out of a concept sprite sheet (fake-big pixels on a plain backdrop) and sample
each back to true pixel art. The pixel size is measured from the dark outlines' thickness.

usage: uv run --with pillow --with numpy --with scipy python tools/extract_sprites.py <sheet.png> <out_dir> [px]
Writes <out_dir>/<n>.png per object in reading order, and tools/sprites_preview.png (numbered).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

src = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
out = Path(sys.argv[2])
bg = np.median(src[:20, :20].reshape(-1, 3), axis=0)
fg = np.abs(src - bg).sum(axis=2) > 40


def find_backdrop():
    """The backdrop is the backdrop-coloured area connected to the sheet's edge, plus enclosed
    holes of it big enough to be gaps (between a fence's rails). Small light parts of an object
    (white paint, a lantern's glow, shine) are close to the backdrop colour too, but they sit
    inside the object's outline and are small, so they stay."""
    lab, n = ndimage.label(np.abs(src - bg).sum(axis=2) <= 60)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sizes = ndimage.sum(lab > 0, lab, range(n + 1))
    holes = np.flatnonzero(sizes >= px * px * 6)
    return np.isin(lab, np.union1d(edge[edge > 0], holes[holes > 0]))



def outline_px():
    """Most common thickness of dark outline runs, horizontally and vertically."""
    dark = src.sum(axis=2) < 200
    runs = []
    for line in list(dark) + list(dark.T):
        edges = np.flatnonzero(np.diff(np.concatenate([[0], line.astype(int), [0]])))
        runs += list(edges[1::2] - edges[::2])
    runs = [r for r in runs if 2 <= r <= 40]
    vals, counts = np.unique(runs, return_counts=True)
    return float(vals[counts.argmax()])


px = float(sys.argv[3]) if len(sys.argv) > 3 else outline_px()
backdrop = find_backdrop()
# objects: foreground merged across small gaps (a bell's ding marks belong to its typewriter)
merged = ndimage.binary_dilation(fg, iterations=max(2, int(px * 1.6)))
labels, n = ndimage.label(merged)
boxes = []
for sl in ndimage.find_objects(labels):
    ys, xs = sl
    sub = fg[sl]
    if sub.sum() < px * px * 6:
        continue
    yy, xx = np.nonzero(sub)
    boxes.append((ys.start + yy.min(), xs.start + xx.min(), ys.start + yy.max() + 1, xs.start + xx.max() + 1))
# reading order: rows (by vertical centre), then left to right
boxes.sort(key=lambda b: (round(((b[0] + b[2]) / 2) / (px * 12)), b[1]))

out.mkdir(parents=True, exist_ok=True)
for f in out.glob("*.png"):
    f.unlink()
thumbs = []
for i, (y0, x0, y1, x1) in enumerate(boxes):
    w, h = round((x1 - x0) / px), round((y1 - y0) / px)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for gy in range(h):
        for gx in range(w):
            cy, cx = y0 + (gy + 0.5) * px, x0 + (gx + 0.5) * px
            ya, yb = int(cy - px * 0.25), int(cy + px * 0.25) + 1
            xa, xb = int(cx - px * 0.25), int(cx + px * 0.25) + 1
            inside = ~backdrop[ya:yb, xa:xb].reshape(-1)
            if inside.mean() < 0.5:
                continue
            block = src[ya:yb, xa:xb].reshape(-1, 3)[inside]
            vals, counts = np.unique(block, axis=0, return_counts=True)
            c = vals[counts.argmax()]
            img.putpixel((gx, gy), (*map(int, c), 255))
    # drop specks: pieces under 3 pixels
    alpha = np.asarray(img)[:, :, 3] > 0
    lab, k = ndimage.label(alpha, structure=np.ones((3, 3)))
    sizes = ndimage.sum(alpha, lab, range(1, k + 1))
    a = np.asarray(img).copy()
    for j, size in enumerate(sizes, 1):
        if size < 3:
            a[lab == j] = 0
    img = Image.fromarray(a)
    img.save(out / f"{i}.png")
    thumbs.append(img)

# numbered preview at 6x
S = 6
W = sum(t.width * S + 30 for t in thumbs) + 30
H = max(t.height for t in thumbs) * S + 60
prev = Image.new("RGB", (W, H), (245, 242, 230))
d = ImageDraw.Draw(prev)
x = 30
for i, t in enumerate(thumbs):
    prev.paste(t.resize((t.width * S, t.height * S), Image.NEAREST), (x, 40), t.resize((t.width * S, t.height * S), Image.NEAREST))
    d.text((x, 10), f"{i}: {t.width}x{t.height}", fill=(60, 40, 30))
    x += t.width * S + 30
prev.save(Path(__file__).parent / "sprites_preview.png")
print(f"px {px:.2f}, {len(boxes)} objects -> {out}")
