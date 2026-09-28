"""第三批原檔聯絡表：python tools/contact_fx2.py <輸出檔名> [--dark] 名稱1 名稱2 ...  → art_raw/fx2/_view/<輸出檔名>
每格墊棋盤格（--dark 墊暗色，看亮的特效），標名稱與四角 alpha；格高一致、自動換列。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAW = Path(__file__).resolve().parents[1] / 'art_raw' / 'fx2'


def src_of(name: str) -> Path:
    if '.try' in name:
        return RAW / f'{name}.png'
    t = sorted((p for p in RAW.glob(f'{name}.try*.png') if '.reject.' not in p.name),
               key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
    return t[-1]


def cell(name: str, h: int, dark: bool) -> np.ndarray:
    p = src_of(name)
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[:H, :W]
    c1, c2 = ([40, 44, 60], [66, 72, 92]) if dark else ([150, 160, 185], [110, 120, 145])
    bg = np.where((((yy // 32 + xx // 32) % 2) == 1)[..., None], c1, c2).astype(np.float32)
    al = a[..., 3:4] / 255
    im = Image.fromarray((a[..., :3] * al + bg * (1 - al)).astype(np.uint8))
    im = im.resize((round(W * h / H), h), Image.LANCZOS)
    c = [int(a[0, 0, 3]), int(a[0, -1, 3]), int(a[-1, 0, 3]), int(a[-1, -1, 3])]
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 360, 18), fill='black')
    d.text((4, 3), f'{p.stem} {c}', fill='yellow')
    return np.asarray(im)


def main() -> None:
    args = sys.argv[1:]
    out = args.pop(0)
    dark = '--dark' in args
    names = [a for a in args if a != '--dark']
    width, h = 2600, 400
    cells = [cell(n, h, dark) for n in names]
    rows, cur, cw = [], [], 0
    for c in cells:
        if cur and cw + c.shape[1] > width:
            rows.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.shape[1] + 8
    rows.append(cur)
    R = [np.concatenate([np.pad(c, ((4, 4), (4, 4), (0, 0)), constant_values=255) for c in r], 1) for r in rows]
    wmax = max(r.shape[1] for r in R)
    R = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0)), constant_values=255) for r in R]
    (RAW / '_view').mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.concatenate(R, 0)).save(RAW / '_view' / out)
    print(RAW / '_view' / out)


if __name__ == '__main__':
    main()
