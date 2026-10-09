"""Vids 生的動作片 → 遊戲用動作圖（public/sprites/qiuqiu/<動作>/NN.webp ＋ anims.json）。

用法：python tools/export_sprites.py            （照下面的 SPEC 全部重做）
      python tools/export_sprites.py 待機 跑步   （只做這幾個）

每個動作在 SPEC 裡寫：
  video   vids/ 底下的影片
  ref     生這支用的參考圖是哪一張：決定「站直有多高」（center 560、throw 480、jump 330、crouch 560，單位是影片像素）
  t       取哪一段（秒）
  loop    循環動作：在這段裡自動找「頭尾最像」的一圈（min~max 格）
  anchor  'fixed'＝整段用第一格的腳底當基準（原地動作，影片裡往前撲的位移保留）
          'feet'＝每一格各自對齊腳底（跳躍：高度交給遊戲的物理）
          'centroid'＝每一格各自對齊身體重心的左右位置（衝刺：往前衝的距離交給物理）
  solo    只留跟身體連在一起的那塊（丟手裏劍：影片裡飛出去的那枚要拿掉，遊戲自己發射）
  marks   動作裡的關鍵時間（秒）：hit＝打中判定、release＝手裏劍出手……換算成格數寫進 anims.json

縮放：站直的球球＝H 像素高（遊戲畫的時候再縮）。每一格裁到剛好包住角色，記錄基準點在圖裡的位置（ax, ay）。
"""
import json, subprocess, sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, "F:/ClaudeWork/qiuqiu-coop/tools")
from chroma_key import key_out  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
VIDS = ROOT / "vids"
OUT = ROOT / "public" / "sprites" / "qiuqiu"
H = 240
REF = {"center": 560, "throw": 480, "jump": 330, "crouch": 560}

SPEC = {
    "待機": dict(video="待機_v1.mp4", ref="center", t=(0.6, 4.0), loop=(28, 70), anchor="fixed"),
    "跑步": dict(video="跑步_v1.mp4", ref="center", t=(0.6, 4.0), loop=(10, 26), anchor="fixed"),
    "揮爪": dict(video="揮爪_v2a.mp4", ref="center", t=(0.62, 3.05), anchor="fixed", marks={"hit": 1.29}),
    "丟手裏劍": dict(video="丟手裏劍_v1.mp4", ref="throw", t=(2.05, 3.05), anchor="fixed", solo=True, marks={"release": 2.17}),
    # 09-26 下午第二批（Vids 側邊欄那九支；蹲下_v1、蹲走_v1 不合格沒用）
    "走路": dict(video="走路_v1.mp4", ref="center", t=(0.5, 4.0), loop=(16, 40), anchor="fixed"),
    "跳躍": dict(video="跳躍_v2.mp4", ref="jump", t=(0.3, 3.0), anchor="feet", marks={"air": 0.55, "land": 2.35}),
    "衝刺": dict(video="衝刺_v1.mp4", ref="throw", t=(0.45, 2.8), anchor="centroid", marks={"go": 0.75, "stop": 2.3}),
    "空中丟": dict(video="空中丟_v1.mp4", ref="jump", t=(0.6, 3.2), anchor="feet", marks={"release": 1.9, "land": 2.85}),
    "蹲走": dict(video="蹲走_v2.mp4", ref="crouch", t=(0.4, 3.6), loop=(14, 40), anchor="fixed"),
    "蹲下": dict(video="蹲走_v2.mp4", ref="crouch", t=(0.0, 0.09), anchor="fixed"),   # 蹲著不動＝蹲走開頭那一兩格（Codex 蹲姿圖本身）
    # 09-26 空手投擲（手上不畫手裏劍，飛行道具交給程式）：前投取代舊的丟手裏劍、上投新加
    "前投": dict(video="前投空手_v1.mp4", ref="throw", t=(0.83, 2.58), anchor="fixed", marks={"release": 1.42}),
    "上投": dict(video="上投_v1.mp4", ref="center", t=(0.62, 2.46), anchor="fixed", marks={"release": 1.25}),
    "受傷": dict(video="受傷_v1.mp4", ref="center", t=(0.17, 1.3), anchor="fixed", solo=True),
    "倒下": dict(video="倒下_v1.mp4", ref="center", t=(0.54, 2.7), anchor="fixed", solo=True),
    # 09-26 晚上追加：跑步中甩手丟（第 27、60 格各甩一次，取中間一圈循環）、蹲著低位丟（取第一次甩出）
    "跑丟": dict(video="跑丟_v1.mp4", ref="center", t=(1.0, 2.4), loop=(32, 34), anchor="fixed", solo=True, marks={"release": 27 / 24}),
    "蹲丟": dict(video="蹲丟_v1.mp4", ref="crouch", t=(0.75, 2.5), anchor="fixed", solo=True, marks={"release": 27 / 24}),
    # 10-09 角色手感：09-28 用 Flow Omni 生好、一直沒接進遊戲的五支（vids/flow/大冒險/球球/，4 秒 24 格，參考圖置中）
    "空翻": dict(video="flow/大冒險/球球/二段跳空翻_omni_v1.mp4", ref="center", t=(23 / 24, 37 / 24), anchor="fixed", solo=True),
    "下落": dict(video="flow/大冒險/球球/二段跳空翻_omni_v1.mp4", ref="center", t=(60 / 24, 95 / 24), loop=(12, 30), anchor="fixed", solo=True),
    "攀爬": dict(video="flow/大冒險/球球/攀爬_omni_v1.mp4", ref="center", t=(16 / 24, 95 / 24), loop=(18, 36), anchor="fixed", solo=True),
    "貼牆": dict(video="flow/大冒險/球球/貼牆下滑_omni_v1.mp4", ref="center", t=(24 / 24, 95 / 24), loop=(16, 40), anchor="fixed", solo=True),
    "翻滾": dict(video="flow/大冒險/球球/翻滾_omni_v1.mp4", ref="center", t=(28 / 24, 56 / 24), anchor="fixed", solo=True),
    # 10-09 Vids 新生：蹬牆跳（vids/clips_v3/，原片第 17～40 格＝蹲低蹬出去、拉直往右上飛；之後落地帶塵土不取）
    "蹬牆": dict(video="clips_v3/vids_wallkick_v1.mp4", ref="center", t=(17 / 24, 40 / 24), anchor="fixed", solo=True),
    "斜上投": dict(video="flow/大冒險/球球/站著斜上丟_omni_v2.mp4", ref="center", t=(4 / 24, 48 / 24), anchor="fixed", solo=True, marks={"release": 16 / 24}),
}
NAME_EN = {"待機": "idle", "跑步": "run", "揮爪": "claw", "丟手裏劍": "throw_baked", "前投": "throw", "上投": "throwup", "走路": "walk", "跳躍": "jump",
           "蹲下": "crouch", "蹲走": "crouchwalk", "衝刺": "dash", "空中丟": "airthrow", "受傷": "hurt", "倒下": "down",
           "跑丟": "runthrow", "蹲丟": "crouchthrow",
           "空翻": "airflip", "下落": "fall", "攀爬": "climb", "貼牆": "wallslide", "翻滾": "roll", "斜上投": "throwdiag", "蹬牆": "wallkick"}


