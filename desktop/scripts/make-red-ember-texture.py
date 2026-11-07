"""Procedural dark red smoke-and-embers backdrop for the Red Ember Frame theme (original artwork).
Fractal noise smoke lit by red light from both sides, a few drifting sparks and fine grain.

Usage: python3 make-red-ember-texture.py OUT.png [WIDTH HEIGHT]
       python3 make-red-ember-texture.py OUT.mp4 [WIDTH HEIGHT]   (seamless 16 s loop, needs ffmpeg)
  Full screen: 1920 1080 (default). Lower-third band: 1920 320.
Then for stills: cwebp -q 82 OUT.png -o public/theme-backgrounds/<name>.webp

The video is deliberately quiet: the smoke circles a few pixels, the side light breathes a few percent
and the sparks sway and twinkle in place, so it reads as a living background behind the verse."""
import math
import subprocess
import sys
import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "red-ember.png"
W = int(sys.argv[2]) if len(sys.argv) > 3 else 1920
H = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
FPS, LOOP_S = 30, 16
PAD = 48  # smoke is drawn larger so it can drift without showing an edge
rng = np.random.default_rng(7)
PW, PH = W + 2 * PAD, H + 2 * PAD


def smooth_noise(sx, sy):
    small = rng.random((max(2, sy), max(2, sx))).astype(np.float32)
    img = Image.fromarray((small * 65535).astype(np.uint16)).resize((PW, PH), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 65535.0


def fbm(bx, by, octaves=5):
    total = np.zeros((PH, PW), np.float32); amp = 1.0; norm = 0.0
    for o in range(octaves):
        total += amp * smooth_noise(bx * 2 ** o, by * 2 ** o); norm += amp; amp *= 0.5
    return total / norm


def blur(a, sigma):
    """Gaussian blur of a float field (Pillow cannot blur float images)."""
    k = np.exp(-0.5 * (np.arange(-3 * sigma, 3 * sigma + 1) / sigma) ** 2); k /= k.sum()
    a = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, np.pad(a, ((0, 0), (len(k), len(k))), mode="edge"))[:, len(k):-len(k)]
    return np.apply_along_axis(lambda c: np.convolve(c, k, mode="same"), 0, np.pad(a, ((len(k), len(k)), (0, 0)), mode="edge"))[len(k):-len(k), :]


def smoke_field():
    rows = max(2, round(4 * H / 1080))
    s = fbm(5, rows, 6)
    s = np.clip((s - 0.35) * 1.9, 0, 1) ** 1.6
    # A soft blur hides the noise grid from the upscaled octaves.
    return blur(s, 3).astype(np.float32)


# Two smoke layers drift on opposite circles; together they slowly churn, and both return home at the loop end.
SMOKE_A, SMOKE_B = smoke_field(), smoke_field()

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = xs / W, ys / H
# Red light pouring in from the left and right edges, stronger low on the left and high on the right.
LEFT = np.exp(-((u - 0.0) / 0.32) ** 2) * (0.55 + 0.45 * v)
RIGHT = np.exp(-((u - 1.0) / 0.30) ** 2) * (1.0 - 0.5 * v)
CENTRE = np.exp(-(((u - 0.5) / 0.45) ** 2 + ((v - 0.45) / 0.55) ** 2))  # faint warmth behind the text
VIG = np.clip(1 - 0.55 * (((u - 0.5) * 1.3) ** 2 + ((v - 0.5) * 1.1) ** 2), 0.35, 1)[..., None]
BASE = np.array([10, 4, 4], np.float32)
RED = np.array([168, 18, 14], np.float32)
HOT = np.array([255, 92, 40], np.float32)
SPARK_RGB = np.array([255, 150, 80], np.float32)

# Sparks: position, brightness, sway radius and twinkle phase. Whole cycles per loop keep it seamless.
N_SPARKS = int(140 * W * H / (1920 * 1080))
SP_X = rng.uniform(0, W, N_SPARKS); SP_Y = rng.uniform(0, H, N_SPARKS)
SP_B = rng.uniform(0.4, 1.0, N_SPARKS)
SP_R = rng.uniform(4, 16, N_SPARKS)
SP_PH = rng.uniform(0, 2 * math.pi, N_SPARKS)
SP_K = rng.integers(1, 4, N_SPARKS)  # sway cycles per loop
SP_TW = rng.integers(2, 6, N_SPARKS)  # twinkle cycles per loop
GRAIN = [rng.normal(0, 3.2, (H, W, 1)).astype(np.float32) for _ in range(4)]


def window(field, dx, dy):
    x0, y0 = int(round(PAD + dx)), int(round(PAD + dy))
    return field[y0:y0 + H, x0:x0 + W]


def frame(t):
    """One frame at time t (seconds). t = 0 is the still picture."""
    p = 2 * math.pi * t / LOOP_S
    r = 22 * H / 1080 + 10
    smoke = 0.5 * window(SMOKE_A, r * math.cos(p), r * 0.6 * math.sin(p)) + \
        0.5 * window(SMOKE_B, -r * math.cos(p + 1.3), r * 0.6 * math.sin(p + 1.3))
    smoke = np.clip(smoke * 1.25, 0, 1)
    breathe = 1 + 0.06 * math.sin(p) + 0.03 * math.sin(2 * p + 0.7)
    light = np.clip(LEFT * (1 + 0.05 * math.sin(p + 2.1)) + RIGHT * 0.9 * (1 + 0.05 * math.sin(p + 4.2)), 0, 1)
    glow = (light * (0.45 + 1.15 * smoke) + CENTRE * 0.12 * smoke) * breathe
    img = BASE + glow[..., None] * RED + (np.clip(glow - 0.75, 0, 1) * 2.0)[..., None] * (HOT - RED)
    img = img * VIG

    spark = np.zeros((H, W), np.float32)
    sx = (SP_X + SP_R * np.cos(SP_K * p + SP_PH)).astype(int) % W
    sy = (SP_Y + SP_R * 0.7 * np.sin(SP_K * p + SP_PH)).astype(int) % H
    tw = 0.55 + 0.45 * np.sin(SP_TW * p + SP_PH)
    np.add.at(spark, (sy, sx), SP_B * tw * (0.4 + 0.6 * (light[sy, sx] + 0.15)))
    spark_img = Image.fromarray(np.clip(spark * 255, 0, 255).astype(np.uint8))
    core = np.asarray(spark_img.filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255 * 6
    bloom = np.asarray(spark_img.filter(ImageFilter.GaussianBlur(6)), np.float32) / 255 * 14
    img = img + (np.clip(core, 0, 1) + np.clip(bloom, 0, 1) * 0.35)[..., None] * SPARK_RGB

    img = img + GRAIN[int(t * FPS) % len(GRAIN)]
    return np.clip(img, 0, 255).astype(np.uint8)


if OUT.lower().endswith(".mp4"):
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-tune", "grain", "-pix_fmt", "yuv420p", "-g", str(FPS * 4),
         "-movflags", "+faststart", "-an", OUT],
        stdin=subprocess.PIPE)
    for i in range(FPS * LOOP_S):
        ff.stdin.write(frame(i / FPS).tobytes())
    ff.stdin.close()
    sys.exit(ff.wait())
Image.fromarray(frame(0)).save(OUT)
