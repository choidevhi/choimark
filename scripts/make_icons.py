"""Draws the ChoiMark app icon, the .md document icon and the installer art.

Run from the repo root:  python scripts/make_icons.py
Then:                    corepack pnpm tauri icon src-tauri/icons/app-icon.png
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
WIN = ROOT / "src-tauri" / "windows"
PUBLIC = ROOT / "public"
FONT_DIR = ROOT / "node_modules" / "pretendard" / "dist" / "public" / "static"

TOP = (124, 122, 240)
BOTTOM = (70, 66, 196)


def gradient(size, top, bottom):
    w, h = size
    grad = Image.new("RGB", (1, 256))

    for y in range(256):
        t = y / 255
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

    # Diagonal: rotate a vertical ramp so light comes from the top-left.
    big = grad.resize((max(w, h) * 2, max(w, h) * 2), Image.BICUBIC).rotate(-35, resample=Image.BICUBIC)
    left = (big.width - w) // 2
    top_px = (big.height - h) // 2

    return big.crop((left, top_px, left + w, top_px + h))


def mark_polygons(cx, cy, unit):
    """M and down-arrow, centred on (cx, cy). unit = stroke width."""
    s = unit / 92
    m = [(236, 694), (236, 330), (328, 330), (424, 452), (520, 330), (612, 330), (612, 694),
         (520, 694), (520, 478), (424, 600), (328, 478), (328, 694)]
    shaft = [(700, 330), (792, 330), (792, 548), (700, 548)]
    head = [(640, 530), (852, 530), (746, 694)]
    ox, oy = 544, 512

    def place(points):
        return [(cx + (x - ox) * s, cy + (y - oy) * s) for x, y in points]

    return [place(m), place(shaft), place(head)]


def app_icon(px=1024):
    ss = 4
    size = px * ss
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = round(size * 0.0625)
    radius = round(size * 0.205)
    box = (inset, inset, size - inset, size - inset)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (box[0], box[1] + size * 0.018, box[2], box[3] + size * 0.018), radius=radius, fill=(30, 20, 90, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.02))
    canvas.alpha_composite(shadow)

    tile = gradient((size, size), TOP, BOTTOM).convert("RGBA")
    shine = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse((-size * 0.35, -size * 0.75, size * 1.15, size * 0.42), fill=(255, 255, 255, 30))
    tile.alpha_composite(shine.filter(ImageFilter.GaussianBlur(size * 0.05)))
    canvas.paste(tile, (0, 0), mask)

    rim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(box, radius=radius, outline=(255, 255, 255, 46), width=round(size * 0.006))
    canvas.alpha_composite(rim)

    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph_shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    unit = size * 0.092
    polys = mark_polygons(size / 2, size / 2, unit)
    shadow_polys = mark_polygons(size / 2, size / 2 + size * 0.014, unit)
    gd = ImageDraw.Draw(glyph)
    sd = ImageDraw.Draw(glyph_shadow)

    for poly in shadow_polys:
        sd.polygon(poly, fill=(20, 12, 80, 110))

    for poly in polys:
        gd.polygon(poly, fill=(255, 255, 255, 255))

    canvas.alpha_composite(glyph_shadow.filter(ImageFilter.GaussianBlur(size * 0.012)))
    canvas.alpha_composite(glyph)

    return canvas.resize((px, px), Image.LANCZOS)


def document_icon(px):
    ss = 8
    size = px * ss
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    detailed = px >= 32
    left, right = size * 0.17, size * 0.83
    top, bottom = size * 0.05, size * 0.95
    fold = size * 0.2
    border = max(ss, round(size * 0.022))
    page = [(left, top), (right - fold, top), (right, top + fold), (right, bottom), (left, bottom)]

    if detailed:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).polygon([(x, y + size * 0.015) for x, y in page], fill=(0, 0, 0, 60))
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(size * 0.012)))
        d = ImageDraw.Draw(img)

    d.polygon(page, fill=(252, 252, 255, 255), outline=(150, 154, 172, 255), width=border)
    d.polygon([(right - fold, top), (right - fold, top + fold), (right, top + fold)],
              fill=(222, 224, 236, 255), outline=(150, 154, 172, 255), width=border)

    if detailed:
        line_h = size * 0.035
        for i, width in enumerate((0.46, 0.36, 0.42)):
            y = top + size * (0.25 + i * 0.1)
            d.rounded_rectangle((left + size * 0.1, y, left + size * (0.1 + width), y + line_h),
                                radius=line_h / 2, fill=(204, 207, 222, 255))

    badge_top = size * (0.55 if detailed else 0.42)
    badge = (left + size * 0.06, badge_top, right - size * 0.06, bottom - size * 0.07)
    badge_img = gradient((round(badge[2] - badge[0]), round(badge[3] - badge[1])), TOP, BOTTOM).convert("RGBA")
    badge_mask = Image.new("L", badge_img.size, 0)
    ImageDraw.Draw(badge_mask).rounded_rectangle((0, 0, badge_img.width - 1, badge_img.height - 1),
                                                 radius=size * 0.07, fill=255)
    img.paste(badge_img, (round(badge[0]), round(badge[1])), badge_mask)

    cx = (badge[0] + badge[2]) / 2
    cy = (badge[1] + badge[3]) / 2
    unit = (badge[3] - badge[1]) * (0.17 if detailed else 0.2)

    for poly in mark_polygons(cx, cy, unit):
        d.polygon(poly, fill=(255, 255, 255, 255))

    return img.resize((px, px), Image.LANCZOS)


def save_ico(path, render, sizes):
    images = [render(s) for s in sizes]
    images[-1].save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=images[:-1])


def font(name, size):
    return ImageFont.truetype(str(FONT_DIR / name), size)


def installer_art():
    icon = app_icon(256)

    sidebar = gradient((164, 314), TOP, BOTTOM).convert("RGBA")
    glow = Image.new("RGBA", sidebar.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-90, -120, 230, 150), fill=(255, 255, 255, 30))
    sidebar.alpha_composite(glow)
    mark = app_icon(88)
    sidebar.alpha_composite(mark, (38, 62))
    d = ImageDraw.Draw(sidebar)
    d.text((82, 172), "ChoiMark", font=font("Pretendard-Bold.otf", 22), fill="white", anchor="mm")
    d.text((82, 200), "마크다운 편집기", font=font("Pretendard-Medium.otf", 13), fill=(232, 232, 255), anchor="mm")
    d.text((82, 296), "choidev", font=font("Pretendard-Regular.otf", 11), fill=(214, 214, 250), anchor="mm")
    sidebar.convert("RGB").save(WIN / "nsis-sidebar.bmp")

    header = Image.new("RGBA", (150, 57), (255, 255, 255, 255))
    header.alpha_composite(icon.resize((40, 40), Image.LANCZOS), (102, 8))
    header.convert("RGB").save(WIN / "nsis-header.bmp")


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    WIN.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    app_icon(1024).save(ICONS / "app-icon.png")
    app_icon(256).save(PUBLIC / "app-icon.png")
    app_icon(256).save(ROOT / "src" / "assets" / "app-icon.png")
    save_ico(ICONS / "markdown-file.ico", document_icon, [16, 20, 24, 32, 40, 48, 64, 96, 128, 256])
    document_icon(256).save(ICONS / "markdown-file-preview.png")
    installer_art()
    print("icons written")


if __name__ == "__main__":
    main()
