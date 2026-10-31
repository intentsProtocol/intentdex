"""Draws the app's icons into assets/images: Cham's tail spiral and eye on the brand's dark green.

    python scripts/make-icons.py

Needs Pillow. The drawing is done at four times the size and scaled down, which is what smooths the edges.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path(__file__).resolve().parent.parent / "assets" / "images"
OUT.mkdir(parents=True, exist_ok=True)

BG_TOP, BG_BOTTOM = (11, 31, 23), (4, 14, 10)
EMERALD, EMERALD_LIGHT = (0, 209, 143), (120, 240, 200)
SS = 4


def background(size, rounded=False):
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        row = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = row
    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=255)
        img.putalpha(mask)
    return img


def mark(size, scale=1.0, colour=EMERALD, eye=True, light=EMERALD_LIGHT):
    """The mark on a transparent square: a spiral tail that opens into a head with one round eye."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = big / 2, big / 2
    unit = big * 0.30 * scale
    width = max(2, round(unit * 0.26))

    # An Archimedean spiral, drawn as overlapping dots so the stroke has round ends and joins.
    turns, steps = 1.75, 900
    last = None
    for i in range(steps + 1):
        t = i / steps
        angle = math.pi * 2 * turns * t + math.pi * 0.35
        radius = unit * (0.12 + 0.88 * t)
        x, y = cx + math.cos(angle) * radius, cy + math.sin(angle) * radius
        draw.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=colour + (255,))
        last = (x, y)

    if eye and last:
        # The head sits where the spiral ends.
        hx, hy = last
        head = width * 1.15
        draw.ellipse([hx - head, hy - head, hx + head, hy + head], fill=colour + (255,))
        white = head * 0.62
        draw.ellipse([hx - white, hy - white, hx + white, hy + white], fill=(255, 255, 255, 255))
        pupil = head * 0.32
        ox = head * 0.12
        draw.ellipse([hx - pupil + ox, hy - pupil, hx + pupil + ox, hy + pupil], fill=(8, 18, 14, 255))
        glint = head * 0.11
        draw.ellipse([hx + ox + pupil * 0.2, hy - pupil * 0.75, hx + ox + pupil * 0.2 + glint * 2, hy - pupil * 0.75 + glint * 2], fill=light + (255,))
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    img.save(OUT / name)
    print(f"wrote {name} {img.size[0]}x{img.size[1]}")


# App icon: full-bleed square; the stores round the corners themselves.
icon = background(1024)
icon.alpha_composite(mark(1024, 1.0))
save(icon.convert("RGB"), "icon.png")

# Android adaptive icon: the launcher crops to its own shape, so the mark stays inside the middle two thirds.
save(background(1024).convert("RGB"), "android-icon-background.png")
save(mark(1024, 0.62), "android-icon-foreground.png")
save(mark(1024, 0.62, colour=(255, 255, 255), eye=False), "android-icon-monochrome.png")

# Splash: the mark alone, on the background colour set in app.json.
save(mark(512, 1.0), "splash-logo.png")
