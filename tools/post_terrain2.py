"""第二批後製（2026-09-26）：art_raw/terrain/*.tryN.png（tools/gen_terrain2.py 生的）→ public/art/terrain/、props2/、ui/ ＋ terrain.json 新鍵。

  python tools/post_terrain2.py

只加新鍵、不改第一批的鍵（第一批由 tools/post_terrain.py 管；兩支都可以重跑，互不蓋掉）。
新增的區塊：
  ground／wall／post／props  沿用第一批的格式，鍵名加關卡前綴（s2_street、s3_castle…）
  rail     第二批加 s2_bridge、s2_stage、s3_catwalk、s3_conveyor（格式同第一批的竹架木架；conveyor 另有 midFrames）
  deck     站得上去（或只當擋牆）的長條、沒有支柱：s1_rampart、s1_palisade、s3_ridge（左／中×n／右）
  building 攤位屋頂（格式同 house）：s2_stallroof
  stair    石階：一階一塊（格式同崖壁：top＋body，壁面朝左）
  platform 單張的站台：s2_torii、s3_lift（standY＋standX0/standX1＝能站的左右範圍）
  water    s2_river：可左右重複的水面帶＋4 格波動
  anim     會動的：s1_campfire（柴堆＋4 格火焰）、s3_steam_vent（噴口＋4 格蒸氣）
  ending   結局圖（public/art/ui/ending_rescued.webp）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp    # noqa: E402
import post_terrain as pt  # noqa: E402

ROOT = pt.ROOT
OUT = pt.OUT
JSON_OUT = pt.JSON_OUT
PS = pt.PROP_SCALE


def load_soft(name: str) -> tuple[np.ndarray, str]:
    """煙、火焰：保留半透明邊緣，只把背景殘影（alpha<8）歸零。"""
    src = pt.pick(name)
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    a[..., 3][a[..., 3] < 8] = 0
    a[..., :3][a[..., 3] == 0] = 0
    return a, src.name


def band_top(a: np.ndarray, frac: float = 0.9) -> tuple[int, int]:
    """中間 60% 欄裡「整列幾乎都實心」的列，分成一段段，取最厚那段：回傳（頂列, 厚度）。
    欄杆的橫桿很薄、平台面很厚，這樣抓到的是平台面，不是欄杆。"""
    W = a.shape[1]
    s = (a[:, int(W * 0.2):int(W * 0.8), 3] > 128).mean(1) > frac
    lab, n = ndimage.label(s)
    best = max(range(1, n + 1), key=lambda i: int((lab == i).sum()))
    rows = np.where(lab == best)[0]
    return int(rows[0]), int(len(rows))


# ── 地面帶、崖壁（照第一批寫法，名稱換成參數） ──
def ground(name: str, out: str, use: str) -> dict:
    a, src = pt.load(name)
    a = pt.scale(a, 0.5)
    top = pt.solid_top(a, 10)
    valid = top[top >= 0]
    stand = int(np.median(valid))
    flat = float(np.mean(np.abs(valid - stand) <= 3))
    y0 = max(0, pt.bbox(a)[0] - 4)
    a = a[y0:]
    stand -= y0
    t = pt.tile_x(a, 110)
    bottom = t[-10:, :, :3].reshape(-1, 3).mean(0)
    e = pt.save(t, f'terrain/{out}')
    e.update(standY=stand, tileX=True, displayScale=1.0, flatness=round(flat, 3), seam=pt.seam_x(t),
             bottomColor='#%02x%02x%02x' % tuple(int(v) for v in bottom), source=src,
             use=use + '：左右重複；圖的第 standY 列＝腳踩的線，圖底以下用 bottomColor 補滿到畫面底')
    return e


def wall(name: str, out: str, use: str, fade: int = 70) -> dict:
    a, src = pt.load(name)
    a = pt.scale(a, 0.5)
    H, W = a.shape[:2]
    lefts = np.array([np.argmax(a[y, :, 3] > 128) if (a[y, :, 3] > 128).any() else W for y in range(H)])
    body_rows = slice(int(H * 0.3), int(H * 0.95))
    x0 = max(0, int(lefts.min()) - 2)
    a = a[:, x0:]
    lefts = lefts - x0
    faceX = int(np.percentile(lefts[body_rows], 98)) + 2
    W = a.shape[1]
    top = pt.solid_top(a, 8)
    cols = top[faceX + 20:min(W, faceX + 150)]
    stand = int(np.median(cols[cols >= 0]))
    ramp = np.ones(W, np.float32)
    ramp[W - fade:] = np.linspace(1, 0, fade)
    a[..., 3] *= ramp[None, :]
    T, ov = stand + 110, 60
    body = pt.tile_y(a[T:H - 6], ov)
    e_top = pt.save(a[:T + ov], f'terrain/{out}_top')
    e_body = pt.save(body, f'terrain/{out}_body')
    return {'top': {**e_top, 'standY': stand}, 'body': {**e_body, 'tileY': True, 'seam': pt.seam_y(body)},
            'faceX': faceX, 'faces': 'left', 'fadeRight': fade, 'displayScale': 1.0, 'source': src,
            'use': use + '：擺法同第一批崖壁（壁面朝左；左邊高就整組水平翻轉；頂塊 standY 對齊高處站立線，壁身往下重複到畫面底）。'}


# ── 長條三段 ──
def long3(name: str, out: str, disp_h: float, use: str, a0f: float = 0.12, rf: float = 0.84,
          frac: float = 0.9) -> tuple[dict, np.ndarray, int]:
    a, src = pt.load(name)
    y0, y1, _, _ = pt.bbox(a, 60)
    a = pt.scale(a, PS * disp_h / (y1 - y0))
    y0, y1, x0, x1 = pt.bbox(a)
    a = a[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2]
    H, W = a.shape[:2]
    stand, thick = band_top(a, frac)
    rows = slice(max(0, stand - int(H * 0.2)), min(H, stand + thick))
    P = pt.period(a, rows, int(W * 0.06), int(W * 0.2))
    ov = max(12, P // 5)
    left, mid, right, info = pt.three_piece(a, int(W * a0f), P, ov, int(W * rf))
    e = {'left': pt.save(left, f'terrain/{out}_left'), 'mid': {**pt.save(mid, f'terrain/{out}_mid'), 'repeat': True},
         'right': pt.save(right, f'terrain/{out}_right'), 'standY': stand, 'bandH': thick, 'displayScale': 1 / PS,
         'split': info, 'source': src, 'use': use}
    return e, mid, stand


def building(name: str, out: str, disp_ridge: float, use: str) -> dict:
    a, src = pt.load(name)
    H, W = a.shape[:2]
    top = pt.solid_top(a, 10)
    mc = top[int(W * 0.3):int(W * 0.7)]
    ridge = int(np.median(mc[mc >= 0]))
    bot = int(np.where((a[:, int(W * 0.3):int(W * 0.7), 3] > 128).any(1))[0].max()) + 1
    a = pt.scale(a, PS * disp_ridge / (bot - ridge))
    y0, y1, x0, x1 = pt.bbox(a)
    a = a[max(0, y0 - 2):y1 + 1, max(0, x0 - 2):x1 + 2]
    H, W = a.shape[:2]
    top = pt.solid_top(a, 6)
    mc = top[int(W * 0.3):int(W * 0.7)]
    ridge = int(np.median(mc[mc >= 0]))
    near = np.where((top >= 0) & (top <= ridge + 3))[0]
    rx0, rx1 = int(near.min()), int(near.max()) + 1
    rows = slice(int(ridge + (H - ridge) * 0.4), int(ridge + (H - ridge) * 0.8))
    P = pt.period(a, rows, int(W * 0.14), int(W * 0.24))
    ov = max(16, P // 5)
    a0 = int(W * 0.06)
    left, mid, right, info = pt.three_piece(a, a0, P, ov, int(W * 0.76))
    # 中段的其他開間（每間賣的東西不同）：跟 mid 一樣寬、可以互相接，輪流用才不會一整排都一樣
    variants = []
    for j in range(1, 6):
        s0 = a0 + j * P
        if s0 + P + ov > info['r0'] + ov:
            break
        v = pt.tile_x(a[:, s0:s0 + P + ov], ov)
        variants.append({**pt.save(v, f'terrain/{out}_mid{j}'), 'repeat': True})
    return {'left': {**pt.save(left, f'terrain/{out}_left'), 'ridgeX': rx0},
            'mid': {**pt.save(mid, f'terrain/{out}_mid'), 'repeat': True},
            'midVariants': variants,
            'right': {**pt.save(right, f'terrain/{out}_right'), 'ridgeX': rx1 - (W - right.shape[1])},
            'standY': ridge, 'bottomY': H, 'displayScale': 1 / PS, 'split': info, 'source': src,
            'use': use + ' 中段可以在 mid 與 midVariants 之間輪流挑（寬度都一樣、可以互相接），一整排才不會每間都一樣。'}


# ── 石階 ──
def stairs(name: str, out: str, riser_disp: float, use: str, ext_disp: float = 96) -> dict:
    a, src = pt.load(name)
    top = pt.solid_top(a, 6)
    # 找每一階的立面：地面頂往上跳超過 12 像素的欄
    t = top.astype(float)
    t[t < 0] = np.nan
    jumps = [x for x in range(8, len(t) - 8) if t[x - 6] - t[x + 6] > 12 and np.nanmin(t[x - 6:x]) > np.nanmax(t[x + 1:x + 7]) + 8]
    groups: list[list[int]] = []
    for x in jumps:
        if groups and x - groups[-1][-1] <= 3:
            groups[-1].append(x)
        else:
            groups.append([x])
    risers = [g[len(g) // 2] for g in groups]
    treads = np.diff(risers)
    tw = int(np.median(treads))
    rh = int(np.median([t[r - 10] - t[r + 10] for r in risers]))
    k = PS * riser_disp / rh
    i = len(risers) // 2
    xr = risers[i]
    ty = int(np.nanmedian(t[xr + 10:xr + tw - 10]))
    # 往左多留一點（石階前緣的圓角會凸出立面），往右只到下一階立面前
    xl = xr - int(tw * 0.18)
    piece = a[:, max(0, xl):xr + tw - 2].copy()
    lefts = np.array([np.argmax(piece[y, :, 3] > 128) if (piece[y, :, 3] > 128).any() else piece.shape[1]
                      for y in range(piece.shape[0])])
    piece = pt.scale(piece, k)
    ty_s, top_rows = int(round(ty * k)), int(round((ty + rh * 2.2) * k))
    # 立面位置：這一階立面那幾列的最左實心欄（取偏內側，蓋住低處地面的切邊）
    face = int(np.percentile(lefts[ty + 4:ty + rh], 90) * k) + 2
    # 踏面往右延長到 ext_disp 像素（關卡的階寬 40～60；多出來的部分會被上一階蓋住，所以要從最低畫到最高）
    twS = int(round(tw * k))
    unit = piece[:, face + int(twS * 0.35):piece.shape[1] - 2]
    ovu = max(12, unit.shape[1] // 5)
    while piece.shape[1] - face < ext_disp * PS:
        piece = np.concatenate([piece[:, :-ovu], pt.cut_blend(piece[:, -ovu:], unit[:, :ovu], 3), unit[:, ovu:]], axis=1)
    # 右緣淡出 22 像素（最上面一階接回平地時不要一刀切）
    W = piece.shape[1]
    fade = 22 * int(PS)
    ramp = np.ones(W, np.float32)
    ramp[W - fade:] = np.linspace(1, 0, fade)
    piece[..., 3] *= ramp[None, :]
    y_top0 = max(0, ty_s - 40)
    ov = 40
    topp = piece[y_top0:top_rows + ov]
    body_src = piece[top_rows:piece.shape[0] - 6]
    body = pt.tile_y(body_src, ov)
    return {'top': {**pt.save(topp, f'terrain/{out}_top'), 'standY': ty_s - y_top0},
            'body': {**pt.save(body, f'terrain/{out}_body'), 'tileY': True, 'seam': pt.seam_y(body)},
            'faceX': face, 'faces': 'left', 'treadW': round((W - face) / PS), 'riserH': riser_disp,
            'displayScale': 1 / PS, 'source': src,
            'measured': {'risers': risers, 'treadPx': tw, 'riserPx': rh},
            'use': use}


# ── 單張站台 ──
def platform_torii(name: str, out: str, disp_h: float, use: str) -> dict:
    a, src = pt.load(name)
    a = pt.crop(a, 2)
    a = pt.scale(a, PS * disp_h / a.shape[0])
    H, W = a.shape[:2]
    mid_cols = a[:, int(W * 0.4):int(W * 0.6), 3] > 128
    stand = int(np.argmax(mid_cols.any(1)))
    top = pt.solid_top(a, 4)
    ok = np.where((top >= 0) & (np.abs(top - stand) <= 6))[0]
    e = pt.save(a, f'terrain/{out}')
    e.update(standY=stand, standX0=int(ok.min()), standX1=int(ok.max()) + 1, displayScale=1 / PS,
             anchor='bottom-center', source=src, use=use)
    return e


def platform_lift(name: str, out: str, disp_w: float, use: str) -> dict:
    a, src = pt.load(name)
    a = pt.crop(a, 2)
    a = pt.scale(a, PS * disp_w / a.shape[1])
    H, W = a.shape[:2]
    stand, thick = band_top(a, 0.8)
    row = a[min(H - 1, stand + 6), :, 3] > 128
    xs = np.where(row)[0]
    e = pt.save(a, f'terrain/{out}')
    e.update(standY=stand, standX0=int(xs.min()), standX1=int(xs.max()) + 1, displayScale=1 / PS,
             anchor='stand-line', source=src, use=use)
    return e


# ── 水面 ──
def water(name: str, out: str, use: str) -> dict:
    a, src = load_soft(name)
    a = pt.scale(a, 0.5)
    top = pt.solid_top(a, 6, 100)
    surf = int(np.median(top[top >= 0]))
    y0 = max(0, surf - 14)
    a = a[y0:]
    surf -= y0
    t = pt.tile_x(a, 110)
    H, W = t.shape[:2]
    frames = []
    for f in range(4):
        fr = np.empty_like(t)
        for y in range(H):
            depth = max(0.0, (y - surf + 6) / H)
            amp = 3.0 * (1 - depth) + 0.6
            dx = amp * np.sin(2 * np.pi * (f / 4 + y / 23.0))
            s = int(np.floor(dx))
            w = dx - s
            fr[y] = np.roll(t[y], s, axis=0) * (1 - w) + np.roll(t[y], s + 1, axis=0) * w
        frames.append(pt.save(fr, f'terrain/{out}_{f}'))
    bottom = t[-10:, :, :3].reshape(-1, 3).mean(0)
    return {'frames': frames, 'surfaceY': surf, 'tileX': True, 'fps': 6, 'displayScale': 1.0, 'seam': pt.seam_x(t),
            'bottomColor': '#%02x%02x%02x' % tuple(int(v) for v in bottom), 'source': src,
            'use': use + '：4 格輪播（約每秒 6 格）；每格都左右無縫重複；第 surfaceY 列＝水面線，圖底以下用 bottomColor 補到畫面底'}


# ── 動畫格 ──
def frames_aligned(name: str, n: int, disp_h: float, out: str) -> tuple[list[dict], dict]:
    a, src = load_soft(name)
    pieces = None
    for dil in (18, 26, 34, 44, 10):
        pieces = gp.split_items(a, n, dil, one_row=True)
        if pieces is not None:
            break
    if pieces is None:
        raise SystemExit(f'{name}：切不出 {n} 格')
    # 每格的「底」＝最下面實心列、「中」＝底部 12% 那幾列實心的中心 x
    info = []
    for p in pieces:
        ys, xs = np.where(p[..., 3] > 40)
        bot = int(ys.max())
        base_rows = p[max(0, bot - int(p.shape[0] * 0.12)):bot + 1, :, 3] > 40
        cx = float(np.mean(np.where(base_rows.any(0))[0]))
        info.append((bot, cx))
    Hmax = max(b for b, _ in info) + 2
    L = int(max(cx for _, cx in info)) + 4
    R = int(max(p.shape[1] - cx for p, (_, cx) in zip(pieces, info))) + 4
    k = PS * disp_h / Hmax
    outs = []
    for i, (p, (bot, cx)) in enumerate(zip(pieces, info)):
        c = np.zeros((Hmax, L + R, 4), np.float32)
        oy, ox = Hmax - 1 - bot, int(round(L - cx))
        hh, ww = min(p.shape[0], Hmax - oy), min(p.shape[1], L + R - ox)
        c[oy:oy + hh, ox:ox + ww] = p[:hh, :ww]
        c = pt.scale(c, k)
        outs.append(pt.save(c, f'{out}_{i}'))
    return outs, {'baseX': round(L * k), 'source': src}


# ── 道具（拼版） ──
def sheet(name: str, n: int, specs: list[tuple], one_row: bool = False) -> dict:
    """specs：每一塊 (輸出名, 顯示高, 用途, 完好版索引或 None)。打爛版跟它的完好版用同一個縮放。"""
    a, src = pt.load(name)
    pieces = None
    for dil in (18, 10, 26, 34, 6):
        pieces = gp.split_items(a, n, dil, one_row=one_row)
        if pieces is not None:
            break
    if pieces is None:
        raise SystemExit(f'{name}：切不出 {n} 塊')
    res: dict = {}
    ks: dict[int, float] = {}
    for i, (nm, dh, use, base) in enumerate(specs):
        if base is None:
            ks[i] = PS * dh / pieces[i].shape[0]
        k = ks[i] if base is None else ks[base]
        e = pt.prop_entry(pieces[i], nm, k, use, src)
        if base is None:
            e['displayH'] = dh
        res[nm] = e
    return res


def single(name: str, out: str, disp_h: float, use: str, anchor: str = 'bottom-center', k: float | None = None) -> tuple[dict, float]:
    a, src = pt.load(name)
    p = pt.crop(a, 2)
    k = k or PS * disp_h / p.shape[0]
    e = pt.prop_entry(p, out, k, use, src, anchor)
    e['displayH'] = disp_h
    return e, k


def gate_pair(name: str, out: str, disp_h: float, zh: str) -> dict:
    A, s1 = pt.load(name)
    B, s2 = pt.load(f'{name}_broken')
    if B.shape != A.shape:
        B = pt.resize(B, A.shape[1], A.shape[0])
    ya0, ya1, xa0, xa1 = pt.bbox(A)
    yb0, yb1, xb0, xb1 = pt.bbox(B)
    y0, y1, x0, x1 = min(ya0, yb0), max(ya1, yb1), min(xa0, xb0), max(xa1, xb1)
    k = PS * disp_h / (ya1 - ya0)
    res = {}
    for arr, rel, use, src in [(A, out, zh + '：底部中間貼地', s1),
                               (B, f'{out}_broken', zh + '打爛後（跟完好版同一個裁切框：直接換圖就對齊）', s2)]:
        p = pt.scale(np.pad(arr[y0:y1, x0:x1], ((2, 2), (2, 2), (0, 0))), k)
        e = pt.save(p, f'props2/{rel}')
        e.update(displayScale=1 / PS, anchor='bottom-center', use=use, source=src)
        if rel == out:
            e['displayH'] = disp_h
        res[rel] = e
    return res


def ending() -> dict:
    src = pt.pick('ending')
    im = Image.open(src).convert('RGB')
    W, H = im.size
    h169 = round(W * 9 / 16)
    # 天空上方多、屋瓦下方少：從上面切掉大部分（角色都在中下段，最上面那隻小貓的耳朵在 y≈200）
    y0 = min(H - h169, int((H - h169) * 0.85))
    im = im.crop((0, y0, W, y0 + h169)).resize((1920, 1080), Image.LANCZOS)
    p = OUT / 'ui' / 'ending_rescued.webp'
    im.save(p, 'WEBP', quality=92, method=6)
    im.save(ROOT / 'art_raw' / 'terrain' / '_check' / 'ending_rescued.png')
    return {'path': 'ui/ending_rescued.webp', 'w': 1920, 'h': 1080, 'source': src.name, 'crop': [0, y0, W, y0 + h169],
            'use': '結局圖：暴風雨過後天守閣頂的夕陽，球球跟 15 隻被救的村貓合照。16:9，直接鋪滿 1280x720 畫面。'
                   '原圖 1536x1024（3:2），切掉上方天空成 16:9 後放大到 1920x1080（放大約 1.25 倍）。'}


def main() -> None:
    J = json.loads(JSON_OUT.read_text(encoding='utf-8'))
    add: dict[str, dict] = {k: {} for k in ('ground', 'wall', 'rail', 'post', 'props', 'deck', 'building', 'stair',
                                            'platform', 'water', 'anim', 'ending')}
    # 第一關補件
    add['stair']['stone'] = stairs('s1_stairs', 'stair_stone', 28, (
        '石階（第一關山村樓梯；第二關神社石階也可以用）：一階一塊，格式同崖壁（壁面＝立面朝左、左低右高；下樓梯整組水平翻轉）。'
        '每一階：立面 x 對齊落差的 x，頂塊 standY 對齊那一階踏面的站立線，壁身往下重複到畫面底。'
        '圖的踏面寬 treadW 像素（顯示後），比關卡的階寬（40、60）寬：從最低的一階畫到最高的一階，高的那階會蓋住低的那階多出來的部分。'))
    e, _, _ = long3('s1_palisade', 's1_palisade', 230, (
        '山賊寨木柵（取代 art.json 舊的 props_s1_palisade 亮色版）：左端＋中段×n＋右端，底部貼地。'
        '頂上是削尖的木樁，不能站；standY 只是木樁實心部分的上緣（當擋牆時用）。'))
    add['deck']['s1_palisade'] = {**e, 'standable': False, 'anchor': 'bottom'}
    e, _, _ = long3('s1_rampart', 's1_rampart', 180, (
        '山賊寨木造矮牆（上面鋪木板，可以站）：左端＋中段×n＋右端，底部貼地；圖上第 standY 列＝木板走道頂＝腳踩的線。'))
    add['deck']['s1_rampart'] = {**e, 'standable': True, 'anchor': 'bottom'}
    add['props']['s1_bamboo_fore'], _ = single('s1_bamboo_fore', 's1_bamboo_fore', 900, (
        '竹林大竹叢（取代 art.json 舊的 props_s1_bamboo 亮綠版；前景或背景都可用）：底部中間貼地，上端超出畫面頂。'
        '當前景時請配合暗一點或半透明。'))
    base, kb = single('s1_campfire_base', 's1_campfire_base', 70, '營火柴堆（不含火焰）：底部中間貼地')
    fl, finfo = frames_aligned('s1_campfire_flames', 4, 120, 'props2/s1_campfire_flame')
    add['anim']['s1_campfire'] = {
        'base': base, 'frames': fl, 'fps': 10, 'displayScale': 1 / PS, 'frameAnchor': 'bottom-center', **finfo,
        'use': ('營火（取代 art.json 舊的 props_s1_campfire）：先畫柴堆（底部中間貼地），再把火焰格的底部中間對齊柴堆中心、'
                '往上約柴堆高度的 45%（火從柴堆中間冒出來）；4 格輪播約每秒 10 格；火焰格有半透明邊緣。')}
    # 第二關
    add['ground']['s2_street'] = ground('s2_ground_street', 'ground_s2_street', '第二關·夜祭石板街')
    add['ground']['s2_bank'] = ground('s2_ground_bank', 'ground_s2_bank', '第二關·河堤木棧道泥地')
    add['ground']['s2_shrine'] = ground('s2_ground_shrine', 'ground_s2_shrine', '第二關·神社石徑（落楓葉）')
    add['wall']['s2_embank'] = wall('s2_wall_embank', 'wall_s2_embank', '第二關·石砌河堤（河段落差、坑邊）')
    add['wall']['s2_shrine'] = wall('s2_wall_shrine', 'wall_s2_shrine', '第二關·神社石垣')
    add['building']['s2_stallroof'] = building('s2_stallroof', 's2_stallroof', 150, (
        '第二關·可以站上去的攤位長屋：格式同 house（左端＋中段×n＋右端、頂端對齊緊貼著排），屋脊橫樑＝站立線，'
        'left.ridgeX～right.ridgeX 是能站的範圍；檔案 2 倍大、顯示 ×0.5（屋脊到圖底約 150）。'))
    e, _, _ = long3('s2_bridge', 's2_bridge', 95, (
        '第二關·朱紅木橋橋面（平橋）：左端＋中段×n＋右端；standY＝橋面頂（欄杆在上面、畫在角色後面）；'
        '檔案 2 倍大、顯示 ×0.5；橋墩用 post.s2_red 或 post.s2_pile 往下接到水面或地面。'))
    add['rail']['s2_bridge'] = {**e, 'post': 's2_red'}
    e, _, _ = long3('s2_stage', 's2_stage', 120, (
        '第二關·祭典木台（櫓台頂）：左端＋中段×n＋右端；standY＝台面頂；紅白布幕垂在台面下；支柱用 post.s2_square。'), frac=0.85)
    add['rail']['s2_stage'] = {**e, 'post': 's2_square'}
    add['platform']['s2_torii'] = platform_torii('s2_torii', 'platform_s2_torii', 330, (
        '第二關·大鳥居（上橫樑可以站）：底部中間貼地；standY＝上橫樑中段頂；standX0～standX1＝能站的左右範圍（兩端微翹，不要站到最尾端）。'))
    add['water']['s2_river'] = water('s2_water', 'water_s2_river', '第二關·河面（河段、坑；河童從這裡冒出來）')
    add['post'].update(posts('s2_posts', ['s2_red', 's2_square', 's2_pile'], 20,
                             '第二關支柱：s2_red 朱紅橋柱、s2_square 祭典木台方柱、s2_pile 河中木樁；中心對齊柱子 x、從平台面往下重複'))
    add['props'].update(sheet('s2_props_a', 4, [
        ('s2_lantern_stall', 170, '第二關·燈籠攤（可打爛）', None), ('s2_crate', 72, '第二關·祭典木箱（可打爛）', None),
        ('s2_lantern_stall_broken', 0, '燈籠攤打爛後（同縮放、同錨點）', 0), ('s2_crate_broken', 0, '祭典木箱打爛後', 1)]))
    add['props'].update(sheet('s2_props_b', 4, [
        ('s2_sake_stack', 130, '第二關·酒樽堆（可打爛）', None), ('s2_stone_lantern', 150, '第二關·石燈籠（可打爛）', None),
        ('s2_sake_stack_broken', 0, '酒樽堆打爛後', 0), ('s2_stone_lantern_broken', 0, '石燈籠打爛後', 1)]))
    add['props'].update(sheet('s2_props_c', 4, [
        ('s2_offering_box', 62, '第二關·賽錢箱（可打爛）', None), ('s2_signboard', 150, '第二關·木製看板（可打爛；板面空白）', None),
        ('s2_offering_box_broken', 0, '賽錢箱打爛後（撒出金幣）', 0), ('s2_signboard_broken', 0, '看板打爛後', 1)]))
    add['props'].update(sheet('s2_decor', 2, [
        ('s2_shrine_bell', 220, '第二關·神社大鈴（裝飾；自己帶木架，底部貼地）', None),
        ('s2_ema_rack', 160, '第二關·繪馬架（裝飾）', None)], one_row=True))
    # 第三關
    add['ground']['s3_town'] = ground('s3_ground_town', 'ground_s3_town', '第三關·城下石板路')
    add['ground']['s3_grate'] = ground('s3_ground_grate', 'ground_s3_grate', '第三關·工廠鐵格柵地板')
    add['ground']['s3_roof'] = ground('s3_ground_roof', 'ground_s3_roof', '第三關·天守閣瓦屋頂（雨中）')
    add['wall']['s3_castle'] = wall('s3_wall_castle', 'wall_s3_castle', '第三關·城牆石垣')
    add['wall']['s3_iron'] = wall('s3_wall_iron', 'wall_s3_iron', '第三關·鐵板牆（工廠）')
    e, _, _ = long3('s3_catwalk', 's3_catwalk', 80, (
        '第三關·鐵製走道：左端＋中段×n＋右端；standY＝格柵走道頂（扶手在上面、畫在角色後面）；支柱用 post.s3_ibeam。'))
    add['rail']['s3_catwalk'] = {**e, 'post': 's3_ibeam'}
    e, mid, stand = long3('s3_conveyor', 's3_conveyor', 58, (
        '第三關·輸送帶：左端＋中段×n＋右端；standY＝皮帶頂；中段有 4 格（midFrames，皮帶往右跑），輪播約每秒 12 格；'
        '要往左跑就倒著播；支架用 post.s3_lattice。'), frac=0.85)
    belt = int(mid.shape[0] * 0.28)   # 只捲凸塊和皮帶那幾列（再往下是框架與立柱，捲了會斷開）
    mf = []
    P = mid.shape[1]
    for f in range(4):
        m = mid.copy()
        s = int(round(P * f / 4))
        m[:belt] = np.roll(mid[:belt], s, axis=1)
        mf.append(pt.save(m, f'terrain/s3_conveyor_mid_{f}'))
    add['rail']['s3_conveyor'] = {**e, 'post': 's3_lattice', 'midFrames': mf, 'fps': 12,
                                  'note': '只捲動凸塊與皮帶那幾列（中段圖最上面 28%），滾輪與框架不動；腳踩在凸塊上緣附近'}
    e, _, _ = long3('s3_ridge', 's3_ridge', 150, (
        '第三關·天守閣屋脊（雨中，可以站）：左端＋中段×n＋右端，底部貼地（圖底埋進地面帶 4 像素）；standY＝屋脊頂＝腳踩的線。要架高就在下面接 s3_roof 地面帶的瓦片剖面或鐵板牆。'),
        a0f=0.14, rf=0.8)
    add['deck']['s3_ridge'] = {**e, 'standable': True, 'anchor': 'bottom'}
    add['platform']['s3_lift'] = platform_lift('s3_lift', 'platform_s3_lift', 230, (
        '第三關·升降台：standY＝台面頂、standX0～standX1＝能站的範圍；鋼索往上超出圖頂（請往上接到畫面頂，可以用 post 或畫線延長）。'))
    add['post'].update(posts('s3_posts', ['s3_ibeam', 's3_lattice', 's3_pipe'], 22,
                             '第三關支柱：s3_ibeam 鐵 I 字柱（走道）、s3_lattice 格子鋼架（輸送帶）、s3_pipe 銅蒸氣管柱'))
    vb, _ = single('s3_vent_base', 's3_vent_base', 72, '第三關·蒸氣噴口（底座）：底部中間貼地')
    st, sinfo = frames_aligned('s3_vent_steam', 4, 230, 'props2/s3_vent_steam')
    add['anim']['s3_steam_vent'] = {
        'base': vb, 'frames': st, 'fps': 8, 'displayScale': 1 / PS, 'frameAnchor': 'bottom-center', **sinfo,
        'use': ('蒸氣噴口：底座底部中間貼地；噴氣時把蒸氣格的底部中間對齊噴嘴口（底座頂端中間，約底座圖寬的 45% 處）。'
                '4 格＝噴出→最高→散開→變弱，可以照噴氣節奏播（不噴時只畫底座）。')}
    add['props']['s3_turret_mount'], _ = single('s3_turret_mount', 's3_turret_mount', 110, (
        '第三關·甲蟲砲台的牆上底座（空的轉盤）：貼在牆上，砲台畫在轉盤中心；錨點 center'), anchor='center')
    add['props'].update(sheet('s3_props_a', 4, [
        ('s3_oil_drum', 95, '第三關·鐵皮油桶（可打爛）', None), ('s3_gearbox', 90, '第三關·齒輪箱（可打爛）', None),
        ('s3_oil_drum_broken', 0, '油桶打爛後（漏油）', 0), ('s3_gearbox_broken', 0, '齒輪箱打爛後', 1)]))
    add['props'].update(sheet('s3_props_b', 4, [
        ('s3_crate', 72, '第三關·機關城木箱（鐵包角，可打爛）', None), ('s3_steam_pipe', 120, '第三關·蒸氣管段（可打爛）', None),
        ('s3_crate_broken', 0, '機關城木箱打爛後', 0), ('s3_steam_pipe_broken', 0, '蒸氣管段打爛後（噴蒸氣）', 1)]))
    add['props'].update(gate_pair('s3_gate', 's3_gate', 430, '第三關·機關城城門（守門石獅守的那扇，打爛才過得去）'))
    add['ending']['rescued'] = ending()

    # 合併：只加新鍵，舊鍵一個都不動
    for sec, items in add.items():
        cur = J.setdefault(sec, {})
        for k, v in items.items():
            if k in cur and sec in ('ground', 'wall', 'rail', 'post', 'props') and not k.startswith(('s1_', 's2_', 's3_')) \
                    and k not in ('stone',):
                raise SystemExit(f'{sec}.{k} 是第一批的鍵，不能蓋')
            cur[k] = v
    J['_說明2'] = ('第二批（tools/gen_terrain2.py 生、tools/post_terrain2.py 後製）：鍵名加了關卡前綴。新區塊：deck（長條、無支柱，'
                  'standable＝能不能站）、building（格式同 house）、stair（石階，格式同崖壁）、platform（單張站台，standX0～standX1'
                  '＝能站的範圍）、water（水面帶＋4 格）、anim（柴堆／噴口＋動畫格）、ending（結局圖）。'
                  '第一批的鍵都沒動。模擬畫面在 art_raw/terrain/_check/s1b_*、s2_*、s3_*。')
    JSON_OUT.write_text(json.dumps(J, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    for sec, items in add.items():
        for k, v in items.items():
            brief = {kk: vv for kk, vv in v.items() if kk in ('w', 'h', 'standY', 'seam', 'faceX', 'surfaceY', 'standX0',
                                                               'standX1', 'treadW', 'bandH')}
            if 'split' in v:
                brief['split'] = v['split']
            print(sec, k, brief)


def posts(name: str, names: list[str], disp_w: float, use: str) -> dict:
    a, src = pt.load(name)
    cols = (a[..., 3] > 128).any(0)
    lab, n = ndimage.label(cols)
    spans = [tuple(np.where(lab == i)[0][[0, -1]]) for i in range(1, n + 1)]
    spans = [s for s in spans if s[1] - s[0] > 20]
    if len(spans) != len(names):
        raise SystemExit(f'{name}：切出 {len(spans)} 根，預期 {len(names)} 根')
    k = PS * disp_w / (spans[0][1] - spans[0][0])
    out = {}
    for nm, (c0, c1) in zip(names, spans):
        p = a[:, max(0, c0 - 3):c1 + 4]
        r = np.where((p[..., 3] > 128).any(1))[0]
        p = pt.scale(p[r.min() + 10:r.max() - 10], k)
        t = pt.tile_y(p, max(20, p.shape[0] // 8))
        out[nm] = {**pt.save(t, f'terrain/post_{nm}'), 'tileY': True, 'seam': pt.seam_y(t), 'displayScale': 1 / PS,
                   'source': src, 'use': use}
    return out


if __name__ == '__main__':
    main()
