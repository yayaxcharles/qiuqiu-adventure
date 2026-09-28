"""逐格圖縮到遊戲裡畫的大小，另外做一套手機用的跳格版（09-27）。

使用者 09-27 裁定：電腦版維持每秒 24 格的完整動作，手機才用 12 格。所以兩套：
  電腦版 public/sprites/monsters/<怪>/   ：只縮尺寸（轉檔存成遊戲裡畫的 1.25 倍 → 1 倍，standHeight＝drawH），每秒 24 格一格都不少
  手機版 public/sprites/monsters_m/<怪>/ ：從電腦版複製，每秒 24 格 → 約 12 格（留偶數格＋所有標記格＋最後一格；
                                           fps 照留下的比例調，整段時間不變；標記換成新的格號，出手那一格一定留著）。
                                           直接複製電腦版的圖檔、不重新壓縮，裁切框 k 也照抄。
  球球 public/sprites/qiuqiu/            ：兩套共用，只縮尺寸（240 → 190，_meta.shrink＝0.79167；畫的時候 SCALE ÷ shrink），不跳格。
遊戲開的時候照裝置選哪一套（src/quality.ts：觸控或螢幕短邊 < 500 用手機版；網址 ?hq／?lq 強制）。
存檔 webp 品質 80。

一個動作一個動作做：縮過的動作在 anims.json 與它自己的 _anim.json 都記 "shrunk"，重跑會跳過；
轉檔腳本（export_monsters.py、export_sprites.py）重轉某幾個動作時，新轉的沒有這個記號，只縮新轉的那幾個
（兩支轉檔腳本最後都會自己叫這支）。縮完會預先算好裁切框與腳底（bake_frames.py），再重做那幾隻的手機版。

用法：python tools/shrink_frames.py           （全部）
      python tools/shrink_frames.py rat qiuqiu （只做這幾個）
"""
import json
import shutil
import sys
from multiprocessing import Pool
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "public" / "sprites"
MOBILE = SPRITES / "monsters_m"
QUALITY = 80
QIUQIU_DRAW = 190   # src/player.ts 的 SCALE＝190/240


def resize_save(src: Path, dst: Path, f: float) -> None:
    im = Image.open(src).convert("RGBA")
    if abs(f - 1) > 1e-6:
        im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
    im.save(dst, "WEBP", quality=QUALITY, method=6)


def marks_of(a: dict) -> dict:
    n = len(a["frames"])
    return {k: v for k, v in a.items() if isinstance(v, int) and not isinstance(v, bool) and k not in ("fps",) and 0 <= v < n}


def shrink_action(d: Path, name: str, a: dict, f: float) -> int:
    """只縮尺寸、不跳格"""
    frames = a["frames"]
    tmp = d / name / "_tmp"
    tmp.mkdir(exist_ok=True)
    new_frames = []
    for i, fr in enumerate(frames):
        out = f"{i:02d}.webp"
        resize_save(d / name / fr["f"], tmp / out, f)
        new_frames.append({"f": out, "ax": round(fr["ax"] * f, 2), "ay": round(fr["ay"] * f, 2)})
    for old in (d / name).glob("*.webp"):
        old.unlink()
    for p in tmp.glob("*.webp"):
        p.rename(d / name / p.name)
    tmp.rmdir()
    a["frames"] = new_frames
    a["shrunk"] = {"scale": round(f, 5), "step": 1, "quality": QUALITY}
    return len(frames)


