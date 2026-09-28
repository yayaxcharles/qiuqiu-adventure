"""從各關長卷背景疊出幾個畫面，裁成 3:1／3:2／2:3 三種比例當生圖的畫風參考（edit 的輸出比例會跟著參考圖）。

  python tools/make_stage_refs.py   → art_raw/terrain/_ref_s{關}_{wide,land,tall}_{N}.png
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public' / 'art'
RAW = ROOT / 'art_raw' / 'terrain'
AJ = json.loads((ART / 'art.json').read_text(encoding='utf-8'))
VW, VH = 1280, 720


def backdrop(stage: str, cam: float) -> np.ndarray:
    c = np.zeros((VH, VW, 3), np.float32)
    P = AJ['panels'][stage]
    for ly in ('far', 'midfar', 'mid'):
        off = cam * P[ly]['rate']
        for it in P[ly]['items']:
            if it['x'] + it['w'] < off or it['x'] > off + VW:
                continue
            a = np.asarray(Image.open(ART / it['path']).convert('RGBA')).astype(np.float32)
            x = int(round(it['x'] - off))
            x0, x1 = max(0, x), min(VW, x + a.shape[1])
            s = a[:, x0 - x:x1 - x]
            al = s[..., 3:4] / 255
            c[:, x0:x1] = s[..., :3] * al + c[:, x0:x1] * (1 - al)
    return c


# 每關取幾個鏡頭位置（關卡總長約 21,207：前段、中段、後段）
CAMS = {'s1': [3000, 11500, 17000], 's2': [2600, 9800, 17800], 's3': [1200, 8600, 18600]}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for st, cams in CAMS.items():
        for i, cam in enumerate(cams, 1):
            b = backdrop(st, cam)
            im = Image.fromarray(np.clip(b + 0.5, 0, 255).astype(np.uint8))
            im.crop((0, 250, 1280, 250 + 427)).save(RAW / f'_ref_{st}_wide_{i}.png')      # 3:1，取畫面中下段（建築細節最多）
            im.crop((100, 0, 100 + 1080, 720)).save(RAW / f'_ref_{st}_land_{i}.png')      # 3:2
            im.crop((400, 0, 400 + 480, 720)).save(RAW / f'_ref_{st}_tall_{i}.png')       # 2:3
            im.save(RAW / f'_ref_{st}_full_{i}.png')
            print(st, i, cam)


if __name__ == '__main__':
    main()
