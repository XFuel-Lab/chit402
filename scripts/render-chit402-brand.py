#!/usr/bin/env python3
"""Rasterize the Chit402 black/white/blue mark from the horizontal SVG.

Each PNG is drawn at its target pixel size. Nothing is scaled up from a
smaller bitmap. Requires rsvg-convert (librsvg).
"""

from __future__ import annotations

import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "apps/web/public/chit402-logo.svg"
ICON = ROOT / "apps/web/public/chit402-icon.svg"
OG_SVG = ROOT / "apps/web/brand/og-image.svg"
PUBLIC = ROOT / "apps/web/public"
GATEWAY_ICON = ROOT / "services/gateway/src/xfuel-icon.js"


def split_logo(src: str) -> tuple[str, str, str]:
    match = re.search(
        r'<g transform="scale\(0\.194805\)">\s*(.*?)\s*</g>\s*'
        r'(<path fill="#16161c" d="[^"]*"/>)\s*'
        r'(<path fill="#0095b8" d="[^"]*"/>)',
        src,
        re.S,
    )
    if not match:
        raise SystemExit("chit402-logo.svg is missing the receipt group or wordmark paths")
    return match.group(1), match.group(2), match.group(3)


def raster(svg: Path, width: int, height: int, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        ["rsvg-convert", "-w", str(width), "-h", str(height), "-o", str(dest), str(svg)]
    )


def build_ico(pngs: list[tuple[int, int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(pngs))
    entries = b""
    payload = b""
    offset = 6 + 16 * len(pngs)
    for width, height, blob in pngs:
        entries += struct.pack(
            "<BBBBHHII",
            width if width < 256 else 0,
            height if height < 256 else 0,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        payload += blob
        offset += len(blob)
    return header + entries + payload


def sync_gateway(icon_svg: str) -> None:
    text = GATEWAY_ICON.read_text()
    start = text.find("export const CHIT402_ICON_SVG = `")
    end = text.find("`;\n\n/** Legacy export alias. */")
    if start < 0 or end < 0:
        raise SystemExit("xfuel-icon.js is missing the CHIT402_ICON_SVG markers")
    body = icon_svg if icon_svg.endswith("\n") else icon_svg + "\n"
    replacement = "export const CHIT402_ICON_SVG = `" + body + "`;"
    GATEWAY_ICON.write_text(text[:start] + replacement + text[end + 2 :])


def main() -> int:
    icon_inner, chit_path, four_path = split_logo(LOGO.read_text())
    icon_svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -23 662 662" '
        'width="662" height="662" role="img" aria-label="Chit402">\n'
        "  <title>Chit402</title>\n"
        f"  {icon_inner}\n"
        "</svg>\n"
    )
    ICON.write_text(icon_svg)

    # Social card keeps the dark field and the existing lines of copy.
    # "Chit" is lifted to #f4f5f7 so the lockup reads on #0b0b12; "402" stays #0095b8.
    chit_on_dark = chit_path.replace('fill="#16161c"', 'fill="#f4f5f7"', 1)
    og_svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">\n'
        "  <title>Chit402</title>\n"
        '  <rect width="1200" height="630" fill="#0b0b12"/>\n'
        '  <g transform="translate(161 161.5) scale(1.424)">\n'
        '    <g transform="scale(0.194805)">\n'
        f"      {icon_inner}\n"
        "    </g>\n"
        f"    {chit_on_dark}\n"
        f"    {four_path}\n"
        "  </g>\n"
        '  <text x="600" y="378" text-anchor="middle" fill="#a0a0b0" '
        'font-family="Inter, sans-serif" font-size="26" font-weight="500">'
        "A receipt you still hold.</text>\n"
        '  <text x="600" y="568" text-anchor="middle" fill="#606070" '
        'font-family="Inter, sans-serif" font-size="16">XFuel Lab</text>\n'
        "</svg>\n"
    )
    OG_SVG.parent.mkdir(parents=True, exist_ok=True)
    OG_SVG.write_text(og_svg)

    raster(ICON, 1024, 1024, PUBLIC / "chit402-icon.png")
    raster(ICON, 512, 512, PUBLIC / "chit402-mark.png")
    raster(ICON, 180, 180, PUBLIC / "apple-touch-icon.png")
    raster(OG_SVG, 1200, 630, PUBLIC / "og-image.png")

    sizes = {}
    for size in (16, 32, 48):
        dest = PUBLIC / f".chit402-icon-{size}.png"
        raster(ICON, size, size, dest)
        sizes[size] = dest.read_bytes()
        dest.unlink()
    (PUBLIC / "favicon.ico").write_bytes(
        build_ico([(size, size, sizes[size]) for size in (16, 32, 48)])
    )
    sync_gateway(icon_svg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
