from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path("public/icons")
OUT.mkdir(parents=True, exist_ok=True)

EMERALD = (0, 209, 143)
EMERALD_LIGHT = (120, 240, 200)
SS = 4

def mark(size, scale=1.0, colour=EMERALD, eye=True, light=EMERALD_LIGHT):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = big / 2, big / 2
    unit = big * 0.30 * scale
    width = max(2, round(unit * 0.26))

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

# Browser extension icons
for s in [16, 32, 48, 128, 256, 512]:
    save(mark(s, 1.0), f"icon-{s}.png")

# Also replace bchintentslogo_edited.png and bchintentslogo.png
large = mark(512, 1.0)
save(large, "bchintentslogo_edited.png")
save(large, "bchintentslogo.png")
save(large, "logo.png")
