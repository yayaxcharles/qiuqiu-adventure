"""三大關的場景與特效生圖（2026-09-26）：Codex（codex-oauth, gpt-image-1.5），寫法照 gen_art.py。

  python tools/gen_stage_art.py s1_1_far s1_1_ground   指定幾張
  python tools/gen_stage_art.py far                    一整組（far / ground / props / fx / icons / npc / ui / all）
  加 --note "..." 補一句提示；每次存成 art_raw/stage_art/<名稱>.try<N>.png，不蓋舊的。
  後製（切圖、無縫、轉 webp、寫 art.json）在 tools/post_stage_art.py。
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
RAW = ROOT / 'art_raw' / 'stage_art'
REF = RAW / '_ref'
IMAGE_GEN = Path.home() / '.codex/skills/codex-ppt/scripts/image_gen.py'
LOG = RAW / 'prompts.json'
_LOCK = threading.Lock()

STYLE = ('cute Japanese chibi cartoon game art: thick bold black outlines, flat colours with soft simple gradients, '
         'clean readable shapes, warm friendly palette')
VILLAGE_REF = ('Reference image 1 is an existing background from the same game: copy its drawing style, line weight, '
               'colour treatment and level of detail EXACTLY, but draw a completely NEW scene as described, with the '
               'time of day, colours and lighting of the NEW scene (not the dusk colours of the reference). ')
HERO_REF = ('Reference image 1 shows QIUQIU, the hero of this game (a chibi cream-and-brown tabby cat ninja in a navy gi '
            'and navy headband): copy his drawing style EXACTLY - thick black outlines, flat colours with soft '
            'gradients, cute chibi proportions (a big round head as big as the whole body, short chubby body, white '
            'paws). ')
WEAPON_REF = ('Reference images 1-3 show existing ninja gear projectiles and weapon icons from the same game (a '
              'shuriken, a kunai, and a scroll-shaped weapon icon): copy their exact art style EXACTLY - thick black '
              'outlines, flat colours with soft simple gradients, cute chibi cartoon game art - for the NEW items '
              'described below. Do not copy their shapes, only the line weight, shading and colour treatment. ')

# ── 遠景：每關三段 ──
FAR = {
    's1_1': 'a quiet Japanese mountain village at dusk: warm orange sky fading to purple at the top, a big setting sun, '
            'soft clouds, distant misty purple mountains, rows of village houses with dark tiled roofs and glowing '
            'paper windows in the middle distance, a small pagoda on a far hill, bushes and wooden fences low down',
    's1_2': 'a deep bamboo forest at dusk: many tall green bamboo stalks in several layers fading into orange-purple '
            'mist, warm dusk light rays between the stalks, a few falling bamboo leaves, the tops of the stalks going '
            'out of the top of the picture, dense bamboo undergrowth low down',
    's1_3': 'a mountain bandit fortress at dusk turning to evening: dark orange-purple sky, a tall wooden palisade wall '
            'of sharpened logs running across the whole picture, wooden watchtowers with torches behind it, rough '
            'thatched huts and plain cloth banners (no writing), the glow of a big campfire and smoke rising, rocky '
            'cliffs in the far distance',
    's2_1': 'a night yokai festival street: deep blue-purple night sky with colourful fireworks bursting, long strings '
            'of glowing red paper lanterns criss-crossing, festival stall roofs with striped awnings and wooden shop '
            'houses in the middle distance, warm lantern glow, a shrine on a far hill',
    's2_2': 'a riverbank at night: a big full moon in a starry navy sky, a calm wide river with shimmering moonlight '
            'reflections across the whole width, a long low wooden bridge in the far distance, weeping willow trees, '
            'reeds and fireflies along the far bank, distant dark hills',
    's2_3': 'a mountaintop Shinto shrine at night: a huge full moon, navy sky with thin clouds, a shrine hall with a '
            'curved roof on the far hilltop, rows of small red torii gates climbing stone steps in the distance, '
            'glowing stone lanterns, red and orange maple trees with falling leaves',
    's3_1': 'the outer town of a giant mechanical iron castle under a dark overcast sky with an orange smoggy glow: '
            'massive grey stone castle walls with huge brass gears built into them, thick steam pipes puffing white '
            'steam, iron smokestacks with dark smoke, the silhouette of a dark iron castle keep in the far distance',
    's3_2': 'the INSIDE of a gloomy mechanical factory (no sky at all): a dark riveted iron back wall, big turning '
            'brass gears, long conveyor belts on rails, glowing orange forges and furnaces, hanging chains and '
            'hooks, pipes and pressure gauges, warm orange light against cold blue-grey shadows',
    's3_3': 'the top of a Japanese castle keep in a violent thunderstorm: very dark stormy sky with swirling '
            'clouds, bright lightning bolts, slanting rain, other dark castle rooftops with golden ornaments far below '
            'and distant mountains, a dramatic cold blue-purple palette with white lightning highlights',
}
# 遠景一律拿舊背景（village.webp）當畫風參考（線條粗細才一致），時段與色調照各段文字
FAR_TMPL = (
    'A 2D SIDE-SCROLLING GAME FAR BACKGROUND LAYER (a parallax backdrop), in ' + STYLE + '. Scene: {scene}. '
    'Pure side view like a platformer backdrop. Draw only the sky and the distant scenery; the scenery continues '
    'down to the bottom edge of the picture (the bottom 20% will be hidden behind a separate ground layer, so fill '
    'it with distant bushes, mist or walls - NOT a road, path or floor). NO ground path, NO road, NO characters, NO '
    'people, NO animals, NO text, NO letters, NO UI, NO frame. HORIZONTALLY SEAMLESS TILE: this picture will be '
    'repeated side by side endlessly, so the LEFT EDGE and the RIGHT EDGE must continue into each other: keep the '
    'sky, horizon and skyline at the same heights at both edges, and do not let any big object cross the left or '
    'right edge. Keep the middle height band calm and slightly muted so game characters stay readable in front of it.')

# ── 地面帶：每段一條（透明） ──
GROUND = {
    's1_1': ('a packed brown dirt village road with small pebbles and darker soil layers below',
             'a few small grass tufts and one small round stone'),
    's1_2': ('a dark brown forest soil path covered with fallen yellow-green bamboo leaves, roots in the soil below',
             'a few short bamboo shoots and fallen leaves'),
    's1_3': ('trampled dirt ground of a bandit camp with embedded flat stones and wooden plank pieces',
             'a small rock, a coil of rope and a broken wooden plank'),
    's2_1': ('a grey cobblestone festival street with neat rounded stones and earth below',
             'a few dropped paper fans and small paper lanterns lying on the ground'),
    's2_2': ('the deck of a long wooden plank bridge seen from the side: a thick straight wooden walkway with a '
             'darker wooden beam under it, and dark blue river water with small light ripples filling the space '
             'below the beam down to the bottom edge', 'a few short wooden railing posts'),
    's2_3': ('a grey stone-paved shrine path with gravel and earth below', 'a few fallen red maple leaves and one '
             'small stone marker'),
    's3_1': ('a dark grey stone brick road with iron drain grates and brass rivets', 'a few small brass bolts and a '
             'tiny puff of steam from a grate'),
    's3_2': ('a riveted dark iron factory floor made of metal plates with yellow-and-black hazard stripes along the '
             'top edge and pipes running underneath', 'a few small scattered cogs and a coil of chain'),
    's3_3': ('the flat top ridge of a Japanese castle roof: a straight ridge beam capped with dark grey wet roof '
             'tiles (kawara), rows of tiles below, small rain puddles shining on the tiles', 'a few small rain '
             'splashes'),
}
GROUND_TMPL = (
    'A 2D SIDE-SCROLLING GAME GROUND STRIP on a TRANSPARENT background, in ' + STYLE + '. Only the ground: {ground}. '
    'Seen exactly from the side like a platformer floor. The solid ground occupies ONLY the bottom 20% of the canvas '
    'and touches the bottom edge, the left edge and the right edge. Its TOP SURFACE, where characters walk, is ONE '
    'PERFECTLY STRAIGHT HORIZONTAL LINE across the whole width, outlined with a thick black line. On top of the '
    'surface only a few small low decorations sit on the ground ({props}), each no taller than 8% of the canvas '
    'height and kept away from the left and right edges. Everything above that is completely empty and '
    'transparent. HORIZONTALLY SEAMLESS TILE: the left end and the right end must continue into each other. No sky, '
    'no background scenery, no characters, no animals, no text, no frame.')

# ── 前景裝飾（每關一張拼版，後製切開） ──
PROPS = {
    's1': ['a cluster of three tall green bamboo stalks with leaves (the tallest item, about 80% of the canvas height)',
           'a wooden drying rack with a row of dried fish hanging on a rope',
           'a small campfire of crossed logs with bright orange flames, ringed by stones',
           'a short section of wooden palisade fence made of sharpened logs tied with rope'],
    's2': ['a long horizontal string of five glowing red paper lanterns hanging on a rope that sags gently',
           'a red Shinto torii gate (the tallest item, about 80% of the canvas height)',
           'a grey stone lantern (toro) with a warm glowing window',
           'a small festival food stall with a striped red-and-white awning and a wooden counter'],
    's3': ['a big brass gear wheel standing upright with a dark iron axle',
           'an L-shaped thick copper steam pipe with a red valve wheel and a pressure gauge, puffing a little white steam',
           'a small iron forge furnace with glowing orange coals and a chimney',
           'a heavy iron chain hanging straight down with a big hook at the bottom (the tallest item)'],
}
PROPS_TMPL = (
    'A SPRITE SHEET of {n} separate FOREGROUND DECORATION PROPS for a side-scrolling ninja cat game, in ' + STYLE + '. '
    'Transparent background. Draw each prop separately in side view, NOT touching each other, with at least 80 '
    'pixels of empty space between them, laid out left to right in one row, at a consistent game scale: {items}. '
    'Each prop complete, solid and opaque, with a thick black outline. No characters, no animals, no text, no '
    'labels, no ground, no cast shadows, no border.')

SHEETS = {
    'fx_weapons': (
        'A SPRITE SHEET of ninja weapon projectiles for a side-scrolling ninja cat game, in ' + STYLE + '. '
        'Transparent background. SIX separate items, NOT touching, with at least 80 pixels of empty space between '
        'them, arranged in two rows of three, each item centred in its own cell. Row 1: (1) a SHURIKEN: a small '
        'four-pointed steel ninja star with a hole in the middle, flat front view; (2) a KUNAI: a steel throwing '
        'knife with a black cloth-wrapped handle and a ring at the end, lying horizontally with the blade pointing '
        'RIGHT; (3) a FUMA SHURIKEN: a large four-bladed windmill shuriken of dark steel with a round centre, flat '
        'front view, the biggest item. Row 2: (4) ONE SENBON NEEDLE: a single long thin steel throwing needle lying '
        'horizontally pointing RIGHT; (5) a SHIKIGAMI PAPER CRANE: a white origami paper crane with a small red '
        'circle mark on its wing, flying to the RIGHT, side view; (6) an EXPLODING TAG: a vertical paper talisman '
        'strip (ofuda) with a red abstract swirl-and-circle seal pattern (no readable characters), with a short lit '
        'fuse sparking at the top. Everything solid with a thick black outline. No text, no letters, no labels, no '
        'ground, no shadows, no border.'),
    'fx_beams': (
        'A SPRITE SHEET of two long horizontal ninja magic attacks for a side-scrolling game, in ' + STYLE + '. '
        'Transparent background. TWO separate items stacked in two rows with a wide empty gap between them, each '
        'spanning almost the full width of the canvas. Row 1: a FIRE DRAGON JET - a horizontal stream of bright '
        'orange-yellow cartoon flames flowing to the RIGHT, starting narrow at the left end, the right end shaped '
        'like a small fierce stylised dragon head made of fire with an open mouth; the middle section is an even '
        'band of swirling fire of constant thickness. Row 2: a PURPLE LIGHTNING BEAM - a straight horizontal band of '
        'jagged violet-purple electricity with a bright white core and small crackling branches, flowing to the '
        'RIGHT, of even thickness along its whole length. Bold black or dark purple outlines. No text, no '
        'characters, no ground, no border.'),
    'fx_explosion': (
        'An EXPLOSION ANIMATION for a side-scrolling game, in ' + STYLE + '. Transparent background. FOUR separate '
        'frames in one row from left to right, growing from small to big, each frame centred in its own quarter of '
        'the canvas, NOT touching the others, with empty space between them: (1) a small bright white-yellow flash '
        'burst; (2) a medium round orange fireball with a yellow core; (3) a big round cartoon explosion of orange '
        'fire and dark smoke puffs with sparks; (4) the biggest frame: a dissipating grey-brown smoke cloud with a '
        'few glowing embers. Thick black outlines on the fire and smoke shapes. No text, no ground, no border.'),
    'fx_misc': (
        'A SPRITE SHEET of five small combat effects for a side-scrolling ninja cat game, in ' + STYLE + '. '
        'Transparent background. FIVE separate items in one row, NOT touching, with at least 80 pixels of empty '
        'space between them: (1) a SMOKE PUFF: a round fluffy cartoon cloud of pale grey ninja smoke; (2) a HIT '
        'SPARK: a white-and-yellow star-shaped impact burst with a few short speed lines around it; (3) an ENEMY '
        'FIREBALL: a round orange-red fireball flying to the LEFT, its flame tail trailing to the right; (4) an '
        'ENEMY WATER BULLET: a round blue water blob flying to the LEFT, with a splashy tail trailing to the right '
        'and a white shine; (5) an ENEMY LEAF BLADE: a single sharp green leaf with a light vein, flying to the LEFT '
        'with a few small motion lines trailing to the right. Thick black outlines. No text, no ground, no border.'),
    'icons': (
        'A SPRITE SHEET of SEVEN WEAPON PICKUP ICONS for a ninja cat side-scrolling game, in ' + STYLE + '. '
        'Transparent background. SEVEN separate items, NOT touching, with at least 70 pixels of empty space between '
        'them: the top row has four items, the bottom row has three items, each item centred in its own cell and all '
        'about the same size. Each of the first six icons is a small rolled NINJA SCROLL (makimono) lying '
        'horizontally with wooden ends, with a big round coloured emblem disc in the middle showing ONE bold white '
        'capital letter with a thick black outline: (1) letter H on a steel-blue disc, with two small kunai crossed '
        'behind the scroll; (2) letter R on a green disc, with a small windmill shuriken behind; (3) letter F on a '
        'red-orange disc, with small flames behind; (4) letter S on a golden-yellow disc, with a small fan of thin '
        'needles behind; (5) letter L on a purple disc, with small lightning bolts behind; (6) letter C on a pink '
        'disc, with a small white paper crane behind. (7) The seventh icon has NO letter: a small bundle of three '
        'red paper exploding talismans tied with a rope, with a sparking fuse. The letters must be exactly H, R, F, '
        'S, L, C; no other text anywhere. Thick black outlines, bright readable colours. No border.'),
}

# ── 忍具第二版新增（2026-09-26）：飛行道具／特效＋圖示 ──
NINJA2 = {
    'fx2_props': (
        'A SPRITE SHEET of six separate ninja gear items for a side-scrolling ninja cat game, in ' + STYLE + '. '
        'Transparent background. SIX separate items, NOT touching, with at least 80 pixels of empty space between '
        'them, the top row has three items, the bottom row has three items, each item centred in its own cell. Row 1: '
        '(1) a BO SHURIKEN: a single long thin straight steel throwing spike, sharp at both ends, lying horizontally '
        'pointing RIGHT; (2) a CALTROP (tetsu-bishi): a SOLID CHUNKY 3D clump of four short thick iron spikes fused '
        'together at a central core (like a small heavy metal jack / caltrop toy piece, ALWAYS resting so exactly '
        'one spike points straight UP and the other three form a tripod stand on the ground) - it must look like a '
        'thick solid lump of cast iron with visible rounded 3D shading, clearly THICKER and CHUNKIER than a flat '
        'blade; it must NOT look like a flat four-pointed ninja star / shuriken (no thin flat symmetrical blades '
        'meeting at a hole in the middle); (3) a BLOW DART (fukiya): a single very thin steel '
        'needle-dart with a small tuft of red feather fletching at the back end, lying horizontally pointing RIGHT. '
        'Row 2: (4) a BAMBOO FIRE TUBE (a stand-alone prop, NOT a hand holding it): a stubby bamboo tube bound with '
        'rope, a dark charred opening at the front end ready to shoot flame out, lying horizontally pointing RIGHT; '
        '(5) a KUSARIGAMA SICKLE HEAD: a curved black steel sickle blade with a short wooden handle and a metal ring '
        'at the butt end where a chain attaches, lying roughly horizontal; (6) a HOROKU BOMB: a round clay pot bomb '
        '(spherical, dark reddish-brown clay, perfectly PLAIN smooth surface with NO markings, NO writing, NO kanji, '
        'NO symbols painted on it) with a short lit fuse sparking out of the top. Everything solid and '
        'opaque with a thick black outline, flat colours. No text, no letters, no labels, no ground, no cast shadows, '
        'no border.'),
    'fx2_stretch': (
        'A SPRITE SHEET of two long horizontal ninja gear effects for a side-scrolling game, in ' + STYLE + '. '
        'Transparent background. TWO separate items stacked in two rows with a wide empty gap between them, each '
        'spanning almost the full width of the canvas. Row 1: a BAMBOO FIRE JET - a horizontal stream of bright '
        'orange-yellow cartoon flame flowing to the RIGHT, starting at a dark charred bamboo-tube nozzle on the LEFT '
        'end, the flame of even thickness along the middle section, tapering to a soft flame tip at the right end. '
        'Row 2: a KUSARIGAMA CHAIN - a straight horizontal length of dark iron chain links, of even thickness along '
        'its whole length, ending in a small round iron ring on the right end (where a sickle would attach). Thick '
        'black outlines. No text, no characters, no ground, no border.'),
    'fx2_smoke': (
        'A SPRITE SHEET of three small ninja smoke/poison effects for a side-scrolling ninja cat game, in ' + STYLE +
        '. Transparent background. THREE separate items in one row, NOT touching, with at least 80 pixels of empty '
        'space between them: (1) a SMOKE BALL (metsubushi): one small solid round black iron ball, flat front view, '
        'small size; (2) a BIG SMOKE CLOUD: a large fluffy round puff of pale grey-white smoke billowing outward, '
        'much bigger than item 1, the cloud released after a smoke ball explodes; (3) a POISON BUBBLE: a small '
        'cluster of two or three round translucent purple bubbles with a subtle shine, cute not scary. Thick black '
        'outlines. No text, no ground, no border.'),
    'fx2_mouse': (
        'A SPRITE SHEET of a running fire-mouse ninja gadget (nezumi-bi) for a side-scrolling game, in ' + STYLE +
        '. Transparent background. TWO separate poses of the SAME character side by side, NOT touching, with at '
        'least 150 pixels of empty space between them, both the same size, their lowest points on the same '
        'baseline: a small round chibi mouse-shaped firework body (plain grey mouse with round ears, simple cute '
        'shape, no clothes) running fast to the RIGHT with a lit sparking fuse sticking up from its back and a '
        'trail of small fire sparks behind it; POSE 1 (left item): front paw forward, back legs stretched back, '
        'mid-stride running pose; POSE 2 (right item): the opposite stride, front paw back, back legs forward. Both '
        'facing RIGHT. Complete and opaque, thick black outlines. No text, no ground, no shadows, no border.'),
    'icons2': (
        'A SPRITE SHEET of EIGHT WEAPON PICKUP ICONS for a ninja cat side-scrolling game, in ' + STYLE + '. '
        'Transparent background. EIGHT separate items, NOT touching, with at least 70 pixels of empty space between '
        'them: the top row has four items, the bottom row has four items, each item centred in its own cell and all '
        'about the same size. Each of the first six icons is a small rolled NINJA SCROLL (makimono) lying '
        'horizontally with wooden ends, with a big round coloured emblem disc in the middle showing ONE bold white '
        'capital letter with a thick black outline: (1) letter I on a brown disc, with a small cute cartoon '
        'mouse-shaped firework with a sparking fuse behind the scroll; (2) letter D on a soft pink disc, with a '
        'small fluffy round fur ball behind; (3) letter B on a teal disc, with a small thin blow-dart needle with '
        'red feather fletching behind; (4) letter F on a red-orange disc, with a small stubby bamboo fire tube '
        'shooting a puff of flame behind; (5) letter S on a golden-yellow disc, with a small 3D iron caltrop behind '
        'that looks like a tiny metal JACK (the toy) or a stubby tripod anchor: one short thick CONE-shaped spike '
        'pointing straight up out of a rounded hub, with two more short thick cone spikes as legs below - render it '
        'with heavy rounded 3D volume like a chess pawn or a bollard, so it reads as a solid lump of iron, NEVER as '
        'a flat bladed star: it must have NO thin flat triangular blades and NO flat symmetric four-pointed star '
        'silhouette anywhere - if it looks anything like a shuriken, it is wrong; (6) letter L on a purple disc, '
        'with a small curved kusarigama sickle blade '
        'and a short length of chain behind. (7) The seventh icon has NO letter: a round clay HOROKU bomb pot with '
        'a sparking fuse, drawn bigger, the item itself, its clay surface perfectly PLAIN and smooth with NO '
        'markings, NO writing, NO kanji, NO symbols painted on it. (8) The eighth icon has NO letter: a small solid '
        'black SMOKE BALL (metsubushi) with a wisp of pale smoke curling off it, the item itself. The letters must '
        'be exactly I, D, B, F, S, L; absolutely no other text, kanji or symbols anywhere on any icon. Thick black '
        'outlines, bright readable colours. No border.'),
}
NINJA2_REFS = ['_ref/shuriken.png', '_ref/kunai.png', '_ref/weapon_H.png']

# 拼版裡的爆裂符圖示畫成炸藥棒，跟丟出去的符紙對不上，單獨再生一張
ICON_BOMB = (
    'ONE WEAPON PICKUP ICON for a ninja cat side-scrolling game, in ' + STYLE + '. Transparent background. A small '
    'bundle of THREE vertical PAPER TALISMAN STRIPS (Japanese ofuda, cream paper) fanned out slightly and tied '
    'together at the middle with a red rope, each strip printed with a red abstract swirl-and-circle seal pattern '
    '(no readable characters), and a short lit fuse sparking at the top. One single item centred on the canvas, '
    'taking about 60% of the canvas height. Thick black outlines, bright readable colours. No text, no letters, no '
    'glow, no ground, no shadow, no border.')

NPC = {
    'npc_calico': 'a CALICO village cat (white fur with big orange and black patches) wearing a short light-blue '
                  'village kimono with a small yellow sash',
    'npc_grey': 'a GREY TABBY village cat (light grey fur with darker grey stripes) wearing a short straw-yellow '
                'happi jacket with a brown sash',
    'npc_tuxedo': 'a BLACK-AND-WHITE TUXEDO village cat (black fur with a white face-mask, white chest and white '
                  'paws) wearing a red-checkered bandana scarf around the neck and a small green apron',
}
NPC_TMPL = (
    HERO_REF + 'But draw a DIFFERENT, ordinary villager cat: {look}; no headband, no ninja clothes, no weapons. On a '
    'TRANSPARENT background draw TWO separate poses of this SAME cat side by side, NOT touching, with at least 150 '
    'pixels of empty space between them, both in three-quarter view facing LEFT, both the same size, their lowest '
    'points on the same baseline: LEFT: the cat TIED to a short thick wooden stake with ropes wrapped around its '
    'body and arms, the stake planted straight up with a flat bottom, the cat looking worried with teary eyes, '
    'mouth open calling for help. RIGHT: the same cat freed and happy, standing on its feet, waving one paw high '
    'above its head, big open smile, eyes closed happily. Complete and opaque, thick black outlines. No text, no '
    'ground, no shadows, no other characters, no border.')

TITLE = {
    1: 'a Japanese mountain village at dusk under a huge orange-purple sky, with a wooden bandit fortress with '
       'watchtowers and the glow of a bonfire on a hill in the distance, and bamboo groves framing both sides',
    2: 'a night yokai festival: a street of glowing red paper lanterns leading to a river with a wooden arched '
       'bridge, and a mountaintop Shinto shrine with a red torii gate under a huge full moon, fireworks in the sky',
    3: 'a menacing giant mechanical iron castle (a Japanese castle built of dark iron plates, brass gears, steam '
       'pipes and smokestacks) under a stormy sky with lightning, seen from the town below',
}
TITLE_TMPL = (
    'A dramatic STAGE TITLE ILLUSTRATION (key art) for stage {n} of a cute ninja cat side-scrolling action game, in '
    + STYLE + '. Scene: {scene}. Wide cinematic composition with a clear, calm empty area in the upper centre where '
    'the game will overlay the stage title later. Keep the game art style simple and bold: thick black outlines on '
    'every shape, flat colours with soft simple gradients, NOT painterly, NOT photo-realistic lighting. No '
    'characters, no people, no animals, NO TEXT, no letters, no logo, no UI, no frame.')
ENDING = (
    HERO_REF + 'Reference images 2, 3 and 4 show three village cats he rescued (a calico cat in a light-blue kimono, a '
    'grey tabby cat in a yellow happi, a black-and-white tuxedo cat with a red-checkered bandana): copy them exactly '
    'too. ENDING ILLUSTRATION for the game, landscape: QIUQIU the ninja cat sits in the middle on the top ridge of a '
    'Japanese castle keep roof (dark tiles, golden roof ornaments) after a storm, together with the three village '
    'cats, all watching a beautiful big orange sunset over mountains and a sea of clouds; the last storm clouds '
    'are clearing, warm golden light, peaceful and happy. The cats are seen from behind in three-quarter view, '
    'turning their heads slightly so their happy smiling faces show in profile; the tuxedo cat waves a paw. Same '
    'drawing style as the references. No text, no letters, no UI, no frame.')


def jobs() -> dict[str, dict]:
    """名稱 → {prompt, transparent, refs}。refs 是 _ref/ 或 RAW 下的檔名（相對 RAW）。"""
    j: dict[str, dict] = {}
    for seg, scene in FAR.items():
        ref = ['_ref/village.png']
        j[f'{seg}_far'] = {'prompt': (VILLAGE_REF if ref else '') + FAR_TMPL.format(scene=scene),
                           'transparent': False, 'refs': ref}
    for seg, (ground, props) in GROUND.items():
        j[f'{seg}_ground'] = {'prompt': GROUND_TMPL.format(ground=ground, props=props), 'transparent': True, 'refs': []}
    for st, items in PROPS.items():
        text = '; '.join(f'({i + 1}) {t}' for i, t in enumerate(items))
        j[f'props_{st}'] = {'prompt': PROPS_TMPL.format(n=len(items), items=text), 'transparent': True, 'refs': []}
    for name, text in SHEETS.items():
        j[name] = {'prompt': text, 'transparent': True, 'refs': []}
    j['icon_bomb'] = {'prompt': ICON_BOMB, 'transparent': True, 'refs': []}
    for name, look in NPC.items():
        j[name] = {'prompt': NPC_TMPL.format(look=look), 'transparent': True, 'refs': ['_ref/qiuqiu.png']}
    for name, text in NINJA2.items():
        j[name] = {'prompt': WEAPON_REF + text, 'transparent': True, 'refs': NINJA2_REFS}
    for n, scene in TITLE.items():
        # 第一關試過拿 village.webp 當參考，結果幾乎照抄舊背景（連泥土路都在），所以標題圖都不帶參考圖
        j[f'ui_stage{n}_title'] = {'prompt': TITLE_TMPL.format(n=n, scene=scene), 'transparent': False, 'refs': []}
    j['ui_ending'] = {'prompt': ENDING, 'transparent': False,
                      'refs': ['_ref/qiuqiu.png', '_ref/npc_calico.png', '_ref/npc_grey.png', '_ref/npc_tuxedo.png']}
    return j


GROUPS = {'far': '_far', 'ground': '_ground', 'props': 'props_', 'fx': 'fx_', 'icons': 'icons', 'npc': 'npc_',
          'ui': 'ui_'}


def refs() -> None:
    REF.mkdir(parents=True, exist_ok=True)
    if not (REF / 'village.png').exists():
        Image.open(ROOT / 'public/bg/village.webp').convert('RGB').save(REF / 'village.png')
    if not (REF / 'shuriken.png').exists():
        Image.open(ROOT / 'public/art/fx/shuriken.webp').convert('RGBA').save(REF / 'shuriken.png')
    if not (REF / 'kunai.png').exists():
        Image.open(ROOT / 'public/art/fx/kunai.webp').convert('RGBA').save(REF / 'kunai.png')
    if not (REF / 'weapon_H.png').exists():
        Image.open(ROOT / 'public/art/icons/weapon_H.webp').convert('RGBA').save(REF / 'weapon_H.png')
    if not (REF / 'qiuqiu.png').exists():
        import numpy as np
        a = np.asarray(Image.open(ROOT / 'vids/球球_參考圖_綠幕.png').convert('RGB')).astype(np.int16)
        green = (a[..., 1] - np.maximum(a[..., 0], a[..., 2])).clip(0, 255) / 255.0   # 綠幕程度
        k = np.clip((green - 0.15) / 0.35, 0, 1)[..., None]
        out = (a * (1 - k) + 255 * k).astype(np.uint8)
        ys, xs = np.where(k[..., 0] < 0.5)
        pad = 30
        out = out[max(ys.min() - pad, 0):ys.max() + pad, max(xs.min() - pad, 0):xs.max() + pad]
        Image.fromarray(out).save(REF / 'qiuqiu.png')


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def generate(name: str, job: dict, note: str) -> str:
    with _LOCK:
        n = 1
        while (RAW / f'{name}.try{n}.png').exists() or (RAW / f'{name}.try{n}.pending').exists():
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    out = RAW / f'{name}.try{n}.png'
    text = job['prompt'] + (f' {note}' if note else '')
    mode = 'edit' if job['refs'] else 'generate'
    cmd = [sys.executable, str(IMAGE_GEN), mode, '--backend', 'codex-oauth', '--model', 'gpt-image-1.5',
           '--size', '1536x1024', '--quality', 'high', '--prompt', text, '--out', str(out), '--force']
    cmd += ['--background', 'transparent' if job['transparent'] else 'opaque']
    for r in job['refs']:
        cmd += ['--image', str(RAW / r)]
    t0 = time.time()
    status = 'failed'
    for _ in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists():
            status = 'ok'
            break
        status = f'failed: {r.stderr.strip()[-400:]}'
        if 'capacity' not in r.stderr and 'rate' not in r.stderr.lower():
            break
        time.sleep(30)
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    record(name, {'attempt': n, 'status': status, 'mode': mode, 'refs': job['refs'], 'prompt': text,
                  'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status}（{time.time() - t0:.0f} 秒）'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', nargs='+', help='名稱或組名：' + ' / '.join([*GROUPS, 'all']))
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    refs()
    table = jobs()
    names: list[str] = []
    for w in a.what:
        if w == 'all':
            names += list(table)
        elif w in GROUPS:
            names += [k for k in table if GROUPS[w] in k]
        elif w in table:
            names.append(w)
        else:
            sys.exit(f'不認得：{w}')
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for line in pool.map(lambda nm: generate(nm, table[nm], a.note), names):
            print(line, flush=True)


if __name__ == '__main__':
    main()
