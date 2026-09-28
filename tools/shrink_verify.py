"""縮圖、跳格之後對照縮之前（備份資料夾）：
  1. 標記格（hit、hurtEnd…）的時間點差多少秒（跳格後出手那一格的時間要跟原本差不到一格）
  2. 整段動作長度差多少秒
  3. 腳底：基準點到最下面實心像素的距離，換算回遊戲畫面像素差多少（縮之前 × drawH ÷ 原 standHeight，縮之後 × drawH ÷ 新 standHeight）
用法：python tools/shrink_verify.py <縮之前的 sprites 備份資料夾> [--m]（--m＝對照手機版 monsters_m）
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = ROOT / "public" / "sprites"


def load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def main(old_root: Path) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    worst_mark = worst_len = worst_foot = 0.0
    rows = []
    mob = "--m" in sys.argv
    dirs = ([] if mob else [("qiuqiu", "qiuqiu")]) + [(f"monsters/{d.name}", d.name) for d in sorted((NEW / "monsters").iterdir()) if d.is_dir()]
    for rel, name in dirs:
        a_old, a_new = old_root / rel / "anims.json", NEW / (rel.replace("monsters/", "monsters_m/") if mob else rel) / "anims.json"
        if not a_old.exists() or not a_new.exists():
            continue
        jo, jn = load(a_old), load(a_new)
        mo, mn = jo.get("_meta", {}), jn.get("_meta", {})
        draw = mn.get("drawH") or 190
        so = mo.get("standHeight", 240)
        sn = mn.get("standHeight", 240) if name != "qiuqiu" else so * mn.get("shrink", 1)
        for act, o in jo.items():
            if act.startswith("_") or act not in jn:
                continue
            n = jn[act]
            to = len(o["frames"]) / o["fps"]
            tn = len(n["frames"]) / n["fps"]
            worst_len = max(worst_len, abs(to - tn))
            for k, v in o.items():
                if isinstance(v, int) and not isinstance(v, bool) and k != "fps" and k in n and 0 <= v < len(o["frames"]):
                    d = abs(v / o["fps"] - n[k] / n["fps"])
                    worst_mark = max(worst_mark, d)
                    if d > 0.03:
                        rows.append(f"{name}/{act} 標記 {k}：{v / o['fps']:.3f} 秒 → {n[k] / n['fps']:.3f} 秒")
            # 腳底：第一格「基準點到圖裡最下面實心像素」的距離（預先算好的裁切框 k＝[x0, y0, w, h, ax, ay]）換算成畫面像素
            fo, fn = o["frames"][0], n["frames"][0]
            if "k" not in fo or "k" not in fn:
                continue
            po = (fo["k"][3] - fo["k"][5]) * draw / so
            pn = (fn["k"][3] - fn["k"][5]) * draw / sn
            worst_foot = max(worst_foot, abs(po - pn))
            if abs(po - pn) > 1.5:
                rows.append(f"{name}/{act} 腳底 {po:.1f} → {pn:.1f} 畫面像素")
    print(f"標記格時間最大差 {worst_mark:.3f} 秒（一格 1/24＝0.042 秒）；動作長度最大差 {worst_len:.3f} 秒；腳底最大差 {worst_foot:.2f} 畫面像素")
    for r in rows[:40]:
        print(" ", r)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
