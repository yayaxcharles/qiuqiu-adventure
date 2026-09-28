"""模擬遊戲畫面檢查第二批（2026-09-26）：第一關補件、第二關、第三關。只是檢查用，不是遊戲程式。

  python tools/sim_terrain2.py            → art_raw/terrain/_check/s1b_*.png、s2_*.png、s3_*.png（1280x720）
每一張：背景長卷（照 art.json panels 的速率）＋地面帶（逐欄照地形高度）＋崖壁／石階＋平台＋道具＋球球 idle（190 像素高、基準點貼站立線）。
地形是每張各自寫的一小段（第二、三關還沒有關卡檔），位置只求看得出每樣東西拼起來對不對。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sim_terrain as s1   # noqa: E402  共用 paste／rs／img／player

ROOT = s1.ROOT
ART = s1.ART
CHECK = s1.CHECK
VW, VH = 1280, 720
TJ = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))
AJ = s1.AJ
paste, rs, img = s1.paste, s1.rs, s1.img


def backdrop(stage: str, cam: float) -> np.ndarray:
    c = np.zeros((VH, VW, 3), np.float32)
    P = AJ['panels'][stage]
    for ly in ('far', 'midfar', 'mid'):
        off = cam * P[ly]['rate']
        for it in P[ly]['items']:
            if it['x'] + it['w'] < off or it['x'] > off + VW:
                continue
            paste(c, img(it['path']), it['x'] - off, 0)
    return c


class Terr:
    """一小段地形：從 x0 開始的折線（同一個 x 兩點＝垂直落差）＋坑。"""

    def __init__(self, x0: float, y0: float):
        self.x, self.y = x0, y0
        self.pts = [(x0, y0)]
        self.pits: list[tuple[float, float]] = []

    def flat(self, n): self.x += n; self.pts.append((self.x, self.y)); return self
    def slope(self, n, dy): self.x += n; self.y += dy; self.pts.append((self.x, self.y)); return self
    def cliff(self, dy): self.y += dy; self.pts.append((self.x, self.y)); return self

    def stairs(self, n, w, dh):
        for _ in range(n):
            self.cliff(dh)
            self.flat(w)
        return self

    def pit(self, n):
        self.pits.append((self.x, self.x + n))
        self.x += n
        self.pts.append((self.x, self.y))
        return self

    def line_at(self, x: float) -> float:
        xs = np.array([p[0] for p in self.pts])
        ys = np.array([p[1] for p in self.pts])
        if x <= xs[0]:
            return float(ys[0])
        if x >= xs[-1]:
            return float(ys[-1])
        i = int(np.searchsorted(xs, x, side='right')) - 1
        j = min(len(xs) - 1, i + 1)
        if xs[j] <= xs[i]:
            return float(ys[i])
        return float(ys[i] + (ys[j] - ys[i]) * (x - xs[i]) / (xs[j] - xs[i]))

    def in_pit(self, x):
        return any(a < x < b for a, b in self.pits)

    def ground_at(self, x):
        return float('inf') if self.in_pit(x) else self.line_at(x)

    def walls(self):
        out = []
        for i in range(len(self.pts) - 1):
            (xa, ya), (xb, yb) = self.pts[i], self.pts[i + 1]
            if xa == xb and not self.in_pit(xa):
                out.append((xa, min(ya, yb), max(ya, yb), ya < yb))
        for a, b in self.pits:
            out.append((a, self.line_at(a - 1e-6), 1e9, True))
            out.append((b, self.line_at(b + 1e-6), 1e9, False))
        return out


def hexrgb(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def draw_ground(c, cam, T: Terr, gkey: str):
    g = TJ['ground'][gkey]
    a = img(g['path'])
    bc = hexrgb(g['bottomColor'])
    for sx in range(VW):
        wx = cam + sx
        if T.in_pit(wx):
            continue
        y = T.line_at(wx)
        top = int(round(y - g['standY']))
        u = int(wx) % a.shape[1]
        paste(c, a[:, u:u + 1], sx, top)
        yb = top + a.shape[0]
        if yb < VH:
            c[max(0, yb):, sx] = bc


def draw_pits(c, cam, T: Terr, water: bool = False, frame: int = 0, drop: float = 70):
    for a, b in T.pits:
        x0, x1 = int(a - cam), int(b - cam)
        if x1 < 0 or x0 > VW:
            continue
        gy = min(T.line_at(a - 1), T.line_at(b + 1))
        if water:
            W = TJ['water']['s2_river']
            fr = img(W['frames'][frame]['path'])
            sy = int(gy + drop - W['surfaceY'])
            for sx in range(max(0, x0), min(VW, x1)):
                u = int(cam + sx) % fr.shape[1]
                paste(c, fr[:, u:u + 1], sx, sy)
                yb = sy + fr.shape[0]
                if yb < VH:
                    c[yb:, sx] = hexrgb(W['bottomColor'])
        else:
            top = int(gy + 20)
            for y in range(max(0, top), VH):
                k = min(1, (y - top) / (VH - top) / 0.35)
                c[y, max(0, x0):min(VW, x1)] = c[y, max(0, x0):min(VW, x1)] * (1 - 0.85 * k) + np.array([22, 10, 28]) * 0.85 * k


def draw_wall_piece(c, cam, x, top_y, bottom, hi_left, W, scale=1.0):
    tp, bd = img(W['top']['path']), img(W['body']['path'])
    if scale != 1.0:
        tp = rs(tp, tp.shape[1] * scale, tp.shape[0] * scale)
        bd = rs(bd, bd.shape[1] * scale, bd.shape[0] * scale)
    fx = W['faceX'] * scale
    if hi_left:
        tp, bd = tp[:, ::-1], bd[:, ::-1]
        fx = tp.shape[1] - 1 - fx
    sx = x - cam - fx
    y = top_y - W['top']['standY'] * scale
    paste(c, tp, sx, y)
    y += tp.shape[0] - 1
    while y < VH:   # 壁身一律接到畫面底（只接到低處地面會在高處地面帶的剖面上留一條橫切線）
        paste(c, bd, sx, y)
        y += bd.shape[0] - 1


def draw_walls(c, cam, T: Terr, wkey: str | None, stair: bool = False):
    ws = [w for w in T.walls() if cam - 300 < w[0] < cam + VW + 300]
    big = [w for w in ws if w[2] - w[1] >= 60]
    small = [w for w in ws if w[2] - w[1] < 60]
    if stair:
        S = TJ['stair']['stone']
        # 從最低的一階畫到最高的一階（高的蓋住低的多出來的踏面）
        for x, top, bottom, hl in sorted(small, key=lambda w: -w[1]):
            draw_wall_piece(c, cam, x, top, bottom, hl, S, S['displayScale'])
    if wkey:
        for x, top, bottom, hl in big:
            draw_wall_piece(c, cam, x, top, bottom, hl, TJ['wall'][wkey])


def three(sec: str, key: str, n_or_w, scale=0.5):
    """左＋中×n＋右接成一條（檔案大小），n_or_w＝要的顯示寬度（整條水平微調到剛好）。"""
    R = TJ[sec][key]
    L, M, Rr = img(R['left']['path']), img(R['mid']['path']), img(R['right']['path'])
    want = n_or_w / scale
    n = max(0, round((want - L.shape[1] - Rr.shape[1]) / M.shape[1]))
    a = np.concatenate([L] + [M] * n + [Rr], axis=1)
    return rs(a, n_or_w, a.shape[0] * scale), R


def rail(c, cam, sec, key, px, py, pw, post=True):
    a, R = three(sec, key, pw + 12)
    if post and R.get('post'):
        P = TJ['post'][R['post']]
        pi = img(P['path'])
        pi = rs(pi, pi.shape[1] * 0.5, pi.shape[0] * 0.5)
        for x in (px + 16, px + pw - 16):
            g = min(VH + 10, T_CUR.ground_at(x))
            y = py + R['bandH'] * 0.25
            while y < g:
                paste(c, pi[:int(min(pi.shape[0], g - y + 4))], x - cam - pi.shape[1] / 2, y)
                y += pi.shape[0] - 1
    paste(c, a, px - 6 - cam, py - R['standY'] * 0.5)


def deck(c, cam, key, px, py, pw):
    a, R = three('deck', key, pw)
    if R.get('anchor') == 'bottom':
        g = T_CUR.line_at(px + pw / 2)
        paste(c, a, px - cam, g + 4 - a.shape[0])
        return g + 4 - a.shape[0] + R['standY'] * 0.5
    paste(c, a, px - cam, py - R['standY'] * 0.5)
    return py


def building(c, cam, key, px, py, pw):
    H = TJ['building'][key]
    L, M, R = img(H['left']['path']), img(H['mid']['path']), img(H['right']['path'])
    g = T_CUR.line_at(px + pw / 2)
    s = (g + 6 - py) / (H['bottomY'] - H['standY'])
    lr = (L.shape[1] - H['left']['ridgeX']) + H['right']['ridgeX']
    n = max(0, round((pw / s - lr) / M.shape[1]))
    mids = [M] + [img(v['path']) for v in H.get('midVariants', [])]
    a = np.concatenate([L] + [mids[i % len(mids)] for i in range(n)] + [R], axis=1)
    fx = pw / ((lr + n * M.shape[1]) * s)
    a = rs(a, a.shape[1] * s * fx, a.shape[0] * s)
    paste(c, a, px - cam - H['left']['ridgeX'] * s * fx, py - H['standY'] * s)


def platform(c, cam, key, x, y_or_ground):
    """單張站台：torii 底部貼地（回傳站立線 y）；lift 照站立線放。"""
    P = TJ['platform'][key]
    a = img(P['path'])
    a = rs(a, a.shape[1] * 0.5, a.shape[0] * 0.5)
    if P['anchor'] == 'bottom-center':
        g = T_CUR.line_at(x)
        top = g + 4 - a.shape[0]
        paste(c, a, x - cam - a.shape[1] / 2, top)
        return top + P['standY'] * 0.5, x - a.shape[1] / 2 + P['standX0'] * 0.5, x - a.shape[1] / 2 + P['standX1'] * 0.5
    paste(c, a, x - cam - a.shape[1] / 2, y_or_ground - P['standY'] * 0.5)
    return y_or_ground


def prop(c, cam, key, x, y=None, anchor=None, sec='props', alpha=1.0):
    p = TJ[sec][key] if sec == 'props' else key
    a = img(p['path'])
    sc = p.get('displayScale', 0.5)
    a = rs(a, a.shape[1] * sc, a.shape[0] * sc)
    if alpha < 1:
        a = a.copy()
        a[..., 3] *= alpha
    anchor = anchor or p.get('anchor', 'bottom-center')
    if y is None:
        y = T_CUR.line_at(x) + 4
    if anchor == 'center':
        paste(c, a, x - cam - a.shape[1] / 2, y - a.shape[0] / 2)
    else:
        paste(c, a, x - cam - a.shape[1] / 2, y - a.shape[0])
    return a.shape


def anim(c, cam, key, x, frame=0, lift=0.45):
    A = TJ['anim'][key]
    base = A['base']
    b = img(base['path'])
    b = rs(b, b.shape[1] * 0.5, b.shape[0] * 0.5)
    g = T_CUR.line_at(x) + 4
    fr = img(A['frames'][frame]['path'])
    fr = rs(fr, fr.shape[1] * 0.5, fr.shape[0] * 0.5)
    bx = A['baseX'] * 0.5
    if key == 's1_campfire':
        paste(c, b, x - cam - b.shape[1] / 2, g - b.shape[0])
        paste(c, fr, x - cam - bx, g - b.shape[0] * lift - fr.shape[0])
    else:   # 蒸氣：噴嘴口在底座頂端中間附近
        paste(c, b, x - cam - b.shape[1] / 2, g - b.shape[0])
        paste(c, fr, x - cam - b.shape[1] * 0.05 - bx, g - b.shape[0] + 6 - fr.shape[0])


T_CUR: Terr = Terr(0, 596)
RIDGE_Y = 616 + 4 - TJ['deck']['s3_ridge']['left']['h'] * 0.5 + TJ['deck']['s3_ridge']['standY'] * 0.5


def scene(name, stage, cam, T: Terr, gkey, wkey=None, stair=False, water=False, wframe=0, back=(), front=(),
          px=None, py=None, fore=()):
    global T_CUR
    T_CUR = T
    c = backdrop(stage, cam)
    for f in back:
        f(c, cam)
    draw_ground(c, cam, T, gkey)
    draw_pits(c, cam, T, water, wframe)
    draw_walls(c, cam, T, wkey, stair)
    for f in front:
        f(c, cam)
    if px is not None:
        s1.player(c, cam, px, py if py is not None else T.line_at(px))
    for f in fore:
        f(c, cam)
    out = CHECK / f'{name}.png'
    Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8)).save(out)
    return out


def main():
    outs = []
    # ───── 第一關補件 ─────
    T = Terr(2900, 506).flat(500).stairs(3, 40, 30).flat(1680)
    outs.append(scene('s1b_01_山村下樓梯', 's1', 3050, T, 'village', 'stone', stair=True,
                      front=[lambda c, cam: prop(c, cam, 'crate', 3620), lambda c, cam: prop(c, cam, 'stall', 3950)],
                      px=3300))
    T = Terr(3000, 596).flat(700).stairs(4, 60, -26).flat(900)
    outs.append(scene('s1b_02_上樓梯測試', 's1', 3200, T, 'village', 'stone', stair=True,
                      front=[lambda c, cam: prop(c, cam, 'barrel', 4300)], px=3860, py=596 - 26 * 2))
    T = Terr(15900, 596).flat(1100).slope(300, -70).flat(1200)
    outs.append(scene('s1b_03_山賊寨營地', 's1', 16200, T, 'bandit', 'log',
                      back=[lambda c, cam: deck(c, cam, 's1_palisade', 16860, 0, 420)],
                      front=[lambda c, cam: anim(c, cam, 's1_campfire', 16560, 0),
                             lambda c, cam: prop(c, cam, 'barrel', 16300), lambda c, cam: prop(c, cam, 'powder', 16700),
                             lambda c, cam: prop(c, cam, 'cage', 16940)],
                      px=16420, fore=[lambda c, cam: prop(c, cam, 's1_bamboo_fore', 16230, 740, alpha=0.95)]))
    Tr = Terr(17200, 526).flat(1600)
    outs.append(scene('s1b_04_木造矮牆可站', 's1', 17300, Tr, 'bandit', 'log',
                      front=[lambda c, cam: deck(c, cam, 's1_rampart', 17700, 0, 520),
                             lambda c, cam: anim(c, cam, 's1_campfire', 18400, 2)],
                      px=17960, py=526 + 4 - TJ['deck']['s1_rampart']['left']['h'] * 0.5 + TJ['deck']['s1_rampart']['standY'] * 0.5))
    # 營火 4 格並排（看火焰有沒有對齊柴堆）
    T = Terr(16000, 596).flat(2000)
    outs.append(scene('s1b_05_營火四格', 's1', 16300, T, 'bandit',
                      front=[lambda c, cam, i=i: anim(c, cam, 's1_campfire', 16520 + i * 260, i) for i in range(4)]))
    # ───── 第二關 ─────
    T = Terr(600, 596).flat(3000)
    outs.append(scene('s2_01_夜祭入口', 's2', 900, T, 's2_street',
                      back=[lambda c, cam: platform(c, cam, 's2_torii', 1500, None)],
                      front=[lambda c, cam: prop(c, cam, 's2_lantern_stall', 1950), lambda c, cam: prop(c, cam, 's2_crate', 1180),
                             lambda c, cam: prop(c, cam, 's2_crate_broken', 1270)],
                      px=1080))
    outs.append(scene('s2_02_鳥居上', 's2', 900, T, 's2_street',
                      back=[lambda c, cam: platform(c, cam, 's2_torii', 1500, None)],
                      front=[lambda c, cam: prop(c, cam, 's2_stone_lantern', 1990)],
                      px=1500, py=596 + 4 - 330 + TJ['platform']['s2_torii']['standY'] * 0.5))
    T = Terr(2800, 596).flat(3000)
    outs.append(scene('s2_03_攤位屋頂', 's2', 3000, T, 's2_street',
                      back=[lambda c, cam: building(c, cam, 's2_stallroof', 3350, 446, 560)],
                      front=[lambda c, cam: prop(c, cam, 's2_sake_stack', 4150), lambda c, cam: prop(c, cam, 's2_signboard', 3180),
                             lambda c, cam: prop(c, cam, 's2_lantern_stall_broken', 4050, None)],
                      px=3650, py=446))
    T = Terr(5000, 596).flat(3000)
    outs.append(scene('s2_04_祭典木台', 's2', 5200, T, 's2_street',
                      front=[lambda c, cam: rail(c, cam, 'rail', 's2_stage', 5500, 470, 300),
                             lambda c, cam: rail(c, cam, 'rail', 's2_stage', 5900, 400, 260),
                             lambda c, cam: prop(c, cam, 's2_sake_stack_broken', 6300),
                             lambda c, cam: prop(c, cam, 's2_crate', 5420)],
                      px=5640, py=470))
    T = Terr(8200, 596).flat(560).cliff(0).pit(520).flat(1200)
    outs.append(scene('s2_05_河堤木橋', 's2', 8300, T, 's2_bank', 's2_embank', water=True, wframe=0,
                      front=[lambda c, cam: rail(c, cam, 'rail', 's2_bridge', 8700, 560, 640)],
                      px=9050, py=560))
    T = Terr(10300, 596).flat(400).pit(260).flat(300).pit(300).flat(900)
    outs.append(scene('s2_06_河童川', 's2', 10400, T, 's2_bank', 's2_embank', water=True, wframe=2,
                      front=[lambda c, cam: prop(c, cam, 's2_crate', 10620), lambda c, cam: prop(c, cam, 's2_stone_lantern_broken', 11320)],
                      px=10560))
    T = Terr(15500, 596).flat(500).stairs(4, 60, -26).flat(300).cliff(-100).flat(900)
    outs.append(scene('s2_07_神社石階', 's2', 15600, T, 's2_shrine', 's2_shrine', stair=True,
                      front=[lambda c, cam: prop(c, cam, 's2_stone_lantern', 15800), lambda c, cam: prop(c, cam, 's2_ema_rack', 16760),
                             lambda c, cam: prop(c, cam, 's2_offering_box', 17000)],
                      px=16150, py=596 - 26 * 2))
    T = Terr(18800, 596).flat(3000)
    outs.append(scene('s2_08_神社本殿', 's2', 19000, T, 's2_shrine',
                      back=[lambda c, cam: platform(c, cam, 's2_torii', 19900, None)],
                      front=[lambda c, cam: prop(c, cam, 's2_shrine_bell', 19300), lambda c, cam: prop(c, cam, 's2_offering_box', 19550),
                             lambda c, cam: prop(c, cam, 's2_offering_box_broken', 20250), lambda c, cam: prop(c, cam, 's2_signboard_broken', 20000)],
                      px=19900, py=596 + 4 - 330 + TJ['platform']['s2_torii']['standY'] * 0.5))
    # ───── 第三關 ─────
    T = Terr(1000, 596).flat(700).cliff(-130).flat(1600)
    outs.append(scene('s3_01_城下', 's3', 1200, T, 's3_town', 's3_castle',
                      front=[lambda c, cam: prop(c, cam, 's3_oil_drum', 1420), lambda c, cam: prop(c, cam, 's3_crate', 2150),
                             lambda c, cam: prop(c, cam, 's3_turret_mount', 1640, 560, anchor='center')],
                      px=1560))
    T = Terr(3200, 596).flat(2000)
    outs.append(scene('s3_02_機關城門', 's3', 3300, T, 's3_town',
                      front=[lambda c, cam: prop(c, cam, 's3_gate', 4200), lambda c, cam: prop(c, cam, 's3_steam_pipe', 3650),
                             lambda c, cam: prop(c, cam, 's3_crate', 4620)], px=3780))
    outs.append(scene('s3_03_城門打爛', 's3', 3300, T, 's3_town',
                      front=[lambda c, cam: prop(c, cam, 's3_gate_broken', 4200), lambda c, cam: prop(c, cam, 's3_steam_pipe_broken', 3650),
                             lambda c, cam: prop(c, cam, 's3_crate_broken', 4620)], px=4200))
    T = Terr(6200, 596).flat(2400)
    outs.append(scene('s3_04_蒸汽管走道', 's3', 6300, T, 's3_grate',
                      front=[lambda c, cam: anim(c, cam, 's3_steam_vent', 6600, 1), lambda c, cam: anim(c, cam, 's3_steam_vent', 7300, 2),
                             lambda c, cam: rail(c, cam, 'rail', 's3_catwalk', 6800, 440, 380),
                             lambda c, cam: prop(c, cam, 's3_gearbox', 7650)],
                      px=7000, py=440))
    T = Terr(8500, 596).flat(2400)
    outs.append(scene('s3_05_輸送帶', 's3', 8600, T, 's3_grate',
                      front=[lambda c, cam: rail(c, cam, 'rail', 's3_conveyor', 8800, 500, 480),
                             lambda c, cam: rail(c, cam, 'rail', 's3_conveyor', 9400, 420, 360),
                             lambda c, cam: prop(c, cam, 's3_oil_drum_broken', 9900), lambda c, cam: prop(c, cam, 's3_gearbox_broken', 8700)],
                      px=9000, py=500))
    T = Terr(12400, 596).flat(500).cliff(-200).flat(1500)
    outs.append(scene('s3_06_升降機', 's3', 12500, T, 's3_grate', 's3_iron',
                      front=[lambda c, cam: platform(c, cam, 's3_lift', 12780, 470)],
                      px=12780, py=470))
    T = Terr(17200, 616).flat(2400)
    outs.append(scene('s3_07_天守閣屋頂', 's3', 17400, T, 's3_roof',
                      front=[lambda c, cam: deck(c, cam, 's3_ridge', 17700, 0, 420),
                             lambda c, cam: deck(c, cam, 's3_ridge', 18250, 0, 300),
                             lambda c, cam: prop(c, cam, 's3_crate', 18000, RIDGE_Y + 4)],
                      px=17850, py=RIDGE_Y))
    for p in outs:
        print(p)


if __name__ == '__main__':
    main()
