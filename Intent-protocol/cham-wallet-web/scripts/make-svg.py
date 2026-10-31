import math
from pathlib import Path

OUT = Path("public/logos/wallets/main.svg")
size = 512
cx, cy = size / 2, size / 2
scale = 1.0
unit = size * 0.30 * scale
stroke_width = max(2, round(unit * 0.26))

turns, steps = 1.75, 400
points = []
for i in range(steps + 1):
    t = i / steps
    angle = math.pi * 2 * turns * t + math.pi * 0.35
    radius = unit * (0.12 + 0.88 * t)
    x = cx + math.cos(angle) * radius
    y = cy + math.sin(angle) * radius
    points.append((x, y))

path_d = f"M {points[0][0]:.2f} {points[0][1]:.2f} " + " ".join(
    f"L {x:.2f} {y:.2f}" for x, y in points[1:]
)

hx, hy = points[-1]
head = stroke_width * 1.15
white = head * 0.62
pupil = head * 0.32
ox = head * 0.12
glint = head * 0.11

svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" fill="none">
  <path d="{path_d}" stroke="#00D18F" stroke-width="{stroke_width}" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="{hx:.2f}" cy="{hy:.2f}" r="{head:.2f}" fill="#00D18F" />
  <circle cx="{hx:.2f}" cy="{hy:.2f}" r="{white:.2f}" fill="#FFFFFF" />
  <circle cx="{(hx + ox):.2f}" cy="{hy:.2f}" r="{pupil:.2f}" fill="#08120E" />
  <circle cx="{(hx + ox + pupil * 0.2 + glint):.2f}" cy="{(hy - pupil * 0.75 + glint):.2f}" r="{glint:.2f}" fill="#78F0C8" />
</svg>'''

OUT.write_text(svg_content, encoding="utf-8")
print(f"Generated {OUT} successfully!")