def frames_of(video: Path, t0: float, t1: float, tag: str = ""):
    tmp = VIDS / f"_export_tmp_{tag}"   # 每個動作各用一個暫存夾，幾個動作可以同時轉
    tmp.mkdir(exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t0}", "-to", f"{t1}", "-i", str(video), str(tmp / "%04d.png")], check=True)
    out = [Image.open(f).convert("RGB") for f in sorted(tmp.glob("*.png"))]
    fps = float(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
                                "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout.strip().split("/")[0])
    return out, fps


def keyed(im: Image.Image) -> Image.Image:
    im = im.copy()
    W, Hh = im.size
    ImageDraw.Draw(im).rectangle((int(W * 0.82), int(Hh * 0.72), W, Hh), fill=(0, 255, 0))   # Gemini 小星星浮水印
    # 門檻比圖片版低：影片的綠幕實測綠度只有 214～219（壓縮過），照圖片版的 220 全透明門檻，
    # 背景每一格都留下 2～9% 的不透明度，畫出來是一層淡暗霧（動作測試場 09-26 回報）。球球身上沒有綠色，壓低不傷角色
    k = key_out(im, soft=130, hard=200, crop=False)
    r, g, b, a = k.split()
    g = ImageChops.darker(g, ImageChops.lighter(r, b))   # 半透明殘影混到的綠壓掉
    return Image.merge("RGBA", (r, g, b, a))


def solo(k: Image.Image) -> Image.Image:
    """只留最大那塊（加一點膨脹，讓爪痕、衣角這種細的還連得上）"""
    a = k.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    grown = a.filter(ImageFilter.MaxFilter(9))
    small = grown.resize((grown.width // 4, grown.height // 4))
    px = small.load()
    w, h = small.size
    seen = [[False] * w for _ in range(h)]
    best, best_n = None, 0
    for y in range(h):
        for x in range(w):
            if px[x, y] and not seen[y][x]:
                stack, comp = [(x, y)], []
                seen[y][x] = True
                while stack:
                    cx, cy = stack.pop()
                    comp.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
                if len(comp) > best_n:
                    best, best_n = comp, len(comp)
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for x, y in best or []:
        mp[x, y] = 255
    mask = mask.resize(k.size).filter(ImageFilter.MaxFilter(5))
    out = k.copy()
    out.putalpha(ImageChops.multiply(k.getchannel("A"), mask))
    return out


def solid_foot(k: Image.Image, solid: int = 128, min_count: int = 3) -> int:
    """實心腳底：最下面一列「至少 min_count 個像素透明度 ≥ solid」的下緣（圖的像素，列號＋1）。
    2026-09-26 修：原本 'feet' 基準拿「透明度 > 8」的外框底當腳底，去綠底剩下的淡影往下拖 17～70 像素，跳躍、空中丟畫出來浮在空中。
    跟遊戲載入時的量法（src/sprite.ts 的 footRow）一樣。"""
    a = k.getchannel("A").point(lambda v: 255 if v >= solid else 0)
    w, h = a.size
    data = a.tobytes()
    for y in range(h - 1, -1, -1):
        if data[y * w:(y + 1) * w].count(255) >= min_count:
            return y + 1
    bb = k.getchannel("A").getbbox()
    return bb[3] if bb else h


def centroid_x(k: Image.Image) -> float:
    a = k.getchannel("A").resize((k.width // 4, k.height // 4))
    px, w, h = a.load(), a.width, a.height
    s = sx = 0
    for y in range(h):
        for x in range(w):
            v = px[x, y]
            if v > 200:   # 只算實心的身體，半透明殘影不算
                s += v; sx += v * x
    return (sx / s) * 4 if s else k.width / 2


def sig(k: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", k.size, (40, 44, 60, 255))
    bg.alpha_composite(k)
    return bg.convert("L").resize((k.width // 8, k.height // 8))


def diff(a: Image.Image, b: Image.Image) -> float:
    return sum(ImageChops.difference(a, b).tobytes()) / (a.width * a.height)


def best_loop(ks, lo, hi):
    sigs = [sig(k) for k in ks]
    best = (1e9, 0, len(ks))
    for s in range(0, max(1, len(ks) - lo)):
        for e in range(s + lo, min(len(ks), s + hi + 1)):
            d = diff(sigs[s], sigs[e])
            if d < best[0]:
                best = (d, s, e)
    return best


def export(name: str, spec: dict, anims: dict):
    video = VIDS / spec["video"]
    raw, fps = frames_of(video, *spec["t"], tag=NAME_EN.get(name, name))
    ks = [keyed(im) for im in raw]
    if spec.get("solo"):
        ks = [solo(k) for k in ks]
    loop_info = None
    loop_start = 0
    if spec.get("loop"):
        d, s, e = best_loop(ks, *spec["loop"])
        ks = ks[s:e]
        loop_start = s
        loop_info = {"start_s": round(spec["t"][0] + s / fps, 3), "frames": e - s, "seam_diff": round(d, 2)}
    scale = H / REF[spec["ref"]]
    ground = solid_foot(ks[0])
    fx = centroid_x(ks[0])
    en = NAME_EN.get(name, name)
    d = OUT / en
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.webp"):
        f.unlink()
    frames = []
    for i, k in enumerate(ks):
        bb = k.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        if not bb:
            continue
        ax = centroid_x(k) if spec["anchor"] == "centroid" else fx
        ay = solid_foot(k) if spec["anchor"] == "feet" else ground   # 裁切外框照舊用透明度 > 8（留住邊緣），腳底用實心的
        crop = k.crop(bb)
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)
        fn = f"{i:02d}.webp"
        crop.save(d / fn, "WEBP", quality=90, method=6)
        frames.append({"f": fn, "ax": round((ax - bb[0]) * scale, 1), "ay": round((ay - bb[1]) * scale, 1)})
    entry = {"fps": fps, "loop": bool(spec.get("loop")), "frames": frames, "src": spec["video"]}
    for mk, sec in (spec.get("marks") or {}).items():
        # 循環動作要扣掉循環從第幾格開始（09-26 修：原本沒扣，標記會錯位）
        entry[mk] = max(0, min(len(frames) - 1, round((sec - spec["t"][0]) * fps) - loop_start))
    if loop_info:
        entry["loopInfo"] = loop_info
    anims[en] = entry
    (d / "_anim.json").write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")   # 各動作自己一份，合併時照這些組回 anims.json
    print(f"{name}（{en}）：{len(frames)} 格 @ {fps:g}fps", loop_info or "", {k: entry[k] for k in ("hit", "release") if k in entry})


def main():
    want = sys.argv[1:] or list(SPEC)
    OUT.mkdir(parents=True, exist_ok=True)
    jf = OUT / "anims.json"
    anims = {}
    for name in want:
        export(name, SPEC[name], anims)
    # 合併：每個動作資料夾的 _anim.json 組回 anims.json（幾支同時跑時，最後跑完的那支會看到全部）
    anims = {}
    for f in sorted(OUT.glob("*/_anim.json")):
        anims[f.parent.name] = json.loads(f.read_text(encoding="utf-8"))
    anims["_meta"] = {"standHeight": H, "note": "每格 (ax, ay)＝基準點（腳底、身體中線）在這張圖裡的位置，單位是圖的像素；站直的球球＝standHeight 像素高"}
    jf.write_text(json.dumps(anims, ensure_ascii=False, indent=1), encoding="utf-8")
    # 預先算好裁切框與腳底（遊戲載入時就不用逐像素處理；見 tools/bake_frames.py）
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    # 縮成遊戲裡畫的大小（240 → 190，手機記憶體，見 tools/shrink_frames.py），順便預先算好裁切框與腳底（bake_frames.py）
    from shrink_frames import main as shrink
    shrink(["qiuqiu"])


if __name__ == "__main__":
    main()
