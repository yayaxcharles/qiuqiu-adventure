"""第二版地形美術後製：art_raw/v2/terrain/*.tryN.png → public/art/v2/terrain/、public/art/v2/props/ ＋ public/art/v2/v2_terrain.json。

  python tools/post_v2_terrain.py            全部（缺原檔的跳過並列出來）
  python tools/post_v2_terrain.py flat       只做新段落平地帶（陡坡導引圖要用）
沿用 post_terrain.py／post_terrain2.py 的做法與格式（把輸出路徑改到 v2/）；新格式：
  slope   陡坡帶：跟平地帶同一種畫法（每一欄照地形高度上下移、左右重複），但圖是照坡度畫的，只用在那個坡度那個方向的坡段
  block   實心方塊九宮格：center（上下左右都可重複）、top／bottom（左右重複）、left／right（上下重複）、四角
  climb   攀爬物：top＋body（上下重複）＋bottom
  waterfall  水柱（上下重複、程式往下捲）、白沫疊層（上下重複、捲得比水柱快）、水口、落水水花 4 格、水霧
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp       # noqa: E402
import post_terrain as pt     # noqa: E402
import post_terrain2 as p2    # noqa: E402

ROOT = pt.ROOT
RAW = ROOT / 'art_raw' / 'v2' / 'terrain'
ART = ROOT / 'public' / 'art'
JSON = ART / 'v2' / 'v2_terrain.json'
PS = pt.PROP_SCALE
pt.RAW = RAW
pt.PICKS = RAW / 'picks.json'
_orig_save = pt.save


def _save(a: np.ndarray, rel: str) -> dict:
    if rel.startswith('terrain/'):
        rel = 'v2/' + rel
    elif rel.startswith('props2/'):
        rel = 'v2/props/' + rel[len('props2/'):]
    elif not rel.startswith('v2/'):
        rel = 'v2/terrain/' + rel
    return _orig_save(a, rel)


pt.save = _save
MISSING: list[str] = []


def have(name: str) -> bool:
    ok = any(p for p in RAW.glob(f'{name}.try*.png') if '.reject.' not in p.name)
    if not ok:
        MISSING.append(name)
    return ok


def fade_bottom(t: np.ndarray, color: np.ndarray, rows: int = 40) -> np.ndarray:
    t = t.copy()
    H = t.shape[0]
    r = np.clip((np.arange(H) - (H - rows)) / rows, 0, 1)[:, None, None]
    t[..., :3] = t[..., :3] * (1 - r) + color[None, None, :] * r
    return t


# ── 陡坡 ──
def slope(name: str, grade: int, up: bool, flat_entry: dict, use: str) -> dict:
    import gen_v2_terrain as gv
    a, src = pt.load(name)
    a = pt.scale(a, 1536 / a.shape[1] * 0.5)          # 導引圖 1536 寬＝顯示 768
    H, W = a.shape[:2]
    g = gv.GRADES[grade]
    geo = gv.SLOPE_GEO[grade]
    run, x0 = geo['run'] / 2, (1536 - geo['run']) / 4
    top = pt.solid_top(a, 8).astype(float)
    xs = np.arange(W)
    m = 18
    sel = (xs > x0 + m) & (xs < x0 + run - m) & (top >= 0)
    # 穩健直線擬合（去掉草叢凸起：兩輪，丟掉離線最遠的 25%）
    X, Y = xs[sel], top[sel]
    for _ in range(3):
        p = np.polyfit(X, Y, 1)
        r = np.abs(Y - np.polyval(p, X))
        keep = r <= np.percentile(r, 75) + 1
        X, Y = X[keep], Y[keep]
    s_fit = float(p[0])
    target = -g if up else g
    # 把整片沿坡段做「逐欄上下移」拉平：新表面＝擬合線（不強迫改成目標角度；角度誤差另外記下，遊戲那邊用目標坡度畫，差一點點看不出）
    lo, hi = int(x0 + m), int(x0 + run - m)
    seg = a[:, lo:hi]
    ys_line = np.polyval(p, np.arange(lo, hi))
    stand = 30
    below = int(min(H - ys_line.max(), 260))
    band = np.zeros((stand + below, hi - lo, 4), np.float32)
    for i in range(hi - lo):
        y = int(round(ys_line[i]))
        y0 = y - stand
        src_col = seg[max(0, y0):min(H, y + below), i]
        band[max(0, -y0):max(0, -y0) + src_col.shape[0], i] = src_col
    bc = np.array([int(flat_entry['bottomColor'][k:k + 2], 16) for k in (1, 3, 5)], np.float32)
    # 表面以下 24 列之後一律實心：透明／半透明的洞（Codex 在坡下畫的霧、圖底外）用 bottomColor 墊底
    sub = band[stand + 24:]
    al = sub[..., 3:4] / 255
    sub[..., :3] = sub[..., :3] * al + bc * (1 - al)
    sub[..., 3] = 255
    band = fade_bottom(band, bc, 60)
    ov = 70
    t = pt.tile_x(band, ov)
    e = pt.save(t, f'terrain/{name}')
    ang_fit = float(np.degrees(np.arctan(abs(s_fit))))
    e.update(standY=stand, tileX=True, displayScale=1.0, seam=pt.seam_x(t), bottomColor=flat_entry['bottomColor'],
             slope={'dir': 'up' if up else 'down', 'grade': round(g, 3), 'deg': grade,
                    'drawnDeg': round(ang_fit, 1)},
             source=src, use=use + (f'：只用在「往右{"上" if up else "下"}、約 {grade} 度（每前進 1 像素高低差 {g:.3f}）」'
                                    '的坡段；畫法跟平地帶一樣（每一欄照地形高度上下移、u＝世界x % 寬），第 standY 列＝腳踩的線，'
                                    '圖底以下用 bottomColor 補到畫面底；坡頂坡底轉折處跟平地帶左右交叉淡化約 40 像素，'
                                    '或蓋一件 cover 遮蓋件'))
    return e


# ── 整段階梯（一張圖＝一整段 N 階，量好每一階踏面的位置） ──
def flight(name: str, riser_disp: float, use: str) -> dict:
    a, src = pt.load(name)
    top = pt.solid_top(a, 6).astype(float)
    top[top < 0] = np.nan
    W = a.shape[1]
    # 踏面＝地面頂高度的眾數（每一階一個高度）；每一階的左緣＝那個高度最長連續段的起點
    ok = ~np.isnan(top)
    hist, edges = np.histogram(top[ok], bins=np.arange(0, a.shape[0] + 4, 4))
    levels = []
    for i in np.argsort(-hist):
        if hist[i] < W * 0.03:
            break
        c = (edges[i] + edges[i + 1]) / 2
        if all(abs(c - l) > 30 for l in levels):
            levels.append(c)
    levels.sort(reverse=True)            # 由低（y 大）到高
    steps_raw = []
    tt = np.nan_to_num(top, nan=1e9)
    prev = -1
    for L in levels:     # 由低到高：這一階的左緣＝上一階左緣之後，第一個「地面頂 ≤ 這一階高度＋12」的欄
        xs = np.where((tt <= L + 12) & (np.arange(W) > prev + 20))[0]
        if len(xs) == 0:
            continue
        prev = int(xs[0])
        steps_raw.append((prev, float(L)))
    if len(steps_raw) < 2:
        raise SystemExit(f'{name}：量不到階梯')
    tw = float(np.median(np.diff([s[0] for s in steps_raw])))
    rh = float(np.median(-np.diff([s[1] for s in steps_raw])))
    k = riser_disp / rh
    y0, y1, x0, x1 = pt.bbox(a)
    a2 = pt.scale(a[y0:y1, x0:x1], k)
    steps = [{'x': round((sx - x0) * k), 'y': round((sy - y0) * k)} for sx, sy in steps_raw]
    # 第一階前面那段低地面
    e = pt.save(a2, f'terrain/{name}')
    e.update(riserH=round(rh * k), treadW=round(tw * k), steps=steps, displayScale=1.0, source=src,
             use=use + '：一張圖＝一整段階梯（往右上）。steps＝每一階「立面頂端、踏面左緣」在圖上的位置；每階高 riserH、踏面寬 treadW；'
                       '關卡用 TerrainBuilder.stairs(n, treadW, −riserH) 對齊，圖底以下用最後一列顏色補；要往左上就整張水平翻轉。')
    return e


# ── 實心方塊九宮格 ──
def block(name: str, use: str, disp_w: float = 420) -> dict:
    a, src = pt.load(name)
    a = pt.crop(a, 0)
    # 只留主塊：alpha 強的最大矩形範圍（去掉邊緣零碎）
    k = disp_w / a.shape[1]
    a = pt.scale(a, k)
    H, W = a.shape[:2]
    # 用中間 60% 列／欄估邊界：每一列最左／最右實心
    rows = a[int(H * 0.2):int(H * 0.8), :, 3] > 200
    lefts = np.array([np.argmax(r) for r in rows if r.any()])
    rights = np.array([len(r) - np.argmax(r[::-1]) for r in rows if r.any()])
    cols = a[:, int(W * 0.2):int(W * 0.8), 3] > 200
    tops = np.array([np.argmax(c) for c in cols.T if c.any()])
    bots = np.array([len(c) - np.argmax(c[::-1]) for c in cols.T if c.any()])
    L, R = int(np.median(lefts)), int(np.median(rights))
    T, B = int(np.median(tops)), int(np.median(bots))
    ml, mr = max(L + 36, int(W * 0.12)), min(R - 36, int(W * 0.88))
    mt, mb = max(T + 40, int(H * 0.2)), min(B - 30, int(H * 0.85))
    ov, fd = 40, 16
    C = pt.tile_y(pt.tile_x(a[mt:mb, ml:mr], ov), ov)
    top = pt.tile_x(a[:mt + fd, ml:mr], ov)
    top[..., 3] *= np.r_[np.ones(mt), np.linspace(1, 0, fd)][:, None]
    bot = pt.tile_x(a[mb - fd:, ml:mr], ov)
    bot[..., 3] *= np.r_[np.linspace(0, 1, fd), np.ones(H - mb)][:, None]
    left = pt.tile_y(a[mt:mb, :ml + fd], ov)
    left[..., 3] *= np.r_[np.ones(ml), np.linspace(1, 0, fd)][None, :]
    right = pt.tile_y(a[mt:mb, mr - fd:], ov)
    right[..., 3] *= np.r_[np.linspace(0, 1, fd), np.ones(W - mr)][None, :]
    out = {}
    for nm, arr in (('center', C), ('top', top), ('bottom', bot), ('left', left), ('right', right),
                    ('tl', a[:mt + fd, :ml + fd]), ('tr', a[:mt + fd, mr - fd:]), ('bl', a[mb - fd:, :ml + fd]),
                    ('br', a[mb - fd:, mr - fd:])):
        out[nm] = pt.save(arr, f'terrain/{name}_{nm}')
    # 每一件「實心邊界在圖上的位置」：畫方塊 (x, y, w, h) 時，件的左上角＝(方塊邊 − 這個位移)
    place = {'top': {'oy': T}, 'bottom': {'oy': B - (mb - fd)}, 'left': {'ox': L}, 'right': {'ox': R - (mr - fd)},
             'tl': {'ox': L, 'oy': T}, 'tr': {'ox': R - (mr - fd), 'oy': T}, 'bl': {'ox': L, 'oy': B - (mb - fd)},
             'br': {'ox': R - (mr - fd), 'oy': B - (mb - fd)}}
    return {'pieces': out, 'place': place, 'minW': ml + (W - mr) - L - (W - R), 'minH': mt + (H - mb) - T - (H - B),
            'edge': {'solidTop': T, 'solidBottom': B, 'solidLeft': L, 'solidRight': R},
            'margins': {'top': mt, 'bottom': H - mb, 'left': ml, 'right': W - mr, 'fade': fd},
            'displayScale': 1.0, 'source': src,
            'use': use + '：九宮格。畫一個實心範圍 (x, y, w, h) 的方塊：center 從 (x, y) 起鋪滿 w×h（上下左右重複，超出裁掉）'
                         '→ top 從 x 起沿上緣左右重複，圖左上角＝(x+k·寬, y−place.top.oy)；bottom 同理（y+h−place.bottom.oy）'
                         '→ left 圖左上角＝(x−place.left.ox, y+k·高)、right＝(x+w−place.right.ox, …) 上下重複 → 四角最後蓋上'
                         '（tl＝(x−ox, y−oy)、tr＝(x+w−ox, y−oy)…）。邊件內側 fade 像素是淡出，疊在 center 上；'
                         '外緣凸出的苔蘚、瓦片是裝飾（不算碰撞）。w、h 不要小於 minW、minH。'}


# ── 攀爬物 ──
def climb(name: str, use: str, disp_w: float = 72) -> dict:
    a, src = pt.load(name)
    ys, xs = np.where(a[..., 3] > 128)
    a = a[:, max(0, xs.min() - 4):xs.max() + 5]
    a = pt.scale(a, PS * disp_w / a.shape[1])
    H = a.shape[0]
    t1, b0 = int(H * 0.17), int(H * 0.86)
    ov = 40
    body = pt.tile_y(a[int(H * 0.2):int(H * 0.84)], ov)
    top = a[:t1 + ov]
    top_f = top.copy()
    top_f[-ov:, :, 3] *= np.linspace(1, 0, ov)[:, None]
    bot = a[b0 - ov:]
    bot_f = bot.copy()
    bot_f[:ov, :, 3] *= np.linspace(0, 1, ov)[:, None]
    return {'top': pt.save(top_f, f'terrain/{name}_top'), 'body': {**pt.save(body, f'terrain/{name}_body'),
                                                                  'tileY': True, 'seam': pt.seam_y(body)},
            'bottom': pt.save(bot_f, f'terrain/{name}_bottom'), 'overlap': ov, 'displayScale': 1 / PS,
            'displayW': disp_w, 'source': src,
            'use': use + '：body 上下重複鋪滿 top～bottom，再把 top 蓋在最上面（下緣 overlap 像素淡出）、bottom 蓋在最下面（上緣淡出）；'
                         '圖存顯示大小的 2 倍'}


# ── 瀑布 ──
def wf_column(name: str, disp_w: float, soft: bool) -> tuple[dict, np.ndarray]:
    a, src = (p2.load_soft(name) if soft else pt.load(name))
    ys, xs = np.where(a[..., 3] > 30)
    a = a[:, max(0, xs.min() - 6):xs.max() + 7]
    a = pt.scale(a, disp_w / a.shape[1])
    H = a.shape[0]
    body = pt.tile_y(a[int(H * 0.04):int(H * 0.96)], 70)
    e = pt.save(body, f'terrain/{name}')
    e.update(tileY=True, seam=pt.seam_y(body), displayScale=1.0, source=src)
    return e, body


def wf_one(name: str, disp_w: float, soft: bool = False) -> dict:
    a, src = (p2.load_soft(name) if soft else pt.load(name))
    a = pt.crop(a, 2)
    a = pt.scale(a, disp_w / a.shape[1])
    e = pt.save(a, f'terrain/{name}')
    e.update(displayScale=1.0, source=src)
    return e


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else 'all'
    data = json.loads(JSON.read_text(encoding='utf-8')) if JSON.exists() else {}
    data['_說明'] = ('第二版地形美術（tools/gen_v2_terrain.py 生、tools/post_v2_terrain.py 後製）。格式跟 public/art/terrain.json '
                   '一樣（座標一律圖片像素、左上角 0,0；displayScale＝顯示時乘多少；standY＝腳踩的線），新格式見 post_v2_terrain.py 檔頭。'
                   '模擬畫面在 art_raw/v2/_check/。')
    G = data.setdefault('ground', {})
    zh_flat = {'s1_terrace': '第一關·梯田坡道土路', 's1_rock': '第一關·山溪瀑布濕岩', 's1_trail': '第一關·山路',
               's2_rock': '第二關·河童瀑布濕岩（夜）', 's3_wet': '第三關·冷卻水道濕鐵格柵', 's3_walk': '第三關·天守閣外牆濕木棧道'}
    for k, zh in zh_flat.items():
        if have(f'ground_{k}'):
            G[k] = p2.ground(f'ground_{k}', f'ground_{k}', zh)
            print('ground', k, G[k]['standY'], G[k]['seam'])
    if only == 'flat':
        JSON.parent.mkdir(parents=True, exist_ok=True)
        JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        return
    import gen_v2_terrain as gv
    tj = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))['ground']
    S = data.setdefault('slope', {})
    for th, (rel, _, what) in gv.SLOPE_THEMES.items():
        fe = next((v for v in list(tj.values()) + list(G.values()) if isinstance(v, dict) and v.get('path') == rel), None)
        for grade in gv.GRADES:
            for up in (True, False):
                nm = f'slope_{th}_{"up" if up else "dn"}{grade}'
                if fe is None or not have(nm):
                    continue
                try:
                    S[nm[6:]] = e = slope(nm, grade, up, fe, f'{th} 陡坡（{what}）')
                    e['flat'] = rel
                    print('slope', nm, e['slope'], e['seam'])
                except Exception as ex:  # noqa: BLE001
                    print('slope 失敗', nm, ex)
    Bk = data.setdefault('block', {})
    for nm in gv.BLOCKS:
        if have(nm):
            Bk[nm[6:]] = block(nm, nm)
            print('block', nm, Bk[nm[6:]]['margins'])
    Wl = data.setdefault('wall', {})
    for nm in gv.WALLS:
        if have(nm):
            Wl[nm[5:]] = p2.wall(nm, nm, nm + ' 岩壁／牆（蹬牆跳用；兩面對放＝夾縫，右邊那面水平翻轉）')
    Ld = data.setdefault('ledge', {})
    for nm, dh in (('ledge_s1_rock', 70), ('ledge_s2_rock', 70), ('ledge_s3_iron', 60), ('ledge_s3_eave', 50)):
        if have(nm):
            e, _, _ = p2.long3(nm, nm, dh, nm + ' 岩棚／單向平台（從下面跳得上去）：左端＋中段×n＋右端，standY＝站的線')
            Ld[nm[6:]] = e
    St = data.setdefault('stair', {})
    for nm, rh in (('stairs_s2_shrine', 34), ('stairs_s3_iron', 30), ('stairs_s1_terrace', 60)):
        if have(nm):
            med = np.median
            def _nm(v, *a, _m=med, **k):   # 最邊上一階量不到高度（透明）→ 略過
                v = np.asarray(v, float).ravel()
                return _m(v[~np.isnan(v)], *a, **k)
            np.median = _nm
            try:
                St[nm[7:]] = flight(nm, rh, nm)
                # 2026-09-28 手動修：神社石階最低那一階（圖最左下）自動量不到，補在最前面（看 art_raw/v2/_check 對過）
                if nm == 'stairs_s2_shrine' and St[nm[7:]]['steps'][0]['x'] > 60:
                    St[nm[7:]]['steps'].insert(0, {'x': 15, 'y': 144})
                    St[nm[7:]]['stepsFix'] = '最低一階（x15,y144）手動補：自動量測漏掉'
            except Exception as ex:  # noqa: BLE001
                print('stairs 失敗', nm, ex)
            finally:
                np.median = med
    Cl = data.setdefault('climb', {})
    for nm in gv.CLIMBS:
        if have(nm):
            Cl[nm[6:]] = climb(nm, nm)
    Wf = data.setdefault('waterfall', {})
    for st in ('s1', 's2', 's3'):
        e: dict = {}
        if have(f'wf_{st}_column'):
            e['column'], _ = wf_column(f'wf_{st}_column', 420, False)
            e['column']['use'] = '水柱：上下重複，程式每秒往下捲約 360 像素（看起來在流）'
        if have(f'wf_{st}_foam'):
            e['foam'], _ = wf_column(f'wf_{st}_foam', 420, True)
            e['foam']['use'] = '白沫疊層：疊在水柱上、捲得比水柱快（約 1.5 倍）、半透明'
        if have(f'wf_{st}_lip'):
            e['lip'] = wf_one(f'wf_{st}_lip', 560)
            # 水口下半的水幕淡出，接到水柱上看不出一刀切（只淡中間水的部分，兩邊岩石不動）
            lp = ART / e['lip']['path']
            la = np.asarray(Image.open(lp).convert('RGBA')).astype(np.float32)
            h, w = la.shape[:2]
            ramp = np.clip((h - np.arange(h)) / (h * 0.35), 0, 1)[:, None]
            colmask = np.zeros(w, np.float32)
            colmask[int(w * 0.14):int(w * 0.86)] = 1
            colmask = np.convolve(colmask, np.ones(31) / 31, mode='same')[None, :]
            la[..., 3] *= 1 - colmask * (1 - ramp)
            _orig_save(la, e['lip']['path'][:-5])
            e['lip']['use'] = '水口：蓋在水柱最上端（圖底約 35% 的水幕已淡出，疊在水柱上）'
            e['lip']['use'] = '水口（瀑布頂）：蓋在水柱最上端，水柱從它下面接出去'
        if have(f'wf_{st}_splash'):
            fr, info = p2.frames_aligned(f'wf_{st}_splash', 4, 150, f'v2/terrain/wf_{st}_splash')
            e['splash'] = {'frames': fr, **info, 'displayScale': 1 / PS, 'fps': 10,
                           'use': '落水水花 4 格循環，底部中心（baseX）對準水柱底'}
        if have(f'wf_{st}_mist'):
            e['mist'] = wf_one(f'wf_{st}_mist', 1100, True)
            e['mist']['use'] = '水霧：半透明，蓋在瀑布底部與水潭上，慢慢左右飄；也能拿來蓋背景接縫'
        if have(f'wf_{st}_pool'):
            e['pool'] = p2.water(f'wf_{st}_pool', f'wf_{st}_pool', f'{st} 水潭')
        if e:
            Wf[st] = e
            print('waterfall', st, list(e))
    Cv = data.setdefault('cover', {})
    zh_cover = {'s1': ['蕨類草叢', '苔石堆', '芒草叢', '倒木'], 's2': ['蘆葦香蒲', '苔石堆', '紅葉矮叢', '小石燈籠'],
                's3': ['斷管閥門堆', '煤與廢鐵', '鐵板齒輪堆', '鐵箱']}
    for st, zhs in zh_cover.items():
        nm = f'cover_{st}_sheet'
        if have(nm):
            try:
                Cv.update(p2.sheet(nm, 4, [(f'cover_{st}_{i + 1}', 64 if st != 's3' else 56,
                                            f'{zhs[i]}（遮地面接縫、坡頂坡底轉折）', None) for i in range(4)]))
            except SystemExit as ex:
                print(ex)
        nm = f'cover_{st}_fore'
        if have(nm):
            e = wf_one(nm, 1280)
            e['use'] = '前景遮蓋件（貼畫面底、比地形快捲），用來蓋背景插段接縫或段落轉場'
            Cv[f'cover_{st}_fore'] = e
    Pr = data.setdefault('props', {})
    for st in ('s1', 's2'):
        nm = f'stones_{st}'
        if have(nm):
            try:
                Pr.update(p2.sheet(nm, 3, [(f'stone_{st}_{i + 1}', 60, '瀑布水潭踏腳石（頂面可站）', None) for i in range(3)],
                                   one_row=True))
            except SystemExit as ex:
                print(ex)
    JSON.parent.mkdir(parents=True, exist_ok=True)
    JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    print('缺原檔：', MISSING)


if __name__ == '__main__':
    main()
