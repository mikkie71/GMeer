"""Genereert het GMeer-icoon: een witte "G+" op een blauwe, afgeronde achtergrond.

Gebruik (vanuit de projectmap):  python scripts/make_icon.py
Schrijft:
  src-tauri/icons/icon.png   (256x256, algemeen)
  src-tauri/icons/icon.ico   (16..256, voor de .exe)
  src-tauri/icons/tray.png   (64x64, tray- en venstericoon; wordt in de app ingebakken)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "icons"
BLUE = (26, 115, 232, 255)  # Google-blauw #1a73e8
WHITE = (255, 255, 255, 255)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",  # Segoe UI Bold
    r"C:\Windows\Fonts\arialbd.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def render(size: int) -> Image.Image:
    # Groot tekenen en daarna verkleinen voor gladde randen
    scale = 8 if size <= 64 else 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    margin = round(s * 0.04)
    d.rounded_rectangle([margin, margin, s - margin, s - margin], radius=round(s * 0.2), fill=BLUE)

    # Kleine iconen: tekst iets groter zodat "G+" leesbaar blijft
    font = load_font(round(s * (0.66 if size <= 24 else 0.6)))
    text = "G+"
    left, top, right, bottom = d.textbbox((0, 0), text, font=font)
    w, h = right - left, bottom - top
    x = (s - w) / 2 - left
    y = (s - h) / 2 - top
    d.text((x, y), text, font=font, fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(256).save(OUT / "icon.png")
    render(64).save(OUT / "tray.png")
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    images = [render(sz) for sz in sizes]
    images[-1].save(OUT / "icon.ico", sizes=[(sz, sz) for sz in sizes], append_images=images[:-1])
    print("Iconen geschreven naar", OUT)


if __name__ == "__main__":
    main()
