"""站得上去的東西與道具的後製（2026-09-26）：art_raw/terrain/*.tryN.png → public/art/terrain/、public/art/props2/ ＋ public/art/terrain.json。

  python tools/post_terrain.py

做的事（每個名稱用 art_raw/terrain/picks.json 指定的那一次，沒指定就用最新一次，*.reject.png 不用）：
  地面帶  量站立線、縮成遊戲大小（1:1）、左右接成可無縫重複。
  崖壁    量壁面與頂上站立線；切成「頂端一塊」＋「下面可垂直重複的一塊」，右緣淡出（疊在高處地面的剖面上）。
  屋子    量屋脊站立線；切成 左端／中段（一個開間，可重複 n 次）／右端，三塊接起來保證無縫。
  竹架／木架 同屋子切三塊；支柱切成可垂直重複。
  道具    拼版切開；完好與打爛同一個縮放（打爛的放在同一個錨點看起來才對）。
道具類檔案都存成「顯示大小的 2 倍」（顯示時縮 0.5），地面帶與崖壁存 1:1。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp   # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'terrain'
PICKS = RAW / 'picks.json'
OUT = ROOT / 'public' / 'art'
JSON_OUT = OUT / 'terrain.json'
PROP_SCALE = 2.0   # 道具類檔案＝顯示大小 × 2


# ── 小工具 ──
def pick(name: str) -> Path:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    t = sorted((p for p in RAW.glob(f'{name}.try*.png') if '.reject.' not in p.name),
               key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
    if not t:
        raise SystemExit(f'{name} 沒有原檔')
    return t[-1]


def load(name: str) -> tuple[np.ndarray, str]:
    src = pick(name)
    return gp.clean_alpha(np.asarray(Image.open(src).convert('RGBA'))), src.name


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    return gp.resize_rgba(a, max(1, int(round(w))), max(1, int(round(h))))


def scale(a: np.ndarray, k: float) -> np.ndarray:
    return resize(a, a.shape[1] * k, a.shape[0] * k)


def bbox(a: np.ndarray, thr: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(a[..., 3] > thr)
    return int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1


def crop(a: np.ndarray, pad: int = 2) -> np.ndarray:
    y0, y1, x0, x1 = bbox(a)
    return np.pad(a[y0:y1, x0:x1], ((pad, pad), (pad, pad), (0, 0)))


def save(a: np.ndarray, rel: str) -> dict:
    path = OUT / f'{rel}.webp'
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path, 'WEBP', quality=92, method=6,
                                                                            alpha_quality=100)
    return {'path': f'{rel}.webp', 'w': int(a.shape[1]), 'h': int(a.shape[0])}


def min_cut(A: np.ndarray, B: np.ndarray, margin: int) -> np.ndarray:
    """A、B 等大：找一條由上到下、兩邊最像的切線（只在 [margin, w-margin) 內）。透明處也要一樣透明才算像。"""
    h, w = A.shape[:2]
    cost = ((gp.premul(A) - gp.premul(B)) ** 2).sum(-1)
    cost = ndimage.uniform_filter(cost, 3)
    acc = cost.copy()
    acc[:, :margin] = np.inf
    acc[:, w - margin:] = np.inf
    back = np.zeros((h, w), np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        cand = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        k = cand.argmin(0)
        back[y] = k - 1
        acc[y] += cand[k, np.arange(w)]
    path = np.zeros(h, int)
    path[-1] = int(acc[-1].argmin())
    for y in range(h - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path


def cut_blend(A: np.ndarray, B: np.ndarray, margin: int, sigma: float = 2.5) -> np.ndarray:
    """切線左邊用 A、右邊用 B。"""
    path = min_cut(A, B, margin)
    return gp.blend(A, B, path, sigma)


def tile_x(seg: np.ndarray, ov: int) -> np.ndarray:
    """左右可無縫重複：結果＝seg[ov : w]，最後 ov 欄跟 seg[0:ov] 沿切線混接。第一欄＝原本的 seg[ov]。"""
    w = seg.shape[1]
    return np.concatenate([seg[:, ov:w - ov], cut_blend(seg[:, w - ov:], seg[:, :ov], max(4, ov // 6))], axis=1)


def tile_y(seg: np.ndarray, ov: int) -> np.ndarray:
    return tile_x(seg.transpose(1, 0, 2), ov).transpose(1, 0, 2)


def seam_x(a: np.ndarray) -> float:
    """左右接起來那一刀的色差 ÷ 圖內相鄰兩欄的平均色差（1 左右＝看不出來）。"""
    c = gp.premul(a)[..., :4]
    edge = np.abs(c[:, -1] - c[:, 0]).mean()
    inner = np.abs(np.diff(c, axis=1)).mean()
    return round(float(edge / max(inner, 1e-6)), 2)


def seam_y(a: np.ndarray) -> float:
    return seam_x(a.transpose(1, 0, 2))


def solid_top(a: np.ndarray, run: int = 10, thr: int = 200) -> np.ndarray:
    """每一欄由上往下，第一個「連續 run 列都實心」的列；整欄都沒有＝-1。"""
    s = a[..., 3] > thr
    h, w = s.shape
    c = np.cumsum(np.r_[np.zeros((1, w), int), s.astype(int)], 0)
    ok = (c[run:] - c[:-run]) == run   # ok[y]＝y..y+run-1 全實心
    out = np.full(w, -1)
    has = ok.any(0)
    out[has] = ok.argmax(0)[has]
    return out


def period(a: np.ndarray, rows: slice, lo: int, hi: int) -> int:
    """橫向重複的週期（像素）：某幾列的亮度沿 x 的自相關最高點。"""
    g = (gp.premul(a)[rows, :, :3].mean(-1)).mean(0)
    g = g - ndimage.uniform_filter1d(g, max(3, hi))
    g = (g - g.mean()) / (g.std() + 1e-6)
    ac = [float((g[:-k] * g[k:]).mean()) for k in range(lo, hi)]
    return lo + int(np.argmax(ac))


def three_piece(a: np.ndarray, a0: int, P: int, ov: int, right_at: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """左端／中段（寬 P，可重複）／右端。左端接中段、中段接中段、中段（或左端）接右端都無縫。
    中段＝a[:, a0 : a0+P+ov] 做成可重複，第一欄＝原圖 a0+ov；右端從 r0 起，r0 找原圖裡「最像 a0+ov」的地方，
    右端開頭 ov 欄再跟「中段本來該接的東西」沿切線混接。"""
    mid = tile_x(a[:, a0:a0 + P + ov], ov)
    left = a[:, :a0 + ov]
    X = a[:, a0 + ov:a0 + 2 * ov]   # 中段後面本來該接的樣子
    k = max(1, round((right_at - (a0 + ov)) / P))
    best, r0 = None, a0 + ov + k * P
    for r in range(r0 - P // 4, r0 + P // 4 + 1):
        if r + ov >= a.shape[1] or r < a0 + 2 * ov:
            continue
        d = float(((gp.premul(a[:, r:r + ov]) - gp.premul(X)) ** 2).mean())
        if best is None or d < best:
            best, r0 = d, r
    head = cut_blend(X, a[:, r0:r0 + ov], max(4, ov // 6))
    right = np.concatenate([head, a[:, r0 + ov:]], axis=1)
    return left, mid, right, {'P': P, 'a0': a0, 'r0': r0, 'midSeam': seam_x(mid)}


# ── 地面帶 ──
GROUND_USE = {'village': '山村土路（第一關 0～10,600）', 'bamboo': '竹林落葉土（第一關 10,600～16,170）',
              'bandit': '山賊寨木板泥地（第一關 16,170～）'}


def do_ground(key: str) -> dict:
    a, src = load(f'ground_{key}')
    a = scale(a, 0.5)
    top = solid_top(a, 10)
    valid = top[top >= 0]
    stand = int(np.median(valid))
    flat = float(np.mean(np.abs(valid - stand) <= 3))
    y0 = max(0, bbox(a)[0] - 4)
    a = a[y0:]
    stand -= y0
    ov = 110
    t = tile_x(a, ov)
    bottom = t[-10:, :, :3].reshape(-1, 3).mean(0)
    e = save(t, f'terrain/ground_{key}')
    e.update(standY=stand, tileX=True, displayScale=1.0, flatness=round(flat, 3), seam=seam_x(t),
             bottomColor='#%02x%02x%02x' % tuple(int(v) for v in bottom), source=src,
             use=GROUND_USE[key] + '：左右重複；圖的第 standY 列＝腳踩的線，圖底以下請用 bottomColor 補滿到畫面底')
    return e


# ── 崖壁 ──
WALL_USE = {'stone': '石砌擋土牆（山村：上坡高台、民家台地、樓梯、小溪坑邊）', 'earth': '土崖帶樹根（竹林：坑邊、斜坡落差；也可用在山村斷崖）',
            'log': '木樁擋土牆（山賊寨：斜坡落差、壕溝邊）'}


def do_wall(key: str) -> dict:
    a, src = load(f'wall_{key}')
    a = scale(a, 0.5)
    H, W = a.shape[:2]
    lefts = np.array([np.argmax(a[y, :, 3] > 128) if (a[y, :, 3] > 128).any() else W for y in range(H)])
    body_rows = slice(int(H * 0.3), int(H * 0.95))
    faceX = int(np.percentile(lefts[body_rows], 98)) + 2   # 取偏內側：大部分石塊凸出落差線、蓋住低處地面的切邊，不留縫
    x0 = max(0, int(lefts.min()) - 2)
    a = a[:, x0:]
    faceX -= x0
    W = a.shape[1]
    # 頂上站立線：壁面往右 20～150 像素那幾欄的地面頂
    top = solid_top(a, 8)
    cols = top[faceX + 20:min(W, faceX + 150)]
    stand = int(np.median(cols[cols >= 0]))
    # 右緣淡出（疊在高處地面的剖面上，不要一刀切的直邊）
    fade = 70
    ramp = np.ones(W, np.float32)
    ramp[W - fade:] = np.linspace(1, 0, fade)
    a[..., 3] *= ramp[None, :]
    T, ov = stand + 110, 60
    body = tile_y(a[T:H - 6], ov)
    topp = a[:T + ov]
    e_top = save(topp, f'terrain/wall_{key}_top')
    e_body = save(body, f'terrain/wall_{key}_body')
    return {'top': {**e_top, 'standY': stand}, 'body': {**e_body, 'tileY': True, 'seam': seam_y(body)},
            'faceX': faceX, 'faces': 'left', 'fadeRight': fade, 'displayScale': 1.0, 'source': src,
            'use': WALL_USE[key] + '：壁面朝左（左邊低、右邊高）。擺法：壁面 x＝落差的 x，頂端那塊的 standY 對齊高處地面的站立線，'
                                   '下面接 body 往下重複到畫面底。左邊高的落差請整組水平翻轉（壁面仍對齊落差 x）。'}


# ── 屋子 ──
def do_house() -> dict:
    a, src = load('house')
    H, W = a.shape[:2]
    top = solid_top(a, 10)
    mid_cols = top[int(W * 0.3):int(W * 0.7)]
    ridge = int(np.median(mid_cols[mid_cols >= 0]))
    ys, _, _, _ = bbox(a)
    bot = int(np.where((a[:, int(W * 0.3):int(W * 0.7), 3] > 128).any(1))[0].max()) + 1
    k = 2 * 146 / (bot - ridge)   # 顯示時屋脊到地面約 146 像素（地面上 140 ＋ 埋進地面 6），檔案存 2 倍
    a = scale(a, k)
    y0, y1, x0, x1 = bbox(a)
    a = a[max(0, y0 - 2):y1 + 1, max(0, x0 - 2):x1 + 2]
    H, W = a.shape[:2]
    top = solid_top(a, 6)
    mid_cols = top[int(W * 0.3):int(W * 0.7)]
    ridge = int(np.median(mid_cols[mid_cols >= 0]))
    near = np.where((top >= 0) & (top <= ridge + 3))[0]
    rx0, rx1 = int(near.min()), int(near.max()) + 1
    wall_rows = slice(int(ridge + (H - ridge) * 0.5), int(ridge + (H - ridge) * 0.75))
    P = period(a, wall_rows, int(W * 0.11), int(W * 0.22))
    ov = max(16, P // 5)
    a0 = int(W * 0.092) - ov // 2
    left, mid, right, info = three_piece(a, a0, P, ov, int(W * 0.73) - ov // 2)
    e = {'left': {**save(left, 'terrain/house_left'), 'ridgeX': rx0},
         'mid': {**save(mid, 'terrain/house_mid'), 'repeat': True},
         'right': {**save(right, 'terrain/house_right'), 'ridgeX': rx1 - (W - right.shape[1])},
         'standY': ridge, 'bottomY': H, 'displayScale': 0.5, 'split': info, 'source': src,
         'use': ('屋頂平台底下的民家（屋脊＝站得上去的那條線）。拼法：左端＋中段×n＋右端，三塊都頂端對齊、緊貼著排；'
                 'left.ridgeX～right.ridgeX 是屋脊（能站的範圍），屋簷會多伸出去一點。'
                 '檔案是 2 倍大，顯示時 ×0.5（屋脊到圖底約 146 像素＝屋脊比地面高 140、圖底埋進地面 6）。'
                 '平台寬 w：n＝round((w/0.5 − (屋脊在左端與右端各占的寬)) ÷ 中段寬)，再把整棟水平縮放到屋脊剛好＝w（誤差在正負 20% 內看不出來）。')}
    return e


# ── 竹架、木架、支柱 ──
def do_rail(key: str, disp_h: int) -> dict:
    a, src = load(f'rail_{key}')
    y0, y1, x0, x1 = bbox(a, 60)
    k = PROP_SCALE * disp_h / (y1 - y0)
    a = scale(a, k)
    y0, y1, x0, x1 = bbox(a)
    a = a[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2]
    H, W = a.shape[:2]
    top = solid_top(a, 4)
    stand = int(np.median(top[top >= 0][int(len(top) * 0.2):int(len(top) * 0.8)]))
    P = period(a, slice(int(H * 0.3), int(H * 0.8)), int(W * 0.07), int(W * 0.2))
    ov = max(12, P // 5)
    left, mid, right, info = three_piece(a, int(W * 0.12), P, ov, int(W * 0.84))
    return {'left': save(left, f'terrain/rail_{key}_left'), 'mid': {**save(mid, f'terrain/rail_{key}_mid'), 'repeat': True},
            'right': save(right, f'terrain/rail_{key}_right'), 'standY': stand, 'displayScale': 0.5, 'split': info,
            'source': src, 'post': 'bamboo' if key == 'bamboo' else 'square',
            'use': ('竹架（第一關竹林）' if key == 'bamboo' else '木架（第一關寨內）') +
                   '平台面：左端＋中段×n＋右端，頂端第 standY 列＝腳踩的線；檔案 2 倍大、顯示 ×0.5；'
                   '寬度不剛好就整條水平縮放（正負 20% 內）。支柱用 posts 裡對應的那根，從平台面往下重複到地面。'}


def do_posts() -> dict:
    a, src = load('posts')
    cols = (a[..., 3] > 128).any(0)
    lab, n = ndimage.label(cols)
    spans = [tuple(np.where(lab == i)[0][[0, -1]]) for i in range(1, n + 1)]
    spans = [s for s in spans if s[1] - s[0] > 20]
    names = ['bamboo', 'bamboo_thin', 'square', 'log']
    out = {}
    if len(spans) != 4:
        print(f'  ⚠ posts：切出 {len(spans)} 根，預期 4 根')
    w0 = spans[0][1] - spans[0][0]
    k = PROP_SCALE * 16 / w0   # 粗竹竿顯示寬約 16 像素
    for nm, (c0, c1) in zip(names, spans):
        p = a[:, max(0, c0 - 3):c1 + 4]
        r = np.where((p[..., 3] > 128).any(1))[0]
        p = p[r.min() + 10:r.max() - 10]
        p = scale(p, k)
        t = tile_y(p, max(20, p.shape[0] // 8))
        out[nm] = {**save(t, f'terrain/post_{nm}'), 'tileY': True, 'seam': seam_y(t), 'displayScale': 0.5}
    out['_use'] = '平台支柱：中心對齊柱子的 x，從平台面往下垂直重複到地面（坑裡就到畫面底）；檔案 2 倍大、顯示 ×0.5。'
    out['_source'] = src
    return out


# ── 道具 ──
def split(name: str, n: int, one_row: bool = False) -> tuple[list[np.ndarray], str]:
    a, src = load(name)
    for dil in (18, 10, 26, 34, 6):
        pieces = gp.split_items(a, n, dil, one_row=one_row)
        if pieces is not None:
            return pieces, src
    raise SystemExit(f'{name}：切不出 {n} 塊')


def prop_entry(p: np.ndarray, rel: str, k: float, use: str, src: str, anchor: str = 'bottom-center',
               disp: dict | None = None) -> dict:
    p = crop(scale(p, k))
    e = save(p, f'props2/{rel}')
    e.update(displayScale=1 / PROP_SCALE, anchor=anchor, use=use, source=src)
    if disp:
        e.update(disp)
    return e


def do_props() -> dict:
    res: dict = {}
    # 木箱、酒桶、火藥桶（上排完好、下排打爛）
    pcs, src = split('props_barrels', 6)
    for i, (nm, dh, zh) in enumerate([('crate', 70, '木箱'), ('barrel', 90, '酒桶'), ('powder', 100, '火藥桶（含引信）')]):
        k = PROP_SCALE * dh / pcs[i].shape[0]
        res[nm] = prop_entry(pcs[i], nm, k, f'{zh}：底部中間貼地', src, disp={'displayH': dh})
        res[f'{nm}_broken'] = prop_entry(pcs[i + 3], f'{nm}_broken', k, f'{zh}打爛後的殘骸（跟完好版同縮放、同錨點）', src)
    pcs, src = split('props_cage_stall', 4)
    for i, (nm, dh, zh) in enumerate([('cage', 170, '竹籠（關村貓；籠內透明，村貓畫在籠子後面）'), ('stall', 165, '攤位')]):
        k = PROP_SCALE * dh / pcs[i].shape[0]
        res[nm] = prop_entry(pcs[i], nm, k, zh, src, disp={'displayH': dh})
        res[f'{nm}_broken'] = prop_entry(pcs[i + 2], f'{nm}_broken', k, zh.split('（')[0] + '打爛後的殘骸（同縮放、同錨點）', src)
    # 瞭望台、寨門：完好與打爛是同一張畫布（打爛版拿完好版當參考重畫），用同一個裁切框才對得齊
    for nm, dh, zh in [('tower', 420, '瞭望台'), ('gate', 430, '寨門')]:
        A, s1 = load(nm)
        B, s2 = load(f'{nm}_broken')
        if B.shape != A.shape:
            B = resize(B, A.shape[1], A.shape[0])
        ya0, ya1, xa0, xa1 = bbox(A)
        yb0, yb1, xb0, xb1 = bbox(B)
        y0, y1, x0, x1 = min(ya0, yb0), max(ya1, yb1), min(xa0, xb0), max(xa1, xb1)
        k = PROP_SCALE * dh / (ya1 - ya0)
        for arr, rel, use, src in [(A, nm, zh + '：底部中間貼地', s1), (B, f'{nm}_broken', zh + '打爛後（跟完好版同一個裁切框：直接換圖就對齊）', s2)]:
            p = scale(np.pad(arr[y0:y1, x0:x1], ((2, 2), (2, 2), (0, 0))), k)
            e = save(p, f'props2/{rel}')
            e.update(displayScale=1 / PROP_SCALE, anchor='bottom-center', use=use, source=src)
            if rel == nm:
                e['displayH'] = dh
            res[rel] = e
    # 食物、魚骨頭、楓葉
    pcs, src = split('items_small', 6)
    for i, (nm, size, zh, anchor) in enumerate([
            ('onigiri', 56, '飯糰（掉落物，中心對齊）', 'center'), ('fish', 76, '魚乾（掉落物，頭朝左）', 'center'),
            ('fish_bone', 70, '魚骨頭（橘皮大王丟的，頭朝左，旋轉用）', 'center'),
            ('maple_red', 30, '紅楓葉（飄落粒子）', 'center'), ('maple_orange', 30, '橘楓葉（飄落粒子）', 'center')]):
        p = pcs[i]
        k = PROP_SCALE * size / max(p.shape[:2])
        res[nm] = prop_entry(p, nm, k, zh, src, anchor, {'displaySize': size})
    pcs, src = split('king_pack', 2, one_row=True)
    k = PROP_SCALE * 170 / pcs[0].shape[1]
    res['king_pack'] = prop_entry(pcs[0], 'king_pack', k, '橘皮大王背上的魚乾竹簍（背帶在左邊；大王朝右時請水平翻轉）', src, 'center',
                                  {'displayW': 170})
    res['king_pack_broken'] = prop_entry(pcs[1], 'king_pack_broken', k, '竹簍炸爛掉在地上（同縮放、底部貼地）', src)
    pcs, src = split('burrow', 2, one_row=True)
    for i, (nm, zh) in enumerate([('burrow', '地洞（鼠兵冒出來的洞）'), ('burrow_burst', '地洞剛被衝開（土塊飛起）')]):
        k = PROP_SCALE * 130 / pcs[0].shape[1]
        res[nm] = prop_entry(pcs[i], nm, k, zh + '：底部中間貼地、洞口在地面線上', src, disp={'displayW': 130})
    pcs, src = split('debris', 8)
    names = ['plank', 'splinter', 'stave', 'hoop', 'bamboo', 'stone', 'straw', 'char']
    zh = ['木板碎片', '木刺', '桶板', '竹箍', '竹筒碎片', '石塊', '稻草', '燒焦木塊']
    k = PROP_SCALE * 32 / max(max(p.shape[:2]) for p in pcs)
    for i, p in enumerate(pcs):
        res[f'debris_{names[i]}'] = prop_entry(p, f'debris_{names[i]}', k, f'碎片粒子：{zh[i]}（中心旋轉）', src, 'center')
    # H 忍具圖示（棒手裏劍）
    a, src = load('icon_H')
    p = crop(a, 4)
    p = scale(p, 350 / max(p.shape[:2]))
    e = save(p, 'props2/weapon_H')
    e.update(use='掉落道具圖示：H 棒手裏劍連射（取代 icons/weapon_H 的苦無圖；大小跟其他 weapon_* 圖示一樣）',
             center=[p.shape[1] // 2, p.shape[0] // 2], source=src)
    res['weapon_H'] = e
    return res


README = ('站得上去的東西與道具（tools/gen_terrain.py 生、tools/post_terrain.py 後製，畫風跟 panels 長卷背景一致）。'
          '座標一律是圖片像素、左上角 (0,0)。displayScale＝顯示時乘多少（道具類檔案存 2 倍大＝0.5；地面帶與崖壁存 1:1＝1）。'
          'standY＝腳踩的那條線在圖上第幾列；tileX／tileY／repeat＝這張可左右／上下／重複接；anchor＝擺放基準點。'
          'seam 是接縫檢查數字（1 左右＝看不出來）。模擬的遊戲畫面在 art_raw/terrain/_check/。')


def main() -> None:
    res = {'_說明': README}
    res['ground'] = {k: do_ground(k) for k in ('village', 'bamboo', 'bandit')}
    res['ground']['_zones'] = {'s1_1_ground': 'village', 's1_2_ground': 'bamboo', 's1_3_ground': 'bandit'}
    res['wall'] = {k: do_wall(k) for k in ('stone', 'earth', 'log')}
    res['house'] = do_house()
    res['rail'] = {'bamboo': do_rail('bamboo', 28), 'plank': do_rail('plank', 26)}
    res['post'] = do_posts()
    res['props'] = do_props()
    # 第二批（tools/post_terrain2.py）加的鍵留著：這裡只蓋掉第一批自己的鍵
    old = json.loads(JSON_OUT.read_text(encoding='utf-8')) if JSON_OUT.exists() else {}
    for sec, v in res.items():
        if isinstance(v, dict) and isinstance(old.get(sec), dict) and sec not in ('house',):
            old[sec].update(v)
        else:
            old[sec] = v
    JSON_OUT.write_text(json.dumps(old, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    for grp in ('ground', 'wall', 'rail', 'post'):
        for k, v in res[grp].items():
            if k.startswith('_'):
                continue
            print(grp, k, {kk: vv for kk, vv in v.items() if kk in ('w', 'h', 'standY', 'seam', 'flatness', 'faceX')} or
                  {kk: (vv.get('w'), vv.get('h'), vv.get('seam')) for kk, vv in v.items() if isinstance(vv, dict)})
    print('house', res['house']['split'], res['house']['standY'], res['house']['left']['w'], res['house']['mid']['w'],
          res['house']['right']['w'])
    print('props', {k: (v['w'], v['h']) for k, v in res['props'].items()})


if __name__ == '__main__':
    main()
