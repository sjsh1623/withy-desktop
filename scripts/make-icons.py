#!/usr/bin/env python3
"""
Generates the desktop app icons. Run: python3 scripts/make-icons.py  (needs Pillow)

Why this exists instead of "just point electron-builder at the app icon":

  * v1.0.0 shipped the bare mark (edge-to-edge, no breathing room) and it read
    as a cropped W. The phone icon has the proportion we actually want: the
    mark spans 68.9% of the plate width, centred. That ratio is reproduced
    here so the desktop icon reads at the same weight as the phone icon.
  * macOS expects the artwork inside a rounded rect covering 824/1024 of the
    canvas with transparency around it. That margin is what makes the Dock
    line up — a full-bleed square looks oversized next to every system app.
    Windows applies no mask, so it gets the full canvas.

The mark source (`build/src/mark-plate.png`) is cropped straight out of the
iOS app icon and is deliberately OPAQUE, plate background included. The mark
is a vertical gradient and keying it to transparency leaves a pale halo at the
anti-aliased rim (the same trap documented in tossa's mobile/CLAUDE.md for the
splash asset). Since the destination plate is the identical near-white, an
opaque paste is seamless and keeps the gradient byte-exact.

Outputs (both consumed by electron-builder.yml):
  build/icon.png      1024²  macOS — transparent margin + rounded plate
  build/icon-win.png  1024²  Windows — full-bleed plate
"""

from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARK_PLATE = ROOT / 'build' / 'src' / 'mark-plate.png'

SIZE = 1024
PLATE = (254, 253, 253, 255)      # sampled from the iOS icon plate (uniform)
MARK_RATIO = 0.689                # mark width ÷ plate width, matching iOS
MARK_CENTER_Y = 0.5064            # iOS sits the mark a hair above centre
CROP_PAD = 8                      # plate margin baked into mark-plate.png, per side

# macOS: Apple's own icons occupy 824 of a 1024 canvas with a ~185px corner.
MAC_PLATE = 824
MAC_RADIUS = 185


def rounded_plate(size: int, radius: int) -> Image.Image:
    plate = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=PLATE)
    return plate


def place_mark(plate: Image.Image) -> None:
    """Pastes the mark at the iOS proportion, measured on the mark itself."""
    src = Image.open(MARK_PLATE).convert('RGBA')
    # MARK_RATIO refers to the glyph, not the padded crop — scale accordingly.
    glyph_w = src.width - 2 * CROP_PAD
    target_glyph = plate.width * MARK_RATIO
    scale = target_glyph / glyph_w
    resized = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)

    x = (plate.width - resized.width) // 2
    y = round(plate.height * MARK_CENTER_Y - resized.height / 2)
    plate.alpha_composite(resized, (x, y))


def build_mac() -> Image.Image:
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    off = (SIZE - MAC_PLATE) // 2

    # Soft contact shadow — a near-white plate on a light Dock needs *some*
    # separation or it reads as a floating blob with no edge.
    shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [off, off + 10, off + MAC_PLATE, off + MAC_PLATE + 10],
        radius=MAC_RADIUS, fill=(0, 0, 0, 60))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))

    plate = rounded_plate(MAC_PLATE, MAC_RADIUS)
    place_mark(plate)
    canvas.alpha_composite(plate, (off, off))
    return canvas


def build_win() -> Image.Image:
    # Windows draws the icon unmasked, so the plate fills the canvas — the same
    # look as the phone icon, which is what "match the app icon" means here.
    plate = rounded_plate(SIZE, 96)
    place_mark(plate)
    return plate


if __name__ == '__main__':
    build_mac().save(ROOT / 'build' / 'icon.png')
    build_win().save(ROOT / 'build' / 'icon-win.png')
    print('wrote build/icon.png (macOS) and build/icon-win.png (Windows)')
