"""把 anims.json 的每一格照基準點（腳底中線）貼到同一條地平線上，排成一張檢查表：
對得準的話，原地動作的腳會一直踩在紅線上、身體不會左右飄。"""
import json, sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "public" / "sprites" / "qiuqiu"
anims = json.loads((D / "anims.json").read_text(encoding="utf-8"))
names = sys.argv[1:] or [k for k in anims if not k.startswith("_")]
CW, CH, GY = 300, 300, 270   # 每格畫布、地平線高度
rows = []
for n in names:
    a = anims[n]
    fr = a["frames"]
    cols = min(len(fr), 12)
    step = max(1, len(fr) // cols)
    pick = fr[::step][:cols]
    row = Image.new("RGB", (cols * CW, CH + 20), (40, 44, 60))
    dr = ImageDraw.Draw(row)
    dr.text((4, 2), f"{n}  {len(fr)} 格  loop={a['loop']}  " + "  ".join(f"{k}={a[k]}" for k in ("hit", "release") if k in a), fill=(255, 255, 255))
    for i, f in enumerate(pick):
        im = Image.open(D / n / f["f"]).convert("RGBA")
        ox, oy = i * CW + CW // 2 - round(f["ax"]), 20 + GY - round(f["ay"])
        row.paste(im, (ox, oy), im)
        dr.line((i * CW, 20 + GY, (i + 1) * CW, 20 + GY), fill=(255, 60, 60))
        dr.line((i * CW + CW // 2, 20, i * CW + CW // 2, 20 + CH), fill=(60, 200, 255))
    rows.append(row)
W = max(r.width for r in rows)
sheet = Image.new("RGB", (W, sum(r.height for r in rows)), (20, 20, 28))
y = 0
for r in rows:
    sheet.paste(r, (0, y)); y += r.height
out = ROOT / "vids" / "_sprite_check.png"
sheet.save(out)
print(out, sheet.size)
