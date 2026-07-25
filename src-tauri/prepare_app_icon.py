"""
Erzeugt app-icon-source.png (1024x1024, transparent) aus icon-reference.png.
Entfernt den Schachbrett-/Grau-Hintergrund per Flood-Fill von den Bildrändern.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

OUT_SIZE = 1024
REF_NAME = "icon-reference.png"


def is_background(r: int, g: int, b: int) -> bool:
    """Heller, wenig gesättigter Pixel (Schachbrett / Rand), nicht Icon-Farbe."""
    sat = max(r, g, b) - min(r, g, b)
    avg = (r + g + b) / 3
    if sat > 52:
        return False
    if avg < 95:
        return False
    if avg >= 168 and sat <= 45:
        return True
    return False


def flood_transparent_rgba(im: Image.Image) -> Image.Image:
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h))
    ox = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y][:3]
            ox[x, y] = (r, g, b, 255)

    seen: set[tuple[int, int]] = set()
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if (x, y) in seen:
            continue
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        seen.add((x, y))
        r, g, b, a = ox[x, y]
        if a == 0:
            continue
        if not is_background(r, g, b):
            continue
        ox[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q.append((x + dx, y + dy))
    return out


def main() -> None:
    base = Path(__file__).resolve().parent
    ref = base / REF_NAME
    if not ref.is_file():
        raise SystemExit(f"Fehlt: {ref}")

    im = Image.open(ref).convert("RGB")
    cut = flood_transparent_rgba(im)
    cut = cut.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)

    out = base / "app-icon-source.png"
    cut.save(out, "PNG")
    print(f"Written {out}")


if __name__ == "__main__":
    main()
