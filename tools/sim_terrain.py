"""模擬遊戲畫面檢查新的地面、崖壁、屋子、竹架、道具（2026-09-26）：照第一關的地形與擺放，畫出幾個鏡頭位置。

  python tools/sim_terrain.py        → art_raw/terrain/_check/scene_*.png（1280x720，跟遊戲畫面一樣大）＋ scenes_sheet.png
背景長卷照 art.json panels.s1 的速率疊；地面照遊戲的畫法（每一欄照地形高度上下移＝斜坡時整張錯切）；
球球用 public/sprites/qiuqiu/idle/00.webp，照遊戲 190 像素高、基準點貼在站立線上。只是檢查用，不是遊戲程式。
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public' / 'art'
CHECK = ROOT / 'art_raw' / 'terrain' / '_check'
VW, VH = 1280, 720
TJ = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))
AJ = json.loads((ART / 'art.json').read_text(encoding='utf-8'))
_cache: dict[str, np.ndarray] = {}


def img(rel: str) -> np.ndarray:
    if rel not in _cache:
        _cache[rel] = np.asarray(Image.open(ART / rel).convert('RGBA')).astype(np.float32)
    return _cache[rel]


def rs(a: np.ndarray, w: float, h: float) -> np.ndarray:
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    p = a.copy()
    p[..., :3] *= p[..., 3:4] / 255
    ch = [np.asarray(Image.fromarray(p[..., c]).resize((w, h), Image.LANCZOS)) for c in range(4)]
    o = np.clip(np.stack(ch, -1), 0, 255)
    al = o[..., 3:4]
    o[..., :3] = np.where(al > 0.5, o[..., :3] * 255 / np.maximum(al, 1e-3), 0)
    return np.clip(o, 0, 255)


def paste(canvas: np.ndarray, a: np.ndarray, x: float, y: float) -> None:
    """a（RGBA）左上角放在畫面 (x, y)，alpha 疊上去。"""
    x, y = int(round(x)), int(round(y))
    h, w = a.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(VW, x + w), min(VH, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    al = s[..., 3:4] / 255
    canvas[y0:y1, x0:x1] = s[..., :3] * al + canvas[y0:y1, x0:x1] * (1 - al)


# ── 第一關地形（照 src/stages/stage1.ts 的 TerrainBuilder 寫一份） ──
class TB:
    def __init__(self, y0: float):
        self.x, self.y, self.pts, self.pits = 0.0, y0, [(0.0, y0)], []

    def flat(self, n): self.x += n; self.pts.append((self.x, self.y)); return self
    def slope(self, n, dy): self.x += n; self.y += dy; self.pts.append((self.x, self.y)); return self
    def cliff(self, dy): self.y += dy; self.pts.append((self.x, self.y)); return self

    def stairs(self, n, w, dh):
        for _ in range(n):
            self.cliff(dh); self.flat(w)
        return self

    def pit(self, n): self.pits.append((self.x, self.x + n)); self.x += n; self.pts.append((self.x, self.y)); return self


T = TB(596)
T.flat(1500).slope(500, -90).flat(1400).stairs(3, 40, 30).flat(1680).slope(400, -126).flat(1300).cliff(140).flat(1300)
T.slope(300, -14).flat(100).pit(170).flat(1830).flat(500).pit(160).flat(790).pit(170).flat(330).pit(150).slope(300, -80)
T.flat(50).slope(250, 80).flat(1400).stairs(4, 60, -26).flat(560).slope(300, 104).flat(370).flat(830).slope(300, -70)
T.flat(400).slope(300, 70).flat(800).pit(160).flat(540).slope(150, -40).flat(150).cliff(40).flat(1407)
XS = np.array([p[0] for p in T.pts])
YS = np.array([p[1] for p in T.pts])


def line_at(x: float) -> float:
    if x <= XS[0]:
        return float(YS[0])
    if x >= XS[-1]:
        return float(YS[-1])
    i = int(np.searchsorted(XS, x, side='right')) - 1
    j = min(len(XS) - 1, i + 1)
    if XS[j] <= XS[i]:
        return float(YS[i])
    return float(YS[i] + (YS[j] - YS[i]) * (x - XS[i]) / (XS[j] - XS[i]))


def in_pit(x: float) -> bool:
    return any(a < x < b for a, b in T.pits)


def ground_at(x: float) -> float:
    return float('inf') if in_pit(x) else line_at(x)


def walls():
    """(x, 上緣, 下緣, 高處在左邊嗎)。坑的兩邊：左岸高處在左、右岸高處在右。"""
    out = []
    for i in range(len(XS) - 1):
        if XS[i + 1] == XS[i] and not in_pit(XS[i]):
            out.append((XS[i], min(YS[i], YS[i + 1]), max(YS[i], YS[i + 1]), YS[i] < YS[i + 1]))
    for a, b in T.pits:
        out.append((a, line_at(a - 1e-6), 1e9, True))
        out.append((b, line_at(b + 1e-6), 1e9, False))
    return out


MIN_WALL = 60   # 落差比這小（樓梯一階 26～30）就不畫崖壁，地面帶自己的剖面就夠
ZONES = [(0, 'village', 'stone'), (10600, 'bamboo', 'earth'), (16170, 'bandit', 'log')]


def zone(x: float):
    z = ZONES[0]
    for zz in ZONES:
        if x >= zz[0]:
            z = zz
    return z


# ── 畫 ──
def backdrop(cam: float) -> np.ndarray:
    c = np.zeros((VH, VW, 3), np.float32)
    P = AJ['panels']['s1']
    for ly in ('far', 'midfar', 'mid'):
        off = cam * P[ly]['rate']
        for it in P[ly]['items']:
            if it['x'] + it['w'] < off or it['x'] > off + VW:
                continue
            paste(c, img(it['path']), it['x'] - off, 0)
    return c


def draw_ground(c: np.ndarray, cam: float) -> None:
    for sx in range(VW):
        wx = cam + sx
        if in_pit(wx):
            continue
        g = TJ['ground'][zone(wx)[1]]
        a = img(g['path'])
        u = int(wx) % a.shape[1]
        y = line_at(wx)
        top = int(round(y - g['standY']))
        col = a[:, u:u + 1]
        paste(c, col, sx, top)
        yb = top + a.shape[0]
        if yb < VH:
            c[max(0, yb):, sx] = np.array([int(g['bottomColor'][i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def draw_pits(c: np.ndarray, cam: float) -> None:
    for a, b in T.pits:
        x0, x1 = int(a - cam), int(b - cam)
        if x1 < 0 or x0 > VW:
            continue
        top = int(min(line_at(a - 1), line_at(b + 1)) + 20)
        for y in range(max(0, top), VH):
            k = min(1, (y - top) / (VH - top) / 0.35)
            c[y, max(0, x0):min(VW, x1)] = c[y, max(0, x0):min(VW, x1)] * (1 - 0.85 * k) + np.array([22, 10, 28]) * 0.85 * k


def draw_walls(c: np.ndarray, cam: float) -> None:
    for x, top, bottom, hi_left in walls():
        if x < cam - 300 or x > cam + VW + 300 or bottom - top < MIN_WALL:
            continue
        W = TJ['wall'][zone(x)[2]]
        tp, bd = img(W['top']['path']), img(W['body']['path'])
        fx = W['faceX']
        if hi_left:
            tp, bd = tp[:, ::-1], bd[:, ::-1]
            fx = tp.shape[1] - 1 - fx
        sx = x - cam - fx
        y = top - W['top']['standY']
        paste(c, tp, sx, y)
        y += tp.shape[0]
        while y < min(VH, bottom + 40):
            paste(c, bd, sx, y)
            y += bd.shape[0]


def house(c: np.ndarray, cam: float, px: float, py: float, pw: float) -> None:
    H = TJ['house']
    L, M, R = img(H['left']['path']), img(H['mid']['path']), img(H['right']['path'])
    g = line_at(px + pw / 2)
    s = (g + 6 - py) / (H['bottomY'] - H['standY'])
    lr = (L.shape[1] - H['left']['ridgeX']) + H['right']['ridgeX']
    n = max(0, round((pw / s - lr) / M.shape[1]))
    a = np.concatenate([L] + [M] * n + [R], axis=1)
    ridge = lr + n * M.shape[1]
    fx = pw / (ridge * s)
    a = rs(a, a.shape[1] * s * fx, a.shape[0] * s)
    paste(c, a, px - cam - H['left']['ridgeX'] * s * fx, py - H['standY'] * s)


def rail(c: np.ndarray, cam: float, px: float, py: float, pw: float, look: str) -> None:
    Rr = TJ['rail'][look]
    post = img(TJ['post'][Rr['post']]['path'])
    post = rs(post, post.shape[1] * 0.5, post.shape[0] * 0.5)
    for x in (px + 16, px + pw - 16):
        g = min(VH + 10, ground_at(x))
        y = py + 6
        while y < g:
            seg = post[:int(min(post.shape[0], g - y + 4))]
            paste(c, seg, x - cam - post.shape[1] / 2, y)
            y += post.shape[0]
    L, M, R = img(Rr['left']['path']), img(Rr['mid']['path']), img(Rr['right']['path'])
    want = (pw + 12) / 0.5
    n = max(0, round((want - L.shape[1] - R.shape[1]) / M.shape[1]))
    a = np.concatenate([L] + [M] * n + [R], axis=1)
    a = rs(a, pw + 12, a.shape[0] * 0.5)
    paste(c, a, px - 6 - cam, py - Rr['standY'] * 0.5)


def prop(c: np.ndarray, cam: float, key: str, x: float, y: float | None = None, anchor: str | None = None,
         rot: float = 0, flip: bool = False) -> None:
    p = TJ['props'][key]
    a = img(p['path'])
    if flip:
        a = a[:, ::-1]
    a = rs(a, a.shape[1] * p['displayScale'], a.shape[0] * p['displayScale'])
    if rot:
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA').rotate(rot, expand=True, resample=Image.BICUBIC)
        a = np.asarray(im).astype(np.float32)
    anchor = anchor or p['anchor']
    if y is None:
        y = line_at(x) + 4
    if anchor == 'center':
        paste(c, a, x - cam - a.shape[1] / 2, y - a.shape[0] / 2)
    else:
        paste(c, a, x - cam - a.shape[1] / 2, y - a.shape[0])


ANIM = json.loads((ROOT / 'public/sprites/qiuqiu/anims.json').read_text(encoding='utf-8'))


def player(c: np.ndarray, cam: float, x: float, y: float | None = None) -> None:
    fr = ANIM['idle']['frames'][0]
    a = np.asarray(Image.open(ROOT / 'public/sprites/qiuqiu/idle' / fr['f']).convert('RGBA')).astype(np.float32)
    k = 190 / 240
    a = rs(a, a.shape[1] * k, a.shape[0] * k)
    if y is None:
        y = line_at(x)
    paste(c, a, x - cam - fr['ax'] * k, y - fr['ay'] * k)


def npc(c: np.ndarray, cam: float, key: str, x: float) -> None:
    m = AJ[key]
    a = img(m['path'])
    a = rs(a, a.shape[1] * 175 / a.shape[0], 175)
    paste(c, a, x - cam - a.shape[1] / 2, line_at(x) - 175)


def scene(name: str, cam: float, houses=(), rails=(), props=(), after=None, px=None, py=None) -> Path:
    c = backdrop(cam)
    for h in houses:
        house(c, cam, *h)
    draw_ground(c, cam)
    draw_pits(c, cam)
    draw_walls(c, cam)
    for r in rails:
        rail(c, cam, *r)
    for p in props:
        prop(c, cam, *p) if isinstance(p, tuple) else None
    if after:
        after(c, cam)
    if px is not None:
        player(c, cam, px, py)
    CHECK.mkdir(parents=True, exist_ok=True)
    out = CHECK / f'scene_{name}.png'
    Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8)).save(out)
    return out


def main() -> None:
    outs = []
    outs.append(scene('01_村口', 500, props=[('crate', 700), ('crate', 790), ('crate_broken', 1100), ('crate', 1420),
                                              ('barrel', 1650)],
                      after=lambda c, cam: prop(c, cam, 'onigiri', 1100, line_at(1100) - 40), px=920))
    outs.append(scene('02_民家屋頂', 1950, houses=[(2150, 366, 260), (2600, 366, 260), (3050, 366, 250)],
                      props=[('barrel', 2300)], after=lambda c, cam: npc(c, cam, 'npc_grey_tied', 3250), px=2730, py=366))
    outs.append(scene('03_小市集樓梯', 3350, props=[('crate', 3620), ('stall', 3950), ('stall_broken', 4300), ('powder', 4640)],
                      after=lambda c, cam: prop(c, cam, 'fish', 4300, line_at(4300) - 40), px=3780))
    outs.append(scene('04_上坡', 4900, props=[('barrel', 5000), ('powder_broken', 5250)], px=5420))
    outs.append(scene('05_高台斷崖', 6150, houses=[(6330, 330, 260)], props=[('crate', 7200), ('crate', 7290)],
                      px=6780))
    outs.append(scene('06_小溪坑', 8250, props=[('crate', 9000), ('barrel_broken', 8380)], px=8480))
    outs.append(scene('07_竹林竹架', 10850,
                      rails=[(11040, 470, 240, 'bamboo'), (11380, 390, 200, 'bamboo'), (11700, 470, 200, 'bamboo'),
                             (11980, 440, 260, 'bamboo')], px=11480, py=390))
    outs.append(scene('08_竹林中魔王前', 12500, rails=[(12460, 450, 260, 'bamboo'), (12780, 380, 180, 'bamboo')],
                      props=[('crate', 13100)],
                      after=lambda c, cam: (prop(c, cam, 'burrow', 13220), prop(c, cam, 'maple_red', 12900, 300, rot=30),
                                            prop(c, cam, 'maple_orange', 13300, 420, rot=-50)),
                      px=13350))
    outs.append(scene('09_山賊寨營地', 16200, props=[('barrel', 16260), ('powder', 16660), ('crate', 16800), ('tower', 17500)],
                      after=lambda c, cam: (npc(c, cam, 'npc_tuxedo_tied', 16920), prop(c, cam, 'cage', 16920)),
                      px=16480))
    outs.append(scene('10_寨門', 17900, rails=[(18300, 450, 200, 'plank'), (18520, 400, 220, 'plank'),
                                             (18770, 440, 240, 'plank')],
                      props=[('gate', 18200), ('crate', 18420), ('powder', 18520)], px=18040))
    outs.append(scene('11_打爛之後', 17250, props=[('tower_broken', 17500), ('gate_broken', 18200), ('cage_broken', 17350)],
                      after=lambda c, cam: [prop(c, cam, f'debris_{d}', 17700 + i * 60, line_at(17700 + i * 60) - 60 - (i % 3) * 40,
                                                 rot=i * 40) for i, d in enumerate(['plank', 'splinter', 'stave', 'hoop',
                                                                                     'bamboo', 'stone', 'straw', 'char'])],
                      px=17900))
    outs.append(scene('13_竹林上樓梯', 14450, props=[('crate', 15000), ('powder', 15100)], px=14620))
    outs.append(scene('12_魔王平地', 19927,
                      after=lambda c, cam: (prop(c, cam, 'burrow_burst', 20200), prop(c, cam, 'king_pack', 20850, 440),
                                            prop(c, cam, 'king_pack_broken', 21000),
                                            prop(c, cam, 'fish_bone', 20500, 380, rot=25), prop(c, cam, 'fish', 20350, line_at(20350) - 40)),
                      px=20080))
    # 總覽（縮小，只是目錄；細節看單張）
    ims = [Image.open(p).resize((640, 360), Image.LANCZOS) for p in outs]
    sheet = Image.new('RGB', (1280, 360 * ((len(ims) + 1) // 2)), 'white')
    d = ImageDraw.Draw(sheet)
    for i, (im, p) in enumerate(zip(ims, outs)):
        sheet.paste(im, ((i % 2) * 640, (i // 2) * 360))
        d.rectangle(((i % 2) * 640, (i // 2) * 360, (i % 2) * 640 + 200, (i // 2) * 360 + 18), fill='black')
        d.text(((i % 2) * 640 + 4, (i // 2) * 360 + 3), p.stem.encode('ascii', 'ignore').decode() or p.stem[:9], fill='yellow')
    sheet.save(CHECK / 'scenes_sheet.png')
    for p in outs:
        print(p)


if __name__ == '__main__':
    main()
