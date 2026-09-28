"""把幾張生圖原檔（最新一次或指定 .tryN）墊棋盤格拼成一張看：
  python tools/contact.py <輸出檔名> <寬> 名稱1 名稱2 ...     → art_raw/terrain/_view/<輸出檔名>
每格標名稱與四角 alpha；每列放兩張（寬圖）或三張（其他），格高一致。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RAW = Path(__file__).resolve().parents[1] / 'art_raw' / 'terrain'


def src_of(name: str) -> Path:
    if '.try' in name:
        return RAW / f'{name}.png'
    t = sorted((p for p in RAW.glob(f'{name}.try*.png') if '.reject.' not in p.name),
               key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
    return t[-1]


def cell(name: str, h: int) -> np.ndarray:
    p = src_of(name)
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[:H, :W]
    bg = np.where((((yy // 32 + xx // 32) % 2) == 1)[..., None], [150, 160, 185], [110, 120, 145]).astype(np.float32)
    al = a[..., 3:4] / 255
    im = Image.fromarray((a[..., :3] * al + bg * (1 - al)).astype(np.uint8))
    im = im.resize((round(W * h / H), h), Image.LANCZOS)
    c = [int(a[0, 0, 3]), int(a[0, -1, 3]), int(a[-1, 0, 3]), int(a[-1, -1, 3])]
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 330, 18), fill='black')
    d.text((4, 3), f'{p.stem} {c}', fill='yellow')
    return np.asarray(im)


def main() -> None:
    out, width, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    h = 420
    cells = [cell(n, h) for n in names]
    rows, cur, cw = [], [], 0
    for c in cells:
        if cur and cw + c.shape[1] > width:
            rows.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.shape[1] + 8
    rows.append(cur)
    R = []
    for r in rows:
        row = np.concatenate([np.pad(c, ((4, 4), (4, 4), (0, 0)), constant_values=255) for c in r], 1)
        row = np.pad(row, ((0, 0), (0, max(0, width - row.shape[1])), (0, 0)), constant_values=255)[:, :max(width, row.shape[1])]
        R.append(row)
    wmax = max(r.shape[1] for r in R)
    R = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0)), constant_values=255) for r in R]
    (RAW / '_view').mkdir(exist_ok=True)
    Image.fromarray(np.concatenate(R, 0)).save(RAW / '_view' / out)
    print(RAW / '_view' / out)


if __name__ == '__main__':
    main()
