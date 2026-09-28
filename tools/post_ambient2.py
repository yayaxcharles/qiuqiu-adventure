"""天氣、背景生物、大場面的後製（原圖由 tools/gen_ambient2.py 生在 art_raw/ambient/）。

  python tools/post_ambient2.py export     切圖、去黑底、無縫重複、調遠景色 → public/art/ambient2/*.webp＋public/art/ambient2.json
  python tools/post_ambient2.py check      每類一張拼版總覽 → art_raw/ambient/_check/{A,B,C,V}_*.png
  python tools/post_ambient2.py mock       每關 3～4 張模擬畫面 → art_raw/ambient/_check/mock_s{1,2,3}_*.png
art_raw/ambient/picks.json 可指定某張用第幾次（{"scrap": 2}），沒指定就用最新一次。
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'ambient'
CHECK = RAW / '_check'
ART = ROOT / 'public' / 'art'
OUT = ART / 'ambient2'
JSON_OUT = ART / 'ambient2.json'
PICKS = RAW / 'picks.json'
VW, VH, GROUND = 1280, 720, 596

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_ambient2 as G   # noqa: E402


# ───────────────────────── 小工具 ─────────────────────────
def pick(name: str) -> Path:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    tries = sorted(RAW.glob(f'{name}.try*.png'), key=lambda p: int(p.stem.split('.try')[1]))
    if not tries:
        raise SystemExit(f'{name} 還沒生')
    return tries[-1]


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(pick(name)).convert('RGBA')).astype(np.float32)


def black_key(a: np.ndarray, black: float = 10, gain: float = 1.0, gamma: float = 1.0) -> np.ndarray:
    """黑底→透明：把黑底當成「疊在黑色上的光」，alpha＝最亮的色版，顏色除回去（保留半透明與原色）。"""
    rgb = a[..., :3] * (a[..., 3:4] / 255)      # Codex 有時直接給透明底：先當成疊在黑色上
    m = rgb.max(-1)
    al = np.clip((m - black) / (255 - black) * gain, 0, 1) ** gamma
    col = np.where(al[..., None] > 1e-3, np.clip(rgb / np.maximum(m[..., None], 1e-3) * 255, 0, 255), 0)
    return np.dstack([col, al * 255]).astype(np.float32)


def lum_key(a: np.ndarray, tint: tuple, black: float = 8, gamma: float = 1.0, amax: float = 1.0) -> np.ndarray:
    """黑底白霧→單一色調的半透明霧：亮度只拿來當 alpha，顏色全換成這關的霧色（亮處略提亮）。"""
    l = a[..., :3].mean(-1)
    al = np.clip((l - black) / (255 - black), 0, 1) ** gamma * amax
    t = np.array(tint, np.float32)
    col = t[None, None] * (0.88 + 0.12 * np.clip(l / 255, 0, 1))[..., None]
    col = np.clip(col, 0, 255)
    return np.dstack([col, al * 255]).astype(np.float32)


def wrap_x(a: np.ndarray, ov: int) -> np.ndarray:
    """左右無縫：把最右邊 ov 欄淡入到最左邊，輸出寬 W-ov，頭尾接得起來。"""
    W = a.shape[1]
    out = a[:, :W - ov].copy()
    t = np.linspace(0, 1, ov, dtype=np.float32)[None, :, None]
    out[:, :ov] = a[:, :ov] * t + a[:, W - ov:] * (1 - t)
    return out


def wrap_y(a: np.ndarray, ov: int) -> np.ndarray:
    return wrap_x(a.transpose(1, 0, 2), ov).transpose(1, 0, 2)


def fade_rows(a: np.ndarray, top: float, bottom: float) -> np.ndarray:
    """上下邊淡到 0（top／bottom 是淡出帶佔圖高的比例）。"""
    h = a.shape[0]
    y = np.arange(h, dtype=np.float32)
    f = np.ones(h, np.float32)
    if top > 0:
        f = np.minimum(f, np.clip(y / (top * h), 0, 1))
    if bottom > 0:
        f = np.minimum(f, np.clip((h - 1 - y) / (bottom * h), 0, 1))
    f = f * f * (3 - 2 * f)
    b = a.copy()
    b[..., 3] *= f[:, None]
    return b


def trim(a: np.ndarray, thr: float = 6, pad: int = 4) -> np.ndarray:
    ys, xs = np.where(a[..., 3] > thr)
    if len(ys) == 0:
        return a
    b = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return np.pad(b, ((pad, pad), (pad, pad), (0, 0)))


def clean(a: np.ndarray, thr: float = 8) -> np.ndarray:
    a = a.copy()
    a[..., 3][a[..., 3] < thr] = 0
    a[..., :3][a[..., 3] == 0] = 0
    return a


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    """先乘 alpha 再縮，避免邊緣發黑。"""
    p = a.copy()
    p[..., :3] *= p[..., 3:4] / 255
    im = cv2.resize(p, (w, h), interpolation=cv2.INTER_AREA if w < a.shape[1] else cv2.INTER_CUBIC)
    im[..., 3] = np.clip(im[..., 3], 0, 255)
    im[..., :3] = np.where(im[..., 3:4] > 0.5, im[..., :3] / np.maximum(im[..., 3:4], 1e-3) * 255, 0)
    return np.clip(im, 0, 255)


def fit(a: np.ndarray, maxside: int) -> np.ndarray:
    s = maxside / max(a.shape[:2])
    if s >= 1:
        return a
    return resize(a, max(1, round(a.shape[1] * s)), max(1, round(a.shape[0] * s)))


def fitg(pieces: list[np.ndarray], maxside: int) -> list[np.ndarray]:
    """同一組（動畫格、大中小）用同一個縮放比例，保留彼此的大小關係。"""
    s = min(1.0, maxside / max(max(p.shape[:2]) for p in pieces))
    if s >= 1:
        return pieces
    return [resize(p, max(1, round(p.shape[1] * s)), max(1, round(p.shape[0] * s))) for p in pieces]


def grade(a: np.ndarray, haze: tuple, amount: float, dark: float, keep_glow: bool = True) -> np.ndarray:
    """遠景化：暗一點、往這關的霧色靠、降彩度；發光的地方（火、熔鐵）保留亮度。"""
    b = a.copy()
    rgb = b[..., :3] / 255
    l = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    w = 1 - np.clip((l - 0.55) / 0.35, 0, 1) if keep_glow else np.ones_like(l)
    gray = l[..., None]
    rgb2 = rgb * 0.75 + gray * 0.25                                  # 降彩度
    rgb2 = rgb2 * (1 - dark)                                         # 變暗
    rgb2 = rgb2 * (1 - amount) + np.array(haze, np.float32) / 255 * amount   # 霧色
    out = rgb * (1 - w[..., None]) + rgb2 * w[..., None]
    b[..., :3] = np.clip(out * 255, 0, 255)
    return b


def split_items(a: np.ndarray, want: int, one_row: bool = False) -> list[np.ndarray] | None:
    """透明拼版切成一塊塊（先分列、再由左到右）；換幾種間隔試到剛好 want 塊。"""
    mask = a[..., 3] > 10
    for dil in (18, 10, 26, 34, 48, 64, 6):
        lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=dil))
        if n < want:
            continue
        boxes = ndimage.find_objects(lab)
        areas = ndimage.sum(mask, lab, range(1, n + 1))
        keep = [i for i in range(n) if areas[i] >= 0.03 * areas.max()]
        if len(keep) != want:
            continue
        if one_row:
            order = sorted(keep, key=lambda i: boxes[i][1].start)
        else:
            keep.sort(key=lambda i: (boxes[i][0].start + boxes[i][0].stop) / 2)
            rows, cur = [], []
            for i in keep:
                cy = (boxes[i][0].start + boxes[i][0].stop) / 2
                if cur and cy - np.mean([(boxes[j][0].start + boxes[j][0].stop) / 2 for j in cur]) > a.shape[0] * 0.2:
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
            out.append(trim(piece))
        return out
    return None


def align(pieces: list[np.ndarray], how: str) -> list[np.ndarray]:
    """動畫格放到同一大小的畫布：how＝bottom（底邊置中對齊）、top、center。"""
    W = max(p.shape[1] for p in pieces)
    H = max(p.shape[0] for p in pieces)
    out = []
    for p in pieces:
        c = np.zeros((H, W, 4), np.float32)
        x = (W - p.shape[1]) // 2
        y = {'bottom': H - p.shape[0], 'top': 0, 'center': (H - p.shape[0]) // 2}[how]
        c[y:y + p.shape[0], x:x + p.shape[1]] = p
        out.append(c)
    return out


def slant_sign(a: np.ndarray) -> float:
    """雨絲的斜向：回傳 >0 表示「右上→左下」（我們要的方向），<0 表示「左上→右下」。"""
    g = cv2.cvtColor(np.clip(a[..., :3], 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    return float((gx * gy).sum())   # 線條「／」的梯度法線在「＼」方向 → gx·gy 為正


def save_webp(a: np.ndarray, rel: str) -> dict:
    p = OUT / f'{rel}.webp'
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(p, 'WEBP', quality=92, method=6,
                                                                           alpha_quality=100)
    return {'path': f'ambient2/{rel}.webp', 'w': int(a.shape[1]), 'h': int(a.shape[0])}


# ───────────────────────── 每一項的處理 ─────────────────────────
FOG_TINT = {   # 每關霧色（黃昏竹林：淡紫粉；夜晚河面：月光藍白；工廠：煤煙褐灰）
    'fog_s1_far': (228, 196, 226), 'fog_s1_near': (196, 186, 226),
    'fog_s2_far': (176, 200, 238), 'fog_s2_near': (196, 216, 242),
    'fog_s3_far': (176, 150, 128), 'fog_s3_near': (150, 132, 118),
}
HAZE = {'s1': (86, 64, 110), 's1n': (40, 30, 60), 's2': (40, 52, 96), 's3': (84, 60, 44), 's3r': (54, 54, 96)}

ITEMS: dict[str, dict] = {}    # 名字 → json 條目（export 時填）
FRAMES: dict[str, list[np.ndarray]] = {}   # 名字 → 切好的圖（給 check／mock 用）


def put(name: str, arrs: list[np.ndarray], meta: dict) -> None:
    frames = [save_webp(a, f'{name}_{i}' if len(arrs) > 1 else name) for i, a in enumerate(arrs, 1)]
    ITEMS[name] = {**meta, 'frames': frames, 'source': pick(name).name}
    FRAMES[name] = arrs


def do_fog() -> None:
    for name, tint in FOG_TINT.items():
        a = load(name)
        near = name.endswith('near')
        k = lum_key(a, tint, black=10, gamma=1.15, amax=0.92)
        k = wrap_x(k, 360)
        k = fade_rows(k, 0.12, 0.10 if not near else 0.08)
        W = 1600
        k = resize(k, W, round(k.shape[0] * W / k.shape[1]))
        st = name.split('_')[1]
        zone = {'s1': '竹林', 's2': '河童川', 's3': '機關城城下／工廠外'}[st]
        put(name, [k], {
            'stage': st, 'zone': zone,
            'use': ('遠層霧帶：橫在遠山前面慢慢飄' if not near else '近層地面霧：貼著地面慢慢飄') + f'（{zone}）',
            'layer': 'midfar' if not near else 'mid', 'tileX': True, 'anchor': 'center-left' if not near else 'bottom-left',
            'display': {'w': W, 'h': k.shape[0], 'y': 380 if not near else GROUND + 40,
                        'y說明': '遠層＝圖的垂直中心放在 y；近層＝圖底放在 y（地面線下 40，底部被地形蓋住）'},
            'alpha': 0.55 if not near else 0.6, 'blend': 'normal',
            'drift': '左右飄 8～15 px/秒（兩層反向更有層次），可疊兩份錯開半張',
        })


def do_rain() -> None:
    spec = {   # 名字：(輸出邊長, 建議 alpha, 落速 px/秒)
        'drizzle_1': (512, 0.35, 380), 'drizzle_2': (640, 0.45, 520), 'drizzle_3': (896, 0.55, 700),
        'storm_rain_1': (512, 0.4, 900), 'storm_rain_2': (768, 0.45, 1250), 'storm_rain_3': (1024, 0.35, 1700),
    }
    for name, (side, al, speed) in spec.items():
        a = load(name)
        k = black_key(a, black=14, gain=1.25)
        if slant_sign(k) < 0:            # 統一成「右上往左下」落
            k = k[:, ::-1].copy()
        k = wrap_y(wrap_x(k, 180), 180)
        k = resize(k, side, side)
        storm = name.startswith('storm')
        put(name, [k], {
            'stage': 's3' if storm else 's1', 'zone': '天守閣頂（暴風雨第二、三級）' if storm else '竹林中段（毛毛雨）',
            'use': ('暴風雨斜打雨幕' if storm else '竹林毛毛雨雨幕') + f'（第 {name[-1]} 層：1 遠細密、2 中、3 近粗長）'
                   + ('；大雨＝1＋2，魔王戰狂風暴雨＝1＋2＋3（第 3 層 alpha 別超過 0.4，會擋到角色）' if storm else ''),
            'layer': 'overlay', 'tileX': True, 'tileY': True, 'anchor': 'screen',
            'display': {'w': side, 'h': side, '說明': '1:1 鋪滿整個畫面、上下左右重複'},
            'alpha': al, 'blend': 'normal',
            'drift': f'往左下捲：每秒 y +{speed}、x −{round(speed * (0.53 if storm else 0.18))}（跟雨絲斜度一致）',
        })


def do_beams() -> None:
    for name, st, zone, al in (('sunbeam', 's1', '黃昏山村', 0.4), ('moonbeam', 's2', '河童川', 0.35)):
        a = load(name)
        k = black_key(a, black=8, gain=1.1)
        k = resize(k, 1280, round(k.shape[0] * 1280 / k.shape[1]))
        put(name, [k], {
            'stage': st, 'zone': zone, 'use': ('夕陽光束（左上斜射）' if st == 's1' else '月光光束（左上斜射；月亮在右上的段落請左右翻轉）'),
            'layer': 'overlay', 'tileX': False, 'anchor': 'top-left',
            'display': {'w': 1280, 'h': 720, '說明': '拉滿整個畫面；可左右翻轉、輕微呼吸（alpha ±0.08）'},
            'alpha': al, 'blend': 'screen（沒有就用 lighter；再沒有用 normal＋alpha 0.3）',
        })


def sheet_black(name: str, n: int, one_row: bool, black: float = 12, gain: float = 1.15) -> list[np.ndarray]:
    k = black_key(load(name), black=black, gain=gain)
    p = split_items(k, n, one_row=one_row)
    if p is None:
        raise SystemExit(f'{name}：切不出 {n} 塊')
    return p


def sheet_alpha(name: str, n: int, one_row: bool) -> list[np.ndarray]:
    a = clean(load(name))
    p = split_items(a, n, one_row=one_row)
    if p is None:
        raise SystemExit(f'{name}：切不出 {n} 塊')
    return p


def do_small() -> None:
    # 螢火蟲：1～3 閃爍三格（同一隻），4～6 模糊光點
    p = sheet_black('fireflies', 6, False, black=10, gain=1.2)
    p = fitg(p, 96)
    blink = align(p[:3], 'center')
    bokeh = p[3:]
    put('fireflies', blink + bokeh, {
        'stage': 's1', 'zone': '竹林（雨停後）；第二關河童川也可用',
        'use': '螢火蟲：第 1～3 張＝同一隻亮→中→暗（輪播 1-2-3-2 當閃爍），第 4～6 張＝失焦光點（大中小）',
        'layer': 'mid', 'anchor': 'center', 'display': {'h': '螢火蟲 16～24、光點 20～48（遠的小、近的大）'},
        'alpha': 0.9, 'blend': 'lighter（加亮）', 'drift': '慢慢繞圈飄，每隻亮暗錯開',
    })
    specs = [
        ('rice_fluff', 's1', '黃昏山村', '稻穗飛絮（稻殼、絨毛、稻草屑、小稻穗）', 'alpha', '12～24', 0.95),
        ('paper_petals', 's2', '夜祭燈籠街', '飄落的紙花瓣（粉櫻、紅、白金邊、金梅）', 'alpha', '14～26', 1.0),
        ('ash', 's3', '機關城城下', '飄灰燼（2、4 邊緣帶餘燼紅光）', 'alpha', '10～22', 0.9),
        ('sparks', 's3', '工廠', '火花雨（往左下落，尾巴朝右上）', 'black', '24～70', 1.0),
    ]
    for name, st, zone, use, mode, disp, al in specs:
        p = sheet_black(name, 4, True) if mode == 'black' else sheet_alpha(name, 4, True)
        p = fitg(p, 128)
        put(name, p, {
            'stage': st, 'zone': zone, 'use': use + '；4 種隨機挑、邊飄邊慢慢轉',
            'layer': 'fore（近、大、快）或 mid（遠、小、慢）各撒一些', 'anchor': 'center',
            'display': {'h': disp}, 'alpha': al, 'blend': 'lighter（加亮）' if mode == 'black' else 'normal',
        })
    # 水窪
    p = fitg(sheet_alpha('puddles', 3, True), 360)
    p = [resize(x, x.shape[1], max(4, round(x.shape[0] * 0.5))) for x in p]   # 側視角：壓扁成細長橢圓才像躺在地上
    put('puddles', p, {
        'stage': 's1', 'zone': '竹林中段（毛毛雨時）', 'use': '地上小水窪反光（小、中、大）',
        'layer': 'mid（隨地形捲動、速率 1.0；畫在地面帶上、角色後面）', 'anchor': 'center＝地面線下 2～4 像素（圖已壓扁，別再拉高）',
        'display': {'w': '小 90、中 140、大 200（高照原比例）'}, 'alpha': 0.85, 'blend': 'normal',
    })


def do_storm_bits() -> None:
    p = align(fitg(sheet_alpha('roof_splash', 3, True), 200), 'bottom')
    put('roof_splash', p, {
        'stage': 's3', 'zone': '天守閣頂（大雨、狂風暴雨）', 'use': '屋瓦濺水 3 格（落下→水冠→回落），每格 0.06 秒，播完消失',
        'layer': 'mid（隨地形捲動、速率 1.0，畫在屋瓦地面上）', 'anchor': 'bottom-center＝屋瓦表面',
        'display': {'h': '36～60'}, 'alpha': 0.85, 'blend': 'normal',
    })
    p = align(fitg(sheet_alpha('eave_drip', 2, True), 320), 'top')
    put('eave_drip', p, {
        'stage': 's3', 'zone': '天守閣頂', 'use': '屋簷滴水 2 格輪播（每格 0.12 秒）',
        'layer': 'mid（掛在背景屋簷下，跟 mid 同速率；或掛在地形屋子的簷口，速率 1.0）', 'anchor': 'top-center＝簷口',
        'display': {'h': '70～120'}, 'alpha': 0.8, 'blend': 'normal',
    })


def do_heat() -> None:
    a = load('heat_haze')
    g = a[..., :3].mean(-1)
    g = cv2.GaussianBlur(g, (0, 0), 3)
    g = np.dstack([g, g, g, np.full_like(g, 255)])
    g = wrap_y(wrap_x(g, 200), 200)[..., 0]
    g = cv2.resize(g, (512, 512), interpolation=cv2.INTER_AREA)
    g = (g - g.mean()) / max(g.std(), 1e-3) * 42 + 128          # 中灰 128、上下各約 1.5 個標準差有變化
    g = np.clip(g, 0, 255).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(g, 'L').save(OUT / 'heat_haze.png')
    ITEMS['heat_haze'] = {
        'stage': 's3', 'zone': '工廠（熔爐附近）', 'use': '熱浪扭曲用的位移貼圖（灰階，128＝不動）',
        'frames': [{'path': 'ambient2/heat_haze.png', 'w': 512, 'h': 512}], 'source': pick('heat_haze').name,
        'layer': 'overlay（只作用在熔爐上方那一塊）', 'tileX': True, 'tileY': True, 'anchor': 'screen',
        'display': {'說明': '取樣位移：dx＝(v−128)/128×3 像素、dy＝(v−128)/128×1.5；貼圖每秒往上捲 40 像素'},
        'alpha': 1.0, 'blend': '位移（不是疊色）；canvas 做不到就改用它當遮罩、上下錯位重畫那一塊',
    }
    FRAMES['heat_haze'] = [np.dstack([g, g, g, np.full_like(g, 255)]).astype(np.float32)]


def do_creatures() -> None:
    k = clean(load('kite'))
    k = grade(fit(trim(k), 420), HAZE['s3'], 0.22, 0.12)
    put('kite', [k], {
        'stage': 's3', 'zone': '機關城城下', 'use': '機關風箏（靜態圖，程式讓它左右飄、上下晃、輕微轉 ±6 度）',
        'layer': 'midfar', 'anchor': 'center', 'display': {'w': '110～160'}, 'alpha': 1.0, 'blend': 'normal',
        'facing': 'left',
    })
    a = grade(fit(trim(clean(load('airship'))), 560), HAZE['s3'], 0.22, 0.12)
    prop = [grade(x, HAZE['s3'], 0.22, 0.12) for x in fitg(sheet_alpha('propeller', 2, True), 200)]
    prop = align(prop, 'center')
    hub = find_hub(a)
    put('airship', [a], {
        'stage': 's3', 'zone': '機關城城下～工廠外', 'use': '小飛艇（側面朝左，程式往左慢慢巡邏）',
        'layer': 'midfar', 'anchor': 'center', 'display': {'w': '180～260'}, 'alpha': 1.0, 'blend': 'normal',
        'facing': 'left', 'propellerAt': {'x': hub[0], 'y': hub[1], '說明': '螺旋槳中心在飛艇圖裡的像素位置（原圖座標）'},
        'propellerScale': round(a.shape[0] * 0.42 / prop[0].shape[0], 3),
    })
    put('propeller', prop, {
        'stage': 's3', 'zone': '同飛艇', 'use': '飛艇螺旋槳 2 格輪播（每格 0.05 秒）',
        'layer': 'midfar（畫在飛艇上面）', 'anchor': 'center＝飛艇 propellerAt',
        'display': {'說明': '寬高＝原圖 × 飛艇縮放 × propellerScale'}, 'alpha': 1.0, 'blend': 'normal',
    })
    p = fitg(sheet_alpha('bird_flocks', 3, True), 360)
    put('bird_flocks', p, {
        'stage': 'all', 'zone': '第一關黃昏、第三關城下（第二關夜空用少一點）',
        'use': '遠山上的鳥群剪影：1 人字雁群、2 散開的烏鴉群、3 一排波浪隊形；程式往左飛、整群上下輕晃',
        'layer': 'far（跟遠山同速率或更慢）', 'anchor': 'center', 'display': {'w': '70～160'},
        'alpha': 0.85, 'blend': 'normal', 'facing': 'left', '調色': '剪影是深紫灰，夜裡可再調暗、黃昏可略帶紫',
    })


def find_hub(a: np.ndarray) -> tuple[int, int]:
    """螺旋槳軸心：飛艇圖最右邊那一段、實心部分的垂直中心（吊艙尾端的軸）。找不到就回傳右下 1/3 處。"""
    al = a[..., 3] > 128
    cols = np.where(al.any(0))[0]
    if len(cols) == 0:
        return a.shape[1] - 10, a.shape[0] * 2 // 3
    x1 = cols.max()
    # 吊艙在最下面：只看底部 30%（尾翼會伸到一半高度以下，不能拿下半部整塊找）
    top = int(a.shape[0] * 0.70)
    lower = al[top:]
    lc = np.where(lower.any(0))[0]
    xr = lc.max() if len(lc) else x1
    ys = np.where(lower[:, max(xr - 6, 0):xr + 1].any(1))[0] + top
    return int(xr), int(ys.mean()) if len(ys) else a.shape[0] * 2 // 3


def do_bigscenes() -> None:
    h1 = HAZE['s1n']
    f = grade(fit(trim(clean(load('fire_arrow_fly'))), 420), h1, 0.2, 0.1)
    put('fire_arrow_fly', [f], {
        'stage': 's1', 'zone': '山賊寨入口', 'use': '飛行中的火箭（火矢），箭頭朝左；程式照拋物線飛、跟著速度方向轉',
        'layer': 'midfar 或 mid（背景深度，不扣血）', 'anchor': 'center', 'display': {'w': '70～110'},
        'alpha': 1.0, 'blend': 'normal', 'facing': 'left',
    })
    s = grade(fit(trim(clean(load('fire_arrow_stuck'))), 360), h1, 0.2, 0.12)
    fl = fitg(sheet_black('flame', 3, True, black=12, gain=1.2), 240)
    fl = align(fl, 'bottom')
    tip = find_rag(s)
    put('fire_arrow_stuck', [s], {
        'stage': 's1', 'zone': '山賊寨入口', 'use': '插在地上的火箭（沒有火），火焰另外疊 flame_1～3',
        'layer': 'mid（插在背景地面帶上，跟 mid 同速率）', 'anchor': 'bottom-center＝插地點',
        'display': {'h': '70～90（再小火焰就看不清）'}, 'alpha': 1.0, 'blend': 'normal',
        'flameAt': {'x': tip[0], 'y': tip[1], '說明': '火焰底部中心在這張圖裡的像素位置（原圖座標）'},
        'flameScale': round(s.shape[0] * 0.65 / fl[0].shape[0], 3),
    })
    put('flame', fl, {
        'stage': 's1', 'zone': '同上', 'use': '火箭上的火焰 3 格輪播（每格 0.08 秒），燒 3～6 秒後縮小熄滅',
        'layer': '同插地火箭', 'anchor': 'bottom-center＝fire_arrow_stuck 的 flameAt',
        'display': {'說明': '寬高＝原圖 × 火箭縮放 × flameScale'}, 'alpha': 0.95, 'blend': 'lighter 或 normal',
    })
    p = fitg(sheet_black('meteors', 2, False, black=10, gain=1.15), 520)
    put('meteors', p, {
        'stage': 's2', 'zone': '山頂神社（流星雨）', 'use': '流星 2 種（1 白藍細長、2 金色帶火星），往左下劃過',
        'layer': 'sky', 'anchor': 'center（頭在左下）', 'display': {'w': '140～260'},
        'alpha': 0.9, 'blend': 'lighter（加亮）', 'facing': '往左下（可左右翻）',
    })
    m = grade(fit(trim(clean(load('big_meteor'))), 900), HAZE['s2'], 0.22, 0.15)
    put('big_meteor', [m], {
        'stage': 's2', 'zone': '山頂神社（魔王前）', 'use': '大隕石劃過天空（頭在左下、尾巴拖到右上），落到遠山後接 impact_glow',
        'layer': 'sky', 'anchor': 'center', 'display': {'w': '200～280（再大就像要砸到玩家）'}, 'alpha': 0.92, 'blend': 'normal',
    })
    p = align(fitg(sheet_black('impact_glow', 4, True, black=10, gain=1.15), 420), 'bottom')
    put('impact_glow', p, {
        'stage': 's2', 'zone': '山頂神社', 'use': '遠山被砸中爆出的光團 4 格（閃光→光罩→火球蘑菇雲→餘光），每格 0.15 秒、第 4 格淡出 1 秒',
        'layer': 'far（畫在遠山那一層之後、midfar 之前，底部被近一點的山擋住）', 'anchor': 'bottom-center＝遠山稜線',
        'display': {'w': '160～260'}, 'alpha': 1.0, 'blend': 'lighter（加亮）',
    })
    p = [grade(x, HAZE['s3'], 0.12, 0.08) for x in fitg(sheet_alpha('scrap', 4, True), 200)]
    put('scrap', p, {
        'stage': 's3', 'zone': '工廠（鍛爐爆炸後）', 'use': '燒紅碎鐵 4 種（自帶往右上的火尾），像隕石一樣往左下砸',
        'layer': 'mid（在工廠背景前、角色後；不扣血）', 'anchor': 'center', 'display': {'h': '28～50'},
        'alpha': 1.0, 'blend': 'normal', 'facing': '往左下',
    })
    p = align([grade(x, HAZE['s3'], 0.18, 0.18) for x in fitg(sheet_alpha('forge_blast', 6, False), 520)], 'bottom')
    put('forge_blast', p, {
        'stage': 's3', 'zone': '工廠', 'use': '鍛爐爆炸 6 格（閃光→火球→黑煙→散去），每格 0.1 秒；同時噴出 scrap',
        'layer': 'mid（背景層：畫在工廠牆前、角色後）', 'anchor': 'bottom-center＝鍛爐爐口',
        'display': {'h': '220～280（大，但別蓋到球球頭上；模擬畫面用 250）'}, 'alpha': 0.8, 'blend': 'normal',
    })
    p = align(fitg(sheet_black('strike', 2, True, black=12, gain=1.2), 900), 'bottom')
    put('strike', p, {
        'stage': 's3', 'zone': '天守閣頂（魔王前）', 'use': '劈中屋脊的閃電 2 格（第 1 格劈中＋閃光 0.08 秒、第 2 格殘影 0.15 秒），配全畫面閃白',
        'layer': 'midfar（劈遠方天守閣的屋脊）', 'anchor': 'bottom-center＝劈中點（屋脊）',
        'display': {'h': '從畫面頂到劈中點，約 300～480'}, 'alpha': 1.0, 'blend': 'lighter（加亮）',
    })
    p = [grade(x, HAZE['s3r'], 0.2, 0.12) for x in fitg(sheet_alpha('ridge_chunks', 3, True), 320)]
    put('ridge_chunks', p, {
        'stage': 's3', 'zone': '天守閣頂', 'use': '斷掉的屋脊碎塊 3 塊（大段屋脊、幾片瓦、脊端飾瓦），劈中後往外噴、邊轉邊落',
        'layer': 'midfar（跟被劈的天守閣同一層）', 'anchor': 'center', 'display': {'w': '30～90'},
        'alpha': 1.0, 'blend': 'normal',
    })


def find_rag(a: np.ndarray) -> tuple[int, int]:
    """插地火箭上「還在悶燒的布團」：找最紅最亮的一團的中心。"""
    rgb = a[..., :3]
    score = (rgb[..., 0] - rgb[..., 2]) * (a[..., 3] > 128) * (rgb[..., 0] > 150)
    if score.max() <= 0:
        return a.shape[1] // 3, a.shape[0] * 2 // 3
    sm = cv2.GaussianBlur(score.astype(np.float32), (0, 0), 6)
    y, x = np.unravel_index(np.argmax(sm), sm.shape)
    return int(x), int(y)


VIDS_META = {   # Vids 參考圖（動畫由使用者在 Google Vids 做）：建議的遊戲顯示大小與層（照模擬畫面實測調過）
    'goose': ('s1', '黃昏山村～村尾', '人字雁（單隻，飛）：程式複製 5～7 隻排成人字', 'far／midfar（天空）', '身長 40～60'),
    'bat': ('s2', '夜祭街～河童川', '蝙蝠（單隻，飛）：程式複製成一群亂飛', 'midfar（天空）', '高 30～45'),
    'rice_cat': ('s1', '黃昏山村', '扛米袋的村貓，從背景走過', 'mid（走在 mid 長卷畫的民家前石台上，約 y 497）', '高 60～70'),
    'cart_cat': ('s1', '黃昏山村', '推小車的村貓', 'mid（同上）', '高 60～70'),
    'deer': ('s1', '竹林', '鹿：在遠處竹林、石燈籠間走、跳走', 'mid（竹林石燈籠台座附近，約 y 548）', '高 55～65'),
    'torch_bandit': ('s1', '山賊寨', '舉火把巡邏的山賊（瞭望台上、木柵後）', 'mid（瞭望台平台約 y 256）', '高 60～70'),
    'fox': ('s2', '往山頂神社', '狐狸：在石燈籠間跑', 'mid（石燈籠旁的矮樹叢上，約 y 530）', '高 40～50'),
    'carp': ('s2', '河童川', '鯉魚跳出水面（程式配水花）', 'mid（背景河面）', '身長 50～60'),
    'mech_soldier': ('s3', '機關城城下（城牆上）', '拿長槍行軍的機關貓兵，一排走過', 'mid（城牆頂約 y 152）', '高 45～55'),
}


def export() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    do_fog()
    do_rain()
    do_beams()
    do_small()
    do_storm_bits()
    do_heat()
    do_creatures()
    do_bigscenes()
    vids = {}
    for k, (st, zone, use, layer, disp) in VIDS_META.items():
        g = G.VIDS / f'{k}_參考圖_綠幕.png'
        vids[k] = {'stage': st, 'zone': zone, 'use': use, 'layer': layer, 'display': disp,
                   'greenRef': f'vids/ambient/{g.name}' if g.exists() else None,
                   'transparentRaw': f'art_raw/ambient/{pick(k).name}', 'facing': 'left'}
    data = {
        '_說明': (
            '天氣、背景生物、大場面（2026-09-27，tools/gen_ambient2.py 生、tools/post_ambient2.py 後製）。'
            '使用者裁定：大場面（火箭、隕石、碎鐵、閃電）只當背景熱鬧、不扣血，所以都畫得偏小、偏暗、帶霧色，放在遠景或中景層。'
            '每項 frames 是同一種東西的幾張（「種」＝隨機挑、「格」＝照順序播）。黑底生成的光效（霧、雨、光束、火花、流星、閃電、火焰、光團）'
            '已轉成帶半透明的透明圖，可直接用 alpha 疊；標 lighter／screen 的用加亮混合更好看。'
            'display 是建議的遊戲畫面大小（1280x720 畫面、球球 190 高、地面線 y≈596）。'
            '原圖、提示詞在 art_raw/ambient/（prompts.json），拼版總覽與每關模擬畫面在 art_raw/ambient/_check/。'),
        '_圖層': {
            'sky': '畫在 far 長卷之後、midfar 之前；貼畫面座標（不隨鏡頭捲或極慢）',
            'far': '同上位置，但跟著 far 的速率捲（黏在遠山上）',
            'midfar': '畫在 midfar 長卷之後、mid 之前，跟 midfar 速率捲',
            'mid': '畫在 mid 長卷之後、地形與角色之前；跟 mid 速率捲，標「速率 1.0」的是黏在地形上',
            'fore': '角色之後（擋在前面），速率 1.2～1.4',
            'overlay': '最後畫（HUD 之前），貼整個畫面',
        },
        'items': ITEMS,
        'vids_pending': {'_說明': '要用 Google Vids 動起來的背景生物：綠幕參考圖在 vids/ambient/，透明原圖在 art_raw/ambient/；'
                                  '動畫做好後再照 display 縮小、調暗（往這關霧色靠約 3 成、暗 3 成）當背景用。'
                                  '擺放：走路的腳底放在 mid 長卷畫出來的地面上（民家前石台、瞭望台、城牆頂、石燈籠台階，約 y 150～550），'
                                  '不要放在遊戲地面線（y≈596）上，否則看起來像小一號的敵人；飛的放在天空露出來的地方。'
                                  '模擬畫面 art_raw/ambient/_check/mock_*.png 用透明原圖示範了位置。', **vids},
    }
    JSON_OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(ITEMS)} 項 → {JSON_OUT}')


# ───────────────────────── 拼版總覽 ─────────────────────────
def font(sz: int) -> ImageFont.FreeTypeFont:
    for f in ('C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/mingliu.ttc'):
        if Path(f).exists():
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


STAGE_BG = {'s1': ('_ref_s1_full_2.png', 0.8), 's2': ('_ref_s2_full_2.png', 0.8), 's3': ('_ref_s3_full_1.png', 0.8),
            'all': ('_ref_s1_full_1.png', 0.8)}


def stage_of(meta: dict) -> str:
    return meta['stage'] if meta['stage'] in STAGE_BG else 'all'


def over(bg: np.ndarray, a: np.ndarray, x: int, y: int, alpha: float = 1.0, add: bool = False) -> None:
    """把 RGBA 貼到 RGB float 畫布（x,y＝左上角，可超出邊界）。"""
    H, W = bg.shape[:2]
    h, w = a.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    al = s[..., 3:4] / 255 * alpha
    if add:
        bg[y0:y1, x0:x1] = np.minimum(255, bg[y0:y1, x0:x1] + s[..., :3] * al)
    else:
        bg[y0:y1, x0:x1] = s[..., :3] * al + bg[y0:y1, x0:x1] * (1 - al)


def check() -> None:
    data = json.loads(JSON_OUT.read_text(encoding='utf-8'))
    items = data['items']
    CHECK.mkdir(parents=True, exist_ok=True)
    groups = {
        'A_天氣與氣氛': ['fog_s1_far', 'fog_s1_near', 'fog_s2_far', 'fog_s2_near', 'fog_s3_far', 'fog_s3_near',
                     'drizzle_1', 'drizzle_2', 'drizzle_3', 'storm_rain_1', 'storm_rain_2', 'storm_rain_3',
                     'sunbeam', 'moonbeam', 'fireflies', 'puddles', 'rice_fluff', 'paper_petals', 'ash', 'sparks',
                     'roof_splash', 'eave_drip', 'heat_haze'],
        'B_背景生物_靜態': ['kite', 'airship', 'propeller', 'bird_flocks'],
        'C_大場面': ['fire_arrow_fly', 'fire_arrow_stuck', 'flame', 'meteors', 'big_meteor', 'impact_glow', 'scrap',
                  'forge_blast', 'strike', 'ridge_chunks'],
    }
    f = font(22)
    for title, names in groups.items():
        rows = []
        for nm in names:
            meta = items[nm]
            st = stage_of(meta)
            ref = np.asarray(Image.open(G.TREF / STAGE_BG[st][0]).convert('RGB')).astype(np.float32) * 0.7
            frames = [np.asarray(Image.open(ART / fr['path']).convert('RGBA')).astype(np.float32) for fr in meta['frames']]
            n = len(frames)
            cellw = 1900 // max(n, 1) if n > 1 else 1900
            rowh = 300 if any(fr.shape[1] / fr.shape[0] > 2.5 for fr in frames) and n == 1 else 360
            canvas = np.zeros((rowh, 1900, 3), np.float32)
            # 背景：這關的畫面（左半），棋盤格（右半頂端小條）
            bgc = cv2.resize(ref, (1900, round(ref.shape[0] * 1900 / ref.shape[1])))
            canvas[:] = bgc[max(0, (bgc.shape[0] - rowh) // 2):][:rowh]
            add = 'lighter' in str(meta.get('blend', '')) or 'screen' in str(meta.get('blend', ''))
            if meta.get('tileX') and n == 1:
                # 可重複的（霧、雨、熱浪）：照建議 alpha 鋪滿整列，才看得出接縫與濃淡
                fr = frames[0]
                s = min(1.0, (rowh - 40) / fr.shape[0]) if not meta.get('tileY') else 0.5
                fr2 = resize(fr, max(1, round(fr.shape[1] * s)), max(1, round(fr.shape[0] * s)))
                for yy in range(34, rowh, fr2.shape[0] if meta.get('tileY') else rowh):
                    for xx in range(0, 1900, fr2.shape[1]):
                        if nm == 'heat_haze':
                            hh, ww = min(fr2.shape[0], rowh - yy), min(fr2.shape[1], 1900 - xx)
                            canvas[yy:yy + hh, xx:xx + ww] = fr2[:hh, :ww, :3]
                        else:
                            y0 = yy if meta.get('tileY') else rowh - fr2.shape[0]
                            over(canvas, fr2, xx, y0, float(meta.get('alpha', 1.0)), False)
                        # 接縫位置畫小記號
                        canvas[34:40, xx:xx + 2] = (255, 60, 60)
                frames = []
            for i, fr in enumerate(frames):
                s = min((cellw - 20) / fr.shape[1], (rowh - 50) / fr.shape[0], 1.5 if fr.shape[0] < 150 else 1.0)
                fr2 = resize(fr, max(1, round(fr.shape[1] * s)), max(1, round(fr.shape[0] * s)))
                x = i * cellw + (cellw - fr2.shape[1]) // 2
                y = 40 + (rowh - 40 - fr2.shape[0]) // 2
                if nm == 'heat_haze':
                    canvas[y:y + fr2.shape[0], x:x + fr2.shape[1]] = fr2[..., :3]
                else:
                    over(canvas, fr2, x, y, 1.0, add)
            im = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
            d = ImageDraw.Draw(im)
            d.rectangle((0, 0, 1900, 34), fill=(20, 20, 26))
            d.text((8, 4), f'{nm}：{meta["use"]}'[:90], font=f, fill=(255, 235, 170))
            rows.append(np.asarray(im))
        sheet = np.concatenate(rows, 0)
        Image.fromarray(sheet).save(CHECK / f'{title}.png')
        print(CHECK / f'{title}.png', sheet.shape)
    # Vids 參考圖
    vs = sorted(G.VIDS.glob('*_參考圖_綠幕.png'))
    if vs:
        cols = 3
        tiles = []
        for p in vs:
            im = Image.open(p).convert('RGB').resize((640, 360))
            d = ImageDraw.Draw(im)
            d.line((0, 325, 640, 325), fill=(255, 0, 0), width=1)   # 腳底線 y=650 縮一半
            d.text((6, 4), p.stem, font=f, fill=(0, 0, 0))
            tiles.append(np.asarray(im))
        while len(tiles) % cols:
            tiles.append(np.zeros_like(tiles[0]))
        grid = np.concatenate([np.concatenate(tiles[i:i + cols], 1) for i in range(0, len(tiles), cols)], 0)
        Image.fromarray(grid).save(CHECK / 'V_Vids參考圖.png')
        print(CHECK / 'V_Vids參考圖.png')


# ───────────────────────── 每關模擬畫面 ─────────────────────────
AJ = json.loads((ART / 'art.json').read_text(encoding='utf-8'))
TJ = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))


def panel_layer(stage: str, ly: str, cam: float) -> np.ndarray:
    c = np.zeros((VH, VW, 4), np.float32)
    P = AJ['panels'][stage]
    off = cam * P[ly]['rate']
    for it in P[ly]['items']:
        if it['x'] + it['w'] < off or it['x'] > off + VW:
            continue
        a = np.asarray(Image.open(ART / it['path']).convert('RGBA')).astype(np.float32)
        x = int(round(it['x'] - off))
        x0, x1 = max(0, x), min(VW, x + a.shape[1])
        s = a[:, x0 - x:x1 - x]
        al = s[..., 3:4] / 255
        c[:, x0:x1, :3] = s[..., :3] * al + c[:, x0:x1, :3] * (1 - al)
        c[:, x0:x1, 3:] = np.maximum(c[:, x0:x1, 3:], s[..., 3:4])
    return c


def ground(canvas: np.ndarray, zone: str, x_off: int = 0) -> None:
    g = TJ['ground'][zone]
    img = np.asarray(Image.open(ART / g['path']).convert('RGBA')).astype(np.float32)
    top = GROUND - g['standY']
    bc = tuple(int(g['bottomColor'][i:i + 2], 16) for i in (1, 3, 5))
    canvas[top + g['h'] - 2:] = bc
    for u in range(-x_off % g['w'] - g['w'], VW, g['w']):
        over(canvas, img, u, top)


def qiuqiu(canvas: np.ndarray, x: int) -> None:
    im = np.asarray(Image.open(ROOT / 'public/sprites/qiuqiu/idle/00.webp').convert('RGBA')).astype(np.float32)
    ys, xs = np.where(im[..., 3] > 40)
    im = im[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    s = 190 / im.shape[0]
    im = resize(im, round(im.shape[1] * s), 190)
    over(canvas, im, x - im.shape[1] // 2, GROUND - 190 + 4)


def fr(name: str, i: int = 0) -> np.ndarray:
    meta = json.loads(JSON_OUT.read_text(encoding='utf-8'))['items'][name]
    return np.asarray(Image.open(ART / meta['frames'][i]['path']).convert('RGBA')).astype(np.float32)


def sized(a: np.ndarray, w: float | None = None, h: float | None = None, rot: float = 0, flip: bool = False) -> np.ndarray:
    s = (w / a.shape[1]) if w else (h / a.shape[0])
    b = resize(a, max(1, round(a.shape[1] * s)), max(1, round(a.shape[0] * s)))
    if flip:
        b = b[:, ::-1].copy()
    if rot:
        im = Image.fromarray(np.clip(b, 0, 255).astype(np.uint8), 'RGBA').rotate(rot, expand=True, resample=Image.BICUBIC)
        b = np.asarray(im).astype(np.float32)
    return b


def put_c(canvas, a, cx, cy, alpha=1.0, add=False):
    over(canvas, a, int(cx - a.shape[1] / 2), int(cy - a.shape[0] / 2), alpha, add)


def put_b(canvas, a, cx, by, alpha=1.0, add=False):
    over(canvas, a, int(cx - a.shape[1] / 2), int(by - a.shape[0]), alpha, add)


def tile_overlay(canvas, a, alpha, ox=0, oy=0):
    h, w = a.shape[:2]
    for y in range(-(oy % h), VH, h):
        for x in range(-(ox % w), VW, w):
            over(canvas, a, x, y, alpha)


def fog_band(canvas, name, y, alpha, ox=0, near=False):
    a = fr(name)
    w = a.shape[1]
    for x in range(-(ox % w), VW, w):
        over(canvas, a, x, (y - a.shape[0]) if near else (y - a.shape[0] // 2), alpha)


def creature(name: str, h: float, haze: tuple, amount: float, dark: float, flip: bool = False) -> np.ndarray:
    """Vids 還沒做，模擬畫面先拿透明原圖縮小、調暗當背景角色。"""
    a = clean(np.asarray(Image.open(pick(name)).convert('RGBA')).astype(np.float32), 24)
    a = trim(a, 24)
    a = sized(a, h=h, flip=flip)
    return grade(a, haze, amount, dark, keep_glow=True)


def scene(stage: str, cam: float, zone: str, before_mid=None, after_mid=None, after_far=None, after_midfar=None,
          after_ground=None, overlay=None, qx: int = 430, heat=None) -> np.ndarray:
    c = panel_layer(stage, 'far', cam)[..., :3].copy()
    if after_far:
        after_far(c)
    m = panel_layer(stage, 'midfar', cam)
    over(c, m, 0, 0)
    if after_midfar:
        after_midfar(c)
    mid = panel_layer(stage, 'mid', cam)
    over(c, mid, 0, 0)
    if after_mid:
        after_mid(c)
    if heat is not None:
        c = heat(c)
    ground(c, zone, int(cam))
    if after_ground:
        after_ground(c)
    qiuqiu(c, qx)
    if overlay:
        overlay(c)
    return c


def save_mock(c: np.ndarray, name: str, title: str) -> None:
    im = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, VW, 30), fill=(0, 0, 0))
    d.text((8, 3), title, font=font(20), fill=(255, 240, 180))
    CHECK.mkdir(parents=True, exist_ok=True)
    im.save(CHECK / f'{name}.png')
    print(CHECK / f'{name}.png')


def mock() -> None:
    """每關 3～4 張模擬畫面。鏡頭位置與擺放座標是看過 grid 圖挑的：背景生物站在 mid 長卷畫出來的台階、城牆、瞭望台上，
    不站在遊戲地面線（596）上，免得看起來像小一號的敵人。"""
    random.seed(7)
    H1, H1n, H2, H3, H3r = HAZE['s1'], HAZE['s1n'], HAZE['s2'], HAZE['s3'], HAZE['s3r']
    items = json.loads(JSON_OUT.read_text(encoding='utf-8'))['items']

    # ── 第一關 ──
    def s1a_far(c):
        put_c(c, sized(fr('bird_flocks', 0), w=150), 430, 120, 0.85)
        put_c(c, sized(fr('bird_flocks', 2), w=120), 1090, 70, 0.8)

    def s1a_mid(c):
        put_b(c, creature('rice_cat', 64, H1, 0.28, 0.3), 720, 497)
        put_b(c, creature('cart_cat', 64, H1, 0.28, 0.3), 880, 497)

    def s1a_over(c):
        over(c, sized(fr('sunbeam'), w=1280), 0, 0, 0.4, add=True)
        for _ in range(16):
            put_c(c, sized(fr('rice_fluff', random.randrange(4)), h=random.uniform(14, 26), rot=random.uniform(0, 360)),
                  random.uniform(0, VW), random.uniform(120, 620), 0.95)
    save_mock(scene('s1', 3000, 'village', after_far=s1a_far, after_mid=s1a_mid, overlay=s1a_over),
              'mock_s1_1_黃昏山村', '第一關 黃昏山村：夕陽光束＋稻穗飛絮＋遠方人字雁群＋扛米袋、推車村貓（走在民家前的石台上）')

    def s1b_midfar(c):
        fog_band(c, 'fog_s1_far', 400, 0.55)

    def s1b_mid(c):
        put_b(c, creature('deer', 60, H1n, 0.35, 0.35), 1065, 548)
        fog_band(c, 'fog_s1_near', GROUND + 40, 0.6, ox=300, near=True)

    def s1b_ground(c):
        for x, k, w in ((250, 1, 140), (760, 2, 200), (1130, 0, 90)):
            put_c(c, sized(fr('puddles', k), w=w), x, GROUND + 3, 0.85)

    def s1b_over(c):
        for i, al in ((1, 0.35), (2, 0.45), (3, 0.55)):
            tile_overlay(c, fr(f'drizzle_{i}'), al, ox=i * 97, oy=i * 131)
    save_mock(scene('s1', 11500, 'bamboo', after_midfar=s1b_midfar, after_mid=s1b_mid, after_ground=s1b_ground,
                    overlay=s1b_over), 'mock_s1_2_竹林毛毛雨', '第一關 竹林中段：兩層霧帶＋毛毛雨三層＋地上水窪＋石燈籠旁的鹿')

    def s1c_mid(c):
        fog_band(c, 'fog_s1_near', GROUND + 40, 0.5, ox=900, near=True)
        for _ in range(16):
            k = random.randrange(3, 6) if random.random() < 0.5 else random.randrange(3)
            put_c(c, sized(fr('fireflies', k), h=random.uniform(14, 34)), random.uniform(0, VW),
                  random.uniform(300, 580), 0.9, add=True)
    save_mock(scene('s1', 12400, 'bamboo', after_midfar=lambda c: fog_band(c, 'fog_s1_far', 400, 0.5, ox=500),
                    after_mid=s1c_mid), 'mock_s1_3_竹林雨停螢火蟲', '第一關 竹林：雨停後螢火蟲（閃爍三格＋光點）＋霧帶')

    def s1d_mid(c):
        # 寨裡射出來的火箭：飛過木柵上空、往左下掉
        for x, y, w, r in ((760, 150, 100, -20), (880, 110, 90, -12), (1010, 190, 95, -26), (560, 300, 90, -34)):
            put_c(c, sized(fr('fire_arrow_fly'), w=w, rot=r), x, y)
        stuck = fr('fire_arrow_stuck')
        meta = items['fire_arrow_stuck']
        for x, h, k in ((260, 80, 0), (720, 72, 1), (900, 84, 2)):
            s = h / stuck.shape[0]
            a = sized(stuck, h=h)
            by = 572
            put_b(c, a, x, by)
            fl = fr('flame', k)
            f2 = sized(fl, h=fl.shape[0] * s * meta['flameScale'])
            fx = x - a.shape[1] / 2 + meta['flameAt']['x'] * s
            fy = by - a.shape[0] + meta['flameAt']['y'] * s
            put_b(c, f2, fx, fy + 6, 0.95, add=True)
        put_b(c, creature('torch_bandit', 64, H1n, 0.3, 0.3), 585, 256)
        put_c(c, sized(fr('bird_flocks', 1), w=120), 300, 110, 0.8)
    save_mock(scene('s1', 17000, 'bandit', after_mid=s1d_mid), 'mock_s1_4_山賊寨火箭',
              '第一關 山賊寨入口：寨裡射來火箭、插在背景地上燃燒（不扣血）＋瞭望台上舉火把巡邏的山賊')

    # ── 第二關 ──
    def s2a_midfar(c):
        for x, y, h, fl in ((620, 120, 44, False), (700, 90, 34, True), (770, 140, 40, False), (1180, 60, 30, True)):
            put_c(c, creature('bat', h, H2, 0.15, 0.15, flip=fl), x, y)

    def s2a_over(c):
        for _ in range(20):
            put_c(c, sized(fr('paper_petals', random.randrange(4)), h=random.uniform(16, 30), rot=random.uniform(0, 360)),
                  random.uniform(0, VW), random.uniform(80, 640))
    save_mock(scene('s2', 2600, 's2_street', after_midfar=s2a_midfar, overlay=s2a_over), 'mock_s2_1_夜祭街',
              '第二關 夜祭燈籠街：飄落紙花瓣＋煙火旁的蝙蝠')

    def s2b_midfar(c):
        fog_band(c, 'fog_s2_far', 470, 0.55)

    def s2b_mid(c):
        fog_band(c, 'fog_s2_near', GROUND + 40, 0.55, ox=400, near=True)
        put_c(c, creature('carp', 56, H2, 0.3, 0.3), 1000, 530)
        for _ in range(10):
            put_c(c, sized(fr('fireflies', random.randrange(6)), h=random.uniform(14, 30)), random.uniform(0, VW),
                  random.uniform(350, 580), 0.9, add=True)

    def s2b_over(c):   # 月亮在右上：光束左右翻過來
        over(c, sized(fr('moonbeam'), w=1280, flip=True), 0, 0, 0.35, add=True)
    save_mock(scene('s2', 9800, 's2_bank', after_midfar=s2b_midfar, after_mid=s2b_mid, overlay=s2b_over),
              'mock_s2_2_河童川', '第二關 河童川：河面起霧兩層＋月光光束（翻向月亮）＋鯉魚跳出水面＋螢火蟲')

    def s2c_far(c):
        put_c(c, sized(fr('meteors', 0), w=220), 420, 150, 0.9, add=True)
        put_c(c, sized(fr('meteors', 1), w=180), 1120, 80, 0.9, add=True)
        put_c(c, sized(fr('big_meteor'), w=240), 860, 110, 0.92)
        put_b(c, sized(fr('impact_glow', 2), w=200), 640, 430, 0.9, add=True)

    def s2c_mid(c):
        put_b(c, creature('fox', 44, H2, 0.3, 0.3), 900, 530)
    save_mock(scene('s2', 15800, 's2_shrine', after_far=s2c_far, after_mid=s2c_mid), 'mock_s2_3_神社流星',
              '第二關 往山頂神社：流星兩種＋大隕石劃過＋遠處爆光團（不扣血）＋石燈籠邊的狐狸')

    # ── 第三關 ──
    def s3a_midfar(c):
        fog_band(c, 'fog_s3_far', 330, 0.5)
        put_c(c, sized(fr('kite'), w=130, rot=8), 260, 60)
        a = fr('airship')
        meta = items['airship']
        w = 200
        s = w / a.shape[1]
        ax, ay = 640, 110
        put_c(c, sized(a, w=w), ax, ay)
        p = fr('propeller', 0)
        put_c(c, sized(p, h=p.shape[0] * s * meta['propellerScale']), ax - w / 2 + meta['propellerAt']['x'] * s,
              ay - a.shape[0] * s / 2 + meta['propellerAt']['y'] * s)
        put_c(c, sized(fr('bird_flocks', 1), w=100), 480, 40, 0.7)

    def s3a_mid(c):
        fog_band(c, 'fog_s3_near', GROUND + 40, 0.5, ox=200, near=True)
        for i in range(3):
            put_b(c, creature('mech_soldier', 50, H3, 0.3, 0.3), 1050 + i * 40, 152)

    def s3a_over(c):
        for _ in range(18):
            put_c(c, sized(fr('ash', random.randrange(4)), h=random.uniform(12, 24), rot=random.uniform(0, 360)),
                  random.uniform(0, VW), random.uniform(60, 640), 0.9)
    save_mock(scene('s3', 0, 's3_town', after_midfar=s3a_midfar, after_mid=s3a_mid, overlay=s3a_over),
              'mock_s3_1_機關城城下', '第三關 城下：煙霧兩層＋灰燼＋機關風箏＋小飛艇（在城牆後）＋城牆上行軍的機關貓兵')

    hh = np.asarray(Image.open(OUT / 'heat_haze.png')).astype(np.float32)

    def s3b_heat(c):
        H = np.tile(hh, (2, 3))[:VH, :VW]
        dx = (H - 128) / 128 * 3
        dy = (H - 128) / 128 * 1.5
        yy, xx = np.mgrid[0:VH, 0:VW].astype(np.float32)
        m = np.zeros((VH, VW), np.float32)
        m[60:420, 480:900] = 1
        m = cv2.GaussianBlur(m, (0, 0), 30)
        return cv2.remap(c.astype(np.float32), xx + dx * m, yy + dy * m, cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_REFLECT)

    def s3b_mid(c):
        put_b(c, sized(fr('forge_blast', 2), h=250), 630, 370, 0.8)
        for x, y, h, k in ((820, 130, 40, 0), (930, 80, 32, 1), (1040, 200, 36, 2), (760, 60, 28, 3)):
            put_c(c, sized(fr('scrap', k), h=h), x, y)

    def s3b_over(c):
        for _ in range(12):
            put_c(c, sized(fr('sparks', random.randrange(4)), h=random.uniform(24, 56)), random.uniform(300, 1100),
                  random.uniform(80, 560), 1.0, add=True)
    save_mock(scene('s3', 11000, 's3_grate', after_mid=s3b_mid, overlay=s3b_over, heat=s3b_heat, qx=300),
              'mock_s3_2_工廠鍛爐爆炸', '第三關 工廠：鍛爐爆炸（從背景爐口噴出）＋燒紅碎鐵砸下（不扣血）＋火花雨＋爐口上方熱浪扭曲')

    def s3c_midfar(c):
        put_b(c, sized(fr('strike', 0), h=330), 1000, 216, 1.0, add=True)
        for k, (x, y, w, r) in enumerate(((955, 180, 62, 25), (1065, 150, 40, -40), (1025, 245, 32, 70))):
            put_c(c, sized(fr('ridge_chunks', k), w=w, rot=r), x, y)
        put_c(c, sized(fr('bird_flocks', 1), w=100), 1170, 110, 0.7)

    def s3c_ground(c):
        for x in (180, 520, 700, 1000, 1210):
            put_b(c, sized(fr('roof_splash', random.randrange(3)), h=random.uniform(36, 56)), x, GROUND + 4, 0.85)

    def s3c_mid(c):
        for x, top in ((640, 486), (520, 470)):
            put_b(c, sized(fr('eave_drip', 0), h=90), x, top + 90, 0.8)

    def s3c_over(c):
        for i, al in ((1, 0.4), (2, 0.45), (3, 0.35)):
            tile_overlay(c, fr(f'storm_rain_{i}'), al, ox=i * 111, oy=i * 173)
    save_mock(scene('s3', 18600, 's3_roof', after_midfar=s3c_midfar, after_mid=s3c_mid, after_ground=s3c_ground,
                    overlay=s3c_over), 'mock_s3_3_天守閣頂暴風雨',
              '第三關 天守閣頂：狂風暴雨三層＋屋瓦濺水＋屋簷滴水＋閃電劈中遠方天守閣屋脊（碎塊噴飛）')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'export'
    {'export': export, 'check': check, 'mock': mock}[cmd]()
