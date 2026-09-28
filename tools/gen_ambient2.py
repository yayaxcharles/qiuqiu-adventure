"""天氣、背景生物、大場面（2026-09-27，規劃書第一～三節）：用 Codex 生原圖。

  python tools/gen_ambient2.py list                    列出全部工作
  python tools/gen_ambient2.py gen 名字 [名字...]      生（可一次多個並行；all＝全部、A／B／V／C＝整類）
  python tools/gen_ambient2.py gen 名字 --note "..."   在提示詞最後加一句（重生時用）
  python tools/gen_ambient2.py green 名字[=第幾次] ...  Vids 參考圖：透明原圖貼到 1280x720 純綠畫布 → vids/ambient/
原圖存 art_raw/ambient/<名字>.try<N>.png，提示詞記在 art_raw/ambient/prompts.json；後製在 tools/post_ambient2.py。

三種生法：
  black  畫在純黑底上（光、霧、雨、火花、閃電這類「只有光」的東西），後製時把黑底換成透明、保留半透明。
  alpha  直接要透明背景（有實體的東西：碎鐵、飛艇、花瓣、屋脊碎塊）。
  vids   Google Vids 要動起來的角色：照 tools/gen_monster_refs.py 的做法，側面朝左、透明背景，之後貼綠幕。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'ambient'
LOG = RAW / 'prompts.json'
VIDS = ROOT / 'vids' / 'ambient'
TREF = ROOT / 'art_raw' / 'terrain'
MSIDE = ROOT / 'art_raw' / 'monster_side'
NPC = ROOT / 'public' / 'art' / 'npc'
IMAGE_GEN = Path.home() / '.codex/skills/codex-ppt/scripts/image_gen.py'
_LOCK = threading.Lock()

STYLE = ('richly detailed hand-drawn and hand-painted 2D side-scrolling arcade game art in the style of classic '
         'run-and-gun games like Metal Slug: crisp dark outlines on solid shapes, rich texture and shading')
REF_TXT = ('Reference image 1 is a finished background scene from the same game: match its drawing style, line '
           'quality, rendering, colour palette and LIGHTING EXACTLY, but draw ONLY the thing described below (nothing '
           'from the reference scene itself). ')
BLACK = (' Everything else is PURE SOLID BLACK (#000000): the background must be completely flat black with no '
         'texture, no vignette, no scenery, no ground, no horizon, no stars, no text, no border. The effect is made '
         'only of light, so its colours must be bright on the black.')
ALPHA = ' Transparent background. NO ground, NO scenery, NO text, NO letters, NO frame, NO border.'
SHEET = ('A SPRITE SHEET of {n} separate {what} for a 2D side-scrolling game, laid out {layout}, NOT touching each '
         'other, with wide empty gaps (at least 120 pixels) between them: ')

# ── 霧帶：3:1 黑畫布 edit，出來約 2172x724 ──
FOG_T = ('The input image is an empty pure black canvas. Paint on it ONLY a HORIZONTAL BAND OF {kind}, as a '
         'hand-painted visual-effect layer for a 2D side-scrolling game (soft painterly brush strokes, not a photo): '
         '{shape} The mist is white and pale grey, semi-transparent-looking, with soft feathered edges and gentle '
         'variations of density; it must be HORIZONTALLY CONTINUOUS from the left edge to the right edge with the '
         'same average height and density everywhere (it will be repeated side by side as a seamless tile), with no '
         'single dominant cloud and no gap.' + BLACK)
FOG = {
    'fog_s1_far': ('DISTANT TWILIGHT HAZE (between far bamboo hills)',
                   'a long, flat, stratified layer of distant haze made of several thin parallel wispy streaks, '
                   'occupying only the middle 40% of the picture height and fading softly to black above and below; '
                   'very soft and airy.'),
    'fog_s1_near': ('LOW GROUND MIST (drifting through a bamboo forest floor)',
                    'thick rolling ground mist lying along the bottom: its body fills the lower half of the picture, '
                    'densest along the bottom edge, and its top edge (at about 45% from the top) is made of soft '
                    'billowing puffs and curling wisps; above that it fades to black.'),
    'fog_s2_far': ('NIGHT RIVER MIST (far over the water)',
                   'a very flat, thin layer of mist hanging over distant water: long horizontal streaks and thin '
                   'veils, occupying only a narrow band around the middle (about 30% of the picture height), fading '
                   'to black above and below.'),
    'fog_s2_near': ('LOW RIVER MIST (creeping over the river surface)',
                    'low, dense mist creeping over a river surface: it fills the bottom 45% of the picture, densest '
                    'along the bottom edge, with long flat curling tendrils and slow wisps rising from its top edge; '
                    'above that it fades to black.'),
    'fog_s3_far': ('DISTANT FACTORY SMOG (industrial smoke haze over a city)',
                   'a heavy layered band of industrial smog made of long drifting smoke streaks with lumpy soot '
                   'clouds in it, occupying the middle half of the picture height, fading to black above and below.'),
    'fog_s3_near': ('LOW FACTORY SMOKE (thick smoke rolling along the street)',
                    'thick, lumpy rolling smoke along the bottom: billowing round smoke puffs and dirty wisps fill the '
                    'bottom half of the picture, densest along the bottom edge, fading to black above.'),
}

# ── 可無縫重複的雨幕（1024x1024，黑底） ──
RAIN_T = ('A full-frame SEAMLESS TILEABLE TEXTURE of {what}, painted as a visual-effect layer for a 2D side-scrolling '
          'game: {detail} All streaks are parallel, straight and slanted the same way, falling from the upper right '
          'to the lower left ({angle} away from vertical). They are scattered EVENLY over the whole square (no '
          'clusters, no empty areas, no perspective, no vanishing point); streaks that cross an edge continue on the '
          'opposite edge.' + BLACK)
RAIN = {
    'drizzle_1': ('fine far drizzle', 'about 220 very thin, very short (2-4% of the picture height) faint pale '
                  'lavender-white streaks, soft and dim.', 'about 10 degrees'),
    'drizzle_2': ('light drizzle', 'about 120 thin short (4-7% of the picture height) pale lavender-white rain streaks '
                  'of varied brightness, soft ends.', 'about 10 degrees'),
    'drizzle_3': ('near drizzle', 'about 45 thin but brighter streaks (8-12% of the picture height) with a tiny round '
                  'water droplet at the lower end of a few of them, pale lavender-white.', 'about 10 degrees'),
    'storm_rain_1': ('far dense storm rain', 'about 500 thin dense streaks (5-9% of the picture height) of cold '
                     'blue-white rain, a fine wall of rain.', 'about 28 degrees'),
    'storm_rain_2': ('driving storm rain', 'about 260 long streaks (10-18% of the picture height) of cold blue-white '
                     'rain of varied brightness, a strong wind-driven downpour.', 'about 28 degrees'),
    'storm_rain_3': ('near heavy storm rain', 'about 90 long thick streaks (20-35% of the picture height) of bright '
                     'blue-white rain, some smeared with motion blur, big heavy close raindrops.', 'about 28 degrees'),
}

# ── 其他黑底光效 ──
BLACK_JOBS = {
    'sunbeam': ('1536x1024', 'A hand-painted VOLUMETRIC LIGHT effect for a 2D side-scrolling game (soft painterly '
                'rendering): five or six broad soft SHAFTS OF WARM GOLDEN-ORANGE SUNSET LIGHT (god rays) streaming '
                'diagonally down from the upper-left corner toward the lower right, of different widths with dark gaps '
                'between them, a few tiny glowing dust motes floating inside the shafts, very soft feathered edges, the '
                'shafts brightest near the upper left and fading out completely before the lower right corner.'),
    'moonbeam': ('1536x1024', 'A hand-painted VOLUMETRIC LIGHT effect for a 2D side-scrolling game (soft painterly '
                 'rendering): four or five long soft SHAFTS OF COOL SILVER-BLUE MOONLIGHT streaming diagonally down '
                 'from the upper-left corner toward the lower right, of different widths with dark gaps between them, '
                 'very faint and misty, very soft feathered edges, brightest near the upper left and fading out '
                 'completely before the lower right corner.'),
    'fireflies': ('1536x1024', SHEET.format(n=6, what='FIREFLY LIGHT sprites', layout='in two rows of three') +
                  'top row: the SAME single firefly in three moments of its blink: (1) glowing brightly - a tiny '
                  'insect with a big bright yellow-green glowing tail and a soft round yellow-green halo around it, '
                  '(2) medium glow with a smaller halo, (3) almost dark, only a small dim glow; bottom row: (4) (5) (6) '
                  'three soft round out-of-focus glowing yellow-green light dots (bokeh) of large, medium and small '
                  'size. All drawn large and centred in their cells.'),
    'sparks': ('1536x1024', SHEET.format(n=4, what='FALLING SPARK sprites (hot metal sparks from a forge)',
                                         layout='in one row from left to right') +
               '(1) a short bright spark streak with a white-hot head and an orange-yellow tail, (2) a longer spark '
               'streak curving slightly as it falls, with a glowing orange trail, (3) a small cluster of three glowing '
               'spark dots with tiny tails, (4) one spark bursting into a star of tiny branching sparklets. All '
               'falling toward the lower left (tails point to the upper right). Bright orange, yellow and white-hot.'),
    'flame': ('1536x1024', 'AN ANIMATION STRIP of 3 frames for a 2D side-scrolling game: the FLAME of a burning oil '
              'rag on a fire arrow stuck in the ground (only the flame: no arrow, no ground). The 3 frames are laid out '
              'in one row from left to right, each centred in its own equal cell, NOT touching each other, with wide '
              'gaps; every flame is the SAME size and its base is at the SAME height near the bottom of the cells. A '
              'lively hand-painted flame: white-yellow core, orange and red tongues licking upward and leaning a '
              'little to the left in the wind, a few sparks. The frames form a flickering loop (3 flows back into 1).'),
    'meteors': ('1536x1024', SHEET.format(n=2, what='SHOOTING STAR (meteor) sprites', layout='one in the upper half '
                                          'and one in the lower half') +
                'each crosses diagonally, heading to the LOWER LEFT: a small very bright head and a long thin '
                'tapering glowing tail streaming back to the upper right. (1) a slim white-blue shooting star with a '
                'long fine tail, (2) a brighter warm golden-white one with a slightly wider tail and a few small '
                'sparkles falling off it.'),
    'impact_glow': ('1536x1024', 'AN ANIMATION STRIP of 4 frames for a 2D side-scrolling game: a HUGE METEOR IMPACT '
                    'seen from very far away, as it lights up behind a distant mountain ridge (only the light: no '
                    'mountain, no ground). Every frame sits on the SAME invisible horizontal base line near the '
                    'bottom of its cell (the glow is cut flat at the bottom, like a dome rising from behind a ridge). '
                    '(1) a small intense white-yellow flash point with a thin vertical pillar of light, (2) an '
                    'expanding white-orange glowing dome with a bright shockwave ring, (3) a big glowing orange-red '
                    'hemisphere with a rising glowing mushroom plume, (4) a fading dim red-orange glow with a faint '
                    'glowing smoke column. The 4 frames are laid out in one row from left to right, each centred in '
                    'its own equal cell, NOT touching each other, with gaps between them.'),
    'strike': ('1024x1536', 'AN ANIMATION STRIP of 2 frames for a 2D side-scrolling game: a LIGHTNING BOLT STRIKING '
               'DOWN onto a castle roof ridge (only the lightning: no roof, no clouds). The 2 frames are laid out side '
               'by side, each a tall bolt running from the very top edge down to about 90% of the picture height, '
               'NOT touching each other. (1) a jagged bright white-violet main bolt with several forked side branches '
               'and a soft purple glow, ending at the bottom in a bright white impact flash burst with sparks, (2) the '
               'SAME bolt shape a moment later: thinner, dimmer violet afterimage, branches faded, only small sparks '
               'left at the bottom.'),
    'heat_haze': ('1024x1024', 'A SEAMLESS TILEABLE GREYSCALE TEXTURE used as a heat-haze distortion map for a game '
                  '(a displacement map, not a picture): smooth soft wavy RISING RIPPLES of heat shimmer, like '
                  'vertical flowing wavy streaks stretched upward, gentle continuous gradients between mid-grey, lighter '
                  'grey and darker grey, NO hard edges, NO objects, NO noise speckles, evenly distributed over the '
                  'whole square, the top edge continuing into the bottom edge and the left edge into the right edge. '
                  'Black-and-white only, no colour.'),
}

# ── 透明背景的東西（有些帶關卡參考圖，讓色調跟背景一致） ──
def tref(st: str, kind: str, i: int) -> Path:
    return TREF / f'_ref_{st}_{kind}_{i}.png'


ALPHA_JOBS = {
    'puddles': (tref('s1', 'land', 2), REF_TXT + SHEET.format(n=3, what='RAIN PUDDLE decals', layout='in one row from '
                'left to right') + 'three small shallow rain puddles lying on dark earth, seen from a low side angle '
                'so each puddle is a FLAT THIN HORIZONTAL ELLIPSE about five times wider than tall (small, medium and '
                'large, with irregular organic outlines), the water mirror-reflecting the pink-purple twilight sky and '
                'dark bamboo silhouettes, a few ring ripples from raindrops, a thin wet dark rim.' + ALPHA),
    'rice_fluff': (tref('s1', 'land', 1), REF_TXT + SHEET.format(n=4, what='small DRIFTING RICE-FIELD FLUFF sprites',
                   layout='in one row from left to right') + '(1) a single golden rice grain husk with a thin hair-like '
                   'awn, (2) a soft fluffy white-gold seed tuft (a plume of fine hairs, like a grass seed), (3) a short '
                   'broken piece of golden rice straw, (4) a tiny spray of three rice grains on a thin stalk. Warm '
                   'golden dusk light, each drawn large and centred in its cell.' + ALPHA),
    'paper_petals': (tref('s2', 'land', 1), REF_TXT + SHEET.format(n=4, what='FALLING PAPER PETAL sprites (festival '
                     'confetti)', layout='in one row from left to right') + '(1) a pink cherry-blossom-shaped cut '
                     'washi-paper petal, (2) a red folded paper petal, (3) a white washi paper petal with a thin gold '
                     'edge, (4) a small gold paper plum-blossom cut-out; each slightly curled and tilted, lit by warm '
                     'lantern light, each drawn large and centred in its cell.' + ALPHA),
    'ash': (tref('s3', 'land', 1), REF_TXT + SHEET.format(n=4, what='FLOATING ASH FLAKE sprites', layout='in one row '
            'from left to right') + 'thin curled flakes of ash and burnt paper: (1) a charcoal-grey curled flake with '
            'pale grey edges, (2) a flake whose edges still glow orange with embers, (3) a small crumbled ash scrap, (4) '
            'a larger torn burnt-paper flake with a glowing orange ember rim. Each drawn large and centred in its '
            'cell.' + ALPHA),
    'roof_splash': (tref('s3', 'land', 3), REF_TXT + 'AN ANIMATION STRIP of 3 frames for a 2D side-scrolling game: '
                    'HEAVY RAIN SPLASHING ON ROOF TILES, only the water (no roof, no tiles). The 3 frames are laid '
                    'out in one row from left to right, each centred in its own equal cell, NOT touching each other, '
                    'each with its base on the SAME height near the bottom of the cells: (1) a raindrop hitting: a '
                    'small low crown of water, (2) a big splash crown spraying droplets up and sideways, (3) droplets '
                    'falling back and a fading low spray. Cold blue-white water with bright highlights from '
                    'lightning.' + ALPHA),
    'eave_drip': (tref('s3', 'land', 3), REF_TXT + 'AN ANIMATION STRIP of 2 frames for a 2D side-scrolling game: '
                  'RAINWATER POURING OFF THE EDGE OF A ROOF EAVE, only the water (no roof). The 2 frames are laid out '
                  'side by side, NOT touching each other, each a tall thin vertical trickle hanging from the SAME '
                  'height at the top of its cell down to the bottom: a wavering stream of water with drops breaking '
                  'off; in frame 2 the stream wavers differently and the drops are at different heights, so the two '
                  'frames loop. Cold blue-white water with bright highlights.' + ALPHA),
    'kite': (tref('s3', 'land', 1), REF_TXT + 'ONE MECHANICAL KITE flying in the sky, for the background of a 2D '
             'side-scrolling game, in ' + STYLE + ': a big bat-wing-shaped war kite of dark patched cloth stretched on '
             'a bamboo and brass frame, small gears and a clockwork box at its centre, a little lantern hanging '
             'under it, a long tail of cloth ribbons trailing to the right and a thin kite string hanging down to '
             'the lower right; seen from the side, flying to the LEFT. Just this one object.' + ALPHA),
    'airship': (tref('s3', 'land', 1), REF_TXT + 'ONE SMALL PATROL AIRSHIP for the background of a 2D side-scrolling '
                'game, in ' + STYLE + ', seen exactly from the side, flying to the LEFT (its rounded nose points to '
                'the left edge): a cigar-shaped gas envelope of patched brown canvas held by riveted dark iron and '
                'brass bands, small tail fins at the right end, a small wooden gondola hanging underneath with round '
                'glowing portholes and a paper lantern. At the very right end of the gondola there is ONLY a round '
                'brass propeller HUB on a short shaft, with NO propeller blades (the blades are drawn separately). '
                'Just this one object.' + ALPHA),
    'propeller': (tref('s3', 'land', 1), REF_TXT + 'AN ANIMATION STRIP of 2 frames for a 2D side-scrolling game: a '
                  'small spinning brass three-blade propeller seen EXACTLY FROM THE SIDE (edge-on, its axis pointing '
                  'left-right, so the spinning blades appear as a tall narrow vertical shape): (1) the blades pointing '
                  'up and down, long and sharp, (2) the blades half-turned, shorter and smeared with motion blur. The 2 '
                  'frames side by side, NOT touching, the same size, centred in their cells.' + ALPHA),
    'bird_flocks': (tref('s1', 'land', 1), SHEET.format(n=3, what='small BIRD FLOCK silhouettes for the far '
                    'background', layout='in one row from left to right, each flock inside its own third of the '
                    'picture') + 'every bird is a flat dark silhouette (dark grey-purple, no inner detail), flying to '
                    'the LEFT with wings in varied flap positions: (1) a V-shaped formation of 7 wild geese, (2) a '
                    'loose scattered flock of about 10 small crows, (3) a long gently wavy line of 6 birds one behind '
                    'the other. Each flock is compact inside its own third.' + ALPHA),
    'fire_arrow_fly': (tref('s1', 'land', 3), REF_TXT + 'ONE FLYING FIRE ARROW (a Japanese fire arrow, hiya), in '
                       + STYLE + ': a long thin wooden arrow shaft, horizontal, the iron arrowhead at the LEFT end and '
                       'grey feather fletching at the right end, a bundle of oil-soaked cloth tied just behind the '
                       'arrowhead burning with bright orange flames, the flames and a thin grey smoke trail streaming '
                       'back to the right along the shaft. Flying to the LEFT. Just this one object.' + ALPHA),
    'fire_arrow_stuck': (tref('s1', 'land', 3), REF_TXT + 'ONE FIRE ARROW STUCK IN THE GROUND, in ' + STYLE + ': a '
                         'long thin wooden arrow planted in the earth at a 40 degree slant, its head buried in a small '
                         'mound of dirt at the LOWER LEFT and its grey feather fletching at the UPPER RIGHT; the '
                         'oil-soaked cloth bundle on the shaft just above the dirt is charred black with glowing '
                         'red-orange embers but has NO flames (flames are added separately). A small patch of '
                         'scorched earth around the base. Just this one object.' + ALPHA),
    'scrap': (tref('s3', 'land', 2), REF_TXT + SHEET.format(n=4, what='FALLING RED-HOT SCRAP IRON sprites (debris '
              'thrown out by a forge explosion)', layout='in one row from left to right') + '(1) a twisted torn iron '
              'plate, (2) a broken half of a cog wheel, (3) a bent bracket with rivets, (4) a jagged iron shard. Each '
              'glows red-orange hot at its edges with dark iron in the middle and has a short trail of fire and sparks '
              'streaming back to the upper right (they fall toward the lower left).' + ALPHA),
    'forge_blast': (tref('s3', 'land', 2), REF_TXT + 'AN ANIMATION STRIP of 6 frames for a 2D side-scrolling game: a '
                    'BIG FORGE FURNACE EXPLOSION, in ' + STYLE + '. The 6 frames are laid out in TWO ROWS OF THREE '
                    '(read left to right, top row then bottom row), each centred in its own equal cell, NOT touching '
                    'each other, with gaps; every frame has its base at the same height near the bottom of its cell: '
                    '(1) a bright white-orange flash burst, (2) an expanding fireball throwing out molten sparks, (3) '
                    'a huge fireball with dark smoke starting at its edges, (4) the fire turning into billowing dark '
                    'smoke with glowing embers inside, (5) a dark grey-brown smoke cloud with a few glowing embers, '
                    '(6) thinning, dissipating grey smoke.' + ALPHA),
    'big_meteor': (tref('s2', 'land', 3), REF_TXT + 'ONE HUGE FLAMING METEOR streaking across the night sky, in ' +
                   STYLE + ': a glowing red-hot rock wrapped in fire at the LOWER LEFT, heading to the lower left, '
                   'with a long wide trail of fire, glowing embers and dark smoke streaming back to the UPPER RIGHT '
                   'corner, the trail getting thinner and fainter toward its end. Just this one object.' + ALPHA),
    'ridge_chunks': (tref('s3', 'land', 3), REF_TXT + SHEET.format(n=3, what='BROKEN ROOF PIECES flying apart after a '
                     'lightning strike', layout='in one row from left to right') + 'in the same style as the dark '
                     'blue-grey clay roof tiles of the castle roofs in the reference: (1) a big broken section of a '
                     'roof ridge: a row of dark ridge tiles on a snapped wooden beam, (2) a smaller cluster of a few '
                     'dark roof tiles stuck together with crumbling mortar, (3) a broken curved ornamental ridge-end '
                     'tile of dark bronze-coloured clay (NO face, NO text). Cold white-violet lightning highlights on '
                     'wet surfaces, a few small chips flying off.' + ALPHA),
}

# ── Google Vids 參考圖（側面朝左、透明背景；之後貼 1280x720 綠幕） ──
CHAR_STYLE = ('Match EXACTLY the drawing style of the reference character: the same cute chunky cartoon proportions, '
              'the same thick black outline and the same flat cel shading. ')
POSE = ('Draw it in a STRICT SIDE PROFILE VIEW FACING LEFT (we see only its left side, nose pointing to the left edge '
        'of the image, like a character in a 2D side-scrolling game), full body, {pose}. Transparent background, no '
        'ground, no shadow, no text, nothing else in the image.')


def webp_ref(name: str, src: Path) -> Path:
    """webp／透明圖貼白底 1024 方圖當參考（跟 gen_monster_refs 一樣）。"""
    out = RAW / f'_src_{name}.png'
    im = Image.open(src).convert('RGBA')
    bg = Image.new('RGBA', (1024, 1024), (255, 255, 255, 255))
    im.thumbnail((900, 900))
    bg.alpha_composite(im, ((1024 - im.width) // 2, (1024 - im.height) // 2))
    bg.convert('RGB').save(out)
    return out


# 名字: (參考圖, 參考圖用途 'same'＝同一角色換姿勢／'style'＝只學畫風, 描述, 姿勢, 飛的?, 寬的?)
VIDS_JOBS = {
    'goose': (MSIDE / 'crow_small_codex1.png', 'style', 'ONE single wild goose (a grey-brown bean goose with a long '
              'neck stretched forward, dark head, pale belly, orange-black bill), a gentle friendly background animal',
              'FLYING with both wings spread wide in mid-flap', True, True),
    'bat': (MSIDE / 'crow_small_codex1.png', 'style', 'ONE single small cute bat (dark purple-brown fur, big pointed '
            'ears, leathery wings with visible finger bones, small fangs, big round eyes)', 'FLYING with both wings '
            'spread wide', True, True),
    'rice_cat': (NPC / 'calico_happy.webp', 'same', 'the same calico village cat (white, orange and black patches, blue '
                 'jinbei with a yellow sash) carrying a big bulging straw rice sack (a tawara bale) on its back, held '
                 'with both front paws over its shoulder, bent forward a little under the weight', 'standing upright '
                 'on its two hind legs, in a walking stride', False, False),
    'cart_cat': (NPC / 'grey_happy.webp', 'same', 'the same grey tabby village cat (beige jinbei with a brown sash) '
                 'pushing a small wooden two-wheeled hand cart loaded with vegetables and a sack; the cart is IN FRONT '
                 'of the cat (on the LEFT), the cat behind it pushing the handles with both paws', 'standing upright on '
                 'its two hind legs, leaning forward, in a walking stride', False, True),
    'deer': (MSIDE / 'wild_boar_codex1.png', 'style', 'ONE graceful sika deer (a stag with small branching antlers, '
             'warm brown coat with white spots, white tail patch, slender legs), a calm background animal',
             'standing on all four legs, one front leg lifted, ready to walk', False, True),
    'torch_bandit': (MSIDE / 'orange_bandit_codex1.png', 'same', 'the same orange tabby cat bandit with the red eye-mask '
                     'bandana knotted at the back of the head, but instead of the club he holds a burning wooden TORCH '
                     'raised up in his front paw (a short thick stick with a rag bound at the top, bright orange '
                     'flame)', 'standing upright on two legs in a patrolling walk, looking ahead, tail curled up',
                     False, False),
    'fox': (MSIDE / 'wild_boar_codex1.png', 'style', 'ONE slender red fox (orange-red fur, white chest and tail tip, '
            'black socks, big bushy tail, pointed ears), a sly background animal', 'RUNNING on all four legs in a '
            'full stretched gallop, tail streaming behind', False, True),
    'carp': (MSIDE / 'kappa_codex1.png', 'style', 'ONE big koi carp (white with red-orange and black patches, long '
             'whiskers, big shiny scales, flowing fins) leaping out of the water with a few water droplets flying off '
             'its body (no water surface)', 'its body curved in a jumping arc, head up-left, tail flicking down-right',
             True, True),
    'mech_soldier': (MSIDE / 'iron_claw_codex1.png', 'style', 'ONE SMALL CLOCKWORK CAT FOOT-SOLDIER: a little '
                     'mechanical cat made of dark riveted iron plates and brass gears like the reference, glowing '
                     'orange eyes, a small wind-up key on its back, a simple iron jingasa soldier hat, holding a LONG '
                     'SPEAR (yari) upright on its shoulder; small and simple like a foot-soldier, NOT a boss',
                     'standing upright on two legs, marching in step', False, False),
}
WIDE = {k for k, v in VIDS_JOBS.items() if v[5]}
FLYING = {k for k, v in VIDS_JOBS.items() if v[4]}

GROUPS = {
    'A': list(FOG) + list(RAIN) + ['sunbeam', 'moonbeam', 'fireflies', 'sparks', 'heat_haze', 'puddles', 'rice_fluff',
                                   'paper_petals', 'ash', 'roof_splash', 'eave_drip'],
    'B': ['kite', 'airship', 'propeller', 'bird_flocks'],
    'V': list(VIDS_JOBS),
    'C': ['fire_arrow_fly', 'fire_arrow_stuck', 'flame', 'meteors', 'big_meteor', 'impact_glow', 'scrap',
          'forge_blast', 'strike', 'ridge_chunks'],
}


def black_canvas(w: int, h: int) -> Path:
    p = RAW / f'_black_{w}x{h}.png'
    if not p.exists():
        Image.new('RGB', (w, h), (0, 0, 0)).save(p)
    return p


def job(name: str) -> dict:
    """回傳 {mode, prompt, size, refs}。"""
    if name in FOG:
        kind, shape = FOG[name]
        return dict(mode='black', prompt=FOG_T.format(kind=kind, shape=shape), size='1536x1024',
                    refs=[black_canvas(2172, 724)])
    if name in RAIN:
        what, detail, angle = RAIN[name]
        return dict(mode='black', prompt=RAIN_T.format(what=what, detail=detail, angle=angle), size='1024x1024',
                    refs=[])
    if name in BLACK_JOBS:
        size, p = BLACK_JOBS[name]
        return dict(mode='black', prompt=p + ('' if name == 'heat_haze' else BLACK), size=size, refs=[])
    if name in ALPHA_JOBS:
        r, p = ALPHA_JOBS[name]
        return dict(mode='alpha', prompt=p, size='1536x1024', refs=[r] if 'Reference image 1' in p else [])
    if name in VIDS_JOBS:
        src, how, desc, pose, _, _ = VIDS_JOBS[name]
        ref = webp_ref(name, src) if src.suffix == '.webp' else src
        if how == 'same':
            head = f'The character: {desc}. Keep EXACTLY the same character design as the reference image (same ' \
                   'colours, markings, costume, face and proportions). ' + CHAR_STYLE
        else:
            head = f'Draw a NEW character in the same game art style as the reference image: {desc}. ' + CHAR_STYLE + \
                   'Do NOT copy the reference character itself. '
        return dict(mode='vids', prompt=head + POSE.format(pose=pose), size='1024x1024', refs=[ref])
    raise SystemExit(f'不認得：{name}')


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def next_try(name: str) -> int:
    with _LOCK:
        n = 1
        while any((RAW / f'{name}.try{n}{s}').exists() for s in ('.png', '.pending')):
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    return n


def gen(name: str, note: str = '') -> str:
    j = job(name)
    n = next_try(name)
    out = RAW / f'{name}.try{n}.png'
    prompt = j['prompt'] + (f' {note}' if note else '')
    transp = j['mode'] in ('alpha', 'vids')
    cmd = [sys.executable, str(IMAGE_GEN), 'edit' if j['refs'] else 'generate', '--backend', 'codex-oauth',
           '--model', 'gpt-image-1.5', '--quality', 'high', '--size', j['size'], '--prompt', prompt, '--out', str(out),
           '--force', '--background', 'transparent' if transp else 'opaque']
    for r in j['refs']:
        cmd += ['--image', str(r)]
    t0 = time.time()
    status = 'failed'
    for _ in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists():
            status = 'ok'
            break
        status = f'failed: {(r.stderr or r.stdout).strip()[-400:]}'
        low = status.lower()
        if not any(t in low for t in ('capacity', 'rate', 'timed out', 'timeout', 'http 5', 'overloaded')):
            break
        time.sleep(30)
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    size = Image.open(out).size if out.exists() else None
    record(name, {'attempt': n, 'status': status, 'mode': j['mode'], 'refs': [Path(x).name for x in j['refs']],
                  'size': size, 'prompt': prompt, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）{size or ""}'


def to_green(name: str, pick: Path) -> Path:
    im = Image.open(pick).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 255 if v > 24 else 0)
    im = im.crop(a.getbbox())
    maxw, maxh = (760, 440) if name in WIDE else (560, 520)
    s = min(maxw / im.width, maxh / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    canvas = Image.new('RGBA', (1280, 720), (0, 255, 0, 255))
    cx = 820                                   # 偏右，左邊留空間
    x = cx - im.width // 2
    y = 360 - im.height // 2 if name in FLYING else 650 - im.height   # 腳底落在 650；飛的放中央
    canvas.alpha_composite(im, (x, y))
    VIDS.mkdir(parents=True, exist_ok=True)
    out = VIDS / f'{name}_參考圖_綠幕.png'
    canvas.convert('RGB').save(out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['list', 'gen', 'green'])
    ap.add_argument('names', nargs='*')
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if a.cmd == 'list':
        for g, names in GROUPS.items():
            print(g, ' '.join(names))
        return
    names: list[str] = []
    for w in a.names:
        if w == 'all':
            names += [n for g in GROUPS.values() for n in g]
        elif w in GROUPS:
            names += GROUPS[w]
        else:
            names.append(w)
    if a.cmd == 'gen':
        for nm in names:
            job(nm)   # 先檢查名字與參考圖
        with ThreadPoolExecutor(a.workers) as ex:
            for line in ex.map(lambda nm: gen(nm, a.note), names):
                print(line, flush=True)
    elif a.cmd == 'green':
        for spec in names:
            nm, _, k = spec.partition('=')
            print(to_green(nm, RAW / f'{nm}.try{k or 1}.png'))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
