"""第三批後製（2026-09-27）：art_raw/fx2/*.tryN.png → public/art/fx2/ ＋ public/art/fx2.json（不動既有的檔與 json）。

  python tools/post_fx2.py

約定（寫在 fx2.json 的 _說明）：
  - 檔案存成「建議顯示大小的 2 倍」，displayScale＝0.5（魔王特寫、村貓、招牌除外，各自寫明）。
  - 動畫：同一組每一格都是同樣大小的畫布、錨點（anchor [x, y]，檔案像素）在每一格的同一個位置，直接換圖就不會跳。
    錨點種類 anchorKind：center＝特效中心、core＝火球本體中心（拖尾在後面）、bottom＝底部中間貼地、right＝右端中間（尾焰接在飛彈尾巴）。
  - facing＝圖上朝向（left／right），反方向請水平翻轉。
每一類另存一張總覽到 art_raw/fx2/_check/（墊暗色棋盤，照建議顯示大小）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp    # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'fx2'
PICKS = RAW / 'picks.json'
OUT = ROOT / 'public' / 'art' / 'fx2'
JSON_OUT = ROOT / 'public' / 'art' / 'fx2.json'
CHECK = RAW / '_check'
PS = 2.0
FONT = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 15)
FONT_T = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 20)


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


def load(name: str, soft: bool = False) -> tuple[np.ndarray, str]:
    """soft＝煙、火、光：保留半透明，只把背景殘影（alpha<8）歸零；否則壓成乾淨的 0／255。"""
    src = pick(name)
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    if soft:
        a[..., 3][a[..., 3] < 8] = 0
        a[..., :3][a[..., 3] == 0] = 0
    else:
        a = gp.clean_alpha(a)
    return a, src.name


def scale(a: np.ndarray, k: float) -> np.ndarray:
    return gp.resize_rgba(a, max(1, round(a.shape[1] * k)), max(1, round(a.shape[0] * k)))


def save(a: np.ndarray, rel: str) -> dict:
    p = OUT / f'{rel}.webp'
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(p, 'WEBP', quality=92, method=6,
                                                                          alpha_quality=100)
    return {'path': f'fx2/{rel}.webp', 'w': int(a.shape[1]), 'h': int(a.shape[0])}


def components(a: np.ndarray, n: int, one_row: bool = False) -> list[tuple[np.ndarray, int, int]]:
    """透明拼版切成 n 塊（閱讀順序）：回傳 (塊, 左上 y, 左上 x)（在原圖裡的位置）。換幾種間隔試到剛好 n 塊。"""
    mask = a[..., 3] > 6
    for dil in (18, 10, 26, 34, 44, 6):
        lab, m = ndimage.label(ndimage.binary_dilation(mask, iterations=dil))
        boxes = ndimage.find_objects(lab)
        areas = ndimage.sum(mask, lab, range(1, m + 1))
        keep = [i for i in range(m) if areas[i] >= 0.015 * areas.max()]
        if len(keep) != n:
            continue
        cy = {i: (boxes[i][0].start + boxes[i][0].stop) / 2 for i in keep}
        if one_row:
            order = sorted(keep, key=lambda i: boxes[i][1].start)
        else:
            keep.sort(key=lambda i: cy[i])
            rows, cur = [], []
            for i in keep:
                if cur and cy[i] - np.mean([cy[j] for j in cur]) > a.shape[0] * 0.18:
                    rows.append(cur)
                    cur = []
                cur.append(i)
            rows.append(cur)
            order = [i for r in rows for i in sorted(r, key=lambda i: boxes[i][1].start)]
        out = []
        for i in order:
            sy, sx = boxes[i]
            piece = a[sy, sx].copy()
            piece[..., 3] *= (lab[sy, sx] == i + 1)
            ys, xs = np.where(piece[..., 3] > 0)
            out.append((piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1], sy.start + int(ys.min()), sx.start + int(xs.min())))
        return out
    raise SystemExit(f'切不出 {n} 塊')


def anchor_of(p: np.ndarray, kind: str) -> tuple[float, float]:
    al = p[..., 3]
    if kind == 'core':   # 火球：最粗那一點
        d = ndimage.distance_transform_edt(al > 128)
        y, x = np.unravel_index(d.argmax(), d.shape)
        return float(x), float(y)
    if kind == 'bottom':
        ys, xs = np.where(al > 40)
        bot = ys.max()
        rows = al[max(0, bot - max(4, int(p.shape[0] * 0.12))):bot + 1] > 40
        return float(np.mean(np.where(rows.any(0))[0])), float(bot)
    if kind == 'right':
        ys, xs = np.where(al > 40)
        x1 = xs.max()
        cols = al[:, max(0, x1 - 20):x1 + 1] > 40
        return float(x1), float(np.mean(np.where(cols.any(1))[0]))
    w = al / 255.0   # center：alpha 重心
    tot = w.sum()
    yy, xx = np.mgrid[:p.shape[0], :p.shape[1]]
    return float((xx * w).sum() / tot), float((yy * w).sum() / tot)


def align(pieces: list[np.ndarray], kind: str, k: float) -> tuple[list[np.ndarray], tuple[int, int]]:
    """同一組縮放 k、錨點對齊到同一個位置、畫布同樣大小。"""
    ps = [scale(p, k) for p in pieces]
    anc = [anchor_of(p, kind) for p in ps]
    L = int(np.ceil(max(ax for ax, _ in anc))) + 2
    R = int(np.ceil(max(p.shape[1] - ax for p, (ax, _) in zip(ps, anc)))) + 2
    T = int(np.ceil(max(ay for _, ay in anc))) + 2
    B = int(np.ceil(max(p.shape[0] - ay for p, (_, ay) in zip(ps, anc)))) + 2
    out = []
    for p, (ax, ay) in zip(ps, anc):
        c = np.zeros((T + B, L + R, 4), np.float32)
        ox, oy = int(round(L - ax)), int(round(T - ay))
        c[oy:oy + p.shape[0], ox:ox + p.shape[1]] = p
        out.append(c)
    return out, (L, T)


def anim(name: str, n: int, rel: str, kind: str, disp: float, dim: str, use: str, case: str, fps: float,
         loop: bool, soft: bool = False, one_row: bool = False, sel: list[int] | None = None,
         facing: str | None = None, extra: dict | None = None) -> dict:
    """一組動畫格。disp＝建議顯示大小（像素），dim＝它量的是哪一邊：'w' 最寬那格的寬、'h' 最高那格的高、'long' 最大那格的長邊。"""
    a, src = load(name, soft)
    comps = components(a, n, one_row)
    pieces = [c[0] for c in comps]
    if sel is not None:
        pieces = [pieces[i] for i in sel]
    ref = {'w': max(p.shape[1] for p in pieces), 'h': max(p.shape[0] for p in pieces),
           'long': max(max(p.shape[:2]) for p in pieces)}[dim]
    k = PS * disp / ref
    frames, anc = align(pieces, kind, k)
    files = [save(f, f'{rel}_{i + 1}' if len(frames) > 1 else rel) for i, f in enumerate(frames)]
    e = {'frames': [f['path'] for f in files], 'w': files[0]['w'], 'h': files[0]['h'], 'anchor': list(anc),
         'anchorKind': kind, 'displayScale': 1 / PS, 'fps': fps, 'loop': loop, 'use': use, 'renderCase': case,
         'source': src}
    if facing:
        e['facing'] = facing
    if extra:
        e.update(extra)
    return e


def singles(name: str, n: int, specs: list[tuple], one_row: bool = False, soft: bool = False) -> dict:
    """拼版裡的單張：specs＝(鍵, 檔名, 建議顯示長邊, 錨點種類, 用途, render case, facing)。"""
    a, src = load(name, soft)
    comps = components(a, n, one_row)
    res = {}
    for (piece, _, _), (key, rel, disp, kind, use, case, facing) in zip(comps, specs):
        k = PS * disp / max(piece.shape[:2])
        fr, anc = align([piece], kind, k)
        f = save(fr[0], rel)
        e = {'frames': [f['path']], 'w': f['w'], 'h': f['h'], 'anchor': list(anc), 'anchorKind': kind,
             'displayScale': 1 / PS, 'use': use, 'renderCase': case, 'source': src}
        if facing:
            e['facing'] = facing
        res[key] = e
    return res


# ── 資訊欄：框做成剛好的大小（左右端不動、中段水平拉） ──
def frame_to(p: np.ndarray, w: int, h: int, cap: float = 0.16) -> np.ndarray:
    p = scale(p, h / p.shape[0])
    W = p.shape[1]
    c = int(round(W * cap))
    mid = p[:, c:W - c]
    need = w - 2 * c
    if need < 8:   # 太窄：整張縮
        return gp.resize_rgba(p, w, h)
    mid = gp.resize_rgba(mid, need, h)
    return np.concatenate([p[:, :c], mid, p[:, W - c:]], axis=1)


def inner_box(p: np.ndarray) -> list[int]:
    """框內深色平板的範圍 [x0, y0, x1, y1]：中間那一列、中間那一欄往外找到亮的木框為止。"""
    rgb = p[..., :3].mean(-1)
    H, W = rgb.shape
    cy, cx = H // 2, W // 2
    dark = rgb < rgb[cy, cx] + 18
    row, col = dark[cy], dark[:, cx]
    x0 = cx
    while x0 > 0 and row[x0 - 1]:
        x0 -= 1
    x1 = cx
    while x1 < W - 1 and row[x1 + 1]:
        x1 += 1
    y0 = cy
    while y0 > 0 and col[y0 - 1]:
        y0 -= 1
    y1 = cy
    while y1 < H - 1 and col[y1 + 1]:
        y1 += 1
    return [int(x0), int(y0), int(x1), int(y1)]


def hud() -> dict:
    a, src = load('hud_frames')
    comps = components(a, 3)
    big, small, long_ = [c[0] for c in comps]
    res = {}
    for key, piece, (w, h), zh, case in (
            ('hud_score', big, (330, 92), '左上：球球、血（貓掌）、命、分數', 'drawHud panel(14, 12, 330, 92)'),
            ('hud_weapon', big, (330, 92), '忍具與副武器', 'drawHud panel(354, 12, 330, 92)'),
            ('hud_time', small, (150, 60), '中上：時間', 'drawHud panel(VIEW_W/2+60, 12, 150, 60)'),
            ('hud_cats', small, (200, 60), '右上：村貓 n / m', 'drawHud panel(VIEW_W-214, 12, 200, 60)'),
            ('hud_boss', big, (652, 70), '魔王血條框（名字＋血條都畫在框內）', 'drawHud 魔王血條 panel(bx-16, by-34, bw+32, 70)')):
        f = frame_to(piece, w * int(PS), h * int(PS), cap=0.16 if key != 'hud_boss' else 0.07)
        e = save(f, key)
        e.update(displayW=w, displayH=h, displayScale=1 / PS, inner=inner_box(f), use=zh + '（框內留空，字與圖示由程式畫；inner＝框內深色平板的範圍，檔案像素）',
                 renderCase=case, source=src)
        res[key] = e
    f = frame_to(long_, 640 * int(PS), 26 * int(PS), cap=0.05)
    e = save(f, 'hud_bar')
    e.update(displayW=640, displayH=26, displayScale=1 / PS, inner=inner_box(f), renderCase='drawHud 魔王血條本體（620x18 的槽）',
             use='魔王血條的木槽（可選：血條 fillRect 畫在 inner 範圍裡）', source=src)
    res['hud_bar'] = e
    a, src = load('hud_paws')
    comps = components(a, 3, one_row=True)
    for (piece, _, _), key, zh in zip(comps, ('paw_full', 'paw_empty', 'cat_token'),
                                      ('生命：貓掌（有血）', '生命：貓掌（沒血）', '村貓小徽章（可放村貓框左邊）')):
        k = PS * 30 / max(piece.shape[:2])
        f = save(np.pad(scale(piece, k), ((2, 2), (2, 2), (0, 0))), key)
        f.update(displayW=30, displayScale=1 / PS, anchor='center', use=zh + '（取代 heart()，顯示約 30 像素）',
                 renderCase='drawHud heart(ctx, 100 + i*34, 36, 13, ...)', source=src)
        res[key] = f
    return res


# ── 招牌 ──
SIGNS = {'sign_m1': ('任務一 開始！', 'mission'), 'sign_m2': ('任務二 開始！', 'mission'), 'sign_m3': ('任務三 開始！', 'mission'),
         'sign_clear': ('任務完成！', 'mission（過關）'), 'sign_continue': ('接關？', '接關畫面'),
         'sign_warning': ('（無字）', 'boss')}


def signs() -> dict:
    res = {}
    for key, (text, case) in SIGNS.items():
        a, src = load(key)
        comps = components(a, 1)
        p = np.pad(comps[0][0], ((4, 4), (4, 4), (0, 0)))
        disp_w = 1280 if key == 'sign_warning' else (560 if key == 'sign_continue' else 780)
        k = min(1.0, 1400 / p.shape[1])
        p = scale(p, k)
        e = save(p, key)
        e.update(text=text, displayW=disp_w, anchor='center', renderCase=f'drawBanners style={case}', source=src,
                 use=('魔王警告橫幅（無字；「警告」與魔王名字由程式寫在中間紅色區，副標寫在下方）' if key == 'sign_warning'
                      else f'書法招牌「{text}」（已逐字檢查）：畫在畫面中間，建議寬 {disp_w}，程式把副標（關卡名）寫在招牌下方'))
        if key == 'sign_warning':
            e['inner'] = inner_box(p)
        res[key] = e
    return res


# ── 魔王特寫 ──
BOSSES = {'boss_drum_tanuki': '太鼓狸', 'boss_orange_king': '橘皮大王', 'boss_frog_daimyo': '蛙大名',
          'boss_tanuki_lord': '狸大人', 'boss_roomba_king': '掃地機王', 'boss_iron_claw': '鐵爪機關貓'}


def bosses() -> dict:
    res = {}
    for key, zh in BOSSES.items():
        a, src = load(key)
        ys, xs = np.where(a[..., 3] > 8)
        p = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        k = min(420 / p.shape[0], 1280 / p.shape[1])
        p = scale(p, k)
        c = np.zeros((420, 1280, 4), np.float32)
        # 靠右下貼齊（角色被原圖右緣、下緣切到的地方要剛好貼齊畫面邊，才不會在畫面裡露出一條直的切邊）
        oy = 420 - p.shape[0]
        ox = 1280 - p.shape[1]
        c[oy:oy + p.shape[0], ox:ox + p.shape[1]] = p
        e = save(c, key)
        e.update(name=zh, displayScale=1.0, anchor='畫面座標：整張放在 (0, 300)＝底邊貼齊畫面底（角色的下緣與右緣是被切掉的，一定要貼齊畫面邊，否則會露出一條直線）', source=src,
                 use=f'魔王登場特寫：{zh}（角色靠右、面向左，左邊約 40% 留給程式寫名字）；可從右邊滑進來配警告橫幅',
                 renderCase='drawBanners style=boss（魔王出場）')
        res[key] = e
    return res


# ── 村貓 ──
CATS = {'cat_orange_white': '橘白', 'cat_black': '全黑', 'cat_white': '全白', 'cat_siamese': '暹羅',
        'cat_grey_tabby': '灰虎斑', 'cat_calico_long': '三花長毛'}


def cats() -> dict:
    res = {}
    for key, zh in CATS.items():
        a, src = load(key)
        comps = components(a, 2, one_row=True)
        for (p, _, _), pose, pzh in zip(comps, ('tied', 'happy'), ('被綁在木樁上', '被救後揮手')):
            p = np.pad(p, ((4, 4), (4, 4), (0, 0)))
            e = save(p, f'npc_{key[4:]}_{pose}')
            e.update(anchor='bottom-center', facing='left', displayH=175, source=src,
                     use=f'被救村貓（{zh}）{pzh}：腳底＝圖底，照 art.json 既有 npc_* 的畫法（高 175）')
            res[f'npc_{key[4:]}_{pose}'] = e
    return res


# ── 雷射 ──
def laser() -> dict:
    a, src = load('b_laser_beam', soft=True)
    ys = np.where((a[..., 3] > 20).mean(1) > 0.5)[0]
    band = a[max(0, ys.min() - 20):ys.max() + 21]
    ov = 160
    t = gp.make_tile(band, ov) if hasattr(gp, 'make_tile') else None
    if t is None:
        import post_terrain as pt
        t = pt.tile_x(band, ov)
    k = PS * 100 / t.shape[0]   # 建議顯示高 100（高雷射的判定帶 110～210＝100 高）
    t = scale(t, k)
    core = np.where(t[:, t.shape[1] // 2, :3].mean(-1) > 235)[0]
    e = save(t, 'laser_beam')
    e.update(tileX=True, displayScale=1 / PS, displayH=100,
             coreY=[int(core.min()), int(core.max())] if len(core) else None,
             use='鐵爪雷射光束段：左右無縫重複；縱向置中對齊判定帶中線，縮放到帶子高（高 100、低 70）的 1～1.2 倍；'
                 '建議用 lighter 混色畫，才亮；嘴巴那一端的第一段把起點 50 像素淡入（或用 laser_muzzle 蓋住），不然會看到一刀切的直邊', renderCase='drawEnemyExtras iron_claw laser（fillRect 那條）', source=src)
    res = {'laser_beam': e}
    res.update(singles('b_laser_ends', 2, [
        ('laser_muzzle', 'laser_muzzle', 150, 'center', '雷射發射口閃光（光芒往右；朝左請翻轉），中心對齊嘴巴 (mx, my)',
         'drawEnemyExtras iron_claw laser 嘴巴', 'right'),
        ('laser_hit', 'laser_hit', 130, 'center', '雷射打中點（火花往左噴；照射方向翻轉），放在光束盡頭或打中球球的位置',
         'drawEnemyExtras iron_claw laser 盡頭', 'left')], one_row=True, soft=True))
    return res


def overview(title: str, entries: dict, out: str) -> None:
    """照建議顯示大小排一張總覽（暗色棋盤），每張標鍵名。"""
    cells = []
    for key, e in entries.items():
        paths = e.get('frames') or [e['path']]
        sc = e.get('displayScale', 1.0)
        ims = []
        for p in paths:
            im = Image.open(ROOT / 'public' / 'art' / p).convert('RGBA')
            w, h = max(1, round(im.width * sc)), max(1, round(im.height * sc))
            if max(w, h) < 40:
                s2 = 40 / max(w, h)
                w, h = round(w * s2), round(h * s2)
            if w > 900:
                h = round(h * 900 / w)
                w = 900
            ims.append(im.resize((w, h), Image.LANCZOS))
        tot = sum(i.width for i in ims) + 6 * (len(ims) + 1)
        if tot > 2380:   # 一整組太寬（大爆炸 8 格）：整組等比縮到放得下，標題註明
            s3 = (2380 - 6 * (len(ims) + 1)) / sum(i.width for i in ims)
            ims = [i.resize((max(1, round(i.width * s3)), max(1, round(i.height * s3))), Image.LANCZOS) for i in ims]
            key = f'{key}（縮成 {s3:.2f} 倍才放得下）'
        W = sum(i.width for i in ims) + 6 * (len(ims) + 1)
        H = max(i.height for i in ims) + 30
        W = max(W, 200)
        c = Image.new('RGB', (W, H), (40, 44, 60))
        d = ImageDraw.Draw(c)
        for yy in range(22, H, 16):
            for xx in range((yy // 16) % 2 * 16, W, 32):
                d.rectangle((xx, yy, xx + 15, yy + 15), fill=(62, 68, 88))
        x = 6
        for im in ims:
            c.paste(im, (x, 24), im)
            x += im.width + 6
        d.rectangle((0, 0, W, 20), fill='black')
        d.text((3, 1), f'{key} ×{len(ims)}', fill='yellow', font=FONT)
        cells.append(c)
    rows, cur, cw = [], [], 0
    for c in cells:
        if cur and cw + c.width > 2400:
            rows.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.width + 6
    rows.append(cur)
    Hs = sum(max(c.height for c in r) + 6 for r in rows) + 30
    sheet = Image.new('RGB', (2400, Hs), 'white')
    ImageDraw.Draw(sheet).text((6, 3), title, fill='black', font=FONT_T)
    y = 30
    for r in rows:
        x = 0
        for c in r:
            sheet.paste(c, (x, y))
            x += c.width + 6
        y += max(c.height for c in r) + 6
    CHECK.mkdir(parents=True, exist_ok=True)
    sheet.save(CHECK / out)
    print(CHECK / out, sheet.size)


def main() -> None:
    J: dict = {}
    # 1. 敵人子彈與招式
    B: dict = {}
    B['fireball'] = anim('b_fireball', 3, 'fireball', 'core', 64, 'w', '燈籠鬼火球（往左飛、拖尾在右；本體中心＝anchor）',
                         "drawBullet case 'fireball'（沒有 cyanHalo 時）", 12, True, soft=True, one_row=True, facing='left')
    B['fireball_cyan'] = anim('b_fireball_cyan', 3, 'fireball_cyan', 'core', 64, 'w', '夜祭段的青白火球（cyanHalo 時用這版）',
                              "drawBullet case 'fireball'（cyanHalo）", 12, True, soft=True, one_row=True, facing='left')
    B['wave'] = anim('b_wave', 3, 'wave', 'bottom', 110, 'w', '地面震波（往右滑，底部中間貼地面 b.y；往左請翻轉）',
                     "drawBullet case 'wave'（判定 64x58）", 12, True, one_row=True, facing='right')
    a, _ = load('b_water_splash')
    W5 = components(a, 5)
    B['water'] = anim('b_water_splash', 5, 'water', 'core', 64, 'w', '河童水彈（往左飛）', "drawBullet case 'water'", 10, True,
                      sel=[0, 1], facing='left')
    B['splash'] = anim('b_water_splash', 5, 'splash', 'bottom', 60, 'w', '水花（底部中間＝水面／地面；3 格播一次）',
                       "drawBullet case 'splash'（判定 22x22；也可當入水、落水特效）", 14, False, sel=[2, 3, 4])
    del W5
    B.update(singles('b_misc', 5, [
        ('fan', 'fan', 64, 'center', '面具舞者的扇子（程式會轉；中心＝扇軸附近的重心）', "drawBullet case 'fan'（判定 50x40）", None),
        ('pellet_1', 'pellet_1', 30, 'center', '甲蟲光彈第 1 格', "drawBullet case 'pellet'", None),
        ('pellet_2', 'pellet_2', 36, 'center', '甲蟲光彈第 2 格（兩格交替閃）', "drawBullet case 'pellet'", None),
        ('bubble_1', 'bubble_1', 60, 'center', '泡泡第 1 格', "drawBullet case 'bubble'（b.w＝56）", None),
        ('bubble_2', 'bubble_2', 60, 'center', '泡泡第 2 格（兩格交替＝晃）', "drawBullet case 'bubble'", None)]))
    B['foxfire'] = anim('b_foxfire', 3, 'foxfire', 'center', 64, 'h', '白狐巫女的狐火（藍白火，火尖朝上）', "drawBullet case 'foxfire'",
                        10, True, soft=True, one_row=True)
    B['gust'] = anim('b_gust', 3, 'gust', 'center', 500, 'w', '天狗的風（往右吹；判定 500x200，整張蓋在判定範圍上，半透明疊）',
                     "drawBullet case 'gust'", 10, True, soft=True, facing='right')
    B.update(singles('b_garbage', 3, [
        ('garbage_can', 'garbage_can', 56, 'center', '掃地機王垃圾彈：空罐（程式會轉）', "drawBullet case 'garbage'（隨機挑一種）", None),
        ('garbage_bone', 'garbage_bone', 60, 'center', '垃圾彈：魚骨', "drawBullet case 'garbage'", None),
        ('garbage_paper', 'garbage_paper', 50, 'center', '垃圾彈：紙團', "drawBullet case 'garbage'", None)], one_row=True))
    a, src = load('b_missile', soft=True)
    comps = components(a, 3, one_row=True)
    rocket, fl1, fl2 = [c[0] for c in comps]
    k = PS * 64 / rocket.shape[1]
    fr, anc = align([rocket], 'center', k)
    f = save(fr[0], 'missile')
    B['missile'] = {'frames': [f['path']], 'w': f['w'], 'h': f['h'], 'anchor': list(anc), 'anchorKind': 'center',
                    'displayScale': 1 / PS, 'facing': 'right', 'tailX': int(np.where(fr[0][..., 3].max(0) > 40)[0].min()),
                    'use': '鐵爪飛彈（頭朝右；程式照速度方向轉：ctx.rotate(atan2(vy, vx))）；tailX＝尾巴在圖上的 x，尾焰接在這裡',
                    'renderCase': "drawBullet case 'missile'（判定 26x60）", 'source': src}
    frs, anc2 = align([fl1, fl2], 'right', k)
    fs = [save(x, f'missile_flame_{i + 1}') for i, x in enumerate(frs)]
    B['missile_flame'] = {'frames': [x['path'] for x in fs], 'w': fs[0]['w'], 'h': fs[0]['h'], 'anchor': list(anc2),
                          'anchorKind': 'right', 'displayScale': 1 / PS, 'fps': 20, 'loop': True, 'facing': 'left',
                          'use': '飛彈尾焰 2 格（噴口在右端中間＝anchor，接在飛彈 tailX；跟飛彈一起轉）', 'renderCase': "drawBullet case 'missile'",
                          'source': src}
    B.update(laser())
    J['bullets'] = B
    overview('1. 敵人子彈與招式（照建議顯示大小；太小的放大到 40）', B, 'fx2_1_bullets.png')
    # 2. 粒子
    P: dict = {}
    P['smoke_white'] = anim('p_smoke_white', 4, 'smoke_white', 'center', 70, 'w', '白煙 4 格（由小到大、變淡）：一顆煙從第 1 格播到第 4 格',
                            "drawParticle case 'smoke'（淺色）／'puff'", 8, False, soft=True, one_row=True,
                            extra={'note': '畫的大小照粒子半徑：第 4 格寬 ≈ 2r×1.8'})
    P['smoke_black'] = anim('p_smoke_black', 4, 'smoke_black', 'center', 80, 'w', '黑煙 4 格（爆炸、火災、魔王冒煙）',
                            "drawParticle case 'smoke'（深色 #3a3040／#4a4048）", 8, False, soft=True, one_row=True)
    P['fire'] = anim('p_fire', 4, 'fire', 'bottom', 44, 'h', '小火焰 4 格循環（燒傷、火遁餘火）', "drawParticle case 'fire'",
                     12, True, soft=True, one_row=True)
    P['dust'] = anim('p_dust', 4, 'dust', 'bottom', 110, 'w', '落地揚塵 4 格（底部中間貼地；球球落地、敵人落地、衝刺）',
                     "drawParticle case 'puff'（#c9a77a 那種）", 14, False, soft=True, one_row=True)
    P.update(singles('p_small', 6, [
        ('spark', 'spark', 20, 'center', '火花（小四角星）', "drawParticle case 'spark'", None),
        ('ember', 'ember', 14, 'center', '火星', "drawParticle case 'ember'", None),
        ('drop_water', 'drop_water', 16, 'center', '水滴（酒桶、水花）', "drawParticle case 'drop'（藍白）", None),
        ('star', 'star', 22, 'center', '暈眩星星（打倒、暈眩）', "drawParticle case 'star'", None),
        ('drop_poison', 'drop_poison', 16, 'center', '毒液滴', "drawParticle case 'drop'（#b06cff）", None),
        ('coin', 'coin', 18, 'center', '金幣（賽錢箱打爛撒出來）', "drawParticle case 'drop'（#ffd23a）", None)], one_row=True, soft=True))
    P.update(singles('p_hits', 3, [
        ('hit_claw', 'hit_claw', 110, 'center', '打中火花：爪子劃過（揮爪打中）', "world.damageEnemy kind='claw' 的 spark 那一串", None),
        ('hit_shuriken', 'hit_shuriken', 80, 'center', '打中火花：手裏劍打中', "打中火花（取代 art.json 的 hit_spark）", None),
        ('hit_blunt', 'hit_blunt', 100, 'center', '打中火花：鈍擊（大手裏劍、爆裂、撞擊）', '打中火花', None)], one_row=True, soft=True))
    J['particles'] = P
    overview('2. 粒子（照建議顯示大小；太小的放大到 40）', P, 'fx2_2_particles.png')
    # 3. 爆炸
    X: dict = {}
    for size, zh, disp, rr in (('small', '小', 220, '< 90'), ('medium', '中', 380, '90～160'), ('large', '大', 640, '≥ 160')):
        X[f'explosion_{size}'] = anim(f'x_{size}', 8, f'explosion_{size}', 'center', disp, 'w',
                                      f'{zh}爆炸 8 格（閃光→火球→最大→黑煙→散掉）；半徑 r {rr} 用這組', 'drawExplosion（取代 explosion_1～4）',
                                      16, False, soft=True,
                                      extra={'note': f'建議：畫布寬 ≈ r × 3.2（現在的 r 也可以直接換算：顯示倍率＝r×3.2 ÷ 檔案寬）；'
                                                     f'8 格照 k＝age/life 均分（第 floor(k×8) 格），最後 25% 淡出'})
    J['explosions'] = X
    overview('3. 爆炸（大中小各 8 格，照建議顯示大小）', X, 'fx2_3_explosions.png')
    # 4. 資訊欄
    J['hud'] = hud()
    overview('4. 資訊欄（照顯示大小）', J['hud'], 'fx2_4_hud.png')
    # 5. 招牌
    J['signs'] = signs()
    ov = {k: {**v, 'displayScale': v['displayW'] / v['w']} for k, v in J['signs'].items()}
    overview('5. 大字招牌（照建議寬度；字都逐字看過）', ov, 'fx2_5_signs.png')
    # 6. 魔王
    J['bosses'] = bosses()
    ov = {k: {**v, 'displayScale': 0.5} for k, v in J['bosses'].items()}
    overview('6. 魔王登場特寫（縮成一半看）', ov, 'fx2_6_bosses.png')
    # 7. 村貓
    J['npc'] = cats()
    ov = {k: {**v, 'displayScale': 175 / v['h']} for k, v in J['npc'].items()}
    overview('7. 被救村貓（高 175，照遊戲大小）', ov, 'fx2_7_cats.png')
    # 8. 球球特效
    Q: dict = {}
    Q['claw_arc'] = anim('q_claw', 3, 'claw_arc', 'center', 230, 'w', '揮爪弧光 3 格（往右揮；朝左請翻轉），中心對齊爪子揮的位置（球球前方約 60、腳底上方約 110）',
                         "world 揮爪（event 'claw'）時在球球前面播一次", 20, False, soft=True, one_row=True, facing='right')
    Q.update(singles('q_flash', 2, [
        ('throw_flash', 'throw_flash', 70, 'center', '丟出時的閃光（往右；朝左翻轉），放在出手點', "fire 事件（丟手裏劍）", 'right'),
        ('twinkle', 'twinkle', 40, 'center', '小閃光（撿到道具、村貓掏出道具）', '撿到道具', None)], one_row=True, soft=True))
    a, src = load('q_respawn', soft=True)
    ys, xs = np.where(a[..., 3] > 8)
    p = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    k = PS * 720 / p.shape[0]
    p = scale(p, k)
    f = save(p, 'respawn_pillar')
    Q['respawn_pillar'] = {'frames': [f['path']], 'w': f['w'], 'h': f['h'], 'anchor': [f['w'] // 2, f['h']],
                           'anchorKind': 'bottom', 'displayScale': 1 / PS, 'displayH': 720,
                           'use': '重生光柱（高 720＝整個畫面；底部中間＝球球落地點；淡入淡出用 alpha，建議 lighter 混色）',
                           'renderCase': '重生從天上掉下來', 'source': src}
    Q['landing_dust'] = {'same': 'particles.dust', 'use': '落地揚塵跟粒子共用 particles.dust'}
    J['qiuqiu'] = Q
    overview('8. 球球特效（照建議顯示大小；光柱縮成一半）', {k: v for k, v in Q.items() if 'frames' in v}, 'fx2_8_qiuqiu.png')

    J['_說明'] = ('第三批美術（tools/gen_fx2.py 生、tools/post_fx2.py 後製；規劃見 docs/2026-09-26_美術補強與場景變化規劃.md 第四節）。'
                 '圖在 public/art/fx2/。檔案多半存成建議顯示大小的 2 倍（displayScale 0.5）；魔王特寫、村貓、招牌照各自寫的大小。'
                 '動畫 frames 每一格畫布同樣大小，anchor [x, y]（檔案像素）在每一格的同一個位置：畫的時候把 anchor 對到要的座標即可。'
                 'anchorKind：center 特效中心、core 火球本體（拖尾在後）、bottom 底部中間貼地、right 右端中間。'
                 'facing＝圖上朝向，反方向請水平翻轉。renderCase＝對應 src/render.ts 現在程式畫的那一段。'
                 '檢查用總覽圖在 art_raw/fx2/_check/fx2_*.png，模擬遊戲畫面在 art_raw/fx2/_check/sim_*.png。')
    JSON_OUT.write_text(json.dumps(dict(sorted(J.items())), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n = sum(len(v) for k, v in J.items() if isinstance(v, dict))
    print('fx2.json 寫好：', {k: len(v) for k, v in J.items() if isinstance(v, dict)}, '共', n, '項')


if __name__ == '__main__':
    main()
