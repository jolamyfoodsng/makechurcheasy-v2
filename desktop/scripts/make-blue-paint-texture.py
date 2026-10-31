"""Procedural blue acrylic-paint texture for the Blue Paint Banner theme (original artwork).
Fractal noise, domain-warped so it swirls like spread paint, mapped onto a blue colour ramp.

Usage: python3 make-blue-paint-texture.py OUT.png [WIDTH HEIGHT]
  Lower-third band: 1920 320 (default). Full screen: 1920 1080.
Then: cwebp -q 80 OUT.png -o public/theme-backgrounds/<name>.webp"""
import sys
import numpy as np
from PIL import Image, ImageFilter

W = int(sys.argv[2]) if len(sys.argv) > 3 else 1920
H = int(sys.argv[3]) if len(sys.argv) > 3 else 320
ROWS = H / 320  # noise is tuned for a 320 px band; scale its rows with the height
rng = np.random.default_rng(11)

def smooth_noise(scale_x, scale_y):
    small = rng.random((scale_y, scale_x)).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0

def fbm(base_x, base_y, octaves=5):
    total = np.zeros((H, W), np.float32); amp = 1.0; norm = 0.0
    for o in range(octaves):
        total += amp * smooth_noise(base_x * 2 ** o, max(2, base_y * 2 ** o)); norm += amp; amp *= 0.5
    return total / norm

# Domain warp: sample a field at coordinates pushed around by two other fields.
wx = fbm(6, max(2, round(2 * ROWS))) - 0.5
wy = fbm(6, max(2, round(2 * ROWS))) - 0.5
field = fbm(9, max(3, round(3 * ROWS)), 6)
yy, xx = np.mgrid[0:H, 0:W]
sx = np.clip((xx + wx * 520).astype(int), 0, W - 1)
sy = np.clip((yy + wy * 140 * ROWS).astype(int), 0, H - 1)
v = field[sy, sx]
# Sharpen the paint edges a little.
v = (v - v.min()) / (v.max() - v.min())
v = 0.5 + np.tanh((v - 0.5) * 3.2) / (2 * np.tanh(1.6))

ramp = np.array([
    [8, 30, 64], [12, 52, 102], [20, 84, 138], [32, 118, 164],
    [62, 152, 188], [104, 176, 204], [150, 204, 224],
], np.float32)
pos = v * (len(ramp) - 1)
i0 = np.clip(pos.astype(int), 0, len(ramp) - 2)
t = (pos - i0)[..., None]
rgb = ramp[i0] * (1 - t) + ramp[i0 + 1] * t

# Brush grain along x, plus fine noise.
grain = np.asarray(Image.fromarray((rng.random((H // 2, W // 24)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255.0
rgb *= (0.95 + grain[..., None] * 0.1)
rgb += rng.normal(0, 5, rgb.shape)

# A few warm speckles in the lower left, like the reference.
img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
px = img.load()
for _ in range(60):
    x = int(rng.integers(0, W // 5)); y = int(rng.integers(H // 2, H))
    for dx in (0, 1):
        for dy in (0, 1):
            if x + dx < W and y + dy < H:
                px[x + dx, y + dy] = (214, 172, 64)

img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
# Darken a touch so bold white text stays readable.
dark = Image.new("RGB", (W, H), (6, 22, 48))
Image.blend(img, dark, 0.26).save(sys.argv[1])
