"""把「載入時逐像素處理」預先算好寫進 anims.json（09-26：開遊戲要等 22 秒，其中 17 秒是瀏覽器在主執行緒逐格讀像素）。

原本 src/sprite.ts 的 loadFrame 每一格都做：去淡霧（透明度 ≤8 歸零）→ 量裁切框 → 量實心腳底（透明度 ≥128、一列至少 3 點）→ 裁切。
這支照同一套算法算好，每一格加一個欄位：
    "k": [x0, y0, 寬, 高, 裁切後的 ax, 裁切後的 ay]
載入時看到 k 就只做「解碼＋裁切」（瀏覽器在背景執行緒做），不讀像素。原本的 ax、ay 不動（重跑這支結果一樣）。

用法：python tools/bake_frames.py                （全部：球球＋每隻怪）
      python tools/bake_frames.py rat orange_king  （只做這幾隻怪；qiuqiu＝球球）
export_monsters.py、export_sprites.py 轉完會自己叫這支。
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "public" / "sprites"
HAZE = 8          # 跟 src/sprite.ts 的 HAZE 一樣
SOLID_RAW = 132   # 去霧拉回之後透明度 ≥128 ⇔ 原圖透明度 ≥132（Math.round((a-8)*255/247) ≥ 128）
FOOT_MIN = 3


def bake_frame(png: Path, ax: float, ay: float) -> list:
    a = np.asarray(Image.open(png).convert("RGBA"))[..., 3]
    h, w = a.shape
    ys, xs = np.nonzero(a > HAZE)
    if len(xs) == 0:
        x0 = y0 = 0; x1 = y1 = 0
    else:
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rows = np.nonzero((a >= SOLID_RAW).sum(axis=1) >= FOOT_MIN)[0]
    foot = int(rows.max()) + 1 if len(rows) else -1
    by = (foot if foot > 0 else ay) - y0
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1, round(ax - x0, 2), round(by, 2)]


def bake_dir(d: Path) -> int:
    jf = d / "anims.json"
    if not jf.exists():
        return 0
    j = json.loads(jf.read_text(encoding="utf-8"))
    n = 0
    for name, act in j.items():
        if name.startswith("_") or not isinstance(act, dict) or not isinstance(act.get("frames"), list):
            continue
        for fr in act["frames"]:
            p = d / name / fr["f"]
            if p.exists():
                fr["k"] = bake_frame(p, fr["ax"], fr["ay"])
                n += 1
    j.setdefault("_meta", {})["baked"] = True
    jf.write_text(json.dumps(j, ensure_ascii=False, indent=1), encoding="utf-8")
    return n


def main(names: list) -> None:
    dirs = []
    if not names or "qiuqiu" in names:
        dirs.append(SPRITES / "qiuqiu")
    mon = SPRITES / "monsters"
    for d in sorted(p for p in mon.iterdir() if p.is_dir()):
        if not names or d.name in names:
            dirs.append(d)
    for d in dirs:
        print(d.name, bake_dir(d), "格")


if __name__ == "__main__":
    main(sys.argv[1:])
