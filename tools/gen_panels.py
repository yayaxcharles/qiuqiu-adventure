"""三大關「連續長卷」背景（2026-09-26 第二輪：細節多、有質感的越南大戰式手繪場景，分四層做深度）。

層（遊戲各自用不同速度捲）：
  far     天空＋最遠的山或雲（不透明）          每關 3 張
  midfar  遠方的城鎮、森林、山寨（上方透明、帶霧）  每關 4 張
  mid     近處的建築、竹林、城牆（天空透明）       每關 8 張，一張接一張走故事
  fore    最前景的單件物品（透明），遊戲自己擺      每關 6 件
far／midfar／mid 都是「接龍外擴」：
  第 1 張：拿畫風參考圖（art_raw/panels/_style_ref.png）當 edit 參考，直接生 3:1 的寬圖。
  第 N 張：把目前長卷最右邊 724 欄放在 2172x724 畫布左邊、右邊三分之二填灰色，請 Codex「左邊不動、往右畫下一段」。
  接起來：新圖左三分之一跟長卷尾巴對位（ECC 仿射）、調色，在重疊區找兩邊最像的一條由上到下的切線、沿線羽化接上。

  python tools/gen_panels.py gen s1_mid:3 s1_far:2           生某條長卷的第 N 張（可一次多條並行；自動檢查不合格就重生，最多 3 次）
  python tools/gen_panels.py fore s1:1 s1:2                   生第 1 關第 1、2 件前景
  python tools/gen_panels.py check s1_mid                     組長卷、存每道接縫的放大圖到 art_raw/panels/_check/
  python tools/gen_panels.py export 1                         輸出 public/art/bg/s1/*.webp、vids/_bg_strip_s1.jpg、寫 art.json 的 panels.s1
  art_raw/panels/picks.json 可指定某一張用第幾次（{"s1_mid_03": 2}），沒指定就用最新一次。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'panels'
CHECK = RAW / '_check'
PICKS = RAW / 'picks.json'
LOG = RAW / 'prompts.json'
STYLE_REF = RAW / '_style_ref.png'   # 畫風測試選中的那張（_style/A_g15.png）
IMAGE_GEN = Path.home() / '.codex/skills/codex-ppt/scripts/image_gen.py'
OUT = ROOT / 'public' / 'art'
ART_JSON = OUT / 'art.json'
VIDS = ROOT / 'vids'
H, W = 724, 2172          # 接龍畫布（3:1；後端實際只出約 157 萬像素，3:1 就是這個大小）
OV = W // 3               # 重疊（保留）寬度＝左三分之一
VIEW_H, VIEW_W = 720, 1280
LAYERS = ('far', 'midfar', 'mid')
RATE = {'far': 0.12, 'midfar': 0.3, 'mid': 0.55, 'fore': 1.3}
_LOCK = threading.Lock()

STYLE = ('richly detailed hand-drawn and hand-painted 2D side-scrolling arcade game background art in the style of '
         'classic run-and-gun games like Metal Slug: crisp dark outlines on shapes, extremely dense detail and '
         'texture (wood grain, cracked mossy stones, chipped clay roof tiles, frayed ropes, cloth folds and patches, '
         'weathering, dirt and stains), a clutter of small lived-in props, rich lighting with volumetric light and '
         'atmospheric perspective')
REF_TXT = ('Reference image 1 is a finished background from the same game: match its drawing style, line quality, '
           'texture detail, rendering and colour treatment EXACTLY, but draw ONLY the new layer described below, with '
           'the time of day, colours and lighting described below (not those of the reference). ')
NO_CHAR = 'NO characters, NO people, NO animals, NO text, NO letters, NO signs with writing, NO UI, NO frame.'
MID_H = ('The near scenery stands in the lower part of the picture; its tallest objects (roofs, trees) reach at most '
         'about 70% of the picture height from the bottom.')
MID_SKY = ('Draw ONLY the near scenery: everything behind it - the sky AND the distant landscape - is completely EMPTY '
           'and TRANSPARENT (transparent background; NO sky, NO clouds, NO distant mountains, NO distant buildings; '
           'other layers are drawn behind).')
MID_SKY_NEXT = ('Draw ONLY the near scenery: everything behind it (sky and distant landscape) stays completely EMPTY '
                'and TRANSPARENT like the left third.')
MID_BAND = ('The bottom 28% of the picture is ground-level scenery receding a little into the distance - {band} - '
            'darker than the scenery above, running across the whole width down to the bottom edge, with NO single '
            'hard horizon line, NO road edge and NO floor line (the game draws its own terrain there).')

FIRST = {
    'far': (REF_TXT + 'A 2D SIDE-SCROLLING GAME SKY LAYER (the farthest parallax layer; the first panel of a long '
            'strip), very wide panoramic 3:1 picture, in ' + STYLE + '. Content: ONLY the sky and the farthest '
            'scenery: {scene}. The farthest mountain ranges or cloud banks stay in the lower half of the picture, pale '
            'and hazy from atmospheric perspective, and the lowest part fades into haze and mist down to the bottom '
            'edge. NO buildings, NO trees, NO ground, nothing close to the viewer (other layers are drawn in front). '
            'Pure side view. ' + NO_CHAR + ' The sky and mountains continue out of the left and right edges.'),
    'midfar': (REF_TXT + 'A 2D SIDE-SCROLLING GAME DISTANT-SCENERY LAYER (the second parallax layer, in front of a '
               'separate sky layer; the first panel of a long strip), very wide panoramic 3:1 picture, in ' + STYLE +
               '. Content: {scene}, seen far away in the distance: small in scale, detailed but softened and tinted '
               'by atmospheric haze (lower contrast; {light}). The distant scenery rises from the bottom edge and its '
               'highest points reach about 60% of the picture height; its lower part is a continuous misty band (far '
               'forest canopy, rooftops or rocks in haze) filling the picture down to the bottom edge. Everything '
               'above the distant scenery is completely EMPTY and TRANSPARENT (transparent background: NO sky, NO '
               'clouds, NO sun, NO moon - the sky is a separate layer). Nothing close to the viewer. Pure side view. '
               + NO_CHAR + ' The scenery continues out of the left and right edges.'),
    'mid': (REF_TXT + 'A 2D SIDE-SCROLLING GAME NEAR-SCENERY LAYER (the main parallax layer right behind the '
            'playfield; the first panel of a long strip), very wide panoramic 3:1 picture, in ' + STYLE + '. '
            'Content: {scene}. Lighting: {light}. Pure side view (orthographic, side-on like a platformer '
            'background). {height} ' + MID_BAND + ' {sky} ' + NO_CHAR + ' The scenery continues out of the left '
            'edge and the right edge.'),
}
NEXT_HEAD = (
    'The input image is one wide panel of the {what} of a 2D side-scrolling game, in ' + STYLE + '. Its LEFT THIRD '
    'already contains finished artwork: it is the right end of the previous panel. Keep that left third EXACTLY as '
    'it is: the same objects at the same positions, the same size and scale, the same colours, lighting and '
    'outlines. The RIGHT TWO-THIRDS are still EMPTY (flat grey placeholder) and must be painted now: continue the '
    'layer seamlessly to the right from the left third, so that everything that touches the boundary continues '
    'naturally across it with no visible join. New content for the right part: {scene}. ')
NEXT = {
    'far': (NEXT_HEAD + 'The sky colours change GRADUALLY from left to right: {sky}. Same pure side view, same '
            'horizon height and the same level of detail as the left third. Draw only the sky and the farthest pale '
            'hazy mountains or clouds, fading into mist down to the bottom edge; NO buildings, NO trees, NO ground. '
            + NO_CHAR + ' No grey placeholder may remain.'),
    'midfar': (NEXT_HEAD + 'Lighting and haze: {light}; it changes only very gradually from the left third. Same pure '
               'side view, same scale and the same level of detail as the left third. Only distant scenery, small '
               'and hazy, its highest points about 60% of the picture height, with a continuous misty band down to '
               'the bottom edge; everything above it stays completely EMPTY and TRANSPARENT like the left third (NO '
               'sky, NO clouds, NO sun, NO moon). Nothing close to the viewer. ' + NO_CHAR +
               ' No grey placeholder may remain.'),
    'mid': (NEXT_HEAD + 'Lighting: {light}; it changes only very gradually from the left third, never abruptly. Same '
            'pure side view, same horizon height, same scale and the same level of detail as the left third. '
            '{height} ' + MID_BAND.replace('The bottom 28% of the picture is', 'The bottom 28% of the picture stays')
            + ' Continue the band of the left third. {sky} ' + NO_CHAR + ' The scenery continues out of the right '
            'edge. No grey placeholder may remain.'),
}
WHAT = {'far': 'SKY LAYER (farthest parallax layer)',
        'midfar': 'DISTANT-SCENERY LAYER (second parallax layer, transparent above the distant scenery)',
        'mid': 'NEAR-SCENERY LAYER (main parallax layer, transparent sky)'}

BAMBOO_H = ('Bamboo stalks may rise out of the top of the picture, but leave plenty of empty transparent gaps '
            'between them (at least half of the upper part stays empty).')
INDOOR_SKY = ('This is INDOORS: the dark riveted iron back wall fills the whole picture from top to bottom, NOTHING '
              'is transparent (no sky at all).')
INDOOR_H = 'Machines, pipes and chains may reach the top of the picture.'

# ── 每關每層每一段：scene、light（mid／midfar）、sky（far 的漸變）、band（mid 下方帶），可加 sky、height 覆寫 ──
S = {
    's1_far': [
        dict(scene='a golden dusk sky: warm golden-orange glow low in the sky fading to soft purple at the top, a big '
                   'round setting sun low above far misty mountain ranges, long soft clouds lit orange and pink from '
                   'below'),
        dict(scene='the sun sinking behind the far mountain ridges, glowing red-orange and pink clouds, sun rays '
                   'fanning out, deep purple mountain silhouettes',
             sky='from the golden-orange of the left third to a deeper red-orange sunset and then pink-purple at the '
                 'right end'),
        dict(scene='the first stars in a deep indigo sky, a thin crescent moon, the last pink-orange glow along the '
                   'far mountain horizon, dark rugged mountain silhouettes',
             sky='from the pink-purple of the left third to deep indigo night at the right end, with more and more '
                 'stars'),
    ],
    's1_midfar': [
        dict(scene='a distant Japanese mountain village on the far hillsides: clusters of small farmhouses with '
                   'glowing windows, terraced rice fields, a small pagoda on a hill, pine forests, thin smoke rising',
             light='golden-orange dusk light from the left, purple haze'),
        dict(scene='distant forested hills with a winding river valley, a far stone bridge, and the first dark bamboo '
                   'forests covering the hills', light='orange-pink sunset haze, slowly getting pinker'),
        dict(scene='an endless distant bamboo forest on rolling hills, bands of mist between the layers of bamboo',
             light='pink-purple twilight haze'),
        dict(scene='rocky cliffs on a distant mountainside with the silhouette of a wooden bandit fortress: palisade '
                   'walls, watchtowers with tiny torch lights, smoke columns',
             light='deep purple-blue evening haze with warm torchlight dots'),
    ],
    's1_mid': [
        dict(scene='the entrance of a small Japanese mountain village: two moss-covered stone lanterns (toro) with '
                   'softly glowing windows flanking a weathered wooden village gate with a thick frayed straw rope, '
                   'small terraced rice paddies with golden rice behind old stone retaining walls, round straw '
                   'haystacks, a patched scarecrow with a straw hat, a small thatched farm shed with tools, pine trees',
             light='warm golden-orange late-afternoon dusk light coming from the left, long soft shadows, light rays',
             band='dark undergrowth, weeds, mossy stones and earth'),
        dict(scene='the edge of the village: two old wooden farmhouses with dark clay-tiled roofs and deep '
                   'overhanging eaves, warmly glowing paper windows, a wooden drying rack with rows of dried fish on '
                   'straw ropes, stacks of firewood, barrels, buckets, bamboo baskets, laundry on a bamboo pole',
             light='the same warm golden-orange dusk light coming from the left as in the existing part',
             band='dark undergrowth, weeds, mossy stones and earth'),
        dict(scene='a small village market square: wooden market stalls with patched cloth awnings (no writing) and '
                   'paper lanterns just being lit, baskets of vegetables, fruit and fish, sacks of rice, a stone well '
                   'with a small wooden roof and a bucket, plain indigo shop curtains (noren) with no writing, a big '
                   'old tree',
             light='the dusk light turns deeper orange as the sun sets (warm orange-red light from the left), the '
                   'paper lanterns begin to glow', band='dark undergrowth, weeds, stones and earth'),
        dict(scene='a small arched stone bridge crossing a stream in the middle distance, the stream running behind '
                   'the undergrowth with a little waterfall between mossy rocks, weeping willow trees, tall reeds and '
                   'the last wooden fence of the village',
             light='orange-pink sunset light, a little dimmer than before, the first purple tones in the shadows',
             band='dark reeds, mossy rocks, wet stones and earth'),
        dict(scene='the entrance of a bamboo forest: the first tall green bamboo stalks and bamboo thickets, a small '
                   'weathered wooden wayside shrine (hokora) with a faded red cloth and a tiny stone lantern, a mossy '
                   'stone path marker, fallen bamboo leaves',
             light='pink-purple late sunset light filtering between the bamboo stalks in soft light rays, colours '
                   'getting cooler', band='dark bamboo thickets, ferns, fallen leaves and earth', height=BAMBOO_H),
        dict(scene='deep inside the bamboo forest: many tall bamboo stalks in two or three layers, drifting bamboo '
                   'leaves, a few glowing fireflies, a fallen bamboo trunk, mossy stones',
             light='purple twilight, the sun is gone, cool blue-purple shadows with a faint pink glow from the left, '
                   'fireflies glowing', band='dark bamboo thickets, ferns, fallen leaves and earth', height=BAMBOO_H),
        dict(scene="outside the mountain bandits' fortress: a tall wooden palisade wall of sharpened logs lashed with "
                   'rope, a wooden watchtower with a small thatched roof and a burning torch, torn plain cloth banners '
                   'on poles (no writing), wooden crates, barrels, animal-skin-free piles of loot sacks, rocks',
             light='dark purple-blue evening, the torches cast warm orange light on the logs, cool blue shadows',
             band='rocks, rough logs, trampled bushes and dark earth'),
        dict(scene='the fortress main gate and campfire square: a big heavy wooden gate standing open with a log '
                   'lintel and two torch braziers, behind it rough thatched huts, a big bonfire whose flames and '
                   'orange glow rise between the huts, weapon racks with wooden clubs, a big drum on a stand, barrels',
             light='night: deep navy-purple darkness lit by the big bonfire and torches with strong warm orange light '
                   'and flying sparks', band='rocks, rough logs, trampled bushes and dark earth'),
    ],
    's2_far': [
        dict(scene='a deep blue-purple festival night sky full of stars with several big colourful round fireworks '
                   'bursting (red, gold, green) above far dark mountain ridges, thin clouds lit by the fireworks'),
        dict(scene='a huge bright full moon high in a starry navy sky above far dark rolling mountains, silver-lit '
                   'thin clouds; only one or two small faint fireworks near the left',
             sky='from the blue-purple firework night of the left third to a calmer deep navy moonlit sky'),
        dict(scene='a deep midnight sky with drifting silver clouds and many stars above a tall dark far mountain, a '
                   'faint purple mystic glow around the mountain peak (the moon itself is NOT in this part)',
             sky='from the navy moonlit sky of the left third to an even deeper midnight blue with a faint purple glow'),
    ],
    's2_midfar': [
        dict(scene='a distant festival town at night: rows of rooftops with strings of tiny glowing lanterns, a far '
                   'pagoda, festival banners, the warm glow of the festival rising into the haze',
             light='night, warm lantern glow from below, blue-purple night haze'),
        dict(scene='a distant riverside town and a long low wooden bridge far away, willows along the far bank, mist '
                   'lying on the river', light='cool silver moonlight, blue haze, a few warm lights'),
        dict(scene='distant dark marshland with reed beds, twisted trees and small ponds, fireflies, drifting mist',
             light='eerie blue-green moonlit haze'),
        dict(scene='a distant mountain with a shrine hall on its summit, rows of red torii gates and stone lantern '
                   'lights climbing the slope, red and orange maple forests',
             light='moonlit night, purple haze, warm lantern dots'),
    ],
    's2_mid': [
        dict(scene='the entrance of a night yokai festival: a big weathered red Shinto torii gate, long strings of '
                   'glowing red and white paper lanterns hanging between tall wooden poles, mossy stone lanterns, '
                   'plain festival banners on poles (no writing), a blank wooden notice board, red maple trees',
             light='night, lit by the warm red-orange glow of many paper lanterns, deep blue-purple shadows',
             band='low mossy stone walls, dark bushes, gravel and earth'),
        dict(scene='a street of festival food stalls: wooden stalls with faded red-and-white striped awnings, paper '
                   'lanterns on every stall, a goldfish-scooping tub, colourful toy pinwheels, hanging festival masks, '
                   'cotton candy bags, steaming pots, wooden crates, strings of lanterns overhead',
             light='night, warm red-orange lantern glow, deep blue-purple shadows',
             band='low stone walls, dark bushes, gravel and earth'),
        dict(scene='the festival plaza: a tall wooden yagura tower draped in red and white cloth with a big taiko drum '
                   'on top, many strings of lanterns radiating from its top, wooden benches, paper streamers, a stall '
                   'at the side', light='night, very bright warm lantern light with colourful reflections of '
                                        'fireworks from above', band='low stone walls, dark bushes, gravel and earth'),
        dict(scene='the river embankment: a curved grey stone embankment wall with a small flight of stone steps down '
                   'to the water, weeping willow trees, mossy stone lanterns, small paper lanterns floating on the dark '
                   'river', light='the festival glow fades and cool silver-blue moonlight takes over, a few warm '
                                  'lanterns remain', band='dark river water with moonlit ripples, reeds and wet stones'),
        dict(scene='a red arched wooden bridge (taiko-bashi) crossing the river in the middle distance, weathered '
                   'wooden posts with small lanterns, tall reeds and cattails, willow branches hanging down, fireflies',
             light='cool silver-blue moonlight with warm lantern dots on the bridge',
             band='dark river water with moonlit ripples, reeds and wet stones'),
        dict(scene='a murky kappa swamp: big lotus leaves and pink lotus flowers, reeds and cattails, mossy rocks, '
                   'twisted dead trees with hanging moss, a broken old wooden boat half sunk, a small patch of '
                   'cucumber vines on a bamboo trellis, fireflies',
             light='eerie moonlit night with green-blue mist, fireflies glowing',
             band='dark swamp water with lily pads, reeds and mossy rocks'),
        dict(scene='the foot of a mountain shrine: long mossy stone steps climbing up the hillside toward the right, '
                   'lined by a row of red torii gates and glowing stone lanterns, red and orange maple trees, big '
                   'mossy rocks', light='moonlit night, warm glow from the stone lanterns, red maple leaves',
             band='mossy stone walls, dark bushes and earth'),
        dict(scene='the main hall of a Shinto shrine on the mountaintop: an old wooden shrine hall with a big curved '
                   'roof and golden ornaments, a thick straw rope with white paper streamers over the entrance, a '
                   'wooden offering box, a big sacred tree with a straw rope, a large red torii gate, stone lanterns, '
                   'red maple trees with falling leaves',
             light='moonlit night, mysterious and calm, warm lantern glow on the shrine and a faint purple magic glow',
             band='mossy stone walls, dark bushes and earth'),
    ],
    's3_far': [
        dict(scene='a dark overcast evening sky with a dull orange smoggy glow near the horizon, heavy grey clouds, '
                   'far dark mountain ridges in haze'),
        dict(scene='heavy dark storm clouds gathering and swirling above the far mountains, distant flashes of '
                   'lightning inside the clouds', sky='from the orange smoggy evening of the left third to dark '
                                                      'grey-blue storm clouds'),
        dict(scene='a violent thunderstorm: swirling dark clouds, several bright white-purple lightning bolts, '
                   'slanting rain streaks, far mountains barely visible',
             sky='from the dark grey-blue storm of the left third to an even darker blue-purple storm with bright '
                 'lightning'),
    ],
    's3_midfar': [
        dict(scene='a distant mechanical castle town: tiled rooftops mixed with iron smokestacks puffing smoke, big '
                   'gear wheels on factory buildings, steam clouds, lamp lights',
             light='smoggy orange evening haze, cold grey shadows'),
        dict(scene='the giant stone and iron walls and gate towers of a mechanical castle far away, steam pipes, red '
                   'warning lights', light='smoggy orange-grey haze, getting darker'),
        dict(scene='a distant factory complex: sawtooth roofs, chimneys with furnace glow, cranes and gantries, steam',
             light='dark grey-blue storm haze with orange furnace glow'),
        dict(scene='the giant iron Japanese castle keep far away on its stone base, with golden roof ornaments and '
                   'red warning lights, other castle rooftops around it',
             light='cold blue-purple storm haze, lightning lighting the edges'),
    ],
    's3_mid': [
        dict(scene='the outer town of a giant mechanical iron castle: massive grey stone castle walls (ishigaki) with '
                   'big brass gears built into them, iron lamp posts with glowing lamps, riveted iron plates, small '
                   'vents puffing white steam, iron-bound wooden storehouses with tiled roofs, crates and coal sacks',
             light='dark smoggy evening with a dull orange glow from the left, cold grey-blue shadows, warm lamp light',
             band='grey stone blocks, dark iron plates, coal and rubble'),
        dict(scene='a huge mechanical castle gate: a tall gate of riveted dark iron plates with a raised iron '
                   'portcullis, giant brass gears and cogwheels on both sides, heavy chains, red warning lamps, stone '
                   'gatehouse walls with a curved tiled roof',
             light='dark smoggy evening with a dull orange glow, cold grey-blue shadows, red and warm lamp light',
             band='grey stone blocks, dark iron plates, coal and rubble'),
        dict(scene='a steam pipe corridor along the castle wall: many thick copper and iron steam pipes running '
                   'horizontally and vertically, red valve wheels, pressure gauges, puffs of white steam, an iron '
                   'catwalk with railings above; toward the right end the corridor goes indoors under a dark riveted '
                   'iron roof and wall',
             light='orange smoggy evening light turning into warm lamp light and dark shadows toward the right',
             band='dark iron plates, pipes and stone blocks',
             sky='Everything behind the scenery at the left stays EMPTY and TRANSPARENT like the left third; toward '
                 'the right end the dark iron roof and back wall close over it and fill the picture up to the top.',
             height='The pipes and walls may rise to the top of the picture toward the right end.'),
        dict(scene='INSIDE a gloomy mechanical factory: a dark riveted iron back wall with small round windows, long '
                   'conveyor belts on iron frames carrying wooden crates and gears, big turning brass gears, hanging '
                   'chains and hooks, orange work lamps', light='warm orange lamp light against cold blue-grey shadows',
             band='dark iron plates, pipes and machinery bases', sky=INDOOR_SKY, height=INDOOR_H),
        dict(scene='INSIDE the factory forge: glowing orange furnaces and forges with open fire mouths, anvils, '
                   'channels of glowing molten metal, big leather bellows, chimney pipes going up out of the top, '
                   'sparks', light='strong hot orange-red glow from the furnaces, deep blue-grey shadows',
             band='dark iron plates, pipes and machinery bases', sky=INDOOR_SKY, height=INDOOR_H),
        dict(scene='INSIDE a tall elevator shaft: an iron cage lift hanging on thick cables, big pulley wheels, '
                   'vertical steel rails and girders, counterweights, iron ladders, a few caged lamps',
             light='colder blue-grey light with a few warm orange lamps, a little darker than the forge',
             band='dark iron plates, pipes and machinery bases', sky=INDOOR_SKY, height=INDOOR_H),
        dict(scene='just after the left third, the iron wall of the shaft ends in a broken jagged edge of torn iron '
                   'plates; to the right of it we are OUTSIDE on the castle keep: a steep wooden staircase with iron '
                   'railings climbing up along the white plaster and dark wood walls of the keep, curved tiled roof '
                   'edges with golden ornaments, iron reinforcement plates, paper lanterns swinging in the wind',
             light='outside: cold blue-purple stormy light, wet surfaces with white highlights, warm lantern glow',
             band='dark wet roof tiles and stone blocks',
             sky='Outside (to the right of the broken wall edge) everything behind the scenery is completely EMPTY '
                 'and TRANSPARENT: do NOT paint any sky, clouds, rain, lightning or distant buildings there (other '
                 'layers show the storm).',
             height='The keep walls may rise out of the top of the picture, but leave plenty of empty transparent '
                    'space above the roofs.'),
        dict(scene='the top of the castle keep in a thunderstorm: layered curved tiled roofs with golden fish-shaped '
                   'roof ornaments (shachihoko), iron lightning rods and antennas crackling with sparks, wet shining '
                   'tiles, torn plain banners (no writing), rain',
             light='dramatic cold blue-purple storm light with white lightning highlights on the edges',
             band='dark wet roof tiles and stone blocks'),
    ],
}
ZH = {'s1_far': ['金黃黃昏', '夕陽落下', '暮色星空'],
      's1_midfar': ['遠方山村與梯田', '遠方河谷與竹山', '遠方竹海', '遠方山崖上的山賊寨'],
      's1_mid': ['村口石燈籠與梯田', '民家屋簷與曬魚架', '小市集', '石橋與溪', '竹林入口', '竹林深處', '山賊寨外木柵與瞭望台',
                 '山賊寨大門與營火廣場'],
      's2_far': ['煙火夜空', '滿月', '深夜雲與星'],
      's2_midfar': ['遠方祭典小鎮', '遠方河岸與長橋', '遠方沼澤', '遠方神社山'],
      's2_mid': ['夜祭入口鳥居', '攤位街', '煙火廣場', '河堤', '木橋', '河童的沼澤', '神社石階', '神社本殿'],
      's3_far': ['煙霧黃昏', '暴風雲聚集', '雷雨'],
      's3_midfar': ['遠方機關城下町', '遠方城牆與城門塔', '遠方工廠群', '遠方天守閣'],
      's3_mid': ['城下石牆', '齒輪城門', '蒸汽管走廊', '輸送帶工廠', '鍛爐', '升降機井', '天守閣樓梯', '暴風雨屋頂']}

# ── 前景（單件、透明）：(描述, 高度類型 full＝從地面長到畫面外／top＝從上方垂下／low＝地上矮的, 中文) ──
FORE = {
    1: [('a cluster of three tall green bamboo stalks with a few leafy branches, seen very close', 'full', '竹幹叢'),
        ('a tall dark pine tree trunk with rough bark and one bushy branch near the top', 'full', '松樹幹'),
        ('a short weathered wooden fence section with posts tied by frayed rope, weeds at its foot', 'low', '木柵欄'),
        ('laundry hanging from a horizontal bamboo pole: patched indigo cloths and a white towel', 'top', '晾衣竹竿'),
        ('a clump of tall pampas grass and reeds', 'low', '芒草叢'),
        ('three sharpened wooden stakes lashed with rope, a bandit barricade', 'low', '山賊尖木樁')],
    2: [('a string of red and white paper lanterns hanging from a sagging rope, glowing warmly', 'top', '燈籠串'),
        ('one thick weathered red torii pillar with a black base, seen very close', 'full', '鳥居柱'),
        ('a red wooden bridge railing section with a round post cap', 'low', '朱紅橋欄杆'),
        ('a clump of tall reeds and cattails', 'low', '蘆葦香蒲'),
        ('a branch of red and orange maple leaves hanging down', 'top', '垂下的楓枝'),
        ('a plain festival cloth banner hanging from a pole, gently folded (no writing)', 'top', '祭典布簾')],
    3: [('a heavy rusty iron chain hanging straight down with a big hook at the bottom', 'top', '吊鉤鐵鍊'),
        ('a thick vertical copper steam pipe with rivets, a red valve wheel and a pressure gauge', 'full', '直立蒸汽管'),
        ('a riveted iron railing section with a hazard-striped top bar', 'low', '鐵欄杆'),
        ('the upper half of a huge brass gear wheel, rising from below', 'low', '大齒輪（下半在畫面外）'),
        ('a torn dark red cloth banner hanging down, frayed at the bottom (no writing)', 'top', '破布旗'),
        ('a steel girder column with bolts and cross braces', 'full', '鋼樑柱')],
}
FORE_LIGHT = {1: 'warm dusk light from the left, the side facing the camera in soft shadow',
              2: 'night, warm lantern light and cool moonlight', 3: 'cold stormy light with warm lamp reflections'}
FORE_TMPL = (
    REF_TXT + 'ONE FOREGROUND OBJECT for a 2D side-scrolling game (it passes very close in front of the camera), in '
    + STYLE + ': {obj}. Lighting: {light}; slightly darker and more saturated than the background because it is '
    'close to the camera. Pure side view. {fit} Transparent background: the object is complete, solid and opaque '
    'with crisp edges; everything else is fully transparent. Just this one object. ' + NO_CHAR + ' No ground, no '
    'shadow, no border.')
FORE_FIT = {'full': 'A tall vertical object that fills the picture from the bottom edge to the top edge.',
            'top': 'It hangs down from the top edge of the picture; its upper end is cut off by the top edge.',
            'low': 'A low object standing on an invisible ground line at the bottom edge, filling most of the width.'}
FORE_H = {'full': 900, 'top': 520, 'low': 330}   # 輸出高度（畫面像素）
# 人眼看過後的修正：(關, 第幾件) → (擺法, 高度)。第二關布簾生出來帶一根落地的竿子，改成從地面長到畫面頂
FORE_FIX = {(2, 6): ('full', 760)}


# ── 小工具 ──
def layer(chain: str) -> str:
    return chain.split('_')[1]


def prompt_for(chain: str, k: int) -> str:
    s = S[chain][k - 1]
    ly = layer(chain)
    if k == 1:
        return FIRST[ly].format(scene=s['scene'], light=s.get('light', ''), band=s.get('band', ''),
                                height=s.get('height', MID_H), sky=s.get('sky', MID_SKY))
    return NEXT[ly].format(what=WHAT[ly], scene=s['scene'], light=s.get('light', ''), band=s.get('band', ''),
                           height=s.get('height', MID_H), sky=s.get('sky', MID_SKY_NEXT))


def transparent(chain: str) -> bool:
    return layer(chain) != 'far'


def tries(name: str) -> list[Path]:
    return sorted(RAW.glob(f'{name}.try*.png'), key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))


def pick(chain: str, k: int) -> Path | None:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    name = f'{chain}_{k:02d}'
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    t = [p for p in tries(name) if '.reject.' not in p.name]
    return t[-1] if t else None


def clean_alpha(a: np.ndarray) -> np.ndarray:
    """Codex 透明圖實心處 alpha 只有 250 上下、背景有 1～10 的殘影：壓成乾淨的 0／255（中間值保留給霧氣）。"""
    a = a.astype(np.float32).copy()
    al = np.clip((a[..., 3] - 12) / (238 - 12), 0, 1) * 255
    a[..., 3] = al
    a[..., :3][al == 0] = 0
    return a


def load_raw(path: Path, chain: str, first: bool) -> np.ndarray:
    im = Image.open(path).convert('RGBA')
    if first:   # 第一張不一定剛好 3:1：等比縮成高 H
        im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
    elif im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    if transparent(chain):
        return clean_alpha(a)
    a[..., 3] = 255
    return a


def premul(a: np.ndarray) -> np.ndarray:
    out = a.copy()
    out[..., :3] *= a[..., 3:4] / 255
    return out


def unpremul(p: np.ndarray) -> np.ndarray:
    out = p.copy()
    al = p[..., 3:4]
    out[..., :3] = np.where(al > 0.5, p[..., :3] * 255 / np.maximum(al, 1e-3), 0)
    return np.clip(out, 0, 255)


def gray(a: np.ndarray) -> np.ndarray:
    al = a[..., 3:4] / 255
    rgb = a[..., :3] * al + 128 * (1 - al)
    return (rgb @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)


def register(tail: np.ndarray, head: np.ndarray) -> tuple[np.ndarray, dict]:
    """head（新圖左三分之一）對到 tail（長卷尾巴）：ECC 仿射。"""
    g1, g2 = gray(tail), gray(head)
    m = np.eye(2, 3, dtype=np.float32)
    info: dict = {'ok': False}
    try:
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
        cc, m = cv2.findTransformECC(g1, g2, m, cv2.MOTION_AFFINE, crit, None, 5)
        info = {'ok': True, 'cc': round(float(cc), 4)}
    except cv2.error as e:
        info['err'] = str(e)[-120:]
        m = np.eye(2, 3, dtype=np.float32)
    info.update(dx=round(float(m[0, 2]), 2), dy=round(float(m[1, 2]), 2), sx=round(float(m[0, 0]), 4),
                sy=round(float(m[1, 1]), 4))
    if not info['ok'] or abs(m[0, 2]) > 25 or abs(m[1, 2]) > 25 or abs(m[0, 0] - 1) > 0.04 or abs(m[1, 1] - 1) > 0.04:
        info['used'] = False
        return np.eye(2, 3, dtype=np.float32), info
    info['used'] = True
    return m, info


def warp(a: np.ndarray, m: np.ndarray) -> np.ndarray:
    if np.allclose(m, np.eye(2, 3), atol=1e-3):
        return a
    p = cv2.warpAffine(premul(a), m, (a.shape[1], a.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                       borderMode=cv2.BORDER_REPLICATE)
    return unpremul(p)


def min_cut(A: np.ndarray, B: np.ndarray, margin: int = 60) -> np.ndarray:
    """A、B 等大（重疊區）：找一條由上到下、兩邊最像的切線（每列一個 x），只能在 [margin, w-margin) 內。"""
    h, w = A.shape[:2]
    cost = ((premul(A) - premul(B)) ** 2).sum(-1)
    cost = ndimage.uniform_filter(cost, 5)
    acc = cost.copy()
    acc[:, :margin] = np.inf
    acc[:, w - margin:] = np.inf
    back = np.zeros((h, w), np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        cand = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        k = cand.argmin(0)
        back[y] = k - 1
        acc[y] += cand[k, np.arange(w)]
    path = np.zeros(h, int)
    path[-1] = int(acc[-1].argmin())
    for y in range(h - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path


def blend(A: np.ndarray, B: np.ndarray, path: np.ndarray, sigma: float = 4) -> np.ndarray:
    mask = (np.arange(A.shape[1])[None, :] < path[:, None]).astype(np.float32)
    mask = ndimage.gaussian_filter1d(mask, sigma, axis=1)[..., None]
    return unpremul(premul(A) * mask + premul(B) * (1 - mask))


def build(chain: str, upto: int | None = None, verbose: bool = False) -> tuple[np.ndarray, list[dict]]:
    """照 picks 把第 1..upto 張接成長卷（高 H）。"""
    n = upto or len(S[chain])
    src = pick(chain, 1)
    if src is None:
        raise SystemExit(f'{chain} 第 1 張還沒生')
    strip = load_raw(src, chain, True)
    seams = []
    for k in range(2, n + 1):
        src = pick(chain, k)
        if src is None:
            raise SystemExit(f'{chain} 第 {k} 張還沒生')
        R = load_raw(src, chain, False)
        tail = strip[:, -OV:]
        m, reg = register(tail, R[:, :OV])
        R = warp(R, m)
        both = (tail[..., 3] > 200) & (R[:, :OV, 3] > 200)
        gain = [1.0, 1.0, 1.0]
        if both.sum() > 1000:
            g = np.clip(tail[..., :3][both].mean(0) / np.maximum(R[:, :OV, :3][both].mean(0), 1), 0.88, 1.12)
            if np.abs(g - 1).max() > 0.01:
                # 重疊區全量修正（接縫才對得上），往右漸漸放掉（新段本來要的光線變化保留下來）
                ramp = np.clip((np.arange(W) - OV) / (W - OV), 0, 1)[None, :, None]
                R[..., :3] = np.clip(R[..., :3] * (g + (1 - g) * ramp), 0, 255)
                gain = [round(float(x), 3) for x in g]
        kept = float(np.abs(premul(tail) - premul(R[:, :OV])).mean())
        path = min_cut(tail, R[:, :OV])
        x0 = strip.shape[1] - OV
        rms = float(np.sqrt(((premul(tail) - premul(R[:, :OV])) ** 2).sum(-1)[np.arange(H), path].mean()))
        strip = np.concatenate([strip[:, :x0], blend(tail, R[:, :OV], path), R[:, OV:]], axis=1)
        seams.append({'k': k, 'src': src.name, 'x0': x0, 'path': path + x0, 'kept_diff': round(kept, 2),
                      'seam_rms': round(rms, 1), 'gain': gain, 'reg': reg})
        if verbose:
            print(f'  {chain} 第 {k} 張（{src.name}）：保留區差 {kept:.2f}、切線 rms {rms:.1f}、增益 {gain}、對位 {reg}')
    return strip, seams


def checker_bg(h: int, w: int) -> np.ndarray:
    b = np.zeros((h, w, 3), np.float32)
    b[...] = (118, 128, 150)
    yy, xx = np.mgrid[:h, :w]
    b[((yy // 24 + xx // 24) % 2) == 1] = (148, 158, 180)
    return b


def composite(a: np.ndarray, bg: np.ndarray | None = None) -> np.ndarray:
    if a.shape[2] == 3:
        return a
    if bg is None:
        bg = checker_bg(*a.shape[:2])
    al = a[..., 3:4] / 255
    return a[..., :3] * al + bg[..., :3] * (1 - al)


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8))


def save_seam_checks(chain: str, strip: np.ndarray, seams: list[dict]) -> list[Path]:
    CHECK.mkdir(parents=True, exist_ok=True)
    outs = []
    for s in seams:
        cx = int(np.mean(s['path']))
        x1, x2 = max(cx - 200, 0), min(cx + 200, strip.shape[1])
        crop = composite(strip[:, x1:x2])
        marked = crop.copy()
        for y, x in enumerate(s['path']):
            if x1 <= x < x2 and y % 6 < 3:
                marked[y, x - x1] = (255, 40, 40)
        img = np.concatenate([crop, np.full((H, 12, 3), 255, np.float32), marked], axis=1)
        p = CHECK / f'{chain}_seam{s["k"]:02d}.png'
        to_img(img).save(p)
        outs.append(p)
    return outs


def rows_image(arr: np.ndarray, rows: int, path: Path, width: int = 2000) -> Path:
    step = int(np.ceil(arr.shape[1] / rows))
    parts = []
    for r in range(rows):
        part = arr[:, r * step:(r + 1) * step]
        if part.shape[1] < step:
            part = np.concatenate([part, np.full((arr.shape[0], step - part.shape[1], 3), 255, np.float32)], axis=1)
        parts += [part, np.full((10, step, 3), 255, np.float32)]
    im = to_img(np.concatenate(parts[:-1], axis=0))
    im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(path)
    return path


# ── 生圖 ──
def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def call_codex(prompt: str, inp: Path | None, out: Path, transp: bool) -> str:
    """inp＝None 時用 generate（不帶參考圖）。"""
    cmd = [sys.executable, str(IMAGE_GEN), 'edit' if inp else 'generate', '--backend', 'codex-oauth', '--model',
           'gpt-image-1.5', '--size', '1536x1024', '--quality', 'high', '--prompt', prompt, '--out', str(out),
           '--force', '--background', 'transparent' if transp else 'opaque']
    if inp:
        cmd += ['--image', str(inp)]
    status = 'failed'
    for _ in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists():
            return 'ok'
        status = f'failed: {r.stderr.strip()[-400:]}'
        low = r.stderr.lower()
        if not any(t in low for t in ('capacity', 'rate', 'timed out', 'timeout', 'http 5', 'overloaded')):
            break
        time.sleep(30)
    return status


def style_ref_31() -> Path:
    """畫風參考圖裁成 3:1（edit 的輸出比例會跟著參考圖）。"""
    p = RAW / '_style_ref_3x1.png'
    if not p.exists():
        im = Image.open(STYLE_REF).convert('RGB')
        ch = round(im.width / 3)
        top = (im.height - ch) // 2
        im.crop((0, top, im.width, top + ch)).save(p)
    return p


def quick_check(chain: str, k: int, out: Path) -> tuple[bool, str]:
    R = load_raw(out, chain, k == 1)
    info = f'{R.shape[1]}x{R.shape[0]}'
    if transparent(chain):
        info += f'、透明比例 {float((R[..., 3] < 16).mean()):.2f}'
    if k == 1:
        return True, info
    tail = build(chain, k - 1)[0][:, -OV:]
    kept = float(np.abs(premul(tail) - premul(R[:, :OV])).mean())
    grey = (np.abs(R[:, OV:, :3] - 128).max(-1) < 6) & (R[:, OV:, 3] > 200)
    gfrac = float(grey.mean())
    # 整張被調亮／調暗太多（保留區跟尾巴的亮度比）
    both = (tail[..., 3] > 200) & (R[:, :OV, 3] > 200)
    ratio = float(tail[..., :3][both].mean() / max(R[:, :OV, :3][both].mean(), 1)) if both.sum() > 1000 else 1.0
    # 中景底部要實心（地形蓋在上面，底下不能透出後面）
    bottom = float((R[-60:, :, 3] < 200).mean()) if layer(chain) == 'mid' else 0.0
    ok = kept < 14 and gfrac < 0.03 and 0.88 < ratio < 1.12 and bottom < 0.02
    return ok, f'{info}、保留區差 {kept:.2f}、灰色殘留 {gfrac:.3f}、亮度比 {ratio:.2f}、底部不實心 {bottom:.2f}'


def next_try(name: str) -> int:
    with _LOCK:
        n = 1
        while any((RAW / f'{name}.try{n}{suf}').exists() for suf in ('.png', '.pending', '.reject.png')):
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    return n


def gen_one(chain: str, k: int, max_tries: int = 3) -> str:
    lines = []
    name = f'{chain}_{k:02d}'
    for _ in range(max_tries):
        n = next_try(name)
        out = RAW / f'{name}.try{n}.png'
        prompt = prompt_for(chain, k)
        if k == 1:
            inp = style_ref_31()
        else:
            strip = build(chain, k - 1)[0]
            canvas = np.zeros((H, W, 4), np.float32)
            canvas[...] = (128, 128, 128, 255)
            canvas[:, :OV] = strip[:, -OV:]
            if not transparent(chain):
                canvas[..., 3] = 255
            inp = RAW / f'_in_{name}.try{n}.png'
            Image.fromarray(np.clip(canvas + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(inp)
        t0 = time.time()
        status = call_codex(prompt, inp, out, transparent(chain))
        (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
        ok, verdict = (quick_check(chain, k, out) if status == 'ok' else (False, ''))
        record(name, {'attempt': n, 'status': status, 'check': verdict, 'pass': ok, 'input': inp.name,
                      'prompt': prompt, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
        lines.append(f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）{verdict}{"" if ok else " ✗"}')
        if ok:
            break
        if out.exists():
            out.rename(RAW / f'{name}.try{n}.reject.png')
    return '\n'.join(lines)


def gen_fore(stage: int, i: int, max_tries: int = 2) -> str:
    obj, fit, _ = FORE[stage][i - 1]
    name = f's{stage}_fore_{i:02d}'
    prompt = FORE_TMPL.format(obj=obj, light=FORE_LIGHT[stage], fit=FORE_FIT[fit])
    lines = []
    for _ in range(max_tries):
        n = next_try(name)
        out = RAW / f'{name}.try{n}.png'
        # 前景用直式參考圖（輸出比例跟著參考圖）：full／top 用 2:3，low 用 3:2
        ref = RAW / ('_style_ref_portrait.png' if fit != 'low' else '_style_ref_land.png')
        if not ref.exists():
            im = Image.open(STYLE_REF).convert('RGB')
            if fit != 'low':
                cw = round(im.height * 2 / 3)
                im.crop((0, 0, cw, im.height)).save(ref)
            else:
                cw = round(im.height * 3 / 2)
                im.crop((0, 0, min(cw, im.width), im.height)).save(ref)
        t0 = time.time()
        status = call_codex(prompt, ref, out, True)
        (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
        ok = status == 'ok'
        verdict = ''
        if ok:
            a = clean_alpha(np.asarray(Image.open(out).convert('RGBA')))
            corners = [a[0, 0, 3], a[0, -1, 3], a[-1, 0, 3], a[-1, -1, 3]]
            verdict = f'透明比例 {float((a[..., 3] < 16).mean()):.2f}、四角 alpha {[int(c) for c in corners]}'
        record(name, {'attempt': n, 'status': status, 'check': verdict, 'prompt': prompt,
                      'at': time.strftime('%Y-%m-%d %H:%M:%S')})
        lines.append(f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）{verdict}')
        if ok:
            break
    return '\n'.join(lines)


# ── 輸出 ──
def resize_rgba(a: np.ndarray, w: int, h: int) -> np.ndarray:
    p = premul(a)
    chans = [np.asarray(Image.fromarray(p[..., c]).resize((w, h), Image.LANCZOS)) for c in range(4)]
    return unpremul(np.clip(np.stack(chans, -1), 0, 255))


def save_webp(a: np.ndarray, path: Path, alpha: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if alpha:
        Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path, 'WEBP', quality=92, method=6,
                                                                               alpha_quality=100)
    else:
        Image.fromarray(np.clip(a[..., :3] + 0.5, 0, 255).astype(np.uint8), 'RGB').save(path, 'WEBP', quality=92,
                                                                                      method=6)


def fore_pick(stage: int, i: int) -> Path | None:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    name = f's{stage}_fore_{i:02d}'
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    t = [p for p in tries(name) if '.reject.' not in p.name]
    return t[-1] if t else None


def export_fore(stage: int) -> list[dict]:
    items = []
    for i, (obj, fit, zh) in enumerate(FORE[stage], 1):
        src = fore_pick(stage, i)
        if src is None:
            continue
        fit, th = FORE_FIX.get((stage, i), (fit, FORE_H[fit]))
        a = clean_alpha(np.asarray(Image.open(src).convert('RGBA')))
        # 只留最大的一塊（去掉零碎殘點）
        mask = a[..., 3] > 0
        lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=6))
        if n > 1:
            sizes = ndimage.sum(mask, lab, range(1, n + 1))
            keep = np.isin(lab, [j + 1 for j in range(n) if sizes[j] >= 0.03 * sizes.max()])
            a[..., 3] *= keep
        ys, xs = np.where(a[..., 3] > 8)
        a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        a = resize_rgba(a, max(1, round(a.shape[1] * th / a.shape[0])), th)
        rel = f'bg/s{stage}/fore_{i:02d}'
        save_webp(a, OUT / f'{rel}.webp', True)
        anchor = {'full': 'bottom', 'top': 'top', 'low': 'bottom'}[fit]
        items.append({'path': f'{rel}.webp', 'w': a.shape[1], 'h': a.shape[0], 'name': zh, 'anchor': anchor,
                      'source': src.name,
                      'use': {'full': '從畫面底往上長、上端超出畫面頂（圖底貼畫面底）',
                              'top': '從畫面頂垂下（圖頂貼畫面頂）',
                              'low': '擺在畫面最下方（圖底貼畫面底），擋在地面前緣'}[fit]})
        CHECK.mkdir(parents=True, exist_ok=True)
        to_img(composite(a)).save(CHECK / f's{stage}_fore_{i:02d}.png')
    return items


def export(stage: int) -> dict:
    CHECK.mkdir(parents=True, exist_ok=True)
    result: dict = {}
    strips = {}
    for ly in LAYERS:
        chain = f's{stage}_{ly}'
        strip, seams = build(chain, verbose=True)
        n = len(S[chain])
        tw = round(strip.shape[1] * VIEW_H / H)
        strip = resize_rgba(strip, tw, VIEW_H)
        if ly == 'far':
            strip[..., 3] = 255
        strips[ly] = strip
        edges = [round(i * tw / n) for i in range(n + 1)]
        items = []
        for i in range(n):
            rel = f'bg/s{stage}/{ly}_{i + 1:02d}'
            save_webp(strip[:, edges[i]:edges[i + 1]], OUT / f'{rel}.webp', ly != 'far')
            src = pick(chain, i + 1)
            items.append({'path': f'{rel}.webp', 'x': edges[i], 'w': edges[i + 1] - edges[i], 'h': VIEW_H,
                          'scene': ZH[chain][i], 'source': src.name if src else None})
        result[ly] = {'totalW': tw, 'items': items,
                      'seams': [{'between': [s['k'] - 1, s['k']], 'keptDiff': s['kept_diff'], 'seamRms': s['seam_rms']}
                                for s in seams]}
        print(f'  s{stage} {ly}：總寬 {tw}，{n} 張，每張寬 {[it["w"] for it in items]}')
    # 捲動速率：以中景 0.55 為準，讓每一層都剛好在關卡最右端捲到自己的最右端
    L = (result['mid']['totalW'] - VIEW_W) / RATE['mid']
    for ly in LAYERS:
        # 無條件捨去到小數四位：四捨五入會讓關卡最右端多捲幾像素、露出圖外的黑邊
        result[ly]['rate'] = (np.floor((result[ly]['totalW'] - VIEW_W) / L * 10000) / 10000) if ly != 'mid' \
            else RATE['mid']
        result[ly]['rate'] = float(result[ly]['rate'])
    result['worldLength'] = round(L + VIEW_W)
    result['fore'] = {'rate': RATE['fore'], 'items': export_fore(stage)}

    # 長圖：中景疊在「拉長到同寬」的遠中景、遠景上（玩家走到中景某處時，背後大約就是那兩層同比例的位置）
    mid = strips['mid']
    tw = mid.shape[1]
    far_st = np.asarray(to_img(strips['far'][..., :3]).resize((tw, VIEW_H), Image.LANCZOS)).astype(np.float32)
    mf = resize_rgba(strips['midfar'], tw, VIEW_H)
    comp = composite(mid, composite(mf, far_st))
    VIDS.mkdir(exist_ok=True)
    im = to_img(comp)
    im.resize((round(im.width * 360 / im.height), 360), Image.LANCZOS).save(VIDS / f'_bg_strip_s{stage}.jpg',
                                                                            quality=88)
    rows_image(comp, 4, CHECK / f's{stage}_comp_rows.png')
    rows_image(composite(mid), 4, CHECK / f's{stage}_midonly_rows.png')
    rows_image(composite(strips['midfar']), 2, CHECK / f's{stage}_midfar_rows.png')
    rows_image(strips['far'][..., :3], 2, CHECK / f's{stage}_far_rows.png')
    # 遊戲畫面模擬：照速率疊三層，沿關卡取 8 個鏡頭位置
    frames = []
    for c in np.linspace(0, L, 8):
        fr = np.zeros((VIEW_H, VIEW_W, 3), np.float32)
        for ly in LAYERS:
            st = strips[ly]
            off = int(round(c * result[ly]['rate']))
            piece = st[:, off:off + VIEW_W]
            if piece.shape[1] < VIEW_W:
                piece = np.concatenate([piece, np.zeros((VIEW_H, VIEW_W - piece.shape[1], 4), np.float32)], axis=1)
            fr = composite(piece, fr) if ly != 'far' else piece[..., :3]
        frames.append(fr)
    grid = np.concatenate([np.concatenate(frames[i:i + 2], axis=1) for i in range(0, 8, 2)], axis=0)
    to_img(grid).resize((2000, round(grid.shape[0] * 2000 / grid.shape[1])), Image.LANCZOS).save(
        CHECK / f's{stage}_frames.png')
    return result


# ── 會動的點綴（透明拼版，切成一張張）：名稱 → (關, 件數, 提示, 中文用途) ──
AMB_STYLE = ('in richly detailed hand-painted 2D arcade game art (Metal Slug style): crisp dark outlines where '
             'appropriate, detailed shading')
AMB_HEAD = ('A SPRITE SHEET of {n} separate ambient effect sprites for a 2D side-scrolling game, ' + AMB_STYLE +
            '. Transparent background. The {n} items are separate, NOT touching each other, with at least 100 pixels '
            'of empty transparent space between them, laid out {layout}: ')
AMB_TAIL = ' No text, no letters, no ground, no background scenery, no characters, no border.'
AMBIENT = {
    's1_bamboo_leaf': (1, 6, 'in two rows of three', 'SIX single falling bamboo leaves, each one slender pointed green '
                       'leaf with a light vein, some partly yellowed, each at a different rotation and curl (flat, '
                       'tilted, twisted, seen edge-on) so they can be cycled as a tumbling animation; all the same '
                       'size', '第一關飄落的竹葉（6 個角度，輪播＝翻轉飄落）'),
    's1_smoke': (1, 4, 'in one row from left to right', 'FOUR frames of a chimney smoke puff rising and growing, from a '
                 'small dense grey-white puff (1) to a big soft wispy cloud that is fading (4); soft semi-transparent '
                 'edges', '第一關炊煙（4 格：小→大、越來越淡）'),
    's2_firework': (2, 4, 'in two rows of two', 'FOUR fully bloomed round firework bursts, each a different colour and '
                    'pattern: (1) a big red chrysanthemum burst, (2) a golden willow burst with drooping trails, (3) a '
                    'green and white peony burst, (4) a blue and pink ring burst with sparkles; glowing bright sparks',
                    '第二關煙火（4 種綻放，程式放大＋淡出）'),
    's2_lantern': (2, 3, 'in one row from left to right', 'THREE glowing floating paper lanterns: (1) a small square '
                   'floating river lantern (toro nagashi) with a warm candle glow and a wooden base, (2) a round red '
                   'paper lantern with a warm glow drifting in the air, (3) a tall white sky lantern (paper hot-air '
                   'lantern) glowing warmly from inside', '第二關飄的燈籠（河燈、紅燈籠、天燈）'),
    's3_steam': (3, 4, 'in one row from left to right', 'FOUR frames of a white steam jet puff billowing out and '
                 'dissipating, from a small dense puff (1) to a large faint wispy cloud (4); soft semi-transparent '
                 'edges', '第三關蒸氣（4 格：小→大、越來越淡）'),
    's3_lightning': (3, 3, 'in one row from left to right', 'THREE tall vertical lightning bolts, each a jagged bright '
                     'white-violet bolt with a few side branches and a soft purple glow, each reaching from the top '
                     'of the canvas to the bottom, different shapes', '第三關閃電（3 種，閃一下就消失）'),
    's3_rain': (3, 5, 'in one row from left to right', 'FIVE rain sprites: (1) (2) (3) three long thin slanted rain '
                'streaks falling diagonally down-left (light blue-white, semi-transparent, different lengths), (4) (5) '
                'two small water splash crowns seen from the side where a raindrop hits the ground',
                '第三關雨（前 3 個雨絲、後 2 個落地水花）'),
}


def gen_ambient(name: str, max_tries: int = 2) -> str:
    st, n, layout, what, _ = AMBIENT[name]
    prompt = AMB_HEAD.format(n=n, layout=layout) + what + '.' + AMB_TAIL
    lines = []
    for _ in range(max_tries):
        t = next_try(f'amb_{name}')
        out = RAW / f'amb_{name}.try{t}.png'
        t0 = time.time()
        status = call_codex(prompt, None, out, True)
        (RAW / f'amb_{name}.try{t}.pending').unlink(missing_ok=True)
        record(f'amb_{name}', {'attempt': t, 'status': status, 'prompt': prompt,
                               'at': time.strftime('%Y-%m-%d %H:%M:%S')})
        lines.append(f'amb_{name} 第 {t} 次：{status[:300]}（{time.time() - t0:.0f} 秒）')
        if status == 'ok':
            break
    return '\n'.join(lines)


def split_items(a: np.ndarray, want: int, dilate: int = 18, one_row: bool = False) -> list[np.ndarray] | None:
    """透明拼版切成一塊塊（照閱讀順序：先分列、再由左到右）。塊數不對回傳 None。"""
    mask = a[..., 3] > 6
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=dilate))
    boxes = ndimage.find_objects(lab)
    areas = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [i for i in range(n) if areas[i] >= 0.02 * areas.max()]
    if len(keep) != want:
        return None
    keep.sort(key=lambda i: (boxes[i][0].start + boxes[i][0].stop) / 2)
    rows, cur = [], []
    for i in keep:
        cy = (boxes[i][0].start + boxes[i][0].stop) / 2
        if cur and cy - np.mean([(boxes[j][0].start + boxes[j][0].stop) / 2 for j in cur]) > a.shape[0] * 0.18:
            rows.append(cur)
            cur = []
        cur.append(i)
    rows.append(cur)
    if one_row:   # 排成一列的拼版：只照 x 排（小的那格常常比較低，不能拿 y 分列）
        rows = [keep]
    out = []
    for i in [i for r in rows for i in sorted(r, key=lambda i: boxes[i][1].start)]:
        sy, sx = boxes[i]
        piece = a[sy, sx].copy()
        piece[..., 3] *= (lab[sy, sx] == i + 1)
        ys, xs = np.where(piece[..., 3] > 0)
        piece = np.pad(piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1], ((4, 4), (4, 4), (0, 0)))
        out.append(piece)
    return out


def amb_alpha(a: np.ndarray) -> np.ndarray:
    """煙、蒸氣、光暈要留半透明：只把背景殘影（alpha<8）歸零，其餘照原樣。"""
    a = a.astype(np.float32).copy()
    a[..., 3][a[..., 3] < 8] = 0
    a[..., :3][a[..., 3] == 0] = 0
    return a


def export_ambient() -> dict:
    res: dict = {}
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    for name, (st, n, _, _, zh) in AMBIENT.items():
        key = f'amb_{name}'
        if key in picks:
            src = RAW / f'{key}.try{picks[key]}.png'
        else:
            t = [p for p in tries(key) if '.reject.' not in p.name]
            src = t[-1] if t else None
        if src is None or not src.exists():
            continue
        a = amb_alpha(np.asarray(Image.open(src).convert('RGBA')))
        pieces = None
        for dil in (18, 10, 26, 34, 6):   # 煙火的火星很散：換幾種間隔試到切出剛好 n 塊
            pieces = split_items(a, n, dil, one_row=AMBIENT[name][2].startswith('in one row'))
            if pieces is not None:
                break
        if pieces is None:
            print(f'  ⚠ {name}：切不出 {n} 塊，這張不輸出')
            continue
        items = []
        for i, p in enumerate(pieces, 1):
            rel = f'fx_ambient/{name}_{i}'
            save_webp(p, OUT / f'{rel}.webp', True)
            items.append({'path': f'{rel}.webp', 'w': p.shape[1], 'h': p.shape[0]})
            to_img(composite(p)).save(CHECK / f'amb_{name}_{i}.png')
        res.setdefault(f's{st}', []).append({'name': name, 'use': zh, 'frames': items, 'source': src.name})
        print(f'  {name}：{len(items)} 張 {[(it["w"], it["h"]) for it in items]}')
    return res


PANELS_NOTE = (
    '連續長卷背景（tools/gen_panels.py）。每關分四層，由後往前：far（天空＋最遠的山雲，不透明）→ midfar（遠方城鎮森林山寨，上方透明）'
    '→ mid（近處建築，天空透明，細節最多）→ 角色與地形 → fore（前景單件，透明）。far／midfar／mid 的 items 照順序由左到右緊貼著排：'
    '第 i 張放在該層的 x＝items[i].x（已累加好的整數；請畫在整數像素上以免出現細縫），圖高都是 720＝畫面高、圖頂貼齊畫面頂。'
    '圖層位移＝鏡頭 x × rate；rate 已算成「關卡走到底時每一層剛好捲到自己的最右端」（以 mid 0.55 為準，worldLength＝那樣算出的關卡總長；'
    '關卡若更長，就把 far／midfar 的 rate 照 (totalW-1280)/(關卡長-1280) 重算）。mid 下方約 200 像素是較暗的地面帶，地形蓋在上面；'
    '第三關 mid_04～06 是工廠室內、整張不透明（會把後兩層蓋住）。fore 是單件前景，由關卡自己擺（anchor＝貼畫面頂或底），'
    '建議捲動速率 1.2～1.4，偶爾掠過畫面、不要擋主角太久。keptDiff／seamRms 只是接縫檢查數字。')


def write_json(panels: dict) -> None:
    data = json.loads(ART_JSON.read_text(encoding='utf-8')) if ART_JSON.exists() else {}
    cur = data.get('panels', {})
    cur.update(panels)
    cur['_說明'] = PANELS_NOTE
    data['panels'] = dict(sorted(cur.items()))
    data = dict(sorted(data.items()))
    ART_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['gen', 'fore', 'check', 'export', 'ambient', 'ambient-export'])
    ap.add_argument('what', nargs='*')
    ap.add_argument('--tries', type=int, default=3)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if a.cmd == 'gen':
        jobs = []
        for w in a.what:
            chain, k = w.split(':')
            if chain not in S:
                sys.exit(f'不認得：{chain}')
            jobs.append((chain, int(k)))
        with ThreadPoolExecutor(max_workers=8) as pool:
            for line in pool.map(lambda j: gen_one(j[0], j[1], a.tries), jobs):
                print(line, flush=True)
    elif a.cmd == 'fore':
        jobs = [(int(w.split(':')[0][1:]), int(w.split(':')[1])) for w in a.what]
        with ThreadPoolExecutor(max_workers=8) as pool:
            for line in pool.map(lambda j: gen_fore(j[0], j[1], a.tries), jobs):
                print(line, flush=True)
    elif a.cmd == 'ambient':
        names = a.what or list(AMBIENT)
        with ThreadPoolExecutor(max_workers=8) as pool:
            for line in pool.map(lambda nm: gen_ambient(nm, a.tries), names):
                print(line, flush=True)
    elif a.cmd == 'ambient-export':
        CHECK.mkdir(parents=True, exist_ok=True)
        res = export_ambient()
        data = json.loads(ART_JSON.read_text(encoding='utf-8'))
        cur = data.get('fx_ambient', {})
        cur.update(res)
        cur['_說明'] = ('會動的點綴（透明，tools/gen_panels.py ambient）。每關一串，每項 frames 是同一種東西的幾張：'
                      '竹葉／閃電／煙火／燈籠是「不同樣子」隨機挑或輪播，炊煙／蒸氣是由小到大的動畫格。'
                      '煙、蒸氣、光暈有半透明邊緣，請直接用 alpha 疊。')
        data['fx_ambient'] = dict(sorted(cur.items()))
        ART_JSON.write_text(json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=1) + '\n',
                            encoding='utf-8')
        print('art.json fx_ambient 已更新')
    elif a.cmd == 'check':
        for chain in a.what:
            n = 0
            while n < len(S[chain]) and pick(chain, n + 1) is not None:
                n += 1
            strip, seams = build(chain, n, verbose=True)
            for p in save_seam_checks(chain, strip, seams):
                print('  接縫圖', p)
            p = rows_image(composite(strip), 3 if layer(chain) == 'mid' else 2, CHECK / f'{chain}_strip.png')
            print('  長卷', p, strip.shape[1], 'px')
    else:
        for st in a.what:
            write_json({f's{st}': export(int(st))})   # 做完一關就寫一關
            print(f'art.json panels.s{st} 已更新')


if __name__ == '__main__':
    main()
