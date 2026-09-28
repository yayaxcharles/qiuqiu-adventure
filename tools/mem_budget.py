"""估每一關開始後、解碼好的圖共佔多少記憶體（寬×高×4 加總），以及進那一關前要下載多少 MB。

照遊戲的載入分包算（src/assets.ts 的 AssetLoader）：
  開頭：art.json 的圖（背景長卷除外）、fx_ambient
  共用包：球球動作圖、terrain.json 的圖、敵人單張立繪、fx2（載入時縮成顯示大小：src/fx2.ts 的 keepScale）
  每一關：那一關的背景長卷＋那一關會出現的怪物動作圖（src/stages/*.ts 裡的 kind，加上魔王叫出來的）
          ＋那一關的天氣大場面（ambient2.json 的 stage＝這關或 all）＋背景生物（sprites/ambient/index.json）
09-27 起遊戲一次只留一關（AssetLoader.focus），所以「進某一關」的記憶體＝開頭＋共用包＋這一關。
逐格圖用 anims.json 的 k（裁切後的寬高）；其他圖讀檔頭的寬高。

用法：python tools/mem_budget.py [--set m] [--q 0.62] [--json 輸出檔]
  --q：手機載入時縮圖的倍率（src/quality.ts 的 TEX_Q）：怪物、球球、背景長卷、敵人立繪、fx2、天氣、地形、art.json 都乘 q²（舊三色村貓 0.3、地面帶 surfaceY 圖不縮）
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "public"
MB = 1048576
Q = float(sys.argv[sys.argv.index("--q") + 1]) if "--q" in sys.argv else 1.0
# --set m：手機版的怪物動作圖（sprites/monsters_m，約每秒 12 格）；沒寫＝電腦版（sprites/monsters，每秒 24 格）
MONDIR = "monsters_m" if "--set" in sys.argv and sys.argv[sys.argv.index("--set") + 1] == "m" else "monsters"


def img_cost(p: Path) -> tuple:
    try:
        with Image.open(p) as im:
            w, h = im.size
        return w * h * 4, p.stat().st_size
    except Exception:
        return 0, 0


def frames_cost(d: Path) -> tuple:
    jf = d / "anims.json"
    if not jf.exists():
        return 0, 0, 0
    j = json.loads(jf.read_text(encoding="utf-8"))
    mem = dl = n = 0
    for name, a in j.items():
        if name.startswith("_"):
            continue
        for f in a["frames"]:
            k = f.get("k")
            p = d / name / f["f"]
            if k:
                mem += k[2] * k[3] * 4
            else:
                mem += img_cost(p)[0]
            dl += p.stat().st_size if p.exists() else 0
            n += 1
    return mem, dl, n


def paths_in(o, out):
    if isinstance(o, str):
        if re.search(r"\.(webp|png|jpg)$", o):
            out.add(o)
    elif isinstance(o, dict):
        for v in o.values():
            paths_in(v, out)
    elif isinstance(o, list):
        for v in o:
            paths_in(v, out)


def json_images(jf: Path, skip=None, scale=None) -> tuple:
    if not jf.exists():
        return 0, 0, 0
    ps = set()
    paths_in(json.loads(jf.read_text(encoding="utf-8")), ps)
    mem = dl = 0
    for p in ps:
        if skip and skip(p):
            continue
        m, s = img_cost(PUB / "art" / p)
        k = scale(p) if scale else 1
        mem += m * k * k; dl += s
    return mem, dl, len(ps)


def core_cost() -> tuple:
    """開頭：art.json（背景長卷、舊的每段遠景 s1_1_far 這種不載；舊三色村貓縮成 0.3）＋ fx_ambient"""
    J = json.loads((PUB / "art" / "art.json").read_text(encoding="utf-8"))
    mem = dl = 0
    skip_paths = set()
    for k, v in J.items():
        if isinstance(v, dict) and isinstance(v.get("path"), str):
            if re.match(r"^s\d_\d_far$", k) or re.search(r"bg/s\d/", v["path"]):
                skip_paths.add(v["path"])
    npc = {v["path"] for k, v in J.items() if k.startswith("npc_") and isinstance(v, dict) and "path" in v}
    ground = {v["path"] for k, v in J.items() if isinstance(v, dict) and "path" in v and isinstance(v.get("surfaceY"), (int, float))}
    ps = set()
    paths_in(J, ps)
    for p in ps:
        if p in skip_paths or re.search(r"bg/s\d/", p):
            continue
        m, s = img_cost(PUB / "art" / p)
        if p in npc:
            m *= 0.09
        elif p not in ground:
            m *= Q * Q   # 手機：art.json 的圖也縮成 TEX_Q（地面帶那種要量底色的 surfaceY 圖除外）
        mem += m; dl += s
    return mem, dl


def stills_cost(imgs: set) -> tuple:
    mem = dl = 0
    for p in (PUB / "enemies").glob("*.webp"):
        name = p.stem
        if name.startswith("dozing_tabby") or any(name.startswith(i + "_") for i in imgs):
            m, s = img_cost(p)
            mem += m; dl += s
    return mem, dl


def keep_scale(section: str, key: str, m: dict) -> float:
    """照 src/fx2.ts 的 keepScale：載進來時縮成幾倍（寬高各乘這個）"""
    w, h = m.get("w") or 0, m.get("h") or 0
    if isinstance(m.get("displayScale"), (int, float)) and section not in ("npc", "signs"):
        ds = m["displayScale"]
    elif m.get("displayW") and w:
        ds = m["displayW"] / w
    elif m.get("displayH") and h:
        ds = m["displayH"] / h
    else:
        ds = m.get("displayScale", 1)
    if section in ("bosses", "particles"):
        return 1
    if section == "qiuqiu":
        return 0.5 if key == "respawn_pillar" else 1
    return {"explosion_small": 0.75, "explosion_medium": 0.8, "explosion_large": 0.5}.get(key, min(1, ds * 1.25))


def fx2_cost() -> tuple:
    J = json.loads((PUB / "art" / "fx2.json").read_text(encoding="utf-8"))
    mem = dl = 0
    for sec, items in J.items():
        if sec.startswith("_") or not isinstance(items, dict):
            continue
        for key, m in items.items():
            if not isinstance(m, dict) or m.get("same"):
                continue
            paths = m.get("frames") if isinstance(m.get("frames"), list) else [m["path"]] if m.get("path") else []
            k = keep_scale(sec, key, m)
            if k >= 0.98:
                k = 1
            for p in paths:
                with Image.open(PUB / "art" / p) as im:
                    w, h = im.size
                mem += round(w * k) * round(h * k) * 4
                dl += (PUB / "art" / p).stat().st_size
    return mem, dl


def ambient_cost(stage: str) -> tuple:
    J = json.loads((PUB / "art" / "ambient2.json").read_text(encoding="utf-8"))
    mem = dl = 0
    for key, m in J.get("items", {}).items():
        if m.get("stage") not in (stage, "all") or key == "heat_haze":
            continue
        k = 0.6 if key in ("airship", "big_meteor", "forge_blast", "kite", "meteors", "fire_arrow_stuck", "strike") else 1
        for f in m.get("frames", []):
            with Image.open(PUB / "art" / f["path"]) as im:
                w, h = im.size
            mem += round(w * k) * round(h * k) * 4
            dl += (PUB / "art" / f["path"]).stat().st_size
    idx = PUB / "sprites" / "ambient" / "index.json"
    if idx.exists():
        for name, c in json.loads(idx.read_text(encoding="utf-8"))["creatures"].items():
            if c["stage"] != stage:
                continue
            for f in c["frames"]:
                p = PUB / "sprites" / "ambient" / name / f
                m2, s2 = img_cost(p)
                mem += m2; dl += s2
    return mem, dl


def stage_kinds(ts: Path) -> set:
    s = ts.read_text(encoding="utf-8")
    return set(re.findall(r"kind: '([a-z_]+)'", s))


BOSSES = {"s1": ["drum_tanuki", "orange_king"], "s2": ["frog_daimyo", "tanuki_lord"], "s3": ["roomba_king", "iron_claw"]}
SUMMONS = {"drum_tanuki": ["tanuki_kid"], "frog_daimyo": ["tadpole"], "broom_centipede": ["mini_broom"], "iron_claw": ["mini_broom"]}
IMG = {"tanuki_clone": "tanuki_lord"}


def main():
    panel_re = re.compile(r"bg/(s\d)/")
    core = core_cost()
    q2 = Q * Q
    base = [tuple(x * q2 if i == 0 else x for i, x in enumerate(frames_cost(PUB / "sprites" / "qiuqiu"))), tuple(x * q2 if i == 0 else x for i, x in enumerate(json_images(PUB / "art" / "terrain.json"))),
            tuple(x * q2 if i == 0 else x for i, x in enumerate(fx2_cost()))]
    stills = [stills_cost(set())]   # 共用包只剩村貓退路圖；敵人立繪改成每關自己載
    base_mem = sum(x[0] for x in base) + sum(x[0] for x in stills)
    base_dl = sum(x[1] for x in base) + sum(x[1] for x in stills)
    rows = {"core": {"memMB": round(core[0] / MB), "dlMB": round(core[1] / MB, 1)},
            "base": {"memMB": round(base_mem / MB), "dlMB": round(base_dl / MB, 1),
                     "qiuqiu": round(base[0][0] / MB), "terrain": round(base[1][0] / MB), "fx2": round(base[2][0] / MB),
                     "enemyStills": round(sum(x[0] for x in stills) / MB)}}
    art = json.loads((PUB / "art" / "art.json").read_text(encoding="utf-8"))
    ps = set(); paths_in(art, ps)
    for n in (1, 2, 3):
        st = f"s{n}"
        pan = [img_cost(PUB / "art" / p) for p in ps if f"bg/{st}/" in p]
        kinds = stage_kinds(ROOT / "src" / "stages" / f"stage{n}.ts")
        for k in list(kinds):
            kinds |= set(SUMMONS.get(k, []))
        mons = {}
        for k in kinds:
            d = PUB / "sprites" / MONDIR / IMG.get(k, k)
            if d.is_dir():
                mons[d.name] = frames_cost(d)
        # 魔王的動作圖不在進關前載（src/assets.ts playTick）：進關前下載不含；記憶體最高＝其他全部＋一次只留一隻魔王
        # （中魔王倒下就放掉，才載最後的魔王）
        bimgs = BOSSES[st]
        amb = ambient_cost(st)
        imgs = {IMG.get(k, k) for k in kinds} | ({"tanuki_lord"} if "tanuki_lord" in kinds else set())
        stl = stills_cost(imgs)
        minion_mem = sum(v[0] for k, v in mons.items() if k not in bimgs)
        boss_peak = max([mons[b][0] for b in bimgs if b in mons] or [0])
        smem = (sum(x[0] for x in pan) + minion_mem + boss_peak + amb[0] + stl[0]) * q2
        smem_all = (sum(x[0] for x in pan) + sum(v[0] for v in mons.values()) + amb[0] + stl[0]) * q2
        sdl = sum(x[1] for x in pan) + sum(v[1] for k, v in mons.items() if k not in bimgs) + amb[1] + stl[1]
        boss_dl = sum(mons[b][1] for b in bimgs if b in mons)
        rows[f"stage{n}"] = {
            "memMB_stageOnly": round(smem / MB), "memMB_total": round((core[0] + base_mem + smem) / MB),
            "memMB_totalIfAllBosses": round((core[0] + base_mem + smem_all) / MB), "dlMB_bossesLater": round(boss_dl / MB, 1),
            "dlMB_stageOnly": round(sdl / MB, 1), "dlMB_beforeFirstPlay": round((core[1] + base_dl + sdl) / MB, 1),
            "panelsMB": round(sum(x[0] for x in pan) * q2 / MB), "ambientMB": round(amb[0] * q2 / MB), "stillsMB": round(stl[0] * q2 / MB), "monsters": {k: round(v[0] * q2 / MB) for k, v in sorted(mons.items(), key=lambda x: -x[1][0])},
        }
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