def shrink_dir(d: Path, is_qiuqiu: bool) -> str:
    jf = d / "anims.json"
    j = json.loads(jf.read_text(encoding="utf-8"))
    meta = j.setdefault("_meta", {})
    acts = [(k, a) for k, a in j.items() if not k.startswith("_") and isinstance(a, dict) and isinstance(a.get("frames"), list)]
    if is_qiuqiu:
        f = QIUQIU_DRAW / meta.get("standHeight", 240)
    else:
        orig = (meta.get("shrunk") or {}).get("fromStandHeight", meta.get("standHeight", 250))
        f = meta.get("drawH", 200) / orig
    n = 0
    for name, a in acts:
        if a.get("shrunk"):
            continue
        n += shrink_action(d, name, a, f)
    # 每個動作自己的 _anim.json 跟 anims.json 一致（轉檔腳本重轉時照這些組回 anims.json）
    for name, a in acts:
        if (d / name).is_dir():
            (d / name / "_anim.json").write_text(json.dumps(a, ensure_ascii=False, indent=1), encoding="utf-8")
    if is_qiuqiu:
        meta["shrink"] = round(f, 5)
        meta["shrunk"] = {"scale": round(f, 5), "step": 1, "quality": QUALITY, "fromStandHeight": meta.get("standHeight", 240)}
    else:
        meta["shrunk"] = {"scale": round(f, 5), "step": 1, "quality": QUALITY, "fromStandHeight": (meta.get("shrunk") or {}).get("fromStandHeight", meta.get("standHeight", 250))}
        meta["standHeight"] = meta.get("drawH", 200)
    jf.write_text(json.dumps(j, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"{n} 格縮 {f:.3f} 倍" if n else "都縮過了"


def mobile_dir(name: str) -> str:
    """從電腦版（每秒 24 格）複製出手機版（約 12 格）：圖檔直接複製、不重新壓縮"""
    src, dst = SPRITES / "monsters" / name, MOBILE / name
    j = json.loads((src / "anims.json").read_text(encoding="utf-8"))
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    out = {}
    before = after = 0
    for act, a in j.items():
        if act.startswith("_") or not isinstance(a, dict) or not isinstance(a.get("frames"), list):
            out[act] = a
            continue
        frames = a["frames"]
        n = len(frames)
        marks = marks_of(a)
        keep = sorted(set(range(0, n, 2)) | set(marks.values()) | {n - 1})
        (dst / act).mkdir()
        nf = []
        for ni, oi in enumerate(keep):
            fr = dict(frames[oi])
            fn = f"{ni:02d}.webp"
            shutil.copyfile(src / act / fr["f"], dst / act / fn)
            fr["f"] = fn
            nf.append(fr)
        b = {k: v for k, v in a.items() if k not in ("frames", "_anim")}
        b["frames"] = nf
        b["fps"] = round(a["fps"] * len(keep) / n, 3)
        for k, v in marks.items():
            b[k] = keep.index(v)
        if "videoFrames" in a:
            b["videoFrames"] = [a["videoFrames"][i] for i in keep if i < len(a["videoFrames"])]
        b["mobile"] = {"from": n, "kept": len(keep)}
        out[act] = b
        before += n; after += len(keep)
    out.setdefault("_meta", {})["mobile"] = "手機版：從 sprites/monsters/ 的每秒 24 格版跳格複製（tools/shrink_frames.py）"
    (dst / "anims.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"手機版 {before} → {after} 格"


def work(job: tuple) -> str:
    name, d = job
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from bake_frames import bake_dir
    msg = shrink_dir(d, name == "qiuqiu")
    baked = bake_dir(d)
    tail = "" if name == "qiuqiu" else "；" + mobile_dir(name)
    return f"{name} {msg}；預先算好 {baked} 格{tail}"


def main(names: list) -> None:
    todo = []
    if not names or "qiuqiu" in names:
        todo.append(("qiuqiu", SPRITES / "qiuqiu"))
    for d in sorted(p for p in (SPRITES / "monsters").iterdir() if p.is_dir()):
        if not names or d.name in names:
            todo.append((d.name, d))
    todo = [t for t in todo if (t[1] / "anims.json").exists()]
    with Pool(min(8, max(1, len(todo)))) as pool:
        for line in pool.imap_unordered(work, todo):
            print(line, flush=True)
    # 手機版的怪物清單跟電腦版一樣
    idx = SPRITES / "monsters" / "index.json"
    if idx.exists():
        MOBILE.mkdir(exist_ok=True)
        shutil.copyfile(idx, MOBILE / "index.json")


if __name__ == "__main__":
    main(sys.argv[1:])
