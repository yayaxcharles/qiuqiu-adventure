"""把 terrain.json 裡某些鍵的輸出圖（實際的 webp）照「顯示大小」排成聯絡表，墊暗色棋盤，標四角 alpha。
  python tools/view_out.py <輸出檔名> <前綴或區塊.鍵> ...   例：python tools/view_out.py o_s2.png s2_ props.s1_bamboo_fore
→ art_raw/terrain/_view/<輸出檔名>"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public' / 'art'
T = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))


def entries(sel: str):
    out = []

    def walk(v, path, scale):
        if isinstance(v, dict):
            sc = v.get('displayScale', scale)
            if isinstance(v.get('path'), str):
                out.append(('.'.join(path), v['path'], sc))
            for k, x in v.items():
                walk(x, path + [k], sc)
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, path + [str(i)], scale)
    for sec, v in T.items():
        if not isinstance(v, dict):
            continue
        for k, x in v.items():
            name = f'{sec}.{k}'
            if name == sel or (sel.endswith('_') and k.startswith(sel)) or sel == sec:
                walk(x, [sec, k], 1.0)
    return out


def main() -> None:
    items = []
    for s in sys.argv[2:]:
        items += entries(s)
    cells = []
    for name, rel, sc in items:
        a = np.asarray(Image.open(ART / rel).convert('RGBA')).astype(np.float32)
        c = [int(a[0, 0, 3]), int(a[0, -1, 3]), int(a[-1, 0, 3]), int(a[-1, -1, 3])]
        h, w = a.shape[:2]
        k = sc
        if h * k > 360:
            k = 360 / h
        im = Image.fromarray(a.astype(np.uint8), 'RGBA').resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        W = max(im.width, 230)
        bg = Image.new('RGB', (W + 8, im.height + 30), (40, 44, 60))
        d = ImageDraw.Draw(bg)
        for yy in range(24, bg.height, 16):
            for xx in range((yy // 16) % 2 * 16, bg.width, 32):
                d.rectangle((xx, yy, xx + 15, yy + 15), fill=(62, 68, 88))
        bg.paste(im, (4, 26), im)
        d.rectangle((0, 0, bg.width, 22), fill='black')
        d.text((3, 5), f'{name.split(".", 1)[1][:34]} {c}', fill='yellow')
        cells.append(bg)
    rows, cur, cw = [], [], 0
    for c in cells:
        if cur and cw + c.width > 2400:
            rows.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.width + 6
    rows.append(cur)
    H = sum(max(c.height for c in r) + 6 for r in rows)
    sheet = Image.new('RGB', (2400, H), 'white')
    y = 0
    for r in rows:
        x = 0
        for c in r:
            sheet.paste(c, (x, y))
            x += c.width + 6
        y += max(c.height for c in r) + 6
    out = ROOT / 'art_raw' / 'terrain' / '_view' / sys.argv[1]
    sheet.save(out)
    print(out, sheet.size, len(items), '張')


if __name__ == '__main__':
    main()
