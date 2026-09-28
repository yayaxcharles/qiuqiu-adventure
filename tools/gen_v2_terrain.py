"""第二版（2026-09-28）地形與機關美術：新段落的地面帶、陡坡、石階、牆、實心方塊、岩棚、攀爬物、瀑布、過場遮蓋件。
寫法照 gen_terrain2.py（同一套畫風文字、參考圖、Codex 呼叫）；原檔存 art_raw/v2/terrain/<名稱>.try<N>.png（不蓋舊的）。

  python tools/gen_v2_terrain.py flat            新段落的平地地面帶（陡坡的導引圖要先有它們）
  python tools/gen_v2_terrain.py slopes          陡坡（先把平地帶「照坡度逐欄錯切」做成導引圖，請 Codex 照輪廓重畫成真正的坡）
  python tools/gen_v2_terrain.py rest            其他全部
  python tools/gen_v2_terrain.py <名稱> ...       指定幾個
  --note "..."  加在提示詞後面（重生時補要求）
後製在 tools/post_v2_terrain.py。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp      # noqa: E402
import gen_terrain2 as g2    # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'v2' / 'terrain'
LOG = RAW / 'prompts.json'
ART = ROOT / 'public' / 'art'
_LOCK = threading.Lock()
STYLE = gp.STYLE
CHUNKY = g2.CHUNKY
NO_CHAR = g2.NO_CHAR
NO_TEXT = g2.NO_TEXT
REF_TXT = g2.REF_TXT
ref = g2.ref   # ref('s1', 'wide'|'land'|'tall', 1..3)

LIGHT = dict(g2.LIGHT)
LIGHT.update({
    's1t': ' Lighting: warm orange-pink sunset light from the upper left, soft purple shadows, like the reference.',
    's1w': ' Lighting: purple twilight like the reference: cool blue-purple shadows, a soft pink-violet glow from the '
           'upper left, wet surfaces catching silver-violet highlights.',
    's2w': ' Lighting: moonlit night like the reference: cool silver-blue moonlight from the upper right, deep '
           'blue-black shadows, wet surfaces with silver highlights, a little warm lantern glow.',
    's3c': ' Lighting: like the reference: cold steel-blue light inside a gloomy iron factory, wet shining metal with '
           'white highlights, warm orange lamp spots.',
})
REFS = {'s1a': ref('s1', 'land', 1), 's1t': ref('s1', 'land', 1), 's1w': ref('s1', 'land', 2),
        's1c': ref('s1', 'land', 3), 's2': ref('s2', 'land', 1), 's2w': ref('s2', 'land', 2),
        's3': ref('s3', 'land', 2), 's3c': ref('s3', 'land', 2), 's3r': ref('s3', 'land', 3)}
WIDE = {'s1a': ref('s1', 'wide', 1), 's1t': ref('s1', 'wide', 1), 's1w': ref('s1', 'wide', 2),
        's1c': ref('s1', 'wide', 3), 's2': ref('s2', 'wide', 1), 's2w': ref('s2', 'wide', 2),
        's3': ref('s3', 'wide', 2), 's3c': ref('s3', 'wide', 2), 's3r': ref('s3', 'wide', 3)}
TALL = {'s1a': ref('s1', 'tall', 1), 's1t': ref('s1', 'tall', 1), 's1w': ref('s1', 'tall', 2),
        's1c': ref('s1', 'tall', 3), 's2': ref('s2', 'tall', 2), 's2w': ref('s2', 'tall', 2),
        's3': ref('s3', 'tall', 2), 's3c': ref('s3', 'tall', 2), 's3r': ref('s3', 'tall', 3)}


def J(prompt: str, r: Path, transp: bool = True) -> dict:
    return {'prompt': prompt, 'ref': r, 'transp': transp}


# ───────── 平地地面帶（新段落） ─────────
FLAT = {
    's1_terrace': ('s1t', dict(surface='a narrow packed-earth path along a rice terrace, with a grassy edge and a few '
                                       'flat terrace stones set into it', tufts='short grass blades and a rice stalk',
                               section='the dry-stone retaining wall of the terrace: fitted mossy grey stones of '
                                       'different sizes with earth and roots between them',
                               dark='brown-black earth')),
    's1_rock': ('s1w', dict(surface='flat wet slabs of dark layered stream rock with thin moss and small puddles',
                            tufts='a little moss, a fern sprig and pebbles',
                            section='layered dark rock strata with cracks, wet streaks and moss, embedded round '
                                    'river stones', dark='blue-black rock')),
    's1_trail': ('s1w', dict(surface='a narrow mountain dirt trail with exposed pine roots and small rocks',
                             tufts='short grass, a pine cone and pebbles',
                             section='rocky mountain earth with big buried stones and tangled roots',
                             dark='dark umber earth')),
    's2_rock': ('s2w', dict(surface='flat wet slabs of dark gorge rock with moss and small puddles reflecting the '
                                    'moonlight', tufts='a little moss, a fern sprig and pebbles',
                            section='layered dark rock strata with cracks, wet streaks, moss and embedded river stones',
                            dark='blue-black rock')),
    's3_wet': ('s3c', dict(surface='a riveted dark iron grating floor wet with a thin film of water and small '
                                   'puddles, a yellow-and-black hazard stripe along the top edge',
                           tufts='a few water droplets and a small bolt',
                           section='a cross-section under the grating: iron girders, a big water pipe and cables '
                                   'running horizontally, rivets, dripping water, a faint cold blue glow from below',
                           dark='iron-black')),
    's3_walk': ('s3r', dict(surface='a wet wooden walkway of dark planks on a stone ledge along the castle wall in '
                                    'heavy rain, puddle shine', tufts='small rain splashes',
                            section='the dark grey granite blocks of the castle stone base (ishigaki), wet and '
                                    'shining, iron clamps', dark='blue-black stone')),
}

# 陡坡要用哪一條平地帶當導引（public/art 下的路徑、standY）＋燈光鍵
SLOPE_THEMES = {
    's1_village': ('terrain/ground_village.webp', 's1a', 'the packed brown dirt village road'),
    's1_terrace': ('v2/terrain/ground_s1_terrace.webp', 's1t', 'the packed-earth terrace path over a mossy dry-stone '
                                                                'retaining wall'),
    's1_rock': ('v2/terrain/ground_s1_rock.webp', 's1w', 'the wet layered stream rock'),
    's1_trail': ('v2/terrain/ground_s1_trail.webp', 's1w', 'the rocky mountain dirt trail'),
    's2_street': ('terrain/ground_s2_street.webp', 's2', 'the worn grey flagstone street (the slabs follow the slope)'),
    's2_shrine': ('terrain/ground_s2_shrine.webp', 's2', 'the grey stone slab shrine path with fallen maple leaves'),
    's2_rock': ('v2/terrain/ground_s2_rock.webp', 's2w', 'the wet dark gorge rock'),
    's3_grate': ('terrain/ground_s3_grate.webp', 's3', 'the riveted iron grating ramp (the grating and the hazard '
                                                       'stripe follow the slope)'),
    's3_wet': ('v2/terrain/ground_s3_wet.webp', 's3c', 'the wet riveted iron grating ramp'),
    's3_roof': ('terrain/ground_s3_roof.webp', 's3r', 'the steep wet castle roof of dark tiles (the rows of tiles run '
                                                      'down the slope like a real sloping roof)'),
}
GRADES = {20: 0.364, 30: 0.577}
SLOPE_GEO = {20: dict(run=1000, y_hi=170), 30: dict(run=800, y_hi=130)}   # 導引圖 1536x1024（原圖尺度＝顯示×2）

SLOPE_T = (
    'Reference image 1 is a rough GUIDE for one terrain piece of a 2D side-scrolling game, made by crudely bending a '
    'flat ground strip into a slope. Repaint it as a properly hand-drawn piece of STEEP SLOPED GROUND in ' + STYLE +
    ', seen exactly from the side (a cross-section): {what}. KEEP THE OUTLINE OF THE GUIDE EXACTLY: the walking '
    'surface is a flat piece at the {low} side, then ONE PERFECTLY STRAIGHT diagonal slope line going {dirtxt} at '
    'exactly the same angle and position as in the guide, then a flat piece at the {high} side; everything above the '
    'surface line stays completely EMPTY and TRANSPARENT (only a few tiny tufts poke up, less than 3% of the picture '
    'height). Keep the same materials, colours, lighting and darkness gradient as the guide and continue the '
    'cross-section under the surface down to the bottom edge, getting darker toward the bottom. But draw everything '
    'NATURALLY for a slope, not skewed: grass and plants grow straight up, stones are round and not stretched, '
    'strata, cracks and textures follow the slope in a believable way, no stretched or slanted-looking texture.'
    '{light}' + CHUNKY + NO_CHAR)


def slope_guide(theme: str, grade: int, up: bool) -> Path:
    """平地帶照導引輪廓逐欄上下移（就是遊戲現在畫斜坡的方法），當 Codex 的輸入。"""
    rel = SLOPE_THEMES[theme][0]
    info = strip_info(rel)
    a = np.asarray(Image.open(ART / rel).convert('RGBA')).astype(np.float32)
    a = gp.resize_rgba(a, a.shape[1] * 2, a.shape[0] * 2)
    stand = info['standY'] * 2
    Wc, Hc = 1536, 1024
    g = GRADES[grade]
    geo = SLOPE_GEO[grade]
    run = geo['run']
    x0 = (Wc - run) // 2
    y_hi = geo['y_hi']
    y_lo = y_hi + run * g
    c = np.zeros((Hc, Wc, 4), np.float32)
    for x in range(Wc):
        t = np.clip((x - x0) / run, 0, 1)
        y = y_lo + (y_hi - y_lo) * t if up else y_hi + (y_lo - y_hi) * t
        top = int(round(y - stand))
        col = a[:, x % a.shape[1]]
        y0, y1 = max(0, top), min(Hc, top + a.shape[0])
        c[y0:y1, x] = col[y0 - top:y1 - top]
        if y1 < Hc:
            c[y1:, x, :3] = col[-1, :3]
            c[y1:, x, 3] = 255
    RAW.mkdir(parents=True, exist_ok=True)
    p = RAW / f'_guide_{theme}_{"up" if up else "dn"}{grade}.png'
    Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(p)
    return p


def strip_info(rel: str) -> dict:
    tj = json.loads((ART / 'terrain.json').read_text(encoding='utf-8'))
    for v in tj['ground'].values():
        if isinstance(v, dict) and v.get('path') == rel:
            return v
    v2 = ART / 'v2' / 'v2_terrain.json'
    if v2.exists():
        for v in json.loads(v2.read_text(encoding='utf-8')).get('ground', {}).values():
            if v.get('path') == rel:
                return v
    raise SystemExit(f'找不到地面帶 {rel} 的 standY（新段落平地帶先跑 post_v2_terrain.py flat）')


def slope_jobs() -> dict[str, dict]:
    j = {}
    for th, (_, lk, what) in SLOPE_THEMES.items():
        for grade in GRADES:
            for up in (True, False):
                nm = f'slope_{th}_{"up" if up else "dn"}{grade}'
                p = SLOPE_T.format(what=what, low='LEFT' if up else 'RIGHT', high='RIGHT' if up else 'LEFT',
                                   dirtxt=('UP from the lower left to the upper right' if up else
                                           'DOWN from the upper left to the lower right'),
                                   light=LIGHT[lk])
                j[nm] = {'prompt': p, 'guide': (th, grade, up), 'transp': True}
    return j


# ── 實心方塊（上面可站、左右可蹬、下面撞頭）：切成九宮格 ──
BLOCK_T = (
    REF_TXT + 'ONE big SOLID BLOCK for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ', seen '
    'exactly from the side (flat elevation, no perspective, no visible top face): {what}. It is a RECTANGLE: a flat '
    'straight horizontal top edge ({top}), straight vertical left and right sides, and a flat horizontal underside '
    '({bottom}); it fills about 75% of the picture width and 75% of the picture height, centred, floating (nothing '
    'below it). The texture inside is even and regular all over (no single big feature in the middle) so the block '
    'can be cut and stretched to any size.{light}' + CHUNKY + NO_CHAR)
BLOCKS = {
    'block_s1_rock': ('s1w', dict(what='a massive block of dark layered wet mountain rock with horizontal strata, '
                                       'cracks and moss', top='a thin cap of moss and small ferns along the top',
                                  bottom='the rough underside of the rock with a few dripping moss strands')),
    'block_s1_log': ('s1c', dict(what='a solid crib of rough horizontal logs stacked and lashed with thick rope, '
                                      'with plank ends showing on the sides',
                                 top='a flat top of rough planks nailed across', bottom='the bottom log')),
    'block_s2_rock': ('s2w', dict(what='a massive block of dark wet gorge rock with strata, cracks and moss, '
                                       'moonlit highlights', top='a thin cap of moss along the top',
                                  bottom='the rough underside of the rock with dripping moss strands')),
    'block_s2_stone': ('s2', dict(what='a solid pillar-block of big fitted grey granite stones like the base of a '
                                       'giant stone lantern, mossy joints, a few red maple leaves caught in cracks',
                                  top='a flat capstone slab along the top', bottom='a flat stone underside')),
    'block_s3_iron': ('s3', dict(what='a solid block of riveted dark iron plates with welded seams, bolts, rust '
                                      'streaks and a hazard-striped edge band',
                                 top='a flat riveted iron top edge', bottom='a flat riveted iron underside')),
    'block_s3_plaster': ('s3r', dict(what="a solid section of a Japanese castle wall: white plaster panels framed by "
                                          'black wooden beams and iron corner plates, wet with rain',
                                     top='a short overhanging strip of dark wet roof tiles along the top',
                                     bottom='a black wooden beam along the underside')),
}

# ── 牆（崖壁格式：壁面朝左、頂端一塊＋可垂直重複） ──
WALLS = {
    'wall_s1_rock': ('s1w', dict(wall='a tall cliff face of dark layered wet mountain rock with horizontal strata, '
                                      'cracks, moss patches and small ferns, water streaks',
                                 cap='the wet stream rock ground with moss')),
    'wall_s2_rock': ('s2w', dict(wall='a tall cliff face of dark wet gorge rock with strata, cracks, moss and '
                                      'silver moonlit wet streaks', cap='the wet gorge rock ground with moss')),
    'wall_s3_plaster': ('s3r', dict(wall='the outer wall of a Japanese castle keep: white plaster panels framed by '
                                         'black wooden beams and iron plates, streaked with rain water',
                                    cap='a wet plank walkway on a stone ledge')),
}

# ── 岩棚（單向平台：左端／中段重複／右端） ──
LEDGES = {
    'ledge_s1_rock': ('s1w', dict(what='a narrow wet ROCK LEDGE sticking out of a cliff: a flat-topped slab of dark '
                                       'layered rock with moss and small ferns on top, a jagged rocky underside with '
                                       'dripping moss', top='The flat TOP of the ledge is ONE straight horizontal line '
                                       'at about 60% of the picture height from the bottom; the ledge is about 18% of '
                                       'the picture height thick; nothing below it.',
                                  repeat='rock texture evenly', ends='rounded broken rock ends')),
    'ledge_s2_rock': ('s2w', dict(what='a narrow wet ROCK LEDGE sticking out of a cliff at night: a flat-topped slab '
                                       'of dark rock with moss on top, moonlit wet edge, a jagged underside with '
                                       'dripping moss', top='The flat TOP of the ledge is ONE straight horizontal line '
                                       'at about 60% of the picture height from the bottom; the ledge is about 18% of '
                                       'the picture height thick; nothing below it.',
                                  repeat='rock texture evenly', ends='rounded broken rock ends')),
    'ledge_s3_iron': ('s3c', dict(what='a narrow IRON SHELF bolted to a wall: a riveted iron grating walkway on '
                                       'triangular iron brackets underneath, dripping water, a hazard-striped front edge',
                                  top='The flat TOP of the grating is ONE straight horizontal line at about 60% of '
                                      'the picture height from the bottom; the grating is about 6% of the picture '
                                      'height thick with the brackets below it.',
                                  repeat='brackets and rivets evenly spaced', ends='a bolted end plate')),
    'ledge_s3_eave': ('s3r', dict(what='a short overhanging castle ROOF EAVE you can stand on: a straight ridge of dark '
                                       'wet curved roof tiles with a flat top, the tile edges and a wooden rafter '
                                       'underneath', top='The flat TOP of the eave is ONE straight horizontal line at '
                                       'about 60% of the picture height from the bottom; the eave is about 14% of the '
                                       'picture height thick.', repeat='tiles evenly spaced',
                                  ends='a round end tile with a small golden ornament')),
}

# ── 攀爬物（直式：頂端＋中段可垂直重複＋底端） ──
CLIMB_T = (
    REF_TXT + 'ONE tall CLIMBABLE {kind} for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
    ', seen exactly from the side, centred, running from the top edge to the bottom edge of the picture: {what}. It '
    'is narrow (about 12% of the picture width). The top 15% is its top end ({top}); the bottom 12% is its bottom '
    'end ({bottom}); everything between looks the same all the way down (it will be repeated vertically). '
    'Everything else is completely transparent.{light}' + CHUNKY + NO_CHAR)
CLIMBS = {
    'climb_s1_vine': ('s1w', dict(kind='VINE', what='a thick hanging jungle vine made of two or three twisted woody '
                                                   'stems with many green leaves and small tendrils',
                                  top='the vine hangs from a clump of roots and moss on a small rock lip',
                                  bottom='a few loose leafy tendrils')),
    'climb_s2_vine': ('s2w', dict(kind='VINE', what='a thick hanging vine of twisted woody stems with dark leaves and '
                                                   'a few small red maple-coloured leaves, moonlit edges',
                                  top='the vine hangs from a clump of roots and moss on a small rock lip',
                                  bottom='a few loose leafy tendrils')),
    'climb_s1_ladder': ('s1c', dict(kind='LADDER', what='a rough wooden ladder of two straight log rails with round '
                                                       'rungs lashed on with rope, evenly spaced rungs',
                                    top='the rail tops lashed to a short cross log', bottom='the rail feet, slightly '
                                                                                         'sharpened')),
    'climb_s3_chain': ('s3c', dict(kind='CHAIN', what='a heavy iron chain of big oval links hanging straight down, '
                                                     'rusty and wet', top='a big riveted iron ring bolted to a bracket',
                                   bottom='a heavy iron hook')),
    'climb_s3_ladder': ('s3r', dict(kind='LADDER', what='an iron ladder bolted to a wall: two riveted iron rails with '
                                                       'round iron rungs, wet with rain, rust streaks',
                                    top='curved iron grab handles at the top', bottom='bolted iron foot plates')),
}

# ── 瀑布：水柱（可上下無縫）、白沫疊層、水口、落水水花 4 格、水霧 ──
WF = {
    's1': ('s1w', 'mountain stream water, clear blue-grey and white with violet twilight reflections'),
    's2': ('s2w', 'night water glowing silver-blue in the moonlight, dark blue-black gaps'),
    's3': ('s3c', 'cold steel-blue industrial cooling water, white foam, a slight metallic grey tint'),
}


def wf_jobs() -> dict[str, dict]:
    j = {}
    for st, (lk, water) in WF.items():
        L = LIGHT[lk]
        j[f'wf_{st}_column'] = J(
            REF_TXT + 'A FALLING WATERFALL COLUMN for a 2D side-scrolling game, in ' + STYLE + ': a wide sheet of '
            f'falling water ({water}) pouring straight down, seen from the front, filling the middle 70% of the '
            'picture width from the TOP EDGE to the BOTTOM EDGE; bold vertical streaks of white foam and darker water '
            'lanes, ragged foamy left and right edges; everything to the left and right of the water is completely '
            'TRANSPARENT. It looks the same from top to bottom (it will be repeated vertically and scrolled to '
            'animate), with no top, no bottom, no rocks, no pool.' + L + CHUNKY + NO_CHAR, TALL[lk])
        j[f'wf_{st}_foam'] = J(
            REF_TXT + 'A FOAM OVERLAY for a 2D waterfall animation, in ' + STYLE + ': only long thin bright WHITE '
            'vertical streaks of foam and spray and small white droplets, falling straight down, spread over the '
            'middle 70% of the picture width from the top edge to the bottom edge; soft semi-transparent white; '
            'everything else completely TRANSPARENT (no blue water, no background). It looks the same from top to '
            'bottom (it will be repeated vertically).' + NO_CHAR, TALL[lk])
        lip = {'s1': 'the lip of a waterfall: water pouring over the flat edge of a dark wet mossy rock ledge and '
                     'curving down into a falling sheet',
               's2': 'the lip of a waterfall at night: water pouring over the flat edge of a dark wet mossy rock ledge '
                     'and curving down into a falling sheet glowing in the moonlight',
               's3': 'an iron SPILLWAY outlet: cold water gushing out of a wide riveted iron channel mouth with a '
                     'hazard-striped lip and curving down into a falling sheet'}[st]
        j[f'wf_{st}_lip'] = J(
            REF_TXT + 'ONE WATERFALL TOP PIECE for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
            f': {lip} ({water}). The falling sheet of water is about 60% of the picture width wide, centred, and runs '
            'down out of the bottom edge of the picture (it continues below). Nothing else.' + L + CHUNKY + NO_CHAR,
            REFS[lk])
        j[f'wf_{st}_splash'] = J(g2.FRAMES_T.format(
            n=4, what=f'the SPLASH at the foot of a waterfall where it plunges into a pool ({water}): a wide low crown '
                      'of white foam, spray and droplets bursting up and outward, with a soft mist puff',
            cycle='the spray bursts, rises, spreads and falls back, frame 4 flows back into frame 1', light=L),
            REFS[lk])
        j[f'wf_{st}_mist'] = J(
            REF_TXT + 'A WATERFALL MIST OVERLAY for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE
            + ': one long low bank of soft billowing white-grey mist and spray clouds, tinted by the light, soft '
            'semi-transparent edges, spanning almost the whole picture width in the lower half; everything else '
            'completely transparent.' + L + NO_CHAR, WIDE[lk])
    # 水潭（左右可重複的水面帶）：第一關山溪色、第三關冷卻水道
    pool = {'wf_s1_pool': ('s1w', 'a mountain plunge pool at twilight: clear dark blue-green water with violet and '
                                  'silver twilight reflections glittering in horizontal streaks and white foam patches '
                                  'just below the surface'),
            'wf_s3_pool': ('s3c', 'an iron cooling-water channel: cold steel-blue water with white foam streaks and warm '
                                  'orange lamp reflections glittering just below the surface')}
    for nm, (lk, what) in pool.items():
        j[nm] = J(
            REF_TXT + 'A 2D SIDE-SCROLLING GAME WATER STRIP, very wide 3:1 picture, in ' + STYLE + f': {what}, seen '
            'exactly from the side as a cross-section band: the WATER SURFACE is ONE straight horizontal line at about '
            '15% from the top of the picture, with small wavelets; below it the water gets deeper and darker, fading '
            'to almost black at the bottom edge, a few faint bubbles. Everything above the surface line is '
            'transparent. HORIZONTALLY SEAMLESS TILE: the left and right ends continue into each other.' + LIGHT[lk]
            + CHUNKY + NO_CHAR, WIDE[lk])
    return j


def jobs() -> dict[str, dict]:
    j: dict[str, dict] = {}
    for nm, (lk, v) in FLAT.items():
        j[f'ground_{nm}'] = J(g2.GROUND_T.format(light=LIGHT[lk], **v), WIDE[lk])
    j.update(slope_jobs())
    for nm, (lk, v) in BLOCKS.items():
        j[nm] = J(BLOCK_T.format(light=LIGHT[lk], **v), REFS[lk])
    for nm, (lk, v) in WALLS.items():
        j[nm] = J(g2.WALL_T.format(light=LIGHT[lk], **v), TALL[lk])
    for nm, (lk, v) in LEDGES.items():
        j[nm] = J(g2.LONG_T.format(light=LIGHT[lk], **v), WIDE[lk])
    for nm, (lk, v) in CLIMBS.items():
        j[nm] = J(CLIMB_T.format(light=LIGHT[lk], **v), TALL[lk])
    j.update(wf_jobs())
    # 石階（格式同第一關 s1_stairs：五階、下面實心）
    STAIR = (REF_TXT + 'A {what} STAIRCASE for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
             ', seen exactly from the side (flat elevation, no perspective): FIVE identical broad steps climbing from '
             'the lower left to the upper right, every step exactly the same width and the same height (each riser is '
             'about 7% of the picture height, each tread about 14% of the picture width), {step}. Under the steps the '
             'staircase is SOLID: {under} fills everything below the steps down to the bottom edge of the picture and '
             'out of the right edge; the top step continues flat out of the right edge. Everything above and to the '
             'left of the steps is completely transparent.{light}' + CHUNKY + NO_CHAR)
    j['stairs_s2_shrine'] = J(STAIR.format(what='STONE SHRINE', step='each step a big cut grey granite slab with a '
                                           'rounded worn front edge, moss and fallen red maple leaves on the treads',
                                           under='fitted mossy stone masonry', light=LIGHT['s2']), WIDE['s2'])
    j['stairs_s3_iron'] = J(STAIR.format(what='RIVETED IRON', step='each step a riveted iron grating tread with a '
                                         'yellow-and-black hazard-striped front edge', under='a riveted iron plate '
                                         'stair stringer and girders', light=LIGHT['s3']), WIDE['s3'])
    j['stairs_s1_terrace'] = J(STAIR.format(what='RICE-TERRACE', step='each step a flat grassy terrace top with a '
                                            'thin line of golden rice stubble, over a mossy dry-stone retaining wall '
                                            'riser', under='mossy dry-stone retaining walls and earth',
                                            light=LIGHT['s1t']), WIDE['s1t'])
    # 過場遮蓋件（接縫、坡頂轉折）：每關一張 4 件拼版＋一件大前景
    COVER = {
        's1': ('s1w', '(1) a clump of ferns and tall grass, (2) a pile of mossy rocks with ferns, (3) a low bush of '
                      'pampas grass and reeds, (4) a fallen mossy log with mushrooms and ferns'),
        's2': ('s2w', '(1) a clump of reeds and cattails, (2) a pile of mossy rocks with ferns, (3) a low bush with '
                      'red maple leaves, (4) a small mossy stone lantern among ferns'),
        's3': ('s3', '(1) a pile of rusty pipe stubs and valves, (2) a heap of coal and scrap iron with bolts, (3) a '
                     'stack of iron plates and gears, (4) a low iron crate with rivets and a hazard stripe'),
    }
    for st, (lk, items) in COVER.items():
        j[f'cover_{st}_sheet'] = J(g2.SHEET_T.format(n=4, layout='in two rows of two', light=LIGHT[lk], text=NO_TEXT,
                                                     items='four LOW ground clumps used to hide joins in the ground '
                                                           '(each wider than tall, flat bottom): ' + items + '.'),
                                   REFS[lk])
    FOG = {'s1': ('s1w', 'a long wall of dense ferns, tall grass and mossy rocks with soft mist drifting through it'),
           's2': ('s2w', 'a long wall of dense reeds, ferns and mossy rocks with soft moonlit mist drifting through it'),
           's3': ('s3', 'a long bank of billowing white steam clouds pouring out of broken pipes along the floor')}
    for st, (lk, what) in FOG.items():
        j[f'cover_{st}_fore'] = J(
            REF_TXT + 'ONE FOREGROUND COVER PIECE for a 2D side-scrolling game (it passes very close in front of the '
            'camera) on a TRANSPARENT background, in ' + STYLE + f': {what}, standing on the bottom edge of the '
            'picture, filling the whole width and about half of the height, slightly darker and more saturated than '
            'the background; soft edges at the top.' + LIGHT[lk] + CHUNKY + NO_CHAR, WIDE[lk])
    # 踏腳石（瀑布水潭）
    j['stones_s1'] = J(g2.SHEET_T.format(n=3, layout='in one row', light=LIGHT['s1w'], text=NO_TEXT,
                                         items='three STEPPING STONES standing in water (the water is NOT drawn): big '
                                               'flat-topped wet dark rocks with moss on top, each with a flat walkable '
                                               'top surface, different widths.'), REFS['s1w'])
    j['stones_s2'] = J(g2.SHEET_T.format(n=3, layout='in one row', light=LIGHT['s2w'], text=NO_TEXT,
                                         items='three STEPPING STONES standing in water (the water is NOT drawn): big '
                                               'flat-topped wet dark rocks with moss on top and moonlit wet edges, '
                                               'each with a flat walkable top surface, different widths.'), REFS['s2w'])
    return j


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def gen(name: str, job: dict, note: str) -> str:
    with _LOCK:
        n = 1
        while any((RAW / f'{name}.try{n}{s}').exists() for s in ('.png', '.pending', '.reject.png')):
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    out = RAW / f'{name}.try{n}.png'
    prompt = job['prompt'] + (f' {note}' if note else '')
    inp = slope_guide(*job['guide']) if 'guide' in job else job['ref']
    t0 = time.time()
    status = gp.call_codex(prompt, inp, out, job.get('transp', True))
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    size = Image.open(out).size if out.exists() else None
    record(name, {'attempt': n, 'status': status, 'size': size, 'ref': Path(inp).name, 'prompt': prompt,
                  'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status[:200]}（{time.time() - t0:.0f} 秒）{size}'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', nargs='+')
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=10)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    table = jobs()
    names: list[str] = []
    for w in a.what:
        if w == 'flat':
            names += [k for k in table if k.startswith('ground_')]
        elif w == 'slopes':
            names += [k for k in table if k.startswith('slope_')]
        elif w == 'rest':
            names += [k for k in table if not k.startswith(('ground_', 'slope_'))]
        elif w.endswith('*'):
            names += [k for k in table if k.startswith(w[:-1])]
        elif w in table:
            names.append(w)
        else:
            sys.exit(f'不認得：{w}')
    for nm in names:
        r = table[nm].get('ref')
        if r is not None and not Path(r).exists():
            sys.exit(f'{nm} 的參考圖不存在：{r}')
    print(f'{len(names)} 張', flush=True)
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for line in pool.map(lambda nm: gen(nm, table[nm], a.note), names):
            print(line, flush=True)


if __name__ == '__main__':
    main()
