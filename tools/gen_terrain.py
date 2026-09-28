"""站得上去的東西與道具重畫（2026-09-26）：地面帶、崖壁、屋頂民家、竹架／木架、可破壞物、掉落物，畫風跟長卷背景一致。

  python tools/gen_terrain.py ground_village wall_stone ...   生幾張（每次存 art_raw/terrain/<名稱>.try<N>.png，不蓋舊的）
  python tools/gen_terrain.py all
後製（切塊、無縫、縮成遊戲大小、寫 terrain.json）在 tools/post_terrain.py。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp   # noqa: E402  共用畫風文字與呼叫 Codex 的函式

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'terrain'
LOG = RAW / 'prompts.json'
PANELS = ROOT / 'art_raw' / 'panels'
REF = {'wide': PANELS / '_style_ref_3x1.png', 'land': PANELS / '_style_ref_land.png',
       'tall': PANELS / '_style_ref_portrait.png'}
_LOCK = threading.Lock()

STYLE = gp.STYLE
REF_TXT = ('Reference image 1 is a finished background from the same game: match its drawing style, line quality, '
           'texture detail, rendering and colour treatment EXACTLY, but draw ONLY what is described below. ')
CHUNKY = (' It will be shown fairly small in the game, so draw it with big bold readable shapes, thick dark outlines '
          'and large clear texture strokes (not tiny noisy detail), while keeping the rich hand-painted texture, '
          'weathering and dirt of the reference.')
NO_CHAR = ' NO characters, NO people, NO animals, NO text, NO letters, NO frame, NO border.'
LIGHT = ' Warm golden dusk light from the upper left.'

# ── 地面帶（3:1，透明天空、剖面到底） ──
GROUND_T = (
    REF_TXT + 'A 2D SIDE-SCROLLING GAME GROUND STRIP (the walkable ground in the front of the scene), very wide 3:1 '
    'picture, in ' + STYLE + '. Pure side view: a CROSS-SECTION of the ground. The walking surface is {surface}; its '
    'top is ONE PERFECTLY STRAIGHT HORIZONTAL LINE at about 12% from the top of the picture, running across the whole '
    'width. Only a few small low tufts ({tufts}) poke up above that line, none taller than 4% of the picture height; '
    'everything above the line is completely EMPTY and TRANSPARENT (transparent background). Below the surface line '
    'the cross-section fills the whole rest of the picture down to the bottom edge and out of the left and right '
    'edges: {section}. It gets gradually darker toward the bottom, and the bottom 15% is an almost plain very dark '
    '{dark}. HORIZONTALLY SEAMLESS TILE: the left and right ends continue into each other, the surface line is at '
    'exactly the same height at both ends, and no big object crosses the left or right edge.' + LIGHT + CHUNKY +
    NO_CHAR)
GROUND = {
    'ground_village': dict(surface='a packed brown dirt village road with small pebbles, faint cart ruts and a thin '
                                   'grassy edge', tufts='short grass blades and one or two tiny pebbles',
                           section='layers of brown earth with embedded rounded stones of different sizes, small '
                                   'roots and a few buried broken roof-tile shards', dark='brown earth'),
    'ground_bamboo': dict(surface='dark forest soil thickly covered with fallen yellow-green bamboo leaves',
                          tufts='curled fallen bamboo leaves and one small bamboo shoot',
                          section='dark soil threaded with a dense network of pale bamboo roots (rhizomes) and '
                                  'mossy stones', dark='dark umber soil'),
    'ground_bandit': dict(surface='trampled mud partly covered by rough weathered wooden planks and boards laid flat '
                                  'and nailed down, with rope scraps', tufts='a splinter, a rope end and a few '
                                  'short weeds', section='muddy earth with buried stones, broken planks, old wooden '
                                  'stakes and charcoal bits', dark='dark mud'),
}

# ── 崖壁（直式；右邊接地面剖面、左邊是露出來的壁面；頂端有地面收邊，下面可垂直重複） ──
WALL_T = (
    REF_TXT + 'ONE TERRAIN PIECE for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ': the '
    'vertical side face of a raised ledge (where the ground drops away to the left), seen exactly from the side: '
    '{wall}. It is a tall vertical band about 45% of the picture width, touching the RIGHT edge of the picture and '
    'running from near the top edge down to the bottom edge (it continues out of the bottom edge). Its LEFT side is '
    'the rough outer face of the wall; everything to the left of it is completely transparent. At the very top (the '
    'top 12% of the picture) the ground surface on top of the ledge reaches the edge: {cap} curls over the top-left '
    'corner; above it is transparent. Below that top, the wall looks the same all the way down (it will be repeated '
    'vertically): no base, no ground at the bottom.' + LIGHT + CHUNKY + NO_CHAR)
WALL = {
    'wall_stone': dict(wall='a Japanese dry-stone retaining wall (ishigaki) of big fitted grey granite blocks with moss '
                            'and small ferns in the cracks, weathered and stained',
                       cap='the brown dirt road surface with a grassy edge'),
    'wall_earth': dict(wall='a crumbling brown earth cliff of layered soil with embedded stones and many exposed tree '
                            'roots hanging out of it', cap='the dirt surface with grass tufts and a few roots'),
    'wall_log': dict(wall='a retaining wall of rough vertical logs and sharpened stakes lashed together with rope, '
                          'packed mud behind', cap='muddy ground with a board and a rope end'),
}

HOUSE = (
    REF_TXT + 'ONE BUILDING for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE + ': a long LOW '
    'single-storey Japanese village house seen exactly from the side (flat front elevation, no perspective), filling '
    'almost the whole width of the picture. It has a big dark clay-tiled roof: the TOP of the roof is a long thick '
    'STRAIGHT HORIZONTAL ridge (ONE perfectly straight level line along the whole top - characters walk on it) with '
    'round tile ends at both ends; from the ridge the roof slopes down to deep overhanging eaves, and at the left and '
    'right ends the roof comes down to curled eave corners that stick out beyond the walls. The roof takes the upper '
    '45% of the building. Below the eaves the low wall is divided by dark wooden posts into FIVE EQUAL BAYS: bays 1 '
    'to 4 each have one warmly glowing paper sliding window with a wooden lattice, bay 5 at the right end has a '
    'doorway with a short plain indigo noren curtain (no writing). The roof tiles, posts and windows repeat evenly. A '
    'red paper lantern hangs under each eave corner. A few barrels, a bundle of firewood and a straw basket stand at '
    'the foot of the wall. The building stands on the bottom edge of the picture (no ground drawn).' + LIGHT +
    CHUNKY + NO_CHAR)

RAIL_T = (
    REF_TXT + 'ONE long horizontal WALKWAY BEAM for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE
    + ', seen exactly from the side: {rail}. It spans almost the whole width of the picture as a thin horizontal band '
    'in the vertical middle of the picture (the band is about 14% of the picture height). The top of the walkway is '
    'ONE straight horizontal line. The pattern repeats evenly along its length; both ends are finished ends ({ends}). '
    'Nothing else: no posts, no legs, no ground, no background.' + LIGHT + CHUNKY + NO_CHAR)
RAIL = {
    'rail_bamboo': dict(rail='two thick green-yellow bamboo poles, one right on top of the other, lashed together '
                             'with brown rope bindings at regular intervals', ends='cut bamboo ends with an extra thick '
                                                                                   'rope lashing'),
    'rail_plank': dict(rail='a walkway of thick weathered wooden planks laid on a squared wooden beam, iron nails and '
                            'a few rope bindings', ends='rough sawn ends with a rope lashing'),
}
POSTS = (
    REF_TXT + 'FOUR separate VERTICAL POLES for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
    ', side by side with wide transparent gaps between them, each one reaching from the top edge to the bottom edge of '
    'the picture and looking the same all along its length (they will be repeated vertically): (1) a thick green-'
    'yellow bamboo post with evenly spaced nodes; (2) a thinner bamboo post; (3) a rough square wooden post with '
    'nails and a rope wrapping; (4) a round log post with bark. Each pole is thin (about 10% of the picture width).'
    + LIGHT + CHUNKY + NO_CHAR)

SHEET_HEAD = (REF_TXT + 'A SPRITE SHEET of {n} separate props for a 2D side-scrolling game on a TRANSPARENT background, '
              'in ' + STYLE + ', laid out {layout}, NOT touching each other, with wide transparent gaps between them, '
              'each seen from the side, all at a consistent scale: ')
SHEETS = {
    'props_barrels': (6, 'in two rows of three', 'land',
                      'Row 1 (intact): (1) a sturdy wooden shipping crate reinforced with dark iron corners and a '
                      'diagonal board, rope handles; (2) a sake barrel (taru) of wooden staves with two bamboo hoops and '
                      'a cream paper label showing the single kanji 酒 in bold black brush writing; (3) a red-lacquered '
                      'gunpowder keg with dark iron hoops, a yellow paper label showing the single kanji 火 and a short '
                      'fuse sticking up from the lid. Row 2 (the same three objects DESTROYED, each directly below its '
                      'intact version): (4) the crate smashed into a low pile of broken planks, splinters and bent '
                      'nails; (5) the barrel burst into a low pile of broken staves with a loose hoop and a small '
                      'spilled puddle; (6) the keg blown apart: a low pile of charred scorched stave fragments and '
                      'black soot. No other text or letters.'),
    'props_cage_stall': (4, 'in two rows of two', 'land',
                         'Row 1: (1) a tall bamboo CAGE for holding a prisoner: vertical bamboo bars lashed to a top '
                         'and a bottom bamboo frame with rope, EMPTY inside so you can see through between the bars (the '
                         'gaps between the bars are transparent); (2) a village FOOD STALL: a wooden counter with a '
                         'faded red-and-white striped cloth awning on two poles, rice balls and dried fish on the '
                         'counter, a small paper lantern. Row 2 (the same objects DESTROYED, each directly below its '
                         'intact version): (3) the cage broken apart: a low heap of snapped bamboo bars and loose rope; '
                         '(4) the stall wrecked: the torn awning collapsed over broken counter boards, a spilled rice '
                         'ball. No text or letters.'),
    'items_small': (6, 'in two rows of three', 'land',
                    'Row 1: (1) a rice ball (onigiri) with a nori seaweed strip; (2) a whole golden-brown dried fish '
                    '(himono) lying horizontally with its head to the LEFT; (3) a clean white fish skeleton (head, spine '
                    'with ribs and tail fin) lying horizontally with its head to the LEFT. Row 2: (4) a red maple leaf; '
                    '(5) an orange maple leaf; (6) a steel bo-shuriken throwing spike: a long thin steel rod pointed at '
                    'both ends with a cloth-wrapped middle, lying horizontally.'),
    'king_pack': (2, 'side by side', 'land',
                  '(1) a big woven bamboo basket backpack (a Japanese seoi-kago), wider at the top, crammed full of dried '
                  'fish sticking out of the top, with thick straw rope shoulder straps hanging on its left side; (2) '
                  'the same basket DESTROYED: split open and crushed, dried fish spilling out onto a low heap, snapped '
                  'straps.'),
    'burrow': (2, 'side by side', 'land',
               '(1) a small animal burrow in the ground seen from the side at ground level: a low mound of fresh brown '
               'dirt around a dark oval hole opening, a few pebbles; (2) a wider burrow with the dirt thrown up and '
               'scattered clumps, as if something just burst out of it.'),
    'debris': (8, 'in two rows of four', 'land',
               'EIGHT small debris pieces for particle effects: (1) a broken wooden plank piece; (2) a long splinter; '
               '(3) a curved barrel stave; (4) a bamboo hoop ring; (5) a broken piece of bamboo tube; (6) a grey stone '
               'chunk; (7) a clump of straw; (8) a scorched black wood chunk.'),
}
SINGLE = {
    'tower': ('tall', 'a bandit WATCHTOWER standing on the bottom edge and reaching near the top edge: four tall rough '
                      'log legs with X-braces lashed with rope, a ladder, a lookout platform with a log railing near the '
                      'top, a small thatched roof on corner poles, a burning torch on a pole and a torn plain cloth '
                      'banner (no writing)'),
    'tower_broken': ('land', 'a COLLAPSED bandit watchtower: a low heap of broken rough logs and snapped ladder rungs, '
                             'the small thatched roof lying crooked on top of the heap, snapped rope, a few glowing '
                             'embers and a little smoke'),
    'gate': ('tall', 'the MAIN GATE of a mountain bandit fortress, standing on the bottom edge and reaching near the top '
                     'edge: two massive rough log posts sharpened at the top, a thick log lintel lashed across the top, '
                     'two heavy wooden double doors (closed) of vertical planks with iron studs and a crossbar, torch '
                     'holders with burning torches on both posts, a blank wooden plaque above the doors (no writing)'),
    'gate_broken': ('tall', 'the SMASHED main gate of a mountain bandit fortress, standing on the bottom edge: the two '
                            'massive log posts and the log lintel still standing (one post cracked), the heavy plank '
                            'doors broken open, one hanging crooked from its hinge and the other fallen and splintered '
                            'on the ground, iron studs scattered, torches knocked askew'),
}
ICON_H = ('Redraw this weapon pickup icon in EXACTLY the same style, size, outline and layout (the same rolled scroll '
          'with a round emblem disc in the middle), but: the disc is steel-blue and shows the bold white capital letter '
          'H with a thick black outline, and behind the scroll are TWO CROSSED BO-SHURIKEN (long thin steel throwing '
          'spikes pointed at both ends, with dark cloth-wrapped middles) instead of the spike ball. Transparent '
          'background. No other text.')


def jobs() -> dict[str, dict]:
    j: dict[str, dict] = {}
    for k, v in GROUND.items():
        j[k] = {'prompt': GROUND_T.format(**v), 'ref': REF['wide']}
    for k, v in WALL.items():
        j[k] = {'prompt': WALL_T.format(**v), 'ref': REF['tall']}
    j['house'] = {'prompt': HOUSE, 'ref': REF['wide']}
    for k, v in RAIL.items():
        j[k] = {'prompt': RAIL_T.format(**v), 'ref': REF['wide']}
    j['posts'] = {'prompt': POSTS, 'ref': REF['land']}
    for k, (n, layout, ref, items) in SHEETS.items():
        j[k] = {'prompt': SHEET_HEAD.format(n=n, layout=layout) + items + LIGHT + CHUNKY +
                (' NO characters, NO people, NO animals, NO frame, NO border.' if 'kanji' in items else NO_CHAR),
                'ref': REF[ref]}
    for k, (ref, what) in SINGLE.items():
        j[k] = {'prompt': REF_TXT + 'ONE PROP for a 2D side-scrolling game on a TRANSPARENT background, in ' + STYLE +
                ', seen exactly from the side: ' + what + '. Just this one object, complete.' + LIGHT + CHUNKY + NO_CHAR,
                'ref': REF[ref]}
    j['icon_H'] = {'prompt': ICON_H, 'ref': RAW / '_ref_icon_S.png'}
    # 第一次生的「打爛版」跟完好版長得不像（寨門變寬、多了石座與木樁），改拿完好版當參考圖重畫
    j['gate_broken'] = {'prompt': BROKEN_T.format(what='fortress gate', how=(
        'keep the two log posts, the log lintel, the plank sign and the stones at the foot EXACTLY as they are; only '
        'the two heavy plank doors are smashed: the left door hangs crooked from one hinge with a big splintered hole, '
        'the right door has fallen and lies broken and splintered on the ground at the foot, scattered splinters and '
        'iron studs, the torches knocked askew, so the doorway between the posts is now OPEN (transparent)')),
        'ref': RAW / 'gate.try1.png'}
    j['tower_broken'] = {'prompt': BROKEN_T.format(what='watchtower', how=(
        'it has COLLAPSED: the same logs, ladder, thatched roof, banner and torch now lie in a low tangled heap on the '
        'same rocks at the bottom (the heap is at most 40% of the original height), snapped leg logs sticking up, '
        'snapped ropes, a few glowing embers and a thin wisp of smoke')), 'ref': RAW / 'tower.try1.png'}
    return j


BROKEN_T = ('Reference image 1 is a prop from a 2D side-scrolling game (a {what}). Redraw the SAME {what} in EXACTLY the '
            'same drawing style, colours, materials, scale and position, but DESTROYED: {how}. Transparent background, '
            'seen exactly from the side, nothing else added.' + NO_CHAR)


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
    t0 = time.time()
    status = gp.call_codex(prompt, job['ref'], out, True)
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    size = Image.open(out).size if out.exists() else None
    record(name, {'attempt': n, 'status': status, 'size': size, 'ref': Path(job['ref']).name, 'prompt': prompt,
                  'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）{size}'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', nargs='+')
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    icon_ref = RAW / '_ref_icon_S.png'
    if not icon_ref.exists():
        im = Image.open(ROOT / 'public/art/icons/weapon_S.webp').convert('RGBA')
        bg = Image.new('RGBA', (im.width + 40, im.height + 40), (0, 0, 0, 0))
        bg.paste(im, (20, 20), im)
        bg.save(icon_ref)
    table = jobs()
    names = list(table) if a.what == ['all'] else a.what
    for nm in names:
        if nm not in table:
            sys.exit(f'不認得：{nm}')
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for line in pool.map(lambda nm: gen(nm, table[nm], a.note), names):
            print(line, flush=True)


if __name__ == '__main__':
    main()
