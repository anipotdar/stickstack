#!/usr/bin/env python3
"""Render StickStack icons (rounded coral tile + peeling white sticker). Usage: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw, ImageFilter
import os
S = 1024
def icon():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # gradient tile
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        r = int(255); g = int(90 + (150 - 90) * t); b = int(54 + (60 - 54) * t)
        gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([24, 24, S - 24, S - 24], radius=230, fill=255)
    im.paste(grad, (0, 0), mask)
    # sticker with shadow
    st = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(st)
    x0, y0, x1, y1 = 230, 220, 800, 790
    fold = 190
    poly = [(x0 + 70, y0), (x1 - 70, y0), (x1, y0 + 70), (x1, y1 - fold), (x1 - fold, y1), (x0 + 70, y1), (x0, y1 - 70), (x0, y0 + 70)]
    d.polygon(poly, fill=(255, 255, 255, 255))
    d.rounded_rectangle([x0, y0, x1, y1 - fold], radius=70, fill=(255, 255, 255, 255))
    d.rounded_rectangle([x0, y0, x1 - fold, y1], radius=70, fill=(255, 255, 255, 255))
    # peeled corner
    d.polygon([(x1, y1 - fold), (x1 - fold, y1), (x1 - fold + 18, y1 - fold + 18)], fill=(255, 214, 196, 255))
    # face
    face = (255, 90, 54, 255)
    d.ellipse([400, 400, 470, 470], fill=face)
    d.ellipse([560, 400, 630, 470], fill=face)
    d.arc([380, 450, 650, 650], start=20, end=160, fill=face, width=44)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.paste((60, 10, 0, 90), (0, 0), st.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    im.alpha_composite(shadow, (0, 18))
    im.alpha_composite(st)
    return im
big = icon()
os.makedirs("extension/icons", exist_ok=True)
for n in (16, 32, 48, 128):
    big.resize((n, n), Image.LANCZOS).save(f"extension/icons/icon{n}.png")
big.resize((512, 512), Image.LANCZOS).save("extension/icons/icon512.png")
print("icons ok")
