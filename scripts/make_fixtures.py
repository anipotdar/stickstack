#!/usr/bin/env python3
"""Generate test fixtures that mimic real WhatsApp sticker exports and edge cases.

Usage: python3 scripts/make_fixtures.py test/fixtures
"""
import io
import math
import os
import sys
import zipfile
import gzip

from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "test/fixtures"
os.makedirs(out, exist_ok=True)


def sticker(color, label, size=512, alpha_edge=True):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = size // 10
    # white sticker outline, like real WhatsApp stickers
    d.ellipse([pad - 12, pad - 12, size - pad + 12, size - pad + 12], fill=(255, 255, 255, 255))
    d.ellipse([pad, pad, size - pad, size - pad], fill=color)
    d.text((size // 2 - 20, size // 2 - 10), label, fill=(0, 0, 0, 255))
    if alpha_edge:
        # soft shadow ring with partial alpha
        d.ellipse([pad - 20, pad - 20, size - pad + 20, size - pad + 20], outline=(0, 0, 0, 90), width=6)
    return im


def anim_frames(n=12, size=512):
    frames = []
    for i in range(n):
        im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        a = 2 * math.pi * i / n
        cx, cy = size / 2 + math.cos(a) * size / 4, size / 2 + math.sin(a) * size / 4
        d.ellipse([cx - 80, cy - 80, cx + 80, cy + 80], fill=(255, 255, 255, 255))
        d.ellipse([cx - 68, cy - 68, cx + 68, cy + 68], fill=(255, 90 + i * 12, 40, 255))
        frames.append(im)
    return frames


def save(name, data):
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)


def to_bytes(im, fmt, **kw):
    b = io.BytesIO()
    im.save(b, fmt, **kw)
    return b.getvalue()


# 1. static WebP stickers (lossless + lossy)
s1 = to_bytes(sticker((255, 120, 40, 255), "hi"), "WEBP", lossless=True)
s2 = to_bytes(sticker((60, 140, 255, 255), "ok"), "WEBP", quality=80)
save("static-lossless.webp", s1)
save("static-lossy.webp", s2)

# 2. animated WebP (12 frames, 80ms, loop forever) + one with 10ms frames + identical frames
fr = anim_frames(12)
anim = to_bytes(fr[0], "WEBP", save_all=True, append_images=fr[1:], duration=80, loop=0, lossless=False, quality=80)
save("animated.webp", anim)
fast = to_bytes(fr[0], "WEBP", save_all=True, append_images=fr[1:], duration=[10] * 12, loop=0)
save("animated-10ms.webp", fast)
dup = [fr[0], fr[0], fr[0], fr[1], fr[1], fr[2]]
save("animated-dupes.webp", to_bytes(dup[0], "WEBP", save_all=True, append_images=dup[1:], duration=[50, 50, 50, 15, 15, 200], loop=2))

# 3. APNG, GIF, PNG, JPEG, non-square PNG, tiny PNG
save("animated.png", to_bytes(fr[0], "PNG", save_all=True, append_images=fr[1:], duration=100, loop=0))
gif_frames = [f.convert("RGBA") for f in fr]
save("animated.gif", to_bytes(gif_frames[0], "GIF", save_all=True, append_images=gif_frames[1:], duration=60, loop=0, disposal=2))
save("still.png", to_bytes(sticker((120, 200, 90, 255), "png"), "PNG"))
save("photo.jpg", to_bytes(sticker((200, 50, 120, 255), "jpg").convert("RGB"), "JPEG", quality=85))
wide = Image.new("RGBA", (1200, 400), (255, 255, 255, 0))
ImageDraw.Draw(wide).rectangle([20, 20, 1180, 380], fill=(30, 30, 30, 255))
save("wide-meme.png", to_bytes(wide, "PNG"))
save("tiny.png", to_bytes(Image.new("RGBA", (8, 8), (255, 0, 0, 255)), "PNG"))

# 4. Broken / unsupported
save("truncated.webp", s1[: len(s1) // 3])
save("not-an-image.webp", b"hello world, definitely not a webp")
save("empty.webp", b"")
save("telegram.tgs", gzip.compress(b'{"v":"5.5.2","layers":[]}'))
save("video.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 64)
save("photo.heic", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64)
save("duplicate-of-static.webp", s1)

# 5. Android "WhatsApp Stickers" folder as zip, with OS junk
with zipfile.ZipFile(os.path.join(out, "android-folder.zip"), "w") as z:
    z.writestr("WhatsApp Stickers/STK-20240101-WA0001.webp", s1)
    z.writestr("WhatsApp Stickers/STK-20240101-WA0002.webp", s2)
    z.writestr("WhatsApp Stickers/STK-20240101-WA0003.webp", anim)
    z.writestr("WhatsApp Stickers/.nomedia", b"")
    z.writestr("__MACOSX/WhatsApp Stickers/._STK-20240101-WA0001.webp", b"junk")
    z.writestr("WhatsApp Stickers/readme.txt", b"hello")

# 6. .wastickers pack
tray = to_bytes(sticker((0, 0, 0, 255), "t", size=96), "PNG")
with zipfile.ZipFile(os.path.join(out, "cats.wastickers"), "w") as z:
    z.writestr("title.txt", "Desi Cats 😺")
    z.writestr("author.txt", "Anon")
    z.writestr("tray.png", tray)
    for i in range(3):
        z.writestr(f"{i:02d}.webp", to_bytes(sticker((255, 40 * i + 60, 200, 255), f"c{i}"), "WEBP", quality=75))

# 7. zip containing a .wastickers + multi-folder layout
with zipfile.ZipFile(os.path.join(out, "nested.zip"), "w") as z:
    z.write(os.path.join(out, "cats.wastickers"), "packs/cats.wastickers")
    z.writestr("Funny/a.webp", to_bytes(sticker((10, 200, 200, 255), "f1"), "WEBP"))
    z.writestr("Love/b.webp", to_bytes(sticker((250, 20, 80, 255), "l1"), "WEBP"))

# 8. corrupted zip
save("broken.zip", b"PK\x03\x04" + os.urandom(200))

print("fixtures written to", out, len(os.listdir(out)), "files")
