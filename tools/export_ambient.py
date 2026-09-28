"""背景生物逐格圖（09-27）：public/sprites/ambient/<名>/00.webp…＋ index.json。

來源：
  1. Google Vids 片段（vids/ambient/clips/）：goose_fly、bat_fly、rice_cat_walk → 去綠、找循環、裁切、縮成顯示大小、調暗往霧色靠
  2. 透明原圖（art_raw/ambient/，Vids 額度用完沒做成動畫的六隻）：cart_cat、deer、torch_bandit、fox、carp、mech_soldier
     → 單張，遊戲裡用程式動（上下晃、跳、拋物線）
  3. 現成怪物動作圖做剪影：百鬼夜行（第二關妖怪一排）、遠方鐵爪機關貓黑影（第三關魔王預告）

縮小、調暗的原則照 art/ambient2.json 的 vids_pending（往這關霧色靠約 3 成、暗 3 成；照 display 大小）。
存的大小＝遊戲裡畫的大小（畫布固定 1280×720），不多存。

用法：python tools/export_ambient.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_monsters import best_loop, key_np, solo_np  # noqa: E402
from post_ambient2 import HAZE, clean, grade, resize, trim  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CLIPS = ROOT / "vids" / "ambient" / "clips"
RAW = ROOT / "art_raw" / "ambient"
TMP = ROOT / "vids" / "_amb_tmp"
OUT = ROOT / "public" / "sprites" / "ambient"
MON = ROOT / "public" / "sprites" / "monsters"
QUALITY = 82

# Vids 片段：名字 → (片段, 關, 顯示高度（飛的用身長＝寬）, 用寬還是高, 霧色, 霧色比例, 暗, 循環長度範圍)
CLIP_SPEC = {
    "goose": ("goose_fly", "s1", 60, "w", HAZE["s1"], 0.3, 0.3, (10, 48)),
    "bat": ("bat_fly", "s2", 44, "h", HAZE["s2"], 0.15, 0.15, (4, 30)),
    "rice_cat": ("rice_cat_walk", "s1", 66, "h", HAZE["s1"], 0.28, 0.3, (10, 48)),
}
# 透明原圖：名字 → (原圖, 關, 顯示高度, 霧色, 霧色比例, 暗)
STATIC_SPEC = {
    "cart_cat": ("cart_cat.try2.png", "s1", 66, HAZE["s1"], 0.28, 0.3),
    "deer": ("deer.try1.png", "s1", 62, HAZE["s1n"], 0.35, 0.35),
    "torch_bandit": ("torch_bandit.try1.png", "s1", 66, HAZE["s1n"], 0.3, 0.3),
    "fox": ("fox.try1.png", "s2", 46, HAZE["s2"], 0.3, 0.3),
    "carp": ("carp.try1.png", "s2", 56, HAZE["s2"], 0.3, 0.3),
    "mech_soldier": ("mech_soldier.try1.png", "s3", 52, HAZE["s3"], 0.3, 0.3),
}
# 剪影：名字 → (怪物資料夾, 動作, 關, 顯示高度, 顏色, 不透明度)
SIL_SPEC = {
    "parade_kasa": ("kasa_obake", "hop", "s2", 46, (34, 26, 52), 235),
    "parade_lantern": ("lantern_ghost", "float", "s2", 44, (34, 26, 52), 235),
    "parade_tanuki": ("tanuki_kid", "run", "s2", 38, (34, 26, 52), 235),
    "parade_kappa": ("kappa", "walk", "s2", 44, (34, 26, 52), 235),
    "parade_dancer": ("mask_dancer", "walk", "s2", 52, (34, 26, 52), 235),
    "parade_fox": ("fox_miko", "idle", "s2", 52, (34, 26, 52), 235),
    "claw_shadow": ("iron_claw", "walk", "s3", 230, (22, 17, 28), 240),
}


def save_frames(name: str, frames: list, stage: str, fps: float, facing: str = "left") -> dict:
    d = OUT / name
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    files = []
    for i, a in enumerate(frames):
        f = f"{i:02d}.webp"
        Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), "RGBA").save(d / f, "WEBP", quality=QUALITY, method=6)
        files.append(f)
    h, w = frames[0].shape[:2]
    return {"stage": stage, "frames": files, "w": int(w), "h": int(h), "fps": round(fps, 2), "facing": facing}


def union_crop(arrs: list, thr: float = 40, pad: int = 3) -> list:
    ys0, ys1, xs0, xs1 = 1e9, -1, 1e9, -1
    for a in arrs:
        ys, xs = np.where(a[..., 3] > thr)
        if len(ys):
            ys0, ys1, xs0, xs1 = min(ys0, ys.min()), max(ys1, ys.max()), min(xs0, xs.min()), max(xs1, xs.max())
    out = []
    for a in arrs:
        b = a[int(ys0):int(ys1) + 1, int(xs0):int(xs1) + 1]
        out.append(np.pad(b, ((pad, pad), (pad, pad), (0, 0))))
    return out


def from_clip(name: str) -> dict:
    clip, stage, size, by, haze, amount, dark, (lo, hi) = CLIP_SPEC[name]
    tmp = TMP / clip
    tmp.mkdir(parents=True, exist_ok=True)
    if len(list(tmp.glob("*.png"))) < 90:
        for f in tmp.glob("*.png"):
            f.unlink()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(CLIPS / f"{clip}.mp4"), str(tmp / "%04d.png")], check=True)
    files = sorted(tmp.glob("*.png"))
    keyed = []
    for f in files:
        im = Image.open(f).convert("RGB")
        W, H = im.size
        im.paste((0, 255, 0), (int(W * 0.86), int(H * 0.8), W, H))   # 右下角浮水印塗掉
        keyed.append(solo_np(key_np(im)))
    d, s, e = best_loop(keyed, lo, hi)
    loop = keyed[s:e]
    # 24 格 → 12 格（背景小東西不用那麼順）
    loop = loop[::2]
    arrs = union_crop([np.asarray(k).astype(np.float32) for k in loop])
    h0, w0 = arrs[0].shape[:2]
    k = size / (w0 if by == "w" else h0)
    arrs = [grade(resize(a, max(1, round(w0 * k)), max(1, round(h0 * k))), haze, amount, dark, keep_glow=True) for a in arrs]
    print(f"{name}：片段 {clip} 第 {s}～{e} 格循環（差 {d:.1f}），{len(arrs)} 格，{arrs[0].shape[1]}×{arrs[0].shape[0]}")
    return save_frames(name, arrs, stage, 12)


def from_static(name: str) -> dict:
    src, stage, h, haze, amount, dark = STATIC_SPEC[name]
    a = clean(np.asarray(Image.open(RAW / src).convert("RGBA")).astype(np.float32), 24)
    a = trim(a, 24)
    k = h / a.shape[0]
    a = grade(resize(a, max(1, round(a.shape[1] * k)), h), haze, amount, dark, keep_glow=True)
    print(f"{name}：{src} → {a.shape[1]}×{a.shape[0]}")
    return save_frames(name, [a], stage, 1)


def silhouette(name: str) -> dict:
    mon, anim, stage, h, color, alpha = SIL_SPEC[name]
    j = json.loads((MON / mon / "anims.json").read_text(encoding="utf-8"))
    a = j.get(anim) or j.get("idle")
    frames = [np.asarray(Image.open(MON / mon / (anim if j.get(anim) else "idle") / f["f"]).convert("RGBA")).astype(np.float32) for f in a["frames"]]
    # 每一格照腳底（anims.json 的 ax、ay）對齊到同一張畫布
    axs = [f["ax"] for f in a["frames"]]
    ays = [f["ay"] for f in a["frames"]]
    L = max(axs)
    R = max(fr.shape[1] - ax for fr, ax in zip(frames, axs))
    T = max(ays)
    B = max(fr.shape[0] - ay for fr, ay in zip(frames, ays))
    W, H = int(np.ceil(L + R)), int(np.ceil(T + B))
    canv = []
    for fr, ax, ay in zip(frames, axs, ays):
        c = np.zeros((H, W, 4), np.float32)
        x0, y0 = int(round(L - ax)), int(round(T - ay))
        c[y0:y0 + fr.shape[0], x0:x0 + fr.shape[1]] = fr[: H - y0, : W - x0]
        canv.append(c)
    canv = union_crop(canv, 30, 2)
    std = float(j.get("_meta", {}).get("standHeight", canv[0].shape[0]))
    k = h / std
    out = []
    for c in canv:
        r = resize(c, max(1, round(c.shape[1] * k)), max(1, round(c.shape[0] * k)))
        s = np.zeros_like(r)
        s[..., 0], s[..., 1], s[..., 2] = color
        s[..., 3] = r[..., 3] * (alpha / 255)
        out.append(s)
    fps = float(a.get("fps", 12))
    print(f"{name}：{mon}/{anim} {len(out)} 格剪影，{out[0].shape[1]}×{out[0].shape[0]}")
    info = save_frames(name, out, stage, fps, "left" if mon != "iron_claw" else "left")
    return info


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    idx = {"_說明": "背景生物（tools/export_ambient.py 產生）：stage＝哪一關用；frames 照順序循環播 fps；w、h＝畫面上畫的大小（像素）；facing＝圖上朝向", "creatures": {}}
    for n in CLIP_SPEC:
        if (CLIPS / f"{CLIP_SPEC[n][0]}.mp4").exists():
            idx["creatures"][n] = from_clip(n)
    for n in STATIC_SPEC:
        idx["creatures"][n] = from_static(n)
    for n in SIL_SPEC:
        if (MON / SIL_SPEC[n][0] / "anims.json").exists():
            idx["creatures"][n] = silhouette(n)
    (OUT / "index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    print("寫好", OUT / "index.json")


if __name__ == "__main__":
    main()
