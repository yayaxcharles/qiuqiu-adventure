"""把第二版美術的三份清單合成 public/art/v2/v2.json，並出每關新長卷總覽圖（art_raw/v2/_check/strip_s{關}.jpg）。

  python tools/make_v2_json.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp   # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public' / 'art'
P = json.loads((ROOT / 'art_raw/v2/panels/v2_panels.json').read_text(encoding='utf-8'))
C = json.loads((ROOT / 'art_raw/v2/climb/climb.json').read_text(encoding='utf-8'))
T = json.loads((ART / 'v2/v2_terrain.json').read_text(encoding='utf-8'))
LEN = 42000

ZONES = {
    's1': {'梯田坡道（10,600～15,000）': dict(ground='s1_terrace', slope='s1_terrace_*', stair='s1_terrace',
                                           cover='cover_s1_1～4', panels='s1_mid_A'),
           '山溪瀑布（20,600～28,000）': dict(ground='s1_rock', slope='s1_rock_*', wall='s1_rock', block='s1_rock',
                                           ledge='s1_rock', climb='s1_vine', waterfall='s1', props='stone_s1_1～3',
                                           climbUp='s1_mid＋s1_far', panels='s1_mid_B 第 1～3 張'),
           '山路（28,000～33,000）': dict(ground='s1_trail', slope='s1_trail_*', climb='s1_ladder', block='s1_log',
                                       panels='s1_mid_B 第 4～5 張'),
           '黃昏山村改陡坡／山賊寨延長': dict(slope='s1_village_*', block='s1_log（寨內木柵夾縫）', climb='s1_ladder（瞭望台）')},
    's2': {'燈籠坂（8,900～14,500）': dict(slope='s2_street_*', cover='cover_s2_1～4', panels='s2_mid_A'),
           '河童瀑布（22,100～30,000）': dict(ground='s2_rock', slope='s2_rock_*', wall='s2_rock', block='s2_rock',
                                           ledge='s2_rock', climb='s2_vine', waterfall='s2（水潭用舊的 water.s2_river）',
                                           props='stone_s2_1～3', climbUp='s2_mid＋s2_far', panels='s2_mid_B'),
           '山頂神社延長': dict(slope='s2_shrine_*', stair='s2_shrine', block='s2_stone（石燈籠柱夾縫）')},
    's3': {'冷卻水道（10,600～17,000）': dict(ground='s3_wet', slope='s3_wet_*', block='s3_iron', ledge='s3_iron',
                                           climb='s3_chain', waterfall='s3', stair='s3_iron', climbUp='s3_shaft＋s3_far',
                                           panels='s3_mid_A'),
           '天守閣外牆（23,000～32,000）': dict(ground='s3_walk', slope='s3_roof_*（陡屋頂）、s3_grate_*（鐵坡道）',
                                             wall='s3_plaster', block='s3_plaster', ledge='s3_eave', climb='s3_ladder',
                                             climbUp='s3_mid＋s3_far', panels='s3_mid_B')},
}


def main() -> None:
    panels = {}
    for st, layers in P.items():
        mid_w = layers['mid']['totalW']
        L = LEN - 1280
        panels[st] = {}
        for ly, v in layers.items():
            v = dict(v)
            v['rateSuggested'] = round((v['totalW'] - 1280) / L, 4)
            panels[st][ly] = v
        panels[st]['_use'] = ('第二版的完整長卷清單（取代 art.json panels 的 items）：沒改的沿用舊路徑，接縫改過的是 v2/bg/…r.webp（取代舊檔），'
                              '插入的新段是 v2/bg/…_N_M.webp（new: true）。rateSuggested＝關卡長 42,000 時剛好捲到底的速率'
                              f'（照 gen_panels 的算法；中景 {mid_w} 寬）。fore（前景單件）沿用 art.json 的。')
    out = {
        '_說明': ('球球大冒險第二版（2026-09-28 規劃第 2～4 階段）新美術清單。座標一律圖片像素、左上角 (0,0)；displayScale＝顯示時乘多少。'
                '生圖：tools/gen_v2_panels.py（背景插段）、gen_v2_climb.py（往上捲背景）、gen_v2_terrain.py（地形機關）；'
                '後製：post_v2_terrain.py；本檔由 make_v2_json.py 合成；模擬畫面 art_raw/v2/_check/（tools/sim_v2.py）。'
                '還沒接進遊戲（src/ 沒動）。'),
        'zones': ZONES,
        'panels': panels,
        'climbUp': C,
        'terrain': {k: v for k, v in T.items() if k != '_說明'},
        'terrain_說明': T.get('_說明'),
    }
    (ART / 'v2' / 'v2.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    # 長卷總覽
    chk = ROOT / 'art_raw/v2/_check'
    for st, layers in P.items():
        strips = {}
        for ly in ('far', 'midfar', 'mid'):
            parts = [np.asarray(Image.open(ART / it['path']).convert('RGBA')).astype(np.float32)
                     for it in layers[ly]['items']]
            strips[ly] = np.concatenate(parts, axis=1)
        tw = strips['mid'].shape[1]
        far = np.asarray(gp.to_img(strips['far'][..., :3]).resize((tw, 720), Image.LANCZOS)).astype(np.float32)
        mf = gp.resize_rgba(strips['midfar'], tw, 720)
        comp = gp.composite(strips['mid'], gp.composite(mf, far))
        im = gp.to_img(comp).resize((tw // 4, 180), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        for it in layers['mid']['items']:
            if it.get('new'):
                d.rectangle((it['x'] // 4, 0, (it['x'] + it['w']) // 4 - 1, 5), fill=(255, 60, 60))
        rows = 4
        step = int(np.ceil(im.width / rows))
        sheet = Image.new('RGB', (step, rows * 190), 'white')
        for r in range(rows):
            sheet.paste(im.crop((r * step, 0, (r + 1) * step, 180)), (0, r * 190))
        sheet.save(chk / f'strip_{st}.jpg', quality=88)
        print(chk / f'strip_{st}.jpg')


if __name__ == '__main__':
    main()
