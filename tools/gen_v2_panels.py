"""第二版（2026-09-28）背景長卷「中間插段」：每關中景 +8、中遠景 +2、最遠景 +1，插在原本兩張之間。

做法（全部在遊戲的 720 高度上算）：
  舊長卷＝public/art/bg/s{關}/{層}_NN.webp 接起來。插在第 b 張和第 b+1 張之間（邊界 B）。
  第 1 張：畫布 2160x720，左 720 欄＝舊長卷在 B 之前的最後 720 欄，右邊灰色 → Codex 往右畫。
  第 k 張：左 720 欄＝目前插段的最後 720 欄。
  橋接：左 720 欄＝插段在「剛好湊滿 N 張寬」處之前的 720 欄、右 720 欄＝舊第 b+1 張的開頭 720 欄、中間灰色 → Codex 補中間。
  接縫：跟 gen_panels 一樣 ECC 對位＋調色＋最小差異切線羽化；右邊接縫用平移對位、在中間三分之一漸進位移。
  結果：舊第 b 張（右端 720 欄被接縫改過）→ 新檔、插入 N 張、舊第 b+1 張（左端 720 欄改過）→ 新檔；其他舊檔不動。

  python tools/gen_v2_panels.py gen s1_mid_B            生這一段下一張還沒生的（前進張或橋接），自動檢查不合格重生（最多 3 次）
  python tools/gen_v2_panels.py run s1_mid_A s1_mid_B   一段一段生到完（多段並行）
  python tools/gen_v2_panels.py run all
  python tools/gen_v2_panels.py check s1_mid_B          組起來、存接縫放大圖
  python tools/gen_v2_panels.py export                  輸出 public/art/v2/bg/…＋v2_panels.json（給 v2.json 用）
原檔在 art_raw/v2/panels/，art_raw/v2/panels/picks.json 可指定用第幾次（{"s1_mid_B3": 2}）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'v2' / 'panels'
CHECK = RAW / '_check'
PICKS = RAW / 'picks.json'
LOG = RAW / 'prompts.json'
ART = ROOT / 'public' / 'art'
OUT = ART / 'v2'
H = 720
OV = 720
W = 2160
_LOCK = threading.Lock()
SLICE_W = {'far': 1680, 'midfar': 1620, 'mid': 1530}

STYLE = gp.STYLE
NO_CHAR = gp.NO_CHAR
MID_BAND = gp.MID_BAND
MID_H = gp.MID_H
MID_SKY_NEXT = gp.MID_SKY_NEXT
TALL_OK = ('Tall cliffs, rock walls and the waterfall may rise out of the top of the picture, but leave some empty '
           'transparent gaps above the lower parts.')
TALL_CASTLE = ('The castle walls and stacked roofs may rise out of the top of the picture, but leave some empty '
               'transparent gaps above the lower roofs.')

BRIDGE_HEAD = (
    'The input image is one wide panel of the {what} of a 2D side-scrolling game, in ' + STYLE + '. Its LEFT THIRD '
    'and its RIGHT THIRD already contain finished artwork (two parts of the same long scenery). Keep BOTH of them '
    'EXACTLY as they are: the same objects at the same positions, the same size and scale, the same colours, '
    'lighting and outlines. The MIDDLE THIRD is still EMPTY (flat grey placeholder) and must be painted now so that '
    'the scenery flows continuously from the left third through the middle into the right third, with no visible '
    'join at either boundary; everything that touches a boundary continues naturally across it. New content for '
    'the middle part: {scene}. ')
BRIDGE = {
    'far': BRIDGE_HEAD + ('The sky colours change GRADUALLY across the middle from the colours of the left third to '
                          'the colours of the right third. Same horizon height and level of detail. Only sky and the '
                          'farthest pale hazy mountains or clouds; NO buildings, NO trees, NO ground. ' + NO_CHAR +
                          ' No grey placeholder may remain.'),
    'midfar': BRIDGE_HEAD + ('Lighting and haze change gradually from the left third to the right third. Only distant '
                             'scenery, small and hazy, with a continuous misty band down to the bottom edge; '
                             'everything above it stays completely EMPTY and TRANSPARENT like the left and right '
                             'thirds (NO sky, NO clouds, NO sun, NO moon). ' + NO_CHAR + ' No grey placeholder may '
                             'remain.'),
    'mid': BRIDGE_HEAD + ('Lighting changes gradually from the left third to the right third. Same pure side view, '
                          'same horizon height, same scale and level of detail. {height} The bottom 28% of the '
                          'picture stays ground-level scenery ({band}), darker than the scenery above, continuing the '
                          'bands of the left and right thirds across the whole width, with NO hard horizon line and NO '
                          'floor line. Everything behind the scenery (sky and distant landscape) stays completely '
                          'EMPTY and TRANSPARENT like the left and right thirds. ' + NO_CHAR + ' No grey placeholder '
                          'may remain.'),
}
BRIDGE_INDOOR = (' This part is {io}: the dark riveted iron back wall fills the whole middle from top to bottom, NOTHING '
                 'is transparent there.')

# ── 插段定義：after＝插在舊第幾張之後、n＝插入幾張（湊滿舊張寬）、panels＝往右畫的每一張、bridge＝最後補中間那張 ──
INSERTS: dict[str, dict] = {
    # ───────── 第一關 ─────────
    's1_mid_A': dict(after=4, n=3, zh='梯田坡道', panels=[
        dict(scene='the village road leaves the stream and climbs into TERRACED RICE FIELDS on a hillside: tiers of '
                   'golden rice paddies held up by old mossy dry-stone retaining walls stepping UP toward the right, '
                   'narrow earthen paths between the tiers, a small thatched field hut, round straw haystacks, a '
                   'wooden water wheel feeding a split-bamboo irrigation flume',
             light='orange-pink sunset light from the left, long soft shadows, colours a little pinker than the left third',
             band='dark grass, weeds, mossy terrace stones and earth'),
        dict(scene='higher up the terraced slope: two old thatched-roof farmhouses standing on terrace platforms with '
                   'stone foundation walls, wooden drying racks (hasa-gake) hung with sheaves of rice, a persimmon tree '
                   'full of orange fruit, a small stone jizo statue with a faded red bib, a stone stairway between the '
                   'terraces', light='orange-pink sunset light, slowly getting pinker',
             band='dark grass, weeds, mossy terrace stones and earth'),
        dict(scene='the top of the terraces: the last paddies and a small wooden mountain shrine gate of plain wood, '
                   'tall old cedar trees, clumps of pampas grass, a weathered wooden signpost with no writing, the '
                   'first young bamboo stalks appearing at the right', light='pink sunset light turning a little purple',
             band='dark grass, ferns, mossy stones and earth'),
    ], bridge=dict(scene='the terraces give way to the edge of the bamboo forest: scattered young bamboo, ferns, a mossy '
                         'stone path marker, pampas grass', band='dark grass, ferns, fallen leaves and earth')),
    's1_mid_B': dict(after=6, n=5, zh='山溪瀑布與山路', panels=[
        dict(scene='leaving the bamboo forest into a rocky MOUNTAIN STREAM GORGE: huge mossy boulders, the last bamboo '
                   'stalks, steep rock walls starting to rise on the right, ferns and hanging moss, a shallow stream '
                   'glinting between the rocks', light='purple twilight, cool blue-purple shadows, a faint pink glow from '
                   'the left, fireflies', band='wet dark rocks, ferns, moss and pebbles', height=TALL_OK),
        dict(scene='a BIG WATERFALL: a tall cliff of dark wet layered rock in the middle distance with a wide white '
                   'waterfall pouring down from the top of the picture into a misty plunge pool, spray and mist '
                   'glowing, wet rock ledges stepping up beside the falls, long hanging vines and ferns on the cliff '
                   'face, twisted pines clinging to the rock', light='blue-purple twilight, the falling water and mist '
                   'catch a soft silver-violet glow, fireflies', band='wet dark rocks, ferns, moss and the mist of the '
                   'plunge pool', height=TALL_OK),
        dict(scene='beside the waterfall: stacked layered rock ledges and a second smaller cascade tumbling over them, an '
                   'old rope-and-plank footbridge high up between two rock pillars, a tiny stone shrine with a stone '
                   'lantern on a ledge, hanging vines, ferns and moss', light='blue-purple twilight with silver mist '
                   'glow, fireflies', band='wet dark rocks, ferns, moss and pebbles', height=TALL_OK),
        dict(scene='a narrow MOUNTAIN ROAD along the foot of a cliff: a dirt path edged with old wooden guard posts and '
                   'rope, wind-bent pine trees, a weathered stone jizo statue, rocky outcrops, a steep hillside rising '
                   'on the right, far torch lights of the bandit fortress appearing at the right end',
             light='deep blue-purple dusk turning to evening, cool shadows, a few warm torch dots',
             band='rocks, roots, dark bushes and earth'),
        dict(scene="the mountain road near the bandits' fortress: a tall rickety wooden LADDER leaning against a rock "
                   'face up to a small wooden lookout platform with a burning torch, a rope bridge, stacked logs, '
                   'sharpened wooden stakes, plain torn cloth banners (no writing), barrels',
             light='dark purple-blue evening, torches cast warm orange light, cool blue shadows',
             band='rocks, rough logs, trampled bushes and dark earth'),
    ], bridge=dict(scene='the last stretch before the palisade wall: rocks, piled logs, sharpened stakes, a torch post',
                   band='rocks, rough logs, trampled bushes and dark earth')),
    's1_midfar_A': dict(after=1, n=1, zh='遠方梯田山坡', panels=[
        dict(scene='distant terraced hillsides: rows of tiny rice terraces climbing the far hills, a few far farmhouses '
                   'with thin smoke, pine groves', light='golden-orange dusk light turning orange-pink, purple haze'),
    ], bridge=dict(scene='distant forested hills and terraces')),
    's1_midfar_B': dict(after=3, n=1, zh='遠方瀑布山谷', panels=[
        dict(scene='distant steep mountains with a tall thin far WATERFALL falling down a cliff into a misty gorge, '
                   'rocky ridges covered with pine and bamboo', light='pink-purple twilight haze turning blue-purple'),
    ], bridge=dict(scene='distant rocky ridges and far forest in mist')),
    's1_far_A': dict(after=2, n=1, zh='晚霞轉暮色', panels=[
        dict(scene='the afterglow of the sunset: long bands of pink and violet clouds lit from below, the sky getting '
                   'deeper purple toward the top, far misty mountain silhouettes',
             sky='from the red-orange and pink sunset of the left third to pink-violet afterglow at the right end'),
    ], bridge=dict(scene='violet afterglow clouds over far mountain silhouettes')),

    # ───────── 第二關 ─────────
    's2_mid_A': dict(after=3, n=3, zh='燈籠坂', panels=[
        dict(scene='a steep old stone-paved SLOPE STREET (saka) climbing up toward the right between old two-storey '
                   'wooden shop houses with dark tiled roofs and wooden lattices, rows of glowing red and white paper '
                   'lanterns hanging along both sides of the slope, stone steps at the side, plain festival banners on '
                   'poles (no writing)', light='night, warm red-orange lantern glow, cool silver moonlight from the upper '
                   'right, deep blue-purple shadows', band='low stone walls, dark bushes, gravel and earth'),
        dict(scene='the top of the lantern slope: a tall wooden lantern tower hung with dozens of glowing lanterns, a '
                   'small food stall with a red awning, an old gnarled pine tree propped with wooden crutches, a stone '
                   'lantern, paper streamers', light='night, bright warm lantern light and cool moonlight',
             band='low stone walls, dark bushes, gravel and earth'),
        dict(scene='the street goes DOWN the other side of the hill toward the river: stone retaining walls, strings of '
                   'lanterns sagging downhill, the first weeping willow trees, a small wooden gate, stone steps',
             light='the lantern glow slowly thins and cool silver-blue moonlight takes over',
             band='low stone walls, dark bushes, gravel and earth'),
    ], bridge=dict(scene='willow trees, a few lanterns and mossy stone lanterns leading to the river embankment',
                   band='low stone walls, dark bushes, gravel and wet stones')),
    's2_mid_B': dict(after=6, n=5, zh='河童瀑布', panels=[
        dict(scene='UPSTREAM of the swamp the river enters a rocky gorge: huge dark mossy boulders, foaming rapids, '
                   'cattails, twisted trees with hanging moss, a tiny weathered wooden roadside shrine with cucumbers '
                   'as offerings, fireflies', light='eerie moonlit night, blue-green mist, fireflies',
             band='dark wet rocks, reeds, moss and rushing water', height=TALL_OK),
        dict(scene='a big moonlit WATERFALL: tall black wet cliffs in the middle distance with a wide silver-blue '
                   'waterfall pouring down from the top of the picture into a misty plunge pool, the falling water '
                   'glowing in the moonlight, wet rock ledges stepping up beside the falls, long hanging vines, ferns',
             light='moonlit night, cool silver-blue light on the water and mist, deep blue-black shadows',
             band='dark wet rocks, reeds and the mist of the plunge pool', height=TALL_OK),
        dict(scene='beside the waterfall: layered rock ledges with a small red torii gate in front of a dark cave '
                   'mouth, candle lanterns flickering on the ledges, a smaller cascade, hanging vines and moss',
             light='moonlit night with silver mist, warm candle glow', band='dark wet rocks, moss and pebbles',
             height=TALL_OK),
        dict(scene='above the gorge: a dark forest of huge old cedar trees, mossy stone lanterns glowing, the first red '
                   'and orange maple trees, a stone path climbing gently toward the right, a small stream',
             light='moonlit night, warm stone lantern glow, red maple leaves', band='mossy stones, dark bushes and earth'),
        dict(scene='the foot of the shrine mountain: a giant sacred cedar tree wrapped with a thick straw rope and white '
                   'paper streamers, a row of stone lanterns, a small red torii, red maple trees with falling leaves',
             light='moonlit night, warm lantern glow, red maple leaves', band='mossy stone walls, dark bushes and earth'),
    ], bridge=dict(scene='mossy rocks, maple trees and stone lanterns leading to the foot of the shrine stairs',
                   band='mossy stone walls, dark bushes and earth')),
    's2_midfar_A': dict(after=1, n=1, zh='遠方燈籠坡', panels=[
        dict(scene='a distant hillside town at night: lantern-lit streets climbing the far hill in zigzags, rooftops '
                   'with strings of tiny glowing lanterns, a far pagoda', light='night, warm lantern glow from below, '
                   'blue-purple haze'),
    ], bridge=dict(scene='distant rooftops with strings of tiny lanterns in blue haze')),
    's2_midfar_B': dict(after=3, n=1, zh='遠方月下瀑布', panels=[
        dict(scene='distant dark mountains with a tall far WATERFALL shining silver in the moonlight, misty gorges, '
                   'cedar forests', light='cool silver-blue moonlit haze'),
    ], bridge=dict(scene='distant dark forested ridges in blue mist')),
    's2_far_A': dict(after=2, n=1, zh='月光雲海', panels=[
        dict(scene='a moonlit sea of silver clouds drifting over far dark mountains, many stars, the moonlight '
                   'catching the cloud edges (the moon itself is NOT in this part)',
             sky='from the calm navy moonlit sky of the left third to a slightly deeper navy'),
    ], bridge=dict(scene='drifting silver clouds and stars above far dark mountains')),

    # ───────── 第三關 ─────────
    's3_mid_A': dict(after=4, n=3, zh='冷卻水道', panels=[
        dict(scene='INSIDE a huge COOLING WATER hall of the mechanical castle: giant riveted iron water channels and '
                   'aqueduct troughs on iron trestles, cold blue-grey water pouring out of big round pipe outlets, '
                   'pumps with pistons, iron grating catwalks with railings, dripping water, blue work lamps',
             light='cold blue-grey light with warm orange lamp spots, wet shining metal',
             band='dark iron plates, pipes and wet machinery bases', sky=gp.INDOOR_SKY, height=gp.INDOOR_H),
        dict(scene='INSIDE: a tall IRON COOLING WATERFALL: water cascading down a stepped riveted iron spillway wall '
                   'from high up into a channel below, clouds of white steam, iron beams, hanging chains, a vertical '
                   'shaft with iron ladders, yellow-and-black hazard stripes, warning lamps',
             light='cold steel-blue light, white steam glowing, warm orange lamp spots',
             band='dark iron plates, pipes and wet machinery bases', sky=gp.INDOOR_SKY, height=gp.INDOOR_H),
        dict(scene='INSIDE: big iron water wheels and pump machinery turning, thick pipes rising, the air getting hotter '
                   'toward the right with the first orange furnace glow, chains and hooks, coal carts',
             light='cold blue-grey light slowly turning to hot orange toward the right end',
             band='dark iron plates, pipes and machinery bases', sky=gp.INDOOR_SKY, height=gp.INDOOR_H),
    ], bridge=dict(scene='pipes and iron machinery glowing more and more orange toward the forge',
                   band='dark iron plates, pipes and machinery bases'), indoor='INDOORS'),
    's3_mid_B': dict(after=6, n=5, zh='天守閣外牆', panels=[
        dict(scene='just after the left third, the iron wall of the shaft ends in a broken jagged edge of torn iron '
                   'plates; to the right of it we are OUTSIDE at the foot of the castle keep: the white plaster walls '
                   'with black wooden beams and iron reinforcement plates of the keep rise up, a stone base (ishigaki), '
                   'brass gear machinery bolted onto the wall, iron lamps',
             light='outside: cold blue-purple stormy light, wet shining surfaces with white highlights, warm lamp glow',
             band='dark wet stone blocks and roof tiles',
             sky='Outside (to the right of the broken wall edge) everything behind the scenery is completely EMPTY and '
                 'TRANSPARENT: do NOT paint any sky, clouds, rain, lightning or distant buildings there.',
             height=TALL_CASTLE),
        dict(scene='the OUTER WALL of the castle keep: a tall white plaster wall with black wooden beams, several '
                   'layers of curved dark tiled roof eaves sticking out, small arrow-slit windows with warm light, an '
                   'iron ladder bolted to the wall, iron chains, rain water pouring off the eaves',
             light='cold blue-purple storm light, wet shining tiles with white lightning highlights, warm window glow',
             band='dark wet stone blocks and roof tiles', height=TALL_CASTLE),
        dict(scene='higher sections of the keep wall: stacked curved roofs with golden ornaments, mechanical iron '
                   'cannons poking out of wall ports, gears and pistons built into the walls, lanterns with a round '
                   'gear crest (no writing) swinging in the wind', light='cold blue-purple storm light, wet highlights, '
                   'warm lantern glow', band='dark wet stone blocks and roof tiles', height=TALL_CASTLE),
        dict(scene='a corner watch turret (yagura) of the castle with a steep tiled roof, iron lightning rods, wooden '
                   'walkways with railings along the wall, torn plain banners (no writing), heavy rain streaming off',
             light='cold blue-purple storm light with white lightning highlights', band='dark wet stone blocks and '
                   'roof tiles', height=TALL_CASTLE),
        dict(scene='the stone walls and wooden stair towers leading toward the main staircase of the keep, iron '
                   'railings, paper lanterns swinging in the wind, puddles shining', light='cold blue-purple storm '
                   'light, wet highlights, warm lantern glow', band='dark wet stone blocks and roof tiles',
             height=TALL_CASTLE),
    ], bridge=dict(scene='stone walls, wooden stairs and lanterns of the keep', band='dark wet stone blocks and roof '
                                                                                   'tiles')),
    's3_midfar_A': dict(after=3, n=2, zh='遠方冷卻塔與天守閣外牆', panels=[
        dict(scene='distant giant iron aqueducts on tall arches and cooling towers puffing white steam, pipes and '
                   'water channels', light='dark grey-blue storm haze with orange furnace glow'),
        dict(scene='the far outer walls of the castle keep with stacked curved roofs and iron towers in the storm',
             light='cold blue-purple storm haze, lightning lighting the edges'),
    ], bridge=dict(scene='distant castle walls and rooftops in the storm haze')),
    's3_far_A': dict(after=2, n=1, zh='暴風雲加劇', panels=[
        dict(scene='churning dark storm clouds with bright flashes of lightning glowing inside the clouds, a few '
                   'distant bolts near the far mountains',
             sky='from the dark grey-blue storm of the left third to a darker blue-purple storm'),
    ], bridge=dict(scene='dark churning storm clouds with lightning glow')),
}


def layer_of(key: str) -> str:
    return key.split('_')[1]


def stage_of(key: str) -> str:
    return key.split('_')[0]


def transparent(key: str) -> bool:
    return layer_of(key) != 'far'


def old_items(stage: str, ly: str) -> list[dict]:
    return json.loads((ART / 'art.json').read_text(encoding='utf-8'))['panels'][stage][ly]['items']


_old_cache: dict[str, np.ndarray] = {}


def old_strip(stage: str, ly: str) -> np.ndarray:
    k = f'{stage}_{ly}'
    if k not in _old_cache:
        parts = [np.asarray(Image.open(ART / it['path']).convert('RGBA')).astype(np.float32)
                 for it in old_items(stage, ly)]
        s = np.concatenate(parts, axis=1)
        if ly == 'far':
            s[..., 3] = 255
        _old_cache[k] = s
    return _old_cache[k]


def boundary(key: str) -> int:
    d = INSERTS[key]
    return sum(it['w'] for it in old_items(stage_of(key), layer_of(key))[:d['after']])


def names(key: str) -> list[str]:
    return [f'{key}{i + 1}' for i in range(len(INSERTS[key]['panels']))] + [f'{key}br']


def tries(name: str) -> list[Path]:
    return sorted(RAW.glob(f'{name}.try*.png'), key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))


def pick(name: str) -> Path | None:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    t = [p for p in tries(name) if '.reject.' not in p.name]
    return t[-1] if t else None


def load_out(path: Path, key: str) -> np.ndarray:
    im = Image.open(path).convert('RGBA')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    if transparent(key):
        return gp.clean_alpha(a)
    a[..., 3] = 255
    return a


def gain_match(tail: np.ndarray, R: np.ndarray, x0: int, x1: int, ramp_dir: int) -> tuple[np.ndarray, list]:
    """R[:, x0:x1] 是跟 tail 重疊的地方：整張乘上增益，重疊區全量、往另一邊漸漸放掉。"""
    ov = R[:, x0:x1]
    both = (tail[..., 3] > 200) & (ov[..., 3] > 200)
    if both.sum() < 1000:
        return R, [1, 1, 1]
    g = np.clip(tail[..., :3][both].mean(0) / np.maximum(ov[..., :3][both].mean(0), 1), 0.88, 1.12)
    xs = np.arange(R.shape[1])
    if ramp_dir > 0:     # 重疊在左邊、往右放掉
        ramp = np.clip((xs - x1) / (R.shape[1] - x1), 0, 1)
    else:                # 重疊在右邊、往左放掉
        ramp = np.clip((x0 - xs) / x0, 0, 1)
    R = R.copy()
    R[..., :3] = np.clip(R[..., :3] * (g + (1 - g) * ramp[None, :, None]), 0, 255)
    return R, [round(float(v), 3) for v in g]


def stitch_left(work: np.ndarray, R: np.ndarray) -> tuple[np.ndarray, dict]:
    """把新圖 R（左 720 欄＝work 的尾巴）接到 work 右邊。"""
    tail = work[:, -OV:]
    m, reg = gp.register(tail, R[:, :OV])
    R = gp.warp(R, m)
    R, gain = gain_match(tail, R, 0, OV, +1)
    kept = float(np.abs(gp.premul(tail) - gp.premul(R[:, :OV])).mean())
    path = gp.min_cut(tail, R[:, :OV])
    rms = float(np.sqrt(((gp.premul(tail) - gp.premul(R[:, :OV])) ** 2).sum(-1)[np.arange(H), path].mean()))
    x0 = work.shape[1] - OV
    out = np.concatenate([work[:, :x0], gp.blend(tail, R[:, :OV], path), R[:, OV:]], axis=1)
    return out, {'x0': x0, 'path': (path + x0).tolist(), 'kept': round(kept, 2), 'rms': round(rms, 1),
                 'gain': gain, 'reg': reg}


def shift_ramp(R: np.ndarray, dx: float, dy: float) -> np.ndarray:
    """右三分之一整塊平移 (dx, dy)、中間三分之一由 0 漸進到 (dx, dy)、左三分之一不動。"""
    h, w = R.shape[:2]
    xs = np.arange(w, dtype=np.float32)
    t = np.clip((xs - OV) / OV, 0, 1)
    mx = (xs[None, :] - dx * t[None, :]).repeat(h, 0).astype(np.float32)
    my = (np.arange(h, dtype=np.float32)[:, None] - dy * t[None, :]).astype(np.float32)
    p = cv2.remap(gp.premul(R), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return gp.unpremul(p)


def register_shift(A: np.ndarray, B: np.ndarray) -> tuple[float, float, dict]:
    g1, g2 = gp.gray(A), gp.gray(B)
    m = np.eye(2, 3, dtype=np.float32)
    try:
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
        cc, m = cv2.findTransformECC(g1, g2, m, cv2.MOTION_TRANSLATION, crit, None, 5)
    except cv2.error:
        return 0.0, 0.0, {'ok': False}
    dx, dy = float(m[0, 2]), float(m[1, 2])
    lim = 60 if cc > 0.95 else 25
    if abs(dx) > lim or abs(dy) > lim:
        return 0.0, 0.0, {'ok': True, 'cc': round(float(cc), 4), 'dx': dx, 'dy': dy, 'used': False}
    return dx, dy, {'ok': True, 'cc': round(float(cc), 4), 'dx': round(dx, 2), 'dy': round(dy, 2), 'used': True}


def plan_widths(key: str) -> tuple[int, int]:
    """(e, 需要幾張前進張)：插入寬＝n×張寬＝e＋720。"""
    ly = layer_of(key)
    total = INSERTS[key]['n'] * SLICE_W[ly]
    e = total - OV
    return e, len(INSERTS[key]['panels'])


def build(key: str, upto: int | None = None, bridge: bool = True) -> tuple[np.ndarray, list[dict], int]:
    """回傳（組好的區段, 接縫資訊, 區段起點在舊長卷的 x）。區段＝舊第 b 張＋插段（＋橋接後接上舊第 b+1 張）。"""
    st, ly = stage_of(key), layer_of(key)
    old = old_strip(st, ly)
    B = boundary(key)
    items = old_items(st, ly)
    d = INSERTS[key]
    wb = items[d['after'] - 1]['w']
    start = B - wb
    work = old[:, start:B].copy()
    seams = []
    k_all = len(d['panels'])
    upto = k_all if upto is None else upto
    for k in range(1, upto + 1):
        src = pick(f'{key}{k}')
        if src is None:
            raise SystemExit(f'{key}{k} 還沒生')
        work, s = stitch_left(work, load_out(src, key))
        s['k'] = k
        s['src'] = src.name
        seams.append(s)
    if not bridge or upto < k_all:
        return work, seams, start
    src = pick(f'{key}br')
    if src is None:
        return work, seams, start
    e, _ = plan_widths(key)
    cut = wb + e                         # work 在這裡截斷，後面接橋接圖的中間
    work = work[:, :cut]
    Rb = load_out(src, key)
    head = old[:, B:B + OV]
    # 左邊：照一般接法（整張仿射）
    work2, s = stitch_left(work, Rb)
    s['k'] = 'br-left'
    s['src'] = src.name
    seams.append(s)
    # 右邊：已接好的 Rb 在 work2 最後 1440 欄（中間＋右）。右三分之一跟 head 對位：平移、在中間漸進
    RbW = work2[:, -2 * OV:]
    left_part = work2[:, :-2 * OV]
    tmp = np.concatenate([np.zeros((H, OV, 4), np.float32), RbW], axis=1)   # 補回 3 等分，方便用 shift_ramp
    dx, dy, reg = register_shift(head, tmp[:, 2 * OV:])
    if reg.get('used'):
        tmp = shift_ramp(tmp, -dx, -dy)   # ECC：對齊後 new(x)=R(x+dx)
    tmp, gain = gain_match(head, tmp, 2 * OV, 3 * OV, -1)
    right = tmp[:, 2 * OV:]
    kept = float(np.abs(gp.premul(head) - gp.premul(right)).mean())
    path = gp.min_cut(right, head)
    rms = float(np.sqrt(((gp.premul(right) - gp.premul(head)) ** 2).sum(-1)[np.arange(H), path].mean()))
    x0 = left_part.shape[1] + OV
    seg = np.concatenate([left_part, tmp[:, OV:2 * OV], gp.blend(right, head, path), old[:, B + OV:B + items[d['after']]['w']]],
                         axis=1)
    seams.append({'k': 'br-right', 'src': src.name, 'x0': x0, 'path': (path + x0).tolist(), 'kept': round(kept, 2),
                  'rms': round(rms, 1), 'gain': gain, 'reg': reg})
    return seg, seams, start


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def next_try(name: str) -> int:
    with _LOCK:
        n = 1
        while any((RAW / f'{name}.try{n}{suf}').exists() for suf in ('.png', '.pending', '.reject.png')):
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    return n


def to_png(a: np.ndarray, path: Path, key: str) -> None:
    im = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    im.resize((2172, 724), Image.LANCZOS).save(path)


def prompt_for(key: str, k: int | str) -> str:
    ly = layer_of(key)
    d = INSERTS[key]
    if k == 'br':
        s = d['bridge']
        p = BRIDGE[ly].format(what=gp.WHAT[ly], scene=s['scene'], band=s.get('band', ''),
                              height=s.get('height', MID_H))
        if d.get('indoor'):
            p += BRIDGE_INDOOR.format(io=d['indoor'])
        return p
    s = d['panels'][k - 1]
    return gp.NEXT[ly].format(what=gp.WHAT[ly], scene=s['scene'], light=s.get('light', ''), band=s.get('band', ''),
                              height=s.get('height', MID_H), sky=s.get('sky', s.get('sky', MID_SKY_NEXT)))


def quick_check(key: str, k, out: Path) -> tuple[bool, str]:
    R = load_out(out, key)
    inp_tail = None
    if k == 'br':
        seg, seams, _ = build(key)
        kl = next(s for s in seams if s['k'] == 'br-left')['kept']
        kr = next(s for s in seams if s['k'] == 'br-right')['kept']
        grey = (np.abs(R[:, OV:2 * OV, :3] - 128).max(-1) < 6) & (R[:, OV:2 * OV, 3] > 200)
        rr = next(s for s in seams if s['k'] == 'br-right')['rms']
        # 右三分之一 Codex 常會重畫（保留差偏大），真正要緊的是切線上兩邊像不像
        ok = kl < 14 and (kr < 14 or rr < 26) and float(grey.mean()) < 0.03
        info = f'左保留差 {kl}、右保留差 {kr}、灰殘 {float(grey.mean()):.3f}'
    else:
        work, seams, _ = build(key, k - 1, bridge=False) if k > 1 else build(key, 0, bridge=False)
        inp_tail = work[:, -OV:]
        kept = float(np.abs(gp.premul(inp_tail) - gp.premul(R[:, :OV])).mean())
        grey = (np.abs(R[:, OV:, :3] - 128).max(-1) < 6) & (R[:, OV:, 3] > 200)
        both = (inp_tail[..., 3] > 200) & (R[:, :OV, 3] > 200)
        ratio = float(inp_tail[..., :3][both].mean() / max(R[:, :OV, :3][both].mean(), 1)) if both.sum() > 1000 else 1
        ok = kept < 14 and float(grey.mean()) < 0.03 and 0.88 < ratio < 1.12
        info = f'保留差 {kept:.2f}、灰殘 {float(grey.mean()):.3f}、亮度比 {ratio:.2f}'
    if layer_of(key) == 'mid':
        bottom = float((R[-60:, :, 3] < 200).mean())
        ok = ok and bottom < 0.03
        info += f'、底部不實心 {bottom:.2f}'
    if transparent(key):
        info += f'、透明比例 {float((R[..., 3] < 16).mean()):.2f}'
    return ok, info


def next_step(key: str):
    for i in range(1, len(INSERTS[key]['panels']) + 1):
        if pick(f'{key}{i}') is None:
            return i
    if pick(f'{key}br') is None:
        return 'br'
    return None


def gen_one(key: str, max_tries: int = 3) -> str:
    k = next_step(key)
    if k is None:
        return f'{key} 已完成'
    name = f'{key}{k}'
    lines = []
    for _ in range(max_tries):
        n = next_try(name)
        out = RAW / f'{name}.try{n}.png'
        canvas = np.zeros((H, W, 4), np.float32)
        canvas[...] = (128, 128, 128, 255)
        if k == 'br':
            e, _ = plan_widths(key)
            work, _, _ = build(key, bridge=False)
            wb = old_items(stage_of(key), layer_of(key))[INSERTS[key]['after'] - 1]['w']
            work = work[:, :wb + e]
            canvas[:, :OV] = work[:, -OV:]
            B = boundary(key)
            canvas[:, 2 * OV:] = old_strip(stage_of(key), layer_of(key))[:, B:B + OV]
        else:
            work, _, _ = build(key, k - 1, bridge=False)
            canvas[:, :OV] = work[:, -OV:]
        if not transparent(key):
            canvas[..., 3] = 255
        inp = RAW / f'_in_{name}.try{n}.png'
        to_png(canvas, inp, key)
        prompt = prompt_for(key, k)
        t0 = time.time()
        status = gp.call_codex(prompt, inp, out, transparent(key))
        (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
        try:
            ok, verdict = quick_check(key, k, out) if status == 'ok' else (False, '')
        except Exception as ex:  # noqa: BLE001
            ok, verdict = False, f'檢查出錯 {ex}'
        record(name, {'attempt': n, 'status': status, 'check': verdict, 'pass': ok, 'input': inp.name,
                      'prompt': prompt, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
        lines.append(f'{name} 第 {n} 次：{status[:200]}（{time.time() - t0:.0f} 秒）{verdict}{"" if ok else " ✗"}')
        if ok:
            break
        if out.exists():
            out.rename(RAW / f'{name}.try{n}.reject.png')
    return '\n'.join(lines)


def run_all(key: str) -> str:
    lines = []
    while True:
        k = next_step(key)
        if k is None:
            break
        r = gen_one(key)
        lines.append(r)
        print(r, flush=True)
        if next_step(key) == k:   # 三次都不合格
            lines.append(f'{key} 卡在 {k}')
            break
    return '\n'.join(lines)


def seam_crops(key: str, seg: np.ndarray, seams: list[dict]) -> Path:
    tiles = []
    for s in seams:
        cx = int(np.mean(s['path']))
        x1, x2 = max(cx - 260, 0), min(cx + 260, seg.shape[1])
        crop = gp.composite(seg[:, x1:x2])
        marked = crop.copy()
        for y, x in enumerate(s['path']):
            if x1 <= x < x2 and y % 6 < 3:
                marked[y, x - x1] = (255, 40, 40)
        tiles.append(np.concatenate([crop, np.full((H, 8, 3), 255, np.float32), marked], axis=1))
        tiles.append(np.full((H, 30, 3), 255, np.float32))
    img = np.concatenate(tiles[:-1], axis=1)
    CHECK.mkdir(parents=True, exist_ok=True)
    p = CHECK / f'{key}_seams.jpg'
    im = gp.to_img(img)
    im.resize((min(im.width, 3600), round(im.height * min(im.width, 3600) / im.width)), Image.LANCZOS).save(p, quality=88)
    return p


def check(key: str) -> None:
    seg, seams, start = build(key)
    for s in seams:
        print(f"  {key} {s['k']}（{s['src']}）：保留差 {s['kept']}、切線 rms {s['rms']}、增益 {s['gain']}、對位 {s['reg']}")
    p = seam_crops(key, seg, seams)
    comp = gp.composite(seg)
    gp.rows_image(comp, 2 if seg.shape[1] > 6000 else 1, CHECK / f'{key}_segment.jpg', width=2400)
    print('  ', p, CHECK / f'{key}_segment.jpg')


def export() -> dict:
    """每關每層：新的完整清單（沿用舊檔的寫舊路徑，改過／新的寫 v2 路徑）。"""
    res: dict = {}
    for st in ('s1', 's2', 's3'):
        res[st] = {}
        for ly in ('far', 'midfar', 'mid'):
            old = old_items(st, ly)
            keys = sorted([k for k in INSERTS if stage_of(k) == st and layer_of(k) == ly],
                          key=lambda k: INSERTS[k]['after'])
            replaced: dict[int, np.ndarray] = {}   # 舊張號（1 起）→ 新圖
            inserted: dict[int, list] = {}          # 插在舊第幾張之後 → [(圖, 場景)]
            for key in keys:
                if next_step(key) is not None:
                    raise SystemExit(f'{key} 還沒生完')
                d = INSERTS[key]
                seg, seams, start = build(key)
                b = d['after']
                wb = old[b - 1]['w']
                sw = SLICE_W[ly]
                replaced[b] = seg[:, :wb]
                ins = [(seg[:, wb + i * sw: wb + (i + 1) * sw], f"{d['zh']} {i + 1}/{d['n']}", key)
                       for i in range(d['n'])]
                inserted[b] = ins
                replaced[b + 1] = seg[:, wb + d['n'] * sw:]
                assert replaced[b + 1].shape[1] == old[b]['w'], (key, replaced[b + 1].shape, old[b]['w'])
            items = []
            x = 0
            nn = 0
            for i, it in enumerate(old, 1):
                if i in replaced:
                    nn += 1
                    rel = f'v2/bg/{st}/{ly}_{i:02d}r.webp'
                    gp.save_webp(replaced[i], ART / rel, ly != 'far')
                    items.append({'path': rel, 'x': x, 'w': it['w'], 'h': H, 'scene': it['scene'] + '（接縫修過）',
                                  'replaces': it['path'], 'new': False})
                else:
                    items.append({'path': it['path'], 'x': x, 'w': it['w'], 'h': H, 'scene': it['scene'], 'new': False})
                x += it['w']
                for j, (a, zh, key) in enumerate(inserted.get(i, []), 1):
                    rel = f'v2/bg/{st}/{ly}_{i:02d}_{j}.webp'
                    gp.save_webp(a, ART / rel, ly != 'far')
                    items.append({'path': rel, 'x': x, 'w': a.shape[1], 'h': H, 'scene': zh, 'new': True,
                                  'insert': key})
                    x += a.shape[1]
            res[st][ly] = {'totalW': x, 'oldTotalW': sum(it['w'] for it in old), 'items': items,
                           'inserts': [{'key': k, 'afterOld': INSERTS[k]['after'], 'n': INSERTS[k]['n'],
                                        'zh': INSERTS[k]['zh']} for k in keys]}
            print(st, ly, 'totalW', x)
    (RAW / 'v2_panels.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['gen', 'run', 'check', 'export', 'prompt'])
    ap.add_argument('keys', nargs='*')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    keys = list(INSERTS) if a.keys == ['all'] else a.keys
    for k in keys:
        if k not in INSERTS:
            sys.exit(f'不認得：{k}')
    if a.cmd == 'gen':
        with ThreadPoolExecutor(max_workers=a.workers) as pool:
            for line in pool.map(gen_one, keys):
                print(line, flush=True)
    elif a.cmd == 'run':
        with ThreadPoolExecutor(max_workers=a.workers) as pool:
            list(pool.map(run_all, keys))
    elif a.cmd == 'check':
        for k in keys:
            check(k)
    elif a.cmd == 'export':
        export()
    elif a.cmd == 'prompt':
        for k in keys:
            print(prompt_for(k, 1))
            print(prompt_for(k, 'br'))


if __name__ == '__main__':
    main()
