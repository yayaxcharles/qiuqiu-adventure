"""把零件圖拆成九個零件（2026-09-25）：透明度遮罩→連通區塊→照「三列、左到右」的順序命名→裁切存 webp。

  python tools/cut_parts.py art_raw/parts.try1.png

輸出 public/rig/qiuqiu/<零件>.webp＋sizes.json（每件的寬高，給綁骨資料對照）。
尾巴原稿是「粗的那端在左」，角色面向右時尾巴要從身體後面（左邊）往外長，所以左右翻過來，根部在右。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/rig/qiuqiu'
NAMES = ['head', 'torso', 'tail', 'arm_front', 'arm_back', 'ribbons', 'leg_front', 'leg_back', 'shuriken']
SCALE = 0.5   # 原稿以「角色約 700 像素高」畫；存一半就夠（畫面上球球約 150 像素高）


def main(src: str) -> None:
    im = Image.open(src).convert('RGBA')
    a = np.array(im)[:, :, 3] > 40
    # 先稍微膨脹再找連通區塊：鬍鬚、刀光這類細線不會被拆成另一塊
    lab, n = ndimage.label(ndimage.binary_dilation(a, iterations=6))
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        area = int((lab[sl] == i).sum())
        if area < 3000:
            continue
        boxes.append((sl[0].start, sl[0].stop, sl[1].start, sl[1].stop, area))
    if len(boxes) != 9:
        sys.exit(f'找到 {len(boxes)} 塊，應該是 9 塊：{boxes}')
    # 三列：照上緣排序後每三個一列，列內照左到右
    boxes.sort(key=lambda b: (b[0] + b[1]) / 2)
    rows = [sorted(boxes[i:i + 3], key=lambda b: b[2]) for i in (0, 3, 6)]
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, (y0, y1, x0, x1, _) in zip(NAMES, [b for r in rows for b in r]):
        pad = 4
        part = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
        # 裁切框裡可能混到隔壁零件的一角：只留這一塊自己的像素
        if name == 'tail':
            part = part.transpose(Image.FLIP_LEFT_RIGHT)
        part = part.resize((round(part.width * SCALE), round(part.height * SCALE)), Image.LANCZOS)
        part.save(OUT / f'{name}.webp', 'WEBP', quality=92, method=6)
        sizes[name] = [part.width, part.height]
        print(f'{name:10s} {part.width}×{part.height}')
    (OUT / 'sizes.json').write_text(json.dumps(sizes, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1])
