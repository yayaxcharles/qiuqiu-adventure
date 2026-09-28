"""把生圖原檔墊棋盤格存成預覽（看透明、看內容）：python tools/view_raw.py art_raw/terrain ground_village house ...
每個名稱用最新一次（或 名稱.tryN），存到 <資料夾>/_view/<名稱>.png，順便印四角 alpha 與透明比例。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(sys.argv[1])
out = root / '_view'
out.mkdir(exist_ok=True)
for name in sys.argv[2:]:
    if '.try' in name:
        src = root / f'{name}.png'
    else:
        t = sorted((p for p in root.glob(f'{name}.try*.png') if '.reject.' not in p.name),
                   key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
        src = t[-1]
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    bg = np.where((((yy // 32 + xx // 32) % 2) == 1)[..., None], [150, 160, 185], [110, 120, 145]).astype(np.float32)
    al = a[..., 3:4] / 255
    im = Image.fromarray((a[..., :3] * al + bg * (1 - al)).astype(np.uint8))
    im.save(out / f'{src.stem}.png')
    c = [int(a[0, 0, 3]), int(a[0, -1, 3]), int(a[-1, 0, 3]), int(a[-1, -1, 3])]
    print(f'{src.name} {w}x{h} 四角 alpha {c} 透明比例 {float((a[..., 3] < 16).mean()):.2f} → {out / (src.stem + ".png")}')
