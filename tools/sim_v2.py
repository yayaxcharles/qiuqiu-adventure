"""第二版美術模擬畫面（只是檢查用，不是遊戲程式）：把 public/art/v2/ 的新件照遊戲大小（1280x720）擺在第二版背景長卷上，
加上球球待機圖（190 像素高）當比例尺。

  python tools/sim_v2.py            → art_raw/v2/_check/*.png（場景）＋ slopes_*.png（陡坡總覽）＋ climb_*.png（往上捲）
背景照 art_raw/v2/panels/v2_panels.json 的新長卷。地面照遊戲畫法（每一欄照地形高度上下移），
陡坡段換成 slope 帶、坡頂坡底轉折處跟平地帶交叉淡化 40 像素。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sim_terrain as s1       # noqa: E402

ROOT = s1.ROOT
ART = s1.ART
CHECK = ROOT / 'art_raw' / 'v2' / '_check'
VW, VH = 1280, 720
TJ = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))
VJ = json.loads((ART / 'v2' / 'v2_terrain.json').read_text(encoding='utf-8'))
PJ = json.loads((ROOT / 'art_raw/v2/panels/v2_panels.json').read_text(encoding='utf-8'))
CJ = json.loads((ROOT / 'art_raw/v2/climb/climb.json').read_text(encoding='utf-8'))
paste, rs, img = s1.paste, s1.rs, s1.img


def rate(stage, ly):
    return 0.55 if ly == 'mid' else (PJ[stage][ly]['totalW'] - VW) / ((PJ[stage]['mid']['totalW'] - VW) / 0.55)


def backdrop(stage: str, mid_x: float, H: int = VH, dy: dict | None = None) -> np.ndarray:
    """mid_x＝中景長卷畫面左緣對到的 x；dy＝各層往下移幾列（往上捲時用）。"""
    cam = mid_x / 0.55
    c = np.zeros((H, VW, 3), np.float32)
    dy = dy or {}
    for ly in ('far', 'midfar', 'mid'):
        off = cam * rate(stage, ly)
        oy = dy.get(ly, 0)
        for it in PJ[stage][ly]['items']:
            if it['x'] + it['w'] < off or it['x'] > off + VW:
                continue
            pastec(c, img(it['path']), it['x'] - off, oy)
    return c


def pastec(canvas, a, x, y):
    """paste 的任意畫布高度版。"""
    x, y = int(round(x)), int(round(y))
    h, w = a.shape[:2]
    Hc, Wc = canvas.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(Wc, x + w), min(Hc, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    al = s[..., 3:4] / 255
    canvas[y0:y1, x0:x1] = s[..., :3] * al + canvas[y0:y1, x0:x1] * (1 - al)


class Terr:
    def __init__(self, x0, y0):
        self.x, self.y, self.pts, self.pits = x0, y0, [(x0, y0)], []

    def flat(self, n): self.x += n; self.pts.append((self.x, self.y)); return self
    def slope(self, n, dy): self.x += n; self.y += dy; self.pts.append((self.x, self.y)); return self
    def cliff(self, dy): self.y += dy; self.pts.append((self.x, self.y)); return self
    def pit(self, n): self.pits.append((self.x, self.x + n)); self.x += n; self.pts.append((self.x, self.y)); return self

    def seg(self, x):
        for (xa, ya), (xb, yb) in zip(self.pts, self.pts[1:]):
            if xa <= x < xb:
                return xa, ya, xb, yb
        return None

    def line_at(self, x):
        s = self.seg(x)
        if s is None:
            return self.pts[-1][1] if x >= self.pts[-1][0] else self.pts[0][1]
        xa, ya, xb, yb = s
        return ya + (yb - ya) * (x - xa) / (xb - xa)

    def in_pit(self, x):
        return any(a < x < b for a, b in self.pits)

    def cliffs(self):
        out = []
        for (xa, ya), (xb, yb) in zip(self.pts, self.pts[1:]):
            if xa == xb and not self.in_pit(xa):
                out.append((xa, min(ya, yb), ya < yb))
        return out


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def gentry(key):
    return VJ['ground'].get(key) or TJ['ground'][key]


def col(c, g, a, x, y, alpha=1.0):
    top = int(round(y - g['standY']))
    u = int(x) % a.shape[1]
    s = a[:, u:u + 1]
    if alpha < 1:
        s = s.copy()
        s[..., 3] *= alpha
    paste(c, s, x, top)
    yb = top + a.shape[0]
    if yb < VH:
        c[max(0, yb):, x] = c[max(0, yb):, x] * (1 - alpha) + hexrgb(g['bottomColor']) * alpha


def draw_ground(c, T: Terr, flat_key: str, theme: str | None = None, x0=0, x1=VW):
    g = gentry(flat_key)
    a = img(g['path'])
    for x in range(max(0, int(x0)), min(VW, int(x1))):
        if T.in_pit(x):
            continue
        y = T.line_at(x)
        col(c, g, a, x, y)
        s = T.seg(x)
        if theme is None or s is None or s[0] == s[2]:
            continue
        xa, ya, xb, yb = s
        k = (yb - ya) / (xb - xa)
        if abs(k) < 0.1:
            continue
        grade = 30 if abs(k) > 0.47 else 20
        key = f'{theme}_{"up" if k < 0 else "dn"}{grade}'
        S = VJ['slope'].get(key)
        if S is None:
            continue
        w = min(1.0, (x - xa) / 40, (xb - x) / 40)
        col(c, S, img(S['path']), x, y, max(0.0, w))


def draw_pool(c, T: Terr, W, drop=60):
    fr = img(W['frames'][0]['path'])
    for a, b in T.pits:
        gy = min(T.line_at(a - 1), T.line_at(b + 1))
        sy = int(gy + drop - W['surfaceY'])
        for x in range(max(0, int(a)), min(VW, int(b))):
            u = x % fr.shape[1]
            paste(c, fr[:, u:u + 1], x, sy)
            yb = sy + fr.shape[0]
            if yb < VH:
                c[yb:, x] = hexrgb(W['bottomColor'])


def draw_wall(c, x, top_y, W, hi_left, scale=1.0, y_end=VH):
    tp, bd = img(W['top']['path']), img(W['body']['path'])
    if scale != 1.0:
        tp = rs(tp, tp.shape[1] * scale, tp.shape[0] * scale)
        bd = rs(bd, bd.shape[1] * scale, bd.shape[0] * scale)
    fx = W['faceX'] * scale
    if hi_left:
        tp, bd = tp[:, ::-1], bd[:, ::-1]
        fx = tp.shape[1] - 1 - fx
    sx = x - fx
    y = top_y - W['top']['standY'] * scale
    paste(c, tp, sx, y)
    y += tp.shape[0] - 1
    while y < y_end:
        paste(c, bd, sx, y)
        y += bd.shape[0] - 1


def pit_walls(c, T: Terr, W):
    for a, b in T.pits:
        if 0 <= a <= VW:
            draw_wall(c, a, T.line_at(a - 1), W, hi_left=True)
        if 0 <= b <= VW:
            draw_wall(c, b, T.line_at(b + 1), W, hi_left=False)
    for x, top, hl in T.cliffs():
        draw_wall(c, x, top, W, hi_left=hl)


def stairs(c, key, x, y):
    """整段階梯：第一階立面在 x、低處地面高 y。"""
    S = VJ['stair'][key]
    a = img(S['path'])
    s0 = S['steps'][0]
    paste(c, a, x - s0['x'], y - (s0['y'] + S['riserH']))


def block(c, key, x, y, w, h):
    B = VJ['block'][key.replace('block_', '', 1)]
    P = {k: img(v['path']) for k, v in B['pieces'].items()}
    pl = B['place']
    C = P['center']
    for yy in range(int(y), int(y + h), C.shape[0]):
        for xx in range(int(x), int(x + w), C.shape[1]):
            paste(c, C[:int(min(C.shape[0], y + h - yy)), :int(min(C.shape[1], x + w - xx))], xx, yy)
    for xx in range(int(x), int(x + w), P['top'].shape[1]):
        wc = int(min(P['top'].shape[1], x + w - xx))
        paste(c, P['top'][:, :wc], xx, y - pl['top']['oy'])
        paste(c, P['bottom'][:, :wc], xx, y + h - pl['bottom']['oy'])
    for yy in range(int(y), int(y + h), P['left'].shape[0]):
        hc = int(min(P['left'].shape[0], y + h - yy))
        paste(c, P['left'][:hc], x - pl['left']['ox'], yy)
        paste(c, P['right'][:hc], x + w - pl['right']['ox'], yy)
    paste(c, P['tl'], x - pl['tl']['ox'], y - pl['tl']['oy'])
    paste(c, P['tr'], x + w - pl['tr']['ox'], y - pl['tr']['oy'])
    paste(c, P['bl'], x - pl['bl']['ox'], y + h - pl['bl']['oy'])
    paste(c, P['br'], x + w - pl['br']['ox'], y + h - pl['br']['oy'])


def ledge(c, key, x, y, w):
    R = VJ['ledge'][key]
    L, M, Rr = img(R['left']['path']), img(R['mid']['path']), img(R['right']['path'])
    sc = R['displayScale']
    n = max(0, round((w / sc - L.shape[1] - Rr.shape[1]) / M.shape[1]))
    a = np.concatenate([L] + [M] * n + [Rr], axis=1)
    a = rs(a, w, a.shape[0] * w / a.shape[1])
    paste(c, a, x, y - R['standY'] * w / (a.shape[1] / sc * sc) * sc * (a.shape[1] / w) * (w / a.shape[1]) / sc * sc)


def ledge2(c, key, x, y, w):
    R = VJ['ledge'][key.replace('ledge_', '', 1)]
    L, M, Rr = img(R['left']['path']), img(R['mid']['path']), img(R['right']['path'])
    sc = R['displayScale']
    n = max(0, round((w / sc - L.shape[1] - Rr.shape[1]) / M.shape[1]))
    a = np.concatenate([L] + [M] * n + [Rr], axis=1)
    k = w / a.shape[1]                  # 水平微調到剛好 w，垂直用顯示比例
    a = rs(a, w, a.shape[0] * sc)
    paste(c, a, x, y - R['standY'] * sc)
    _ = k


def climb(c, key, x, y_top, y_bot):
    C = VJ['climb'][key.replace('climb_', '', 1)]
    sc = C['displayScale']
    tp, bd, bt = (rs(img(C[k]['path']), img(C[k]['path']).shape[1] * sc, img(C[k]['path']).shape[0] * sc)
                  for k in ('top', 'body', 'bottom'))
    w = bd.shape[1]
    y = y_top + tp.shape[0] * 0.5
    while y < y_bot - bt.shape[0] * 0.5:
        paste(c, bd[:int(min(bd.shape[0], y_bot - y))], x - w / 2, y)
        y += bd.shape[0] - 1
    paste(c, bt, x - bt.shape[1] / 2, y_bot - bt.shape[0])
    paste(c, tp, x - tp.shape[1] / 2, y_top)


def waterfall(c, st, x, y_top, y_bot, phase=0, lip=True, splash=True, mist=True, pool_y=None):
    Wf = VJ['waterfall'][st]
    colm, foam = img(Wf['column']['path']), img(Wf['foam']['path'])
    w = colm.shape[1]
    off = int(phase * 360) % colm.shape[0]
    y = y_top - off
    while y < y_bot:
        seg = colm[max(0, int(y_top - y)):int(min(colm.shape[0], y_bot - y))]
        paste(c, seg, x - w / 2, max(y, y_top))
        y += colm.shape[0]
    off = int(phase * 540) % foam.shape[0]
    y = y_top - off
    while y < y_bot:
        seg = foam[max(0, int(y_top - y)):int(min(foam.shape[0], y_bot - y))]
        paste(c, seg, x - foam.shape[1] / 2, max(y, y_top))
        y += foam.shape[0]
    if lip:
        L = img(Wf['lip']['path'])
        paste(c, L, x - L.shape[1] / 2, y_top - L.shape[0] * 0.35)
    if splash:
        S = Wf['splash']
        fr = img(S['frames'][0]['path'])
        fr = rs(fr, fr.shape[1] * 0.5, fr.shape[0] * 0.5)
        paste(c, fr, x - S['baseX'] * 0.5, y_bot - fr.shape[0] + 20)
    if mist:
        M = img(Wf['mist']['path'])
        a = M.copy()
        a[..., 3] *= 0.8
        paste(c, a, x - a.shape[1] / 2, y_bot - a.shape[0] * 0.75)


def prop(c, sec, key, x, y, alpha=1.0, anchor='bottom'):
    p = VJ[sec][key]
    a = img(p['path'])
    sc = p.get('displayScale', 1.0)
    a = rs(a, a.shape[1] * sc, a.shape[0] * sc)
    if alpha < 1:
        a = a.copy()
        a[..., 3] *= alpha
    if anchor == 'bottom':
        paste(c, a, x - a.shape[1] / 2, y - a.shape[0] + 4)
    else:
        paste(c, a, x - a.shape[1] / 2, y)


def player(c, x, y):
    s1.player(c, 0, x, y)


def label(c, text):
    im = s1.Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8))
    return im


def save(c, name):
    CHECK.mkdir(parents=True, exist_ok=True)
    p = CHECK / f'{name}.png'
    Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8)).save(p)
    return p


def mid_x_of(stage, key, i=1, frac=0.0):
    """第二版中景長卷裡插段 key 第 i 張的左緣＋frac×寬。"""
    its = [it for it in PJ[stage]['mid']['items'] if it.get('insert') == key]
    it = its[i - 1]
    return it['x'] + frac * it['w']


# ───────── 場景 ─────────
def s1_terrace():
    c = backdrop('s1', mid_x_of('s1', 's1_mid_A', 1, 0.3))
    T = Terr(-50, 600).flat(220).slope(230, -133).flat(220).slope(260, 95).flat(160).slope(200, -73).flat(400)
    draw_ground(c, T, 's1_terrace', 's1_terrace')
    for x in (170, 400, 620, 880):
        prop(c, 'cover', 'cover_s1_1' if x % 2 else 'cover_s1_3', x, T.line_at(x) + 6, 0.95)
    player(c, 520, T.line_at(520))
    return save(c, 's1_01_梯田陡坡')


def s1_waterfall(phase=0):
    c = backdrop('s1', mid_x_of('s1', 's1_mid_B', 1, 0.75))
    T = Terr(-50, 600).flat(330).pit(420).flat(700)
    waterfall(c, 's1', 600, 60, 640, phase)
    draw_pool(c, T, VJ['waterfall']['s1']['pool'], 50)
    draw_ground(c, T, 's1_rock')
    pit_walls(c, T, VJ['wall']['s1_rock'])
    prop(c, 'props', 'stone_s1_1', 520, 650)
    prop(c, 'props', 'stone_s1_2', 700, 650)
    ledge2(c, 'ledge_s1_rock', 830, 470, 220)
    ledge2(c, 'ledge_s1_rock', 960, 340, 200)
    ledge2(c, 'ledge_s1_rock', 800, 215, 180)
    climb(c, 'climb_s1_vine', 1160, 40, 420)
    prop(c, 'cover', 'cover_s1_2', 1220, 600)
    player(c, 1060, 340)
    return save(c, 's1_02_山溪瀑布岩棚藤蔓')


def s1_shaft():
    c = backdrop('s1', mid_x_of('s1', 's1_mid_B', 3, 0.3))
    T = Terr(-50, 600).flat(1400)
    draw_ground(c, T, 's1_rock', None)
    block(c, 'block_s1_rock', 330, 270, 240, 330)
    block(c, 'block_s1_rock', 830, 200, 240, 400)
    ledge2(c, 'ledge_s1_rock', 610, 250, 180)
    prop(c, 'cover', 'cover_s1_4', 120, 600)
    player(c, 700, 600)
    player(c, 180, 600)
    return save(c, 's1_03_岩壁夾縫蹬牆')


def s1_trail():
    c = backdrop('s1', mid_x_of('s1', 's1_mid_B', 4, 0.2))
    T = Terr(-50, 560).flat(200).slope(260, 150).flat(250).slope(300, -110).flat(700)
    draw_ground(c, T, 's1_trail', 's1_trail')
    block(c, 'block_s1_log', 980, 330, 250, 230)
    climb(c, 'climb_s1_ladder', 930, 300, T.line_at(930) + 4)
    for x in (230, 700):
        prop(c, 'cover', 'cover_s1_1', x, T.line_at(x) + 6)
    player(c, 560, T.line_at(560))
    return save(c, 's1_04_山路陡坡與梯子')


def s1_village():
    c = backdrop('s1', 2400)
    T = Terr(-50, 596).flat(250).slope(260, -126).flat(300).slope(220, 126).flat(600)
    draw_ground(c, T, 'village', 's1_village')
    player(c, 480, T.line_at(480))
    return save(c, 's1_05_山村改陡坡')


def s2_slope():
    c = backdrop('s2', mid_x_of('s2', 's2_mid_A', 1, 0.4))
    T = Terr(-50, 620).flat(200).slope(360, -208).flat(260).slope(300, 110).flat(600)
    draw_ground(c, T, 's2_street', 's2_street')
    prop(c, 'cover', 'cover_s2_4', 170, T.line_at(170) + 6)
    player(c, 620, T.line_at(620))
    return save(c, 's2_01_燈籠坂陡坡')


def s2_waterfall(phase=0):
    c = backdrop('s2', mid_x_of('s2', 's2_mid_B', 2, 0.1))
    T = Terr(-50, 600).flat(330).pit(440).flat(700)
    waterfall(c, 's2', 610, 60, 640, phase)
    draw_pool(c, T, TJ['water']['s2_river'], 50)
    draw_ground(c, T, 's2_rock')
    pit_walls(c, T, VJ['wall']['s2_rock'])
    prop(c, 'props', 'stone_s2_2', 560, 650)
    ledge2(c, 'ledge_s2_rock', 860, 470, 220)
    ledge2(c, 'ledge_s2_rock', 1000, 340, 200)
    ledge2(c, 'ledge_s2_rock', 840, 215, 180)
    climb(c, 'climb_s2_vine', 1190, 40, 420)
    prop(c, 'cover', 'cover_s2_1', 90, 600)
    player(c, 930, 340)
    return save(c, 's2_02_河童瀑布岩棚藤蔓')


def s2_shrine():
    c = backdrop('s2', PJ['s2']['mid']['totalW'] - 1530 * 1.6)
    T = Terr(-50, 640).flat(250).slope(300, -173).flat(300).slope(220, -127).flat(600)
    draw_ground(c, T, 's2_shrine', 's2_shrine')
    block(c, 'block_s2_stone', 1000, 150, 90, 190)
    block(c, 'block_s2_stone', 1200, 90, 90, 250)
    stairs(c, 's2_shrine', 40, 700)
    player(c, 700, T.line_at(700))
    return save(c, 's2_03_神社陡坡石階石柱')


def s3_cooling(phase=0):
    c = backdrop('s3', mid_x_of('s3', 's3_mid_A', 2, 0.1))
    T = Terr(-50, 600).flat(330).pit(420).flat(250).slope(200, -115).flat(500)
    waterfall(c, 's3', 590, 40, 640, phase)
    draw_pool(c, T, VJ['waterfall']['s3']['pool'], 50)
    draw_ground(c, T, 's3_wet', 's3_wet')
    pit_walls(c, T, TJ['wall']['s3_iron'])
    ledge2(c, 'ledge_s3_iron', 820, 330, 200)
    climb(c, 'climb_s3_chain', 1120, 0, 470)
    block(c, 'block_s3_iron', 1180, 120, 140, 200)
    player(c, 900, 330)
    return save(c, 's3_01_冷卻水道鐵瀑布')


def s3_shaft():
    c = backdrop('s3', mid_x_of('s3', 's3_mid_A', 3, 0.2))
    T = Terr(-50, 600).flat(1400)
    draw_ground(c, T, 's3_wet')
    block(c, 'block_s3_iron', 360, 180, 200, 420)
    block(c, 'block_s3_iron', 820, 120, 200, 480)
    stairs(c, 's3_iron', 1060, 600)
    player(c, 690, 600)
    return save(c, 's3_02_鐵牆豎井蹬牆')


def s3_wall():
    c = backdrop('s3', mid_x_of('s3', 's3_mid_B', 2, 0.1))
    T = Terr(-50, 610).flat(260).slope(260, -150).flat(180).slope(200, 115).flat(700)
    draw_ground(c, T, 's3_walk', None, 0, 260)
    draw_ground(c, T, 's3_roof', 's3_roof', 260, VW)
    block(c, 'block_s3_plaster', 900, 200, 180, 380)
    ledge2(c, 'ledge_s3_eave', 1090, 330, 160)
    climb(c, 'climb_s3_ladder', 850, 190, T.line_at(850) + 4)
    draw_wall(c, 1270, 140, VJ['wall']['s3_plaster'], hi_left=False)
    player(c, 560, T.line_at(560))
    return save(c, 's3_03_天守閣外牆陡屋頂')


def slopes_gallery():
    outs = []
    themes = [('s1_village', 'village', 's1', 2400), ('s1_terrace', 's1_terrace', 's1', None),
              ('s1_rock', 's1_rock', 's1', None), ('s1_trail', 's1_trail', 's1', None),
              ('s2_street', 's2_street', 's2', None), ('s2_shrine', 's2_shrine', 's2', None),
              ('s2_rock', 's2_rock', 's2', None), ('s3_grate', 's3_grate', 's3', None),
              ('s3_wet', 's3_wet', 's3', None), ('s3_roof', 's3_roof', 's3', None)]
    mx = {'s1': mid_x_of('s1', 's1_mid_A', 2, 0), 's2': mid_x_of('s2', 's2_mid_A', 2, 0),
          's3': mid_x_of('s3', 's3_mid_B', 3, 0)}
    rows = []
    for th, fk, st, m in themes:
        c = backdrop(st, m or mx[st])
        T = (Terr(-20, 640).flat(90).slope(300, -173).flat(120).slope(300, 173).flat(110).slope(330, -120)
             .flat(110).slope(330, 120).flat(200))
        draw_ground(c, T, fk, th)
        player(c, 355, T.line_at(355))
        rows.append(c[200:])
    for i in range(0, len(rows), 5):
        sheet = np.concatenate(rows[i:i + 5], axis=0)
        outs.append(save(sheet, f'slopes_{i // 5 + 1}'))
    return outs


def climb_frames(key, stage, far_key, ups=(0, 900, 1800, 2600), props=None):
    """往上捲：鏡頭往上 up 像素時的畫面。中景上下捲速 0.8、中遠景 0.4、最遠景 0.2（假設值）。"""
    C = CJ[key]
    F = CJ[far_key]
    frames = []
    mid_x = C['x'] + (C['w'] - VW) / 2
    for up in ups:
        dy = {'mid': up * 0.8, 'midfar': up * 0.4, 'far': up * 0.2}
        c = backdrop(stage, mid_x, VH, dy)
        cam = mid_x / 0.55
        offf = cam * rate(stage, 'far')
        # 最遠景上半部
        pastec_rgb(c, img(F['path']), -offf, dy['far'] - F['height'])
        # 再疊一次中遠景＋中景（上面那步蓋掉了）
        for ly in ('midfar', 'mid'):
            off = cam * rate(stage, ly)
            for it in PJ[stage][ly]['items']:
                if it['x'] + it['w'] < off or it['x'] > off + VW:
                    continue
                pastec(c, img(it['path']), it['x'] - off, dy[ly])
        for p in C['pieces']:
            pastec(c, img(p['path']), C['x'] - mid_x, dy['mid'] + p['y'])
        if props:
            props(c, up)
        frames.append(c)
    grid = np.concatenate([np.concatenate(frames[i:i + 2], axis=1) for i in range(0, len(frames), 2)], axis=0)
    p = save(grid, f'climb_{key}_frames')
    # 總覽：整條中景欄（含往上延伸）疊在最遠景上，縮小
    H = C['height'] + VH
    tall = np.zeros((H, C['w'], 3), np.float32)
    fstrip = np.concatenate([np.asarray(Image.open(ART / it['path']).convert('RGB')).astype(np.float32)
                             for it in PJ[stage]['far']['items']], axis=1)
    fx = int(min(fstrip.shape[1] - C['w'], (mid_x / 0.55) * rate(stage, 'far')))
    fe = np.asarray(Image.open(ART / F['path']).convert('RGB')).astype(np.float32)
    farcol = np.concatenate([fe[:, fx:fx + C['w']], fstrip[:, fx:fx + C['w']]], axis=0)
    farcol = np.asarray(Image.fromarray(farcol.astype(np.uint8)).resize((C['w'], H), Image.LANCZOS)).astype(np.float32)
    tall[:] = farcol
    for p_ in C['pieces']:
        pastec(tall, img(p_['path']), 0, C['height'] + p_['y'])
    for it in PJ[stage]['mid']['items']:
        pastec(tall, img(it['path']), it['x'] - C['x'], C['height'])
    im = Image.fromarray(np.clip(tall, 0, 255).astype(np.uint8))
    im = im.resize((im.width * 700 // im.height, 700), Image.LANCZOS)
    im.save(CHECK / f'climb_{key}_overview.png')
    return p


def pastec_rgb(c, a, x, y):
    pastec(c, a if a.shape[2] == 4 else np.dstack([a, np.full(a.shape[:2], 255, np.float32)]), x, y)


def s1_climb_props(c, up):
    base = 600 + up
    waterfall(c, 's1', 640, -10, base + 40, up / 900, lip=False, splash=up < 100, mist=up < 100)
    for i, (x, w) in enumerate([(820, 200), (380, 200), (840, 180), (360, 200), (800, 200), (400, 180),
                                (820, 200), (380, 200), (800, 200), (420, 180)]):
        y = base - 150 - i * 250
        if -40 < y < VH + 40:
            ledge2(c, 'ledge_s1_rock', x, y, w)
            if i == int(up // 250) % 10:
                player(c, x + w / 2, y)
    climb(c, 'climb_s1_vine', 1100, base - 1900 - 200, base - 1300)


def main():
    fs = [s1_terrace(), s1_waterfall(), s1_shaft(), s1_trail(), s1_village(), s2_slope(), s2_waterfall(),
          s2_shrine(), s3_cooling(), s3_shaft(), s3_wall()]
    fs += slopes_gallery()
    fs.append(climb_frames('s1_mid', 's1', 's1_far', props=s1_climb_props))
    fs.append(climb_frames('s2_mid', 's2', 's2_far'))
    fs.append(climb_frames('s3_mid', 's3', 's3_far'))
    fs.append(climb_frames('s3_shaft', 's3', 's3_far'))
    for f in fs:
        print(f)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        for n in sys.argv[1:]:
            print(globals()[n]())
    else:
        main()
