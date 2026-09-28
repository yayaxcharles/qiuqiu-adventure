"""把一批截圖縮小排成一張總覽（每張上面標檔名）。

用法：python tools/contact_sheet.py <資料夾> <輸出檔> <檔名清單（逗號分隔，照這個順序排）> [每列幾張=4]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

folder, out, names = Path(sys.argv[1]), Path(sys.argv[2]), [n for n in sys.argv[3].split(",") if n]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
W, H, L = 480, 270, 26
font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 16)
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, rows * (H + L)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    x, y = (i % cols) * W, (i // cols) * (H + L)
    try:
        im = Image.open(folder / n).convert("RGB").resize((W, H), Image.LANCZOS)
        sheet.paste(im, (x, y + L))
    except FileNotFoundError:
        d.text((x + 10, y + L + 100), "（沒有這張）", fill=(255, 80, 80), font=font)
    d.text((x + 4, y + 3), n.rsplit(".", 1)[0], fill=(255, 224, 122), font=font)
sheet.save(out)
print(out, sheet.size)
