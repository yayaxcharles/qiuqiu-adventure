"""三大關場景與特效的後製（2026-09-26）：art_raw/stage_art/*.tryN.png → public/art/**.webp ＋ art.json。

  python tools/post_stage_art.py            全部處理（每個名稱用 picks.json 指定的那一次，沒指定就用最新一次）
  python tools/post_stage_art.py s1_1_far   只處理幾個（art.json 會合併更新）

做的事：
  遠景   丟掉 alpha、縮成高 720、用「最小接縫切割」把左右接成可無縫重複（見 make_tile）。
  地面帶 透明；量站立面，統一縮放成站立面離圖底 STAND_PX 像素；同樣接成可重複。
  拼版   前景裝飾、特效、圖示、村貓：依透明區切成一張張，照閱讀順序命名。
  標題   縮成高 720。
每張另存一張預覽到 art_raw/stage_art/_preview/（透明圖墊灰底、可重複的圖接兩次），給人眼檢查用。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'stage_art'
PREVIEW = RAW / '_preview'
OUT = ROOT / 'public' / 'art'
ART_JSON = OUT / 'art.json'
PICKS = RAW / 'picks.json'
VIEW_H = 720
STAND_PX = 124          # 站立面離地面帶圖底的像素（= 720 - game.ts 的 GROUND 596）

SEG_NAME = {
    's1_1': '第一關·黃昏山村', 's1_2': '第一關·竹林', 's1_3': '第一關·山賊寨',
    's2_1': '第二關·夜祭燈籠街', 's2_2': '第二關·河堤木橋', 's2_3': '第二關·山頂神社',
    's3_1': '第三關·機關城下', 's3_2': '第三關·工廠內部', 's3_3': '第三關·暴風雨天守閣頂',
}
# 拼版：名稱 → [(輸出路徑, 用途, 中心點算法 bbox|core, 朝向)]，順序＝由上到下、由左到右
SHEETS = {
    'props_s1': [('props/s1_bamboo', '第一關前景：竹叢（高）', 'bbox', None),
                 ('props/s1_fish_rack', '第一關前景：曬魚架', 'bbox', None),
                 ('props/s1_campfire', '第一關前景：營火', 'bbox', None),
                 ('props/s1_palisade', '第一關前景：山賊寨木柵', 'bbox', None)],
    'props_s2': [('props/s2_lantern_string', '第二關前景：燈籠串（掛在畫面上方）', 'bbox', None),
                 ('props/s2_torii', '第二關前景：鳥居', 'bbox', None),
                 ('props/s2_stone_lantern', '第二關前景：石燈籠', 'bbox', None),
                 ('props/s2_food_stall', '第二關前景：祭典攤位', 'bbox', None)],
    'props_s3': [('props/s3_gear', '第三關前景：大齒輪（可旋轉）', 'bbox', None),
                 ('props/s3_steam_pipe', '第三關前景：蒸汽管', 'bbox', None),
                 ('props/s3_forge', '第三關前景：鍛爐', 'bbox', None),
                 ('props/s3_chain_hook', '第三關前景：吊鉤鐵鍊（從畫面上方垂下）', 'bbox', None)],
    'fx_weapons': [('fx/shuriken', '預設武器：手裏劍（旋轉用，中心＝圖中心）', 'bbox', None),
                   ('fx/kunai', 'H 苦無連射的子彈', 'bbox', 'right'),
                   ('fx/fuma_shuriken', 'R 風魔大手裏劍（旋轉用）', 'bbox', None),
                   ('fx/needle', 'S 散針的一根', 'bbox', 'right'),
                   ('fx/paper_crane', 'C 式神紙鶴', 'bbox', 'right'),
                   ('fx/bomb_tag', '副武器：爆裂符（拋物線飛行中的符紙）', 'bbox', None)],
    'fx_beams': [('fx/fire_dragon', 'F 火遁·火龍（左端接手、往右噴，可橫向拉長）', 'bbox', 'right'),
                 ('fx/lightning', 'L 雷遁·紫電（左端接手、往右，可橫向拉長）', 'bbox', 'right')],
    'fx_explosion': [(f'fx/explosion_{i}', f'爆炸第 {i} 格（共 4 格，由小到大）', 'bbox', None) for i in (1, 2, 3, 4)],
    'fx_misc': [('fx/smoke', '煙霧團（忍術煙、落地煙）', 'bbox', None),
                ('fx/hit_spark', '打中火花', 'bbox', None),
                ('fx/enemy_fireball', '敵人子彈：火球（燈籠鬼等）', 'core', 'left'),
                ('fx/enemy_water', '敵人子彈：水彈（河童）', 'core', 'left'),
                ('fx/enemy_leaf', '敵人子彈：葉子手裏劍（狸大人）', 'core', 'left')],
    'icons': [('icons/weapon_H', '掉落道具：H 苦無連射', 'bbox', None),
              ('icons/weapon_R', '掉落道具：R 風魔大手裏劍', 'bbox', None),
              ('icons/weapon_F', '掉落道具：F 火遁·火龍', 'bbox', None),
              ('icons/weapon_S', '掉落道具：S 散針', 'bbox', None),
              ('icons/weapon_L', '掉落道具：L 雷遁·紫電', 'bbox', None),
              ('icons/weapon_C', '掉落道具：C 式神紙鶴', 'bbox', None),
              ('icons/weapon_bomb_alt', '掉落道具：爆裂符（拼版版本，畫成炸藥棒，備用）', 'bbox', None)],
    'icon_bomb': [('icons/weapon_bomb', '掉落道具：爆裂符 +10', 'bbox', None)],
    # 忍具第二版新增（2026-09-26）
    'fx2_props': [('fx/bo_shuriken', '棒手裏劍（旋轉用）', 'bbox', None),
                  ('fx/caltrop', 'S 撒菱：落地的一顆（會扎到走過的敵人）', 'bbox', None),
                  ('fx/blow_dart', 'B 吹箭', 'bbox', 'right'),
                  ('fx/bamboo_tube', 'F 火藥竹筒：竹筒本體（掛在球球手上）', 'bbox', 'right'),
                  ('fx/kusarigama_sickle', 'L 鎖鎌：鐮刀頭（鏈子另一端）', 'bbox', None),
                  ('fx/horoku', '焙烙玉：圓形陶罐炸彈', 'bbox', None)],
    'fx2_stretch': [('fx/bamboo_flame', 'F 火藥竹筒噴出的火焰（左端接竹筒口、往右噴，可橫向拉長）', 'bbox', 'right'),
                    ('fx/kusarigama_chain', '鎖鎌鏈條一段（可橫向重複拼接／拉長，右端接鐮刀）', 'bbox', 'right')],
    'fx2_smoke': [('fx/smoke_ball', '煙玉：丟出去的小黑球', 'bbox', None),
                  ('fx/smoke_cloud_big', '煙玉炸開後放出的大煙團（隱身用）', 'bbox', None),
                  ('fx/poison_puff', '中毒狀態的紫色小泡泡', 'bbox', None)],
    'fx2_mouse': [('fx/mouse_fire_1', '鼠火（跑步姿勢 1）', 'bbox', 'right'),
                  ('fx/mouse_fire_2', '鼠火（跑步姿勢 2）', 'bbox', 'right')],
    'icons2': [('icons/weapon_I', '掉落道具：I 鼠火（地走り）', 'bbox', None),
               ('icons/weapon_D', '掉落道具：D 毛球彈', 'bbox', None),
               ('icons/weapon_B', '掉落道具：B 吹箭', 'bbox', None),
               ('icons/weapon_F', '掉落道具：F 火藥竹筒（新版，取代舊版火遁）', 'bbox', None),
               ('icons/weapon_S', '掉落道具：S 撒菱（新版，取代舊版散針）', 'bbox', None),
               ('icons/weapon_L', '掉落道具：L 鎖鎌（新版，取代舊版雷遁）', 'bbox', None),
               ('icons/weapon_horoku', '掉落道具：焙烙玉（大炸彈，撿到才有）', 'bbox', None),
               ('icons/weapon_smoke', '掉落道具：煙玉（撿到才有）', 'bbox', None)],
}
# 單獨生的圖示比拼版裡的大一倍，縮到跟其他圖示差不多高
SCALE_TO_H = {'icons/weapon_bomb': 350}
# 人眼看過後補的欄位：光束可拉長的區段、掛在上方的前景裝飾
EXTRA = {
    'fire_dragon': {'origin': 'left-middle', 'stretchX': [300, 1650],
                    'note': '左端是噴口、右端約 1700 以後是龍頭；拉長時只拉 stretchX 這段，頭尾保持原寬'},
    'lightning': {'origin': 'left-middle', 'stretchX': [150, 2000], 'note': '整條粗細平均，可整張橫向拉長或只拉 stretchX'},
    'props_s2_lantern_string': {'anchor': 'top-center'},
    'props_s3_chain_hook': {'anchor': 'top-center'},
    'ui_ending': {'note': '3:2 比例，放 1280x720 畫面時請等比放大到寬 1280 再上下裁切（主角們在下半部，裁上方天空）'},
    'mouse_fire_1': {'anchor': 'bottom-center'},
    'mouse_fire_2': {'anchor': 'bottom-center'},
}
README = ('三大關場景與特效（tools/gen_stage_art.py 生、tools/post_stage_art.py 後製）。座標一律是圖片像素、左上角 (0,0)。'
          'tile=true 可左右無縫重複；地面帶的 standPx＝站立面離圖底的像素，surfaceY＝站立面離圖頂的像素；'
          'center＝特效中心點 [x,y]；facing＝圖上朝向（right/left，反向請水平翻轉）；anchor＝擺放基準點'
          '（bottom-center＝底部中間貼地、top-center＝頂部中間掛在上方）；source＝用的是哪一次生圖原檔（art_raw/stage_art/）；'
          'seam／flatness 只是檢查用數字（seam.tiled 在 1～3 左右＝接縫處跟圖內一般相鄰兩欄差不多，flatness＝地表跟站立面差 3 像素以內的欄數比例）。')
for _c, _zh in (('calico', '三花'), ('grey', '灰虎斑'), ('tuxedo', '黑白賓士')):
    SHEETS[f'npc_{_c}'] = [(f'npc/{_c}_tied', f'被綁的村貓（{_zh}），綁在木樁上；腳底＝圖底', 'bbox', 'left'),
                           (f'npc/{_c}_happy', f'被救後揮手的村貓（{_zh}）；腳底＝圖底', 'bbox', 'left')]


# ── 小工具 ──
def pick(name: str) -> Path | None:
    picks = json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    tries = sorted(RAW.glob(f'{name}.try*.png'), key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
    return tries[-1] if tries else None


def clean_alpha(a: np.ndarray) -> np.ndarray:
    """Codex 的透明圖實心處 alpha 只有 250 上下、背景有 1～10 的殘影：壓成乾淨的 0／255。"""
    a = a.astype(np.float32).copy()
    al = a[..., 3]
    al = np.clip((al - 12) / (238 - 12), 0, 1) * 255
    a[..., 3] = al
    a[..., :3][al == 0] = 0
    return a


def save_webp(arr: np.ndarray, rel: str) -> Path:
    path = OUT / f'{rel}.webp'
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = 'RGBA' if arr.shape[2] == 4 else 'RGB'
    Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), mode).save(path, 'WEBP', quality=90, method=6)
    return path


def resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    if arr.shape[2] == 4:   # 先乘 alpha 再縮，邊緣才不會出黑邊
        pm = arr.copy()
        pm[..., :3] *= pm[..., 3:4] / 255
        im = Image.fromarray(np.clip(pm + 0.5, 0, 255).astype(np.uint8), 'RGBA').resize((w, h), Image.LANCZOS)
        out = np.asarray(im).astype(np.float32)
        al = out[..., 3:4]
        out[..., :3] = np.where(al > 0, out[..., :3] * 255 / np.maximum(al, 1), 0)
        out[out[..., 3] < 4] = 0   # 縮圖的振鈴殘影
        return np.clip(out, 0, 255)
    im = Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), 'RGB').resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)


def seam_ratio(arr: np.ndarray) -> float:
    """左右接起來那一刀的色差 ÷ 圖內相鄰兩欄的平均色差。≈1 表示看不出接縫。"""
    c = arr[..., :3] * (arr[..., 3:4] / 255 if arr.shape[2] == 4 else 1)
    edge = np.abs(c[:, -1] - c[:, 0]).mean()
    inner = np.abs(np.diff(c, axis=1)).mean()
    return float(edge / max(inner, 1e-6))


def make_tile(arr: np.ndarray, overlap: int) -> np.ndarray:
    """把右端 overlap 欄（A）跟左端 overlap 欄（B）疊在一起，沿「兩邊最像」的那條由上到下的路切開：
    路左邊用 A、右邊用 B，沿路羽化 3 像素。結果去掉左端 overlap 欄，右端接回左端就是原圖相鄰的兩欄＝無縫。"""
    h, w = arr.shape[:2]
    A, B = arr[:, w - overlap:], arr[:, :overlap]
    diff = A - B
    if arr.shape[2] == 4:   # 透明處的顏色不算
        diff[..., :3] *= np.maximum(A[..., 3:4], B[..., 3:4]) / 255
    cost = (diff ** 2).sum(-1)
    m = 12
    acc = cost.copy()
    acc[:, :m] = np.inf
    acc[:, overlap - m:] = np.inf
    back = np.zeros((h, overlap), np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        cand = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        k = cand.argmin(0)
        back[y] = k - 1
        acc[y] += cand[k, np.arange(overlap)]
    path = np.zeros(h, int)
    path[-1] = int(acc[-1].argmin())
    for y in range(h - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    mask = (np.arange(overlap)[None, :] < path[:, None]).astype(np.float32)
    mask = ndimage.gaussian_filter1d(mask, 3, axis=1)[..., None]
    blend = A * mask + B * (1 - mask)
    return np.concatenate([arr[:, overlap:w - overlap], blend], axis=1)


def preview(arr: np.ndarray, name: str, tile: bool = False) -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    if tile:   # 接兩次，接縫在正中間
        arr = np.concatenate([arr, arr], axis=1)
    if arr.shape[2] == 4:
        bg = np.zeros_like(arr[..., :3])
        bg[...] = (120, 150, 200)
        yy, xx = np.mgrid[:arr.shape[0], :arr.shape[1]]
        bg[((yy // 32 + xx // 32) % 2) == 1] = (150, 175, 220)
        al = arr[..., 3:4] / 255
        arr = arr[..., :3] * al + bg * (1 - al)
    Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8), 'RGB').save(PREVIEW / f'{name}.png')


# ── 各類處理 ──
def do_far(name: str, src: Path) -> dict:
    arr = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)[..., :3]
    h, w = arr.shape[:2]
    arr = resize(arr, round(w * VIEW_H / h), VIEW_H)
    raw_seam = seam_ratio(arr)
    tile = make_tile(arr, overlap=260)
    seg = name[:-4]
    save_webp(tile, f'bg/{name}')
    preview(tile, name, tile=True)
    return {'path': f'bg/{name}.webp', 'w': tile.shape[1], 'h': tile.shape[0], 'tile': True,
            'use': f'{SEG_NAME[seg]} 遠景（天空＋遠方景物），高 720，左右可無縫重複；地面帶蓋在它下方',
            'seam': {'raw': round(raw_seam, 2), 'tiled': round(seam_ratio(tile), 2)}, 'source': src.name}


def do_ground(name: str, src: Path) -> dict:
    arr = clean_alpha(np.asarray(Image.open(src).convert('RGBA')))
    solid = arr[..., 3] > 128
    cols = np.where(solid.any(0))[0]
    rows = np.where(solid.any(1))[0]
    arr, solid = arr[:, cols[0]:cols[-1] + 1], solid[:, cols[0]:cols[-1] + 1]
    bottom = rows[-1]
    # 每一欄從圖底往上數連續實心到哪一列＝那欄的地表；取眾數當站立面
    surf = np.array([bottom - np.argmin(solid[bottom::-1, x]) + 1 if not solid[:bottom + 1, x].all() else 0
                     for x in range(solid.shape[1])])
    line = int(np.bincount(surf).argmax())
    flat = float(np.mean(np.abs(surf - line) <= 3))
    top = int(np.where((arr[..., 3] > 0).any(1))[0][0])   # 連半透明的蒸氣也算進去，才不會被切平
    arr = arr[max(top - 8, 0):bottom + 1]   # 上方留 8 像素透明，縮圖後頂列才不會沾到地面
    stand_raw = bottom + 1 - line
    k = STAND_PX / stand_raw
    arr = resize(arr, round(arr.shape[1] * k), round(arr.shape[0] * k))
    raw_seam = seam_ratio(arr)
    tile = make_tile(arr, overlap=200)
    seg = name[:-7]
    save_webp(tile, f'bg/{name}')
    preview(tile, name, tile=True)
    return {'path': f'bg/{name}.webp', 'w': tile.shape[1], 'h': tile.shape[0], 'tile': True,
            'standPx': STAND_PX, 'surfaceY': tile.shape[0] - STAND_PX,
            'use': f'{SEG_NAME[seg]} 地面帶（透明），圖底貼齊畫面底；腳踩的水平線在圖底往上 {STAND_PX} 像素'
                   f'（= 畫面 y {VIEW_H - STAND_PX}）',
            'flatness': round(flat, 3), 'seam': {'raw': round(raw_seam, 2), 'tiled': round(seam_ratio(tile), 2)},
            'source': src.name}


def split_sheet(name: str, src: Path) -> list[dict]:
    arr = clean_alpha(np.asarray(Image.open(src).convert('RGBA')))
    mask = arr[..., 3] > 0
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=14))
    boxes = ndimage.find_objects(lab)
    areas = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [i for i in range(n) if areas[i] >= 0.02 * areas.max()]
    dropped = n - len(keep)
    # 閱讀順序：先依中心 y 分列，再依 x
    items = sorted(keep, key=lambda i: (boxes[i][0].start + boxes[i][0].stop) / 2)
    rows, cur = [], []
    for i in items:
        cy = (boxes[i][0].start + boxes[i][0].stop) / 2
        if cur and cy - np.mean([(boxes[j][0].start + boxes[j][0].stop) / 2 for j in cur]) > arr.shape[0] * 0.18:
            rows.append(cur)
            cur = []
        cur.append(i)
    rows.append(cur)
    order = [i for r in rows for i in sorted(r, key=lambda i: boxes[i][1].start)]
    specs = SHEETS[name]
    if len(order) != len(specs):
        print(f'  ⚠ {name}：切出 {len(order)} 塊，預期 {len(specs)} 塊（丟掉 {dropped} 個小碎點），這張不輸出')
        return []
    out = []
    for i, (rel, use, cmode, facing) in zip(order, specs):
        sy, sx = boxes[i]
        piece = arr[sy, sx].copy()
        piece[..., 3] *= (lab[sy, sx] == i + 1)   # 只留這一塊（旁邊別塊的邊不要）
        ys, xs = np.where(piece[..., 3] > 0)
        pad = 4
        piece = piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        if rel in SCALE_TO_H:
            k = (SCALE_TO_H[rel] - 2 * pad) / piece.shape[0]
            piece = resize(piece, round(piece.shape[1] * k), SCALE_TO_H[rel] - 2 * pad)
        piece = np.pad(piece, ((pad, pad), (pad, pad), (0, 0)))
        h, w = piece.shape[:2]
        if cmode == 'core':   # 有拖尾的子彈：中心取「最粗那一點」（火球本體），不是外框中心
            dist = ndimage.distance_transform_edt(piece[..., 3] > 128)
            cy, cx = np.unravel_index(dist.argmax(), dist.shape)
            center = [int(cx), int(cy)]
        else:
            center = [w // 2, h // 2]
        save_webp(piece, rel)
        preview(piece, rel.replace('/', '_'))
        e = {'path': f'{rel}.webp', 'w': w, 'h': h, 'use': use, 'center': center, 'source': src.name}
        if facing:
            e['facing'] = facing
        if rel.startswith(('npc/', 'props/')):
            e['anchor'] = 'bottom-center'
        out.append(e)
    return out


def do_ui(name: str, src: Path) -> dict:
    arr = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)[..., :3]
    h, w = arr.shape[:2]
    arr = resize(arr, round(w * VIEW_H / h), VIEW_H)
    rel = 'ui/' + name[3:]
    save_webp(arr, rel)
    preview(arr, name)
    use = '結局圖：球球跟村貓們在天守閣頂看夕陽' if name == 'ui_ending' else \
        f'第 {name[8]} 關的關卡標題圖（純圖，無文字；上方中間留空給程式疊關卡名）'
    return {'path': f'{rel}.webp', 'w': arr.shape[1], 'h': arr.shape[0], 'use': use, 'source': src.name}


def main() -> None:
    names = sys.argv[1:] or sorted({re.sub(r'\.try\d+\.png$', '', p.name) for p in RAW.glob('*.try*.png')})
    data = json.loads(ART_JSON.read_text(encoding='utf-8')) if ART_JSON.exists() else {}
    for name in names:
        src = pick(name)
        if src is None:
            print(f'  ⚠ {name}：沒有原檔')
            continue
        if name.endswith('_far'):
            entries = {name: do_far(name, src)}
        elif name.endswith('_ground'):
            entries = {name: do_ground(name, src)}
        elif name.startswith('ui_'):
            entries = {name: do_ui(name, src)}
        elif name in SHEETS:
            entries = {Path(e['path']).stem if not e['path'].startswith(('props/', 'npc/')) else
                       e['path'][:-5].replace('/', '_'): e for e in split_sheet(name, src)}
        else:
            print(f'  ⚠ {name}：不知道怎麼處理')
            continue
        for k, e in entries.items():
            e.update(EXTRA.get(k, {}))
            data[k] = e
            extra = {kk: e[kk] for kk in ('seam', 'standPx', 'flatness', 'center') if kk in e}
            print(f'{k}: {e["path"]} {e["w"]}x{e["h"]} {extra}')
    data['_說明'] = README
    data = dict(sorted(data.items()))
    ART_JSON.parent.mkdir(parents=True, exist_ok=True)
    ART_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
