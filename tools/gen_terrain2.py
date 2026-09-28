"""第二批站得上去的東西與道具（2026-09-26）：第一關補件（石階、竹叢、木柵、營火）、第二關、第三關、結局圖。
畫風參考＝各關長卷背景疊出來的畫面（tools/make_stage_refs.py 產生 art_raw/terrain/_ref_s{關}_{wide,land,tall}_{段}.png），
這樣夜晚、暴風雨的色調才跟背景一致。寫法、呼叫方式照 gen_terrain.py。

  python tools/gen_terrain2.py s2_ground_street s3_lift ...
  python tools/gen_terrain2.py s1 / s2 / s3 / ending / all
後製在 tools/post_terrain2.py。
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp    # noqa: E402
import gen_terrain as gt   # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = gt.RAW
STYLE = gp.STYLE
CHUNKY = gt.CHUNKY
NO_CHAR = gt.NO_CHAR
REF_TXT = ('Reference image 1 is a finished background scene from the same game: match its drawing style, line '
           'quality, texture detail, rendering, colour palette and LIGHTING EXACTLY, but draw ONLY the object '
           'described below (nothing from the reference scene itself). ')
LIGHT = {
    's1a': ' Lighting: warm golden dusk light from the upper left, like the reference.',
    's1c': ' Lighting: night, warm orange firelight and torchlight from below and the side, cool purple-blue shadows, '
           'like the reference.',
    's2': ' Lighting: festival night, like the reference: cool silver-blue moonlight from the upper right and warm '
          'orange-red lantern glow, deep blue-purple shadows.',
    's3': ' Lighting: like the reference: dark smoggy dusk, cold blue-grey shadows, warm orange lamp and furnace glow '
          'reflecting on metal and wet stone.',
    's3r': ' Lighting: like the reference: a violent night thunderstorm, very dark blue-purple, wet shining surfaces '
           'with cold white lightning highlights, a little warm lantern glow.',
}


def ref(stage: str, kind: str, part: int) -> Path:
    return RAW / f'_ref_{stage}_{kind}_{part}.png'


GROUND_T = (
    REF_TXT + 'A 2D SIDE-SCROLLING GAME GROUND STRIP (the walkable ground in the front of the scene), very wide 3:1 '
    'picture, in ' + STYLE + '. Pure side view: a CROSS-SECTION of the ground. The walking surface is {surface}; its '
    'top is ONE PERFECTLY STRAIGHT HORIZONTAL LINE at about 12% from the top of the picture, running across the whole '
    'width. Only a few small low details ({tufts}) poke up above that line, none taller than 4% of the picture '
    'height; everything above the line is completely EMPTY and TRANSPARENT (transparent background). Below the '
    'surface line the cross-section fills the whole rest of the picture down to the bottom edge and out of the left '
    'and right edges: {section}. It gets gradually darker toward the bottom, and the bottom 15% is an almost plain '
    'very dark {dark}. HORIZONTALLY SEAMLESS TILE: the left and right ends continue into each other, the surface line '
    'is at exactly the same height at both ends, and no big object crosses the left or right edge.{light}' + CHUNKY +
    NO_CHAR)
WALL_T = (
    REF_TXT + 'ONE TERRAIN PIECE for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ': the '
    'vertical side face of a raised ledge (where the ground drops away to the left), seen exactly from the side: '
    '{wall}. It is a tall vertical band about 45% of the picture width, touching the RIGHT edge of the picture and '
    'running from near the top edge down to the bottom edge (it continues out of the bottom edge). Its LEFT side is '
    'the outer face of the wall; everything to the left of it is completely transparent. At the very top (the top '
    '12% of the picture) the ground surface on top of the ledge reaches the edge: {cap}; above it is transparent. '
    'Below that top, the wall looks the same all the way down (it will be repeated vertically): no base, no ground at '
    'the bottom.{light}' + CHUNKY + NO_CHAR)
LONG_T = (
    REF_TXT + 'ONE long horizontal piece for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
    ', seen exactly from the side (flat elevation, no perspective): {what}. It spans almost the whole width of the '
    'picture. {top} The pattern repeats evenly along its length ({repeat}); both ends are finished ends ({ends}). '
    'Nothing else: no ground, no background.{light}' + CHUNKY + NO_CHAR)
ONE_T = (REF_TXT + 'ONE {kind} for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ', seen '
         'exactly from the side: {what}. Just this one object, complete, nothing else.{light}' + CHUNKY + NO_CHAR)
SHEET_T = (REF_TXT + 'A SPRITE SHEET of {n} separate props for a 2D side-scrolling game on a TRANSPARENT background, '
           'in ' + STYLE + ', laid out {layout}, NOT touching each other, with wide transparent gaps between them, '
           'each seen from the side, all at a consistent scale: {items}{light}' + CHUNKY +
           ' NO characters, NO people, NO animals, NO frame, NO border.{text}')
NO_TEXT = ' NO text, NO letters, NO writing anywhere.'
FRAMES_T = (REF_TXT + 'AN ANIMATION STRIP of {n} frames for a 2D side-scrolling game on a TRANSPARENT background, in '
            + STYLE + ': {what}. The {n} frames are laid out in one row from left to right, each centred in its own '
            'equal cell, NOT touching each other, with wide transparent gaps between them; every frame is the SAME '
            'size and has its base at the SAME height (the bottom of the cells), and they form a smooth looping '
            'cycle: {cycle}.{light}' + CHUNKY + NO_CHAR)


def J(prompt: str, r: Path) -> dict:
    return {'prompt': prompt, 'ref': r}


def jobs() -> dict[str, dict]:
    j: dict[str, dict] = {}
    # ───────── 第一關補件 ─────────
    L = LIGHT['s1a']
    j['s1_stairs'] = J(
        REF_TXT + 'A STONE STAIRCASE for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ', seen '
        'exactly from the side (flat elevation, no perspective): FIVE identical broad steps climbing from the lower '
        'left to the upper right, every step exactly the same width and the same height (each riser is about 6% of '
        'the picture height, each tread about 14% of the picture width), each step a big cut grey granite slab with '
        'a rounded worn front edge, moss and small ferns in the joints. Under the steps the staircase is SOLID: fitted '
        'stone masonry fills everything below the steps down to the bottom edge of the picture and out of the right '
        'edge; the top step continues flat out of the right edge. Everything above and to the left of the steps is '
        'completely transparent.' + L + CHUNKY + NO_CHAR, ref('s1', 'wide', 1))
    j['s1_bamboo_fore'] = J(ONE_T.format(
        kind='FOREGROUND PLANT (it passes close in front of the camera)',
        what='a cluster of three tall thick bamboo stalks with a few leafy side branches, rising from a small clump of '
             'bamboo leaves at the bottom edge to above the top edge (cut off by the top edge); muted dark olive and '
             'yellow-green colours in dusk shadow (NOT bright green), rim-lit warm orange on the left edges',
        light=L), ref('s1', 'tall', 2))
    Lc = LIGHT['s1c']
    j['s1_palisade'] = J(LONG_T.format(
        what="a long section of a mountain bandits' palisade wall: tall vertical rough logs sharpened to points at the "
             'top, lashed together with thick rope to two horizontal log rails, weathered and dirty, the bottom of the '
             'logs planted straight at the bottom of the picture',
        top='The wall is about 45% of the picture height tall and stands on the bottom of the picture.',
        repeat='every log the same size', ends='a thicker corner post with extra rope lashing', light=Lc),
        ref('s1', 'wide', 3))
    j['s1_rampart'] = J(LONG_T.format(
        what='a low log RAMPART you can walk on: a wall of thick vertical logs cut FLAT at the top, topped by a flat '
             'walkway of rough planks nailed across the tops, rope lashings, a torch bracket or two',
        top='The TOP of the plank walkway is ONE straight horizontal line at about 55% of the picture height from the '
            'bottom; the log wall stands on the bottom of the picture.',
        repeat='every log the same size', ends='a thicker corner post', light=Lc), ref('s1', 'wide', 3))
    j['s1_campfire_base'] = J(ONE_T.format(
        kind='PROP', what='a bandit campfire WITHOUT flames: a ring of blackened stones around a pile of crossed '
                          'half-burnt logs, glowing red-orange embers and hot coals in the middle, a little grey ash, '
                          'a roasting stick with a fish on a forked stand at the side',
        light=Lc), ref('s1', 'land', 3))
    j['s1_campfire_flames'] = J(FRAMES_T.format(
        n=4, what='the FLAMES of a big campfire only (no logs, no stones): tall bright cartoon flames, yellow-white core, '
                  'orange and red tongues, a few sparks, thick dark outline',
        cycle='the flame tongues sway and flicker, frame 4 flows back into frame 1', light=Lc), ref('s1', 'land', 3))

    # ───────── 第二關 ─────────
    L2 = LIGHT['s2']
    g2 = {
        's2_ground_street': (1, dict(surface='a festival street of worn grey flagstones with moss in the joints',
                                     tufts='a dropped paper fan, a few petals and tiny pebbles',
                                     section='packed earth with the flagstones\' thick edges, buried stones and a '
                                             'drainage channel of stone blocks', dark='blue-black earth')),
        's2_ground_bank': (2, dict(surface='a riverbank walkway of weathered wooden planks laid on dark wet mud, with '
                                           'reeds at the edge', tufts='short reeds and a small frog-free lily leaf',
                                   section='dark wet mud with round river stones, old wooden stakes and roots',
                                   dark='blue-black mud')),
        's2_ground_shrine': (3, dict(surface='a shrine approach path of fitted grey stone slabs scattered with fallen red '
                                             'and orange maple leaves', tufts='fallen maple leaves and a little moss',
                                     section='dark earth with mossy foundation stones and roots',
                                     dark='blue-black earth')),
    }
    for k, (part, v) in g2.items():
        j[k] = J(GROUND_T.format(light=L2, **v), ref('s2', 'wide', part))
    j['s2_wall_embank'] = J(WALL_T.format(
        wall='a curved-looking river embankment wall of big dressed grey granite blocks, wet and dark at the bottom, '
             'moss and water stains', cap='the plank walkway and reeds on top', light=L2), ref('s2', 'tall', 2))
    j['s2_wall_shrine'] = J(WALL_T.format(
        wall='a shrine stone base wall (ishigaki) of big fitted mossy stones with red maple leaves caught in the cracks',
        cap='the stone slab path with fallen maple leaves', light=L2), ref('s2', 'tall', 3))
    j['s2_stallroof'] = J(
        REF_TXT + 'ONE BUILDING for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ': a long ROW '
        'of night-festival food stalls under ONE continuous low roof, seen exactly from the side (flat front '
        'elevation, no perspective), filling almost the whole width of the picture. The roof is a low wooden shingle '
        'roof whose TOP is ONE long STRAIGHT HORIZONTAL ridge beam along the whole top (characters walk on it); its '
        'eaves carry a red-and-white striped awning valance. Under the roof there are FIVE EQUAL stall bays divided '
        'by wooden posts, each with a wooden counter, a row of glowing red paper lanterns, festival masks or toys or '
        'food, cloth curtains with no writing; the bays repeat evenly. The building stands on the bottom edge of the '
        'picture (no ground drawn).' + L2 + CHUNKY + NO_CHAR + NO_TEXT, ref('s2', 'wide', 1))
    j['s2_bridge'] = J(LONG_T.format(
        what='the deck of a red-lacquered Japanese wooden bridge: a thick flat red deck beam with visible plank ends, '
             'a red wooden railing with round-topped posts and a top rail standing on the deck, black iron fittings, '
             'worn paint showing wood',
        top='The TOP of the flat deck (where characters walk, below the railing) is ONE straight horizontal line at '
            'about 45% of the picture height from the bottom; the railing rises above it; the deck is about 12% of '
            'the picture height thick; nothing below the deck.',
        repeat='railing posts evenly spaced', ends='a bigger railing end post with a bronze cap', light=L2),
        ref('s2', 'wide', 2))
    j['s2_torii'] = J(ONE_T.format(
        kind='GATE', what='a big red-lacquered Shinto torii gate facing the camera, standing on the bottom edge: two '
                          'round red pillars with black bases, a straight tie beam, and a massive black-topped upper '
                          'lintel whose TOP is flat and straight in the middle and curves slightly up at both ends, a '
                          'small blank plaque between the beams, weathered paint, moss',
        light=L2) + NO_TEXT, ref('s2', 'land', 3))
    j['s2_stage'] = J(LONG_T.format(
        what='the top of a wooden festival stage (yagura platform): a thick wooden deck edge of dark polished planks, '
             'with a red-and-white vertically striped cloth skirt (kohaku-maku) hanging down below the deck, and a '
             'string of small glowing lanterns along the deck edge',
        top='The TOP of the deck is ONE straight horizontal line at about 60% of the picture height from the bottom; '
            'the striped cloth hangs about 25% of the picture height below it.',
        repeat='cloth stripes and lanterns evenly spaced', ends='a squared corner post top', light=L2),
        ref('s2', 'wide', 1))
    j['s2_posts'] = J(
        REF_TXT + 'THREE separate VERTICAL POLES for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
        ', side by side with wide transparent gaps between them, each reaching from the top edge to the bottom edge of '
        'the picture and looking the same all along its length (they will be repeated vertically): (1) a thick round '
        'red-lacquered bridge pillar with worn paint; (2) a square dark wooden stage post with rope wrapping; (3) a '
        'thick wooden bridge pile with black water stains and barnacle-like moss. Each pole is thin (about 10% of the '
        'picture width).' + L2 + CHUNKY + NO_CHAR, ref('s2', 'tall', 2))
    j['s2_water'] = J(
        REF_TXT + 'A 2D SIDE-SCROLLING GAME RIVER WATER STRIP, very wide 3:1 picture, in ' + STYLE + ': a night river '
        'seen exactly from the side as a cross-section band: the WATER SURFACE is ONE straight horizontal line at '
        'about 15% from the top of the picture, with small wavelets and bright silver-blue moonlight and warm orange '
        'lantern reflections glittering in horizontal streaks just below the surface; below it deep dark blue-green '
        'water fading to almost black at the bottom edge, a few faint bubbles and waterweed shapes. Everything above '
        'the surface line is transparent. HORIZONTALLY SEAMLESS TILE: the left and right ends continue into each '
        'other.' + L2 + CHUNKY + NO_CHAR, ref('s2', 'wide', 2))
    j['s2_props_a'] = J(SHEET_T.format(
        n=4, layout='in two rows of two', light=L2, text=NO_TEXT,
        items='Row 1 (intact): (1) a small festival LANTERN STALL: a wooden stand with a little roof, many glowing red '
              'and white paper lanterns hanging and stacked, a wooden counter; (2) a festival wooden CRATE with rope '
              'handles and red paper streamers, a few paper fans sticking out. Row 2 (the same two objects DESTROYED, '
              'each directly below its intact version): (3) the lantern stall collapsed: broken frame, torn and '
              'crushed lanterns, one still glowing; (4) the crate smashed into a low pile of planks and scattered fans.'),
        ref('s2', 'land', 1))
    j['s2_props_b'] = J(SHEET_T.format(
        n=4, layout='in two rows of two', light=L2, text='',
        items='Row 1 (intact): (1) a pyramid STACK OF SIX straw-wrapped sake barrels (komodaru) with rope, their round '
              'ends facing the camera, each round end showing a simple red-and-black circle crest (no writing); (2) a '
              'tall grey stone lantern (toro) with a softly glowing fire box, moss on the cap. Row 2 (the same two '
              'objects DESTROYED, each directly below its intact version): (3) the barrel stack knocked down: burst '
              'barrels, broken straw wrappings and a puddle of spilled sake; (4) the stone lantern broken: toppled cap '
              'and fire box in a low heap of stone chunks on its base. NO text or letters.'),
        ref('s2', 'land', 3))
    j['s2_props_c'] = J(SHEET_T.format(
        n=4, layout='in two rows of two', light=L2, text=NO_TEXT,
        items='Row 1 (intact): (1) a shrine OFFERING BOX (saisen-bako): a wide dark wooden box with a slatted top and '
              'gold metal corner fittings; (2) a wooden festival SIGNBOARD on two posts with a little roof, the board '
              'BLANK (no writing), paper lanterns hanging from its corners. Row 2 (the same two objects DESTROYED, '
              'each directly below its intact version): (3) the offering box smashed open, broken slats and scattered '
              'gold coins; (4) the signboard snapped in half, the roof fallen, broken posts.'),
        ref('s2', 'land', 3))
    j['s2_decor'] = J(SHEET_T.format(
        n=2, layout='side by side', light=L2, text=NO_TEXT,
        items='(1) a big shrine BELL (suzu) hanging from a short wooden beam, a round golden bell with a thick braided '
              'red-and-white rope hanging down from it; (2) an EMA RACK: a small wooden frame with a little roof, '
              'covered in many small pentagonal wooden votive plaques hanging on strings, the plaques painted with '
              'small pictures only (no writing).'),
        ref('s2', 'land', 3))

    # ───────── 第三關 ─────────
    L3, L3r = LIGHT['s3'], LIGHT['s3r']
    g3 = {
        's3_ground_town': (1, L3, dict(surface='a castle-town road of big worn grey stone slabs with iron drain grates '
                                               'and brass rivets', tufts='a small bolt, a coal lump and a weed',
                                       section='compacted earth with stone foundations, a buried iron pipe and coal '
                                               'bits', dark='soot-black earth')),
        's3_ground_grate': (2, L3, dict(surface='a factory floor of riveted dark iron grating plates with a yellow-and-'
                                                'black hazard stripe along the top edge',
                                        tufts='a few scattered cogs and bolts',
                                        section='a cross-section under the grating: iron girders, pipes and cables '
                                                'running horizontally, rivets, a faint orange glow from below',
                                        dark='iron-black')),
        's3_ground_roof': (3, L3r, dict(surface='the flat top ridge of a Japanese castle roof in heavy rain: a straight '
                                                'ridge cap of dark blue-grey wet tiles with puddle shine',
                                        tufts='small rain splashes',
                                        section='rows of dark blue-grey rounded roof tiles (kawara) seen side-on, '
                                                'stepping down in overlapping courses, wet and shining, water running '
                                                'down', dark='blue-black tiles')),
    }
    for k, (part, lt, v) in g3.items():
        j[k] = J(GROUND_T.format(light=lt, **v), ref('s3', 'wide', part))
    j['s3_wall_castle'] = J(WALL_T.format(
        wall='a massive castle stone wall (ishigaki) of huge fitted grey granite blocks, soot stains, a few iron '
             'clamps and rivets', cap='the stone slab road with an iron drain grate', light=L3), ref('s3', 'tall', 1))
    j['s3_wall_iron'] = J(WALL_T.format(
        wall='a wall of big riveted dark iron plates with welded seams, rust streaks and a small pipe running down',
        cap='the iron grating floor with a hazard stripe', light=L3), ref('s3', 'tall', 2))
    j['s3_catwalk'] = J(LONG_T.format(
        what='an iron CATWALK: a riveted iron grating walkway on a thick iron I-beam, with a simple iron handrail on '
             'thin posts standing on it',
        top='The TOP of the grating walkway (below the handrail) is ONE straight horizontal line at about 45% of the '
            'picture height from the bottom; the handrail rises above it; the beam is about 10% of the picture '
            'height thick; nothing below the beam.',
        repeat='rivets, grating and handrail posts evenly spaced', ends='a bolted end plate', light=L3),
        ref('s3', 'wide', 2))
    j['s3_conveyor'] = J(LONG_T.format(
        what='a factory CONVEYOR BELT: a dark rubber belt with evenly spaced raised iron cleats running over a row of '
             'iron rollers inside a riveted iron frame with yellow-and-black hazard stripes on the side',
        top='The TOP of the belt is ONE straight horizontal line at about 60% of the picture height from the bottom; '
            'the whole conveyor is about 16% of the picture height thick.',
        repeat='cleats and rollers evenly spaced', ends='a big round end drum roller', light=L3), ref('s3', 'wide', 2))
    j['s3_ridge'] = J(LONG_T.format(
        what='the top RIDGE of a Japanese castle keep roof in heavy rain: a thick straight ridge beam capped with dark '
             'blue-grey wet ridge tiles, with the sloping tiled roof falling away below it on the near side',
        top='The TOP of the ridge is ONE straight horizontal line at about 60% of the picture height from the bottom; '
            'the roof tiles below it fill down to the bottom of the picture.',
        repeat='ridge tiles evenly spaced', ends='an upturned ornamental end tile (onigawara) with a golden fin',
        light=L3r), ref('s3', 'wide', 3))
    j['s3_posts'] = J(
        REF_TXT + 'THREE separate VERTICAL SUPPORTS for a 2D side-scrolling game on a TRANSPARENT background, in ' +
        STYLE + ', side by side with wide transparent gaps between them, each reaching from the top edge to the bottom '
        'edge of the picture and looking the same all along its length (they will be repeated vertically): (1) a '
        'riveted iron I-beam column; (2) an iron lattice girder column with diagonal cross bracing; (3) a thick copper '
        'steam pipe column with flanges. Each is thin (about 10% of the picture width).' + L3 + CHUNKY + NO_CHAR,
        ref('s3', 'tall', 2))
    j['s3_lift'] = J(ONE_T.format(
        kind='MACHINE', what='an iron ELEVATOR LIFT PLATFORM: a flat riveted iron platform with a grating top and a '
                             'hazard-striped edge, hanging from two thick steel cables that go straight up out of the '
                             'top edge, a pulley bracket on each side, a small warning lamp; the TOP of the platform is '
                             'one straight horizontal line',
        light=L3), ref('s3', 'land', 2))
    j['s3_vent_base'] = J(ONE_T.format(
        kind='MACHINE', what='a STEAM VENT set into a factory floor: a short thick iron nozzle pipe with a flange and '
                             'bolts pointing straight up, a red valve wheel and a small pressure gauge beside it, no '
                             'steam',
        light=L3), ref('s3', 'land', 2))
    j['s3_vent_steam'] = J(FRAMES_T.format(
        n=4, what='a jet of white-grey STEAM shooting straight up from a small nozzle opening at the bottom of each '
                  'cell (the nozzle itself is NOT drawn), soft billowing puffs with a thin dark outline',
        cycle='(1) a short burst just starting, (2) a tall strong column, (3) the tallest column spreading into puffs '
              'at the top, (4) the column thinning and fading', light=L3), ref('s3', 'land', 2))
    j['s3_turret_mount'] = J(ONE_T.format(
        kind='MACHINE PART', what='a heavy riveted iron WALL MOUNT for a gun turret, bolted onto a patch of stone wall: '
                                  'a round iron swivel ring on an L-shaped bracket with thick bolts, hydraulic pipes, a '
                                  'small red warning lamp; the turret itself is NOT there (the ring is empty)',
        light=L3), ref('s3', 'land', 1))
    j['s3_props_a'] = J(SHEET_T.format(
        n=4, layout='in two rows of two', light=L3, text=NO_TEXT,
        items='Row 1 (intact): (1) an iron OIL DRUM with rolled rims, dented, rusty, a yellow hazard band and an oil '
              'stain; (2) a riveted iron GEARBOX machine block with brass gears showing through an opening, a crank '
              'handle and pipes. Row 2 (the same two objects DESTROYED, each directly below its intact version): (3) '
              'the drum burst open and crumpled, a black oil puddle; (4) the gearbox blown apart: bent plates, '
              'scattered gears and springs, smoke wisp.'),
        ref('s3', 'land', 2))
    j['s3_props_b'] = J(SHEET_T.format(
        n=4, layout='in two rows of two', light=L3, text=NO_TEXT,
        items='Row 1 (intact): (1) an iron-bound wooden CRATE with riveted iron corner plates and a stencilled gear '
              'symbol (no letters); (2) a vertical STEAM PIPE SECTION: a thick copper pipe with bolted flanges, a red '
              'valve wheel and a pressure gauge, standing on an iron foot. Row 2 (the same two objects DESTROYED, '
              'each directly below its intact version): (3) the crate smashed into planks and bent iron plates; (4) '
              'the pipe burst open, torn copper, bolts scattered, a puff of steam.'),
        ref('s3', 'land', 1))
    j['s3_gate'] = J(ONE_T.format(
        kind='CASTLE GATE', what='the heavy iron GATE of a mechanical castle, standing on the bottom edge and reaching '
                                 'near the top edge: two massive stone gate pillars with iron bands, a thick riveted '
                                 'iron lintel with a round brass gear emblem, two closed riveted iron door leaves with '
                                 'big bolts and a crossbar, red warning lamps on both pillars',
        light=L3), ref('s3', 'tall', 1))
    j['s3_gate_broken'] = J(gt.BROKEN_T.format(what='castle gate', how=(
        'keep the two stone pillars, the lintel with the gear emblem and the lamps EXACTLY as they are; only the two '
        'iron door leaves are blown apart: one leaf hangs twisted from its top hinge with a torn hole, the other has '
        'fallen and lies bent and crumpled on the ground at the foot, scattered bolts and rubble, sparks and smoke, '
        'so the doorway between the pillars is now OPEN (transparent)')), RAW / 's3_gate.try1.png')

    # ───────── 結局圖 ─────────
    j['ending'] = {'prompt': (
        'Reference image 1 is a finished background scene from this game: match its drawing style, texture detail and '
        'rendering exactly. Reference image 2 is QIUQIU, the hero (a chibi cream-and-grey tabby cat ninja in a navy gi '
        'and navy headband): copy his design EXACTLY (thick black outline, flat cute cartoon colours - the characters '
        'stay cute flat cartoon while the scenery is richly painted). Reference images 3, 4 and 5 are three village '
        'cats he rescued (a calico cat in a light-blue kimono, a grey tabby cat in a yellow happi, a black-and-white '
        'tuxedo cat with a red-checkered bandana): copy their designs exactly. ENDING ILLUSTRATION, wide landscape: '
        'on the top ridge of a Japanese castle keep roof (dark wet tiles, golden roof ornaments, puddles shining) just '
        'after the thunderstorm, the last storm clouds breaking up and a huge warm orange sunset glowing over a sea of '
        'clouds and distant mountains, a rainbow faintly in the sky. QIUQIU stands in the middle giving a happy V '
        'sign, surrounded by FOURTEEN rescued village cats sitting and standing along the ridge: the three from the '
        'references plus eleven more in the same cute style with different fur (orange tabby, white, black, siamese, '
        'brown tabby, grey, cream, calico kitten, etc.) wearing simple village clothes (kimono, happi, aprons, '
        'bandanas); everyone smiling, some waving, a small kitten on a bigger cat\'s shoulders; all characters are '
        'complete and not cut off, arranged like a group photo in the lower two-thirds. No text, no letters, no UI, '
        'no frame.'), 'refs': [RAW / '_ref_s3_land_3.png', RAW / '_ref_qiuqiu_idle.png',
                               ROOT / 'art_raw/stage_art/_ref/npc_calico.png', ROOT / 'art_raw/stage_art/_ref/npc_grey.png',
                               ROOT / 'art_raw/stage_art/_ref/npc_tuxedo.png']}
    return j


def gen_multi(name: str, job: dict, note: str) -> str:
    """多張參考圖（結局圖）：直接呼叫生圖腳本。"""
    import json as _json
    import subprocess
    import time
    n = 1
    while any((RAW / f'{name}.try{n}{s}').exists() for s in ('.png', '.pending', '.reject.png')):
        n += 1
    out = RAW / f'{name}.try{n}.png'
    prompt = job['prompt'] + (f' {note}' if note else '')
    cmd = [sys.executable, str(gp.IMAGE_GEN), 'edit', '--backend', 'codex-oauth', '--model', 'gpt-image-1.5', '--size',
           '1536x1024', '--quality', 'high', '--prompt', prompt, '--out', str(out), '--force', '--background', 'opaque']
    for r in job['refs']:
        cmd += ['--image', str(r)]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    status = 'ok' if r.returncode == 0 and out.exists() else f'failed: {r.stderr.strip()[-400:]}'
    gt.record(name, {'attempt': n, 'status': status, 'refs': [Path(x).name for x in job['refs']], 'prompt': prompt,
                     'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    _ = _json
    return f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', nargs='+')
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    table = jobs()
    names: list[str] = []
    for w in a.what:
        if w == 'all':
            names += [k for k in table if k != 's3_gate_broken']
        elif w in ('s1', 's2', 's3'):
            names += [k for k in table if k.startswith(w + '_') and k != 's3_gate_broken']
        elif w in table:
            names.append(w)
        else:
            sys.exit(f'不認得：{w}')
    for nm in names:
        r = table[nm].get('ref')
        if r is not None and not Path(r).exists():
            sys.exit(f'{nm} 的參考圖不存在：{r}')

    def run(nm: str) -> str:
        job = table[nm]
        return gen_multi(nm, job, a.note) if 'refs' in job else gt.gen(nm, job, a.note)

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for line in pool.map(run, names):
            print(line, flush=True)


if __name__ == '__main__':
    main()
