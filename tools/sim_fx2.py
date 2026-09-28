"""第三批美術的模擬遊戲畫面（2026-09-27，只是檢查用，不是遊戲程式）：
背景長卷＋地面帶＋球球（190 高）＋怪物立繪＋新子彈、粒子、爆炸、資訊欄、招牌、魔王特寫。

  python tools/sim_fx2.py   → art_raw/fx2/_check/sim_*.png（1280x720）
大小照 fx2.json 的 displayScale／建議大小與 src/render.ts 現在畫的位置。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sim_terrain as s1    # noqa: E402
import sim_terrain2 as s2   # noqa: E402

ROOT = s1.ROOT
ART = ROOT / 'public' / 'art'
CHECK = ROOT / 'art_raw' / 'fx2' / '_check'
FX = json.loads((ART / 'fx2.json').read_text(encoding='utf-8'))
TJ = s2.TJ
VW, VH = 1280, 720
paste, rs, img = s1.paste, s1.rs, s1.img
FB = 'C:/Windows/Fonts/msjhbd.ttc'


def font(n: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FB, n)


def fx(sec: str, key: str, frame: int, x: float, y: float, scale: float = 1.0, flip: bool = False, alpha: float = 1.0,
       rot: float = 0.0) -> None:
    """把 fx2 的一格照 anchor 對到畫面 (x, y)。"""
    e = FX[sec][key]
    a = np.asarray(Image.open(ART / e['frames'][frame]).convert('RGBA')).astype(np.float32)
    k = e['displayScale'] * scale
    ax, ay = e['anchor']
    if flip:
        a = a[:, ::-1]
        ax = a.shape[1] - ax
    a = rs(a, a.shape[1] * k, a.shape[0] * k)
    ax, ay = ax * k, ay * k
    if rot:
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
        w0, h0 = im.size
        im = im.rotate(rot, expand=True, resample=Image.BICUBIC)
        # 旋轉後錨點位置（繞圖中心轉）
        cx, cy = w0 / 2, h0 / 2
        t = np.deg2rad(rot)
        dx, dy = ax - cx, ay - cy
        ax = im.width / 2 + dx * np.cos(t) + dy * np.sin(t)
        ay = im.height / 2 - dx * np.sin(t) + dy * np.cos(t)
        a = np.asarray(im).astype(np.float32)
    if alpha < 1:
        a = a.copy()
        a[..., 3] *= alpha
    paste(CUR, a, x - ax, y - ay)


def add_light(a: np.ndarray, x: float, y: float) -> None:
    """lighter 混色（雷射、光柱）。"""
    x, y = int(round(x)), int(round(y))
    h, w = a.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(VW, x + w), min(VH, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    CUR[y0:y1, x0:x1] = np.minimum(255, CUR[y0:y1, x0:x1] + s[..., :3] * (s[..., 3:4] / 255))


def enemy(name: str, pose: str, x: float, ground: float, h: float, flip: bool = False) -> None:
    a = np.asarray(Image.open(ROOT / 'public' / 'enemies' / f'{name}_{pose}.webp').convert('RGBA')).astype(np.float32)
    if flip:
        a = a[:, ::-1]
    a = rs(a, a.shape[1] * h / a.shape[0], h)
    paste(CUR, a, x - a.shape[1] / 2, ground - h + 8)


def npc(key: str, x: float, ground: float) -> None:
    e = FX['npc'][key]
    a = np.asarray(Image.open(ART / e['path']).convert('RGBA')).astype(np.float32)
    a = rs(a, a.shape[1] * 175 / a.shape[0], 175)
    paste(CUR, a, x - a.shape[1] / 2, ground - 175)


def frame_img(key: str, sec: str = 'hud') -> np.ndarray:
    e = FX[sec][key]
    a = np.asarray(Image.open(ART / e['path']).convert('RGBA')).astype(np.float32)
    return rs(a, e.get('displayW', a.shape[1] * 0.5), e.get('displayH', a.shape[0] * 0.5))


def text(d: ImageDraw.ImageDraw, xy, s: str, size: int, fill, anchor='lm', stroke=0, sfill=(58, 29, 14)):
    d.text(xy, s, font=font(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=sfill)


def hud(score: int, hp: int, lives: int, weapon: str, ammo: str, sub: str, subn: int, time_left: int, cats: str,
        boss: tuple[str, float] | None = None) -> None:
    paste(CUR, frame_img('hud_score'), 14, 12)
    paste(CUR, frame_img('hud_weapon'), 354, 12)
    paste(CUR, frame_img('hud_time'), VW / 2 + 60, 12)
    paste(CUR, frame_img('hud_cats'), VW - 214, 12)
    paw_f = frame_img('paw_full')
    paw_e = frame_img('paw_empty')
    for i in range(3):
        p = paw_f if i < hp else paw_e
        paste(CUR, p, 100 + i * 34 - p.shape[1] / 2, 36 - p.shape[0] / 2)
    # 忍具圖示（沿用 art.json 的）
    for key, x, sz in (('shuriken' if weapon == '手裏劍' else 'weapon_H', 396, 50), ('bomb_tag', 590, 44)):
        m = s1.AJ[key]
        a = img(m['path'])
        k = sz / max(a.shape[:2])
        a2 = rs(a, a.shape[1] * k, a.shape[0] * k)
        paste(CUR, a2, x - a2.shape[1] / 2, 56 - a2.shape[0] / 2)
    if boss:
        paste(CUR, frame_img('hud_boss'), VW / 2 - 310 - 16, VH - 54 - 34)
        bar = frame_img('hud_bar')
        bx, by = VW / 2 - 310, VH - 54
        paste(CUR, bar, bx - 10, by - 4)
        CUR[int(by + 2):int(by + 16), int(bx + 2):int(bx + 2 + 616 * boss[1])] = (255, 106, 58)
    im = Image.fromarray(np.clip(CUR + 0.5, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    text(d, (30, 36), '球球', 22, (255, 233, 196))
    text(d, (212, 36), f'命 ×{lives}', 22, (255, 233, 196))
    text(d, (30, 74), str(score).rjust(8, '0'), 30, (255, 243, 160), stroke=4)
    text(d, (434, 36), weapon, 20, (255, 233, 196))
    text(d, (434, 72), ammo, 26, (255, 243, 160))
    text(d, (614, 36), sub, 18, (255, 233, 196))
    text(d, (614, 72), f'×{subn}', 26, (255, 243, 160))
    text(d, (VW / 2 + 135, 28), '時間', 16, (255, 233, 196), 'mm')
    text(d, (VW / 2 + 135, 54), str(time_left), 30, (255, 243, 160), 'mm')
    text(d, (VW - 114, 42), cats, 22, (255, 233, 196), 'mm')
    if boss:
        text(d, (VW / 2 - 310, VH - 54 - 16), boss[0], 20, (255, 233, 196))
    CUR[:] = np.asarray(im).astype(np.float32)


def sign(key: str, cy: float, width: float, sub: str | None = None) -> None:
    e = FX['signs'][key]
    a = np.asarray(Image.open(ART / e['path']).convert('RGBA')).astype(np.float32)
    a = rs(a, width, a.shape[0] * width / a.shape[1])
    paste(CUR, a, VW / 2 - width / 2, cy - a.shape[0] / 2)
    if sub:
        im = Image.fromarray(np.clip(CUR + 0.5, 0, 255).astype(np.uint8))
        text(ImageDraw.Draw(im), (VW / 2, cy + a.shape[0] / 2 + 18), sub, 26, (255, 243, 224), 'mm', 5, (58, 15, 10))
        CUR[:] = np.asarray(im).astype(np.float32)


def boss_intro(key: str, name: str, sub: str) -> None:
    e = FX['bosses'][key]
    a = np.asarray(Image.open(ART / e['path']).convert('RGBA')).astype(np.float32)
    CUR[:] = CUR * 0.45   # 登場特寫時畫面壓暗（像格鬥遊戲的切入），特寫才跳得出來
    paste(CUR, a, 0, VH - 420)   # 底邊貼齊畫面底（角色被切的下緣才不會露出一條橫線）
    w = FX['signs']['sign_warning']
    b = np.asarray(Image.open(ART / w['path']).convert('RGBA')).astype(np.float32)
    b = rs(b, 860, b.shape[0] * 860 / b.shape[1])
    by = 330
    paste(CUR, b, 20, by)
    im = Image.fromarray(np.clip(CUR + 0.5, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    cx, cy = 20 + 430, by + b.shape[0] / 2
    text(d, (cx, cy - 26), '警告　WARNING　警告', 20, (255, 210, 58), 'mm')
    text(d, (cx, cy + 10), name, 50, (255, 255, 255), 'mm', 8, (42, 5, 5))
    text(d, (cx, by + b.shape[0] + 16), sub, 22, (255, 224, 160), 'mm', 4, (42, 5, 5))
    CUR[:] = np.asarray(im).astype(np.float32)


def base(stage: str, cam: float, gkey: str, ground: float = 596) -> None:
    global CUR
    CUR = s2.backdrop(stage, cam)
    T = s2.Terr(cam - 100, ground).flat(VW + 400)
    s2.T_CUR = T
    s2.draw_ground(CUR, cam, T, gkey)


CUR = np.zeros((VH, VW, 3), np.float32)


def save(name: str) -> Path:
    CHECK.mkdir(parents=True, exist_ok=True)
    p = CHECK / f'sim_{name}.png'
    Image.fromarray(np.clip(CUR + 0.5, 0, 255).astype(np.uint8)).save(p)
    return p


def main() -> None:
    outs = []
    G = 596
    # 1. 第二關夜祭：燈籠鬼吐青白火球、白狐巫女的狐火、面具舞者的扇子、球球揮爪打中
    base('s2', 1200, 's2_street')
    enemy('lantern_ghost', 'attack', 980, 420, 170)
    enemy('fox_miko', 'attack', 1150, G, 210)
    enemy('mask_dancer', 'hurt', 520, G, 210)
    fx('bullets', 'fireball_cyan', 0, 830, 380)
    fx('bullets', 'fireball_cyan', 2, 700, 330)
    fx('bullets', 'foxfire', 1, 900, 470)
    fx('bullets', 'foxfire', 2, 780, 520)
    fx('bullets', 'fan', 0, 640, 420, rot=35)
    s1.player(CUR, 0, 400, G)
    fx('qiuqiu', 'claw_arc', 1, 470, G - 110)
    fx('particles', 'hit_claw', 0, 515, G - 120)
    fx('particles', 'spark', 0, 540, G - 150)
    fx('particles', 'spark', 0, 500, G - 90)
    fx('particles', 'dust', 1, 380, G + 2)
    hud(23250, 3, 2, '手裏劍', '∞', '爆裂符', 9, 566, '村貓 1 / 6')
    sign('sign_m2', 300, 780, '妖怪夜祭燈籠街 → 河童川 → 山頂神社')
    outs.append(save('1_夜祭'))
    # 2. 第二關河童川：河童水彈＋水花、蛙大名泡泡、天狗的風
    base('s2', 9000, 's2_bank')
    enemy('kappa', 'attack', 900, G, 180)
    enemy('tengu', 'attack', 1130, 300, 210)
    fx('bullets', 'water', 0, 720, 480)
    fx('bullets', 'water', 1, 560, 470)
    fx('bullets', 'splash', 1, 820, G + 2)
    fx('bullets', 'splash', 2, 470, G + 2)
    fx('bullets', 'bubble_1', 0, 640, 330)
    fx('bullets', 'bubble_2', 0, 760, 250)
    fx('bullets', 'gust', 1, 700, 380, alpha=0.8)
    for i, (x, y) in enumerate([(430, 500), (445, 470), (410, 520)]):
        fx('particles', 'drop_water', 0, x, y)
    s1.player(CUR, 0, 330, G)
    fx('qiuqiu', 'throw_flash', 0, 400, G - 120)
    hud(42300, 2, 2, '手裏劍', '∞', '爆裂符', 7, 547, '村貓 2 / 6')
    outs.append(save('2_河童川'))
    # 3. 第一關魔王：橘皮大王登場特寫＋警告橫幅
    base('s1', 19927, 'bandit')
    enemy('orange_king', 'idle', 960, G, 380)
    s1.player(CUR, 0, 320, G)
    hud(105450, 3, 3, '手裏劍', '∞', '爆裂符', 8, 454, '村貓 5 / 5')
    boss_intro('boss_orange_king', '魔王 橘皮大王', '跳起來打背後的魚乾背包！')
    outs.append(save('3_魔王登場'))
    # 4. 第一關魔王戰：丟魚骨頭（用垃圾魚骨圖看大小）、中爆炸、黑煙、震波、魔王血條
    base('s1', 19927, 'bandit')
    enemy('orange_king', 'attack', 980, G, 380)
    fx('bullets', 'wave', 1, 700, G, flip=True)
    fx('bullets', 'garbage_bone', 0, 620, 330, rot=-30)
    fx('explosions', 'explosion_medium', 3, 480, 470)
    fx('particles', 'smoke_black', 2, 560, 380)
    fx('particles', 'ember', 0, 540, 420)
    fx('particles', 'ember', 0, 430, 400)
    s1.player(CUR, 0, 300, G)
    fx('particles', 'star', 0, 290, 380)
    fx('particles', 'star', 0, 330, 365)
    hud(105450, 1, 2, '手裏劍', '∞', '爆裂符', 2, 454, '村貓 5 / 5', boss=('橘皮大王（魚乾背包）', 0.62))
    outs.append(save('4_魔王戰爆炸'))
    # 5. 第三關工廠：甲蟲光彈、掃地機王垃圾彈、飛彈＋尾焰、大爆炸
    base('s3', 9800, 's3_grate')
    enemy('plated_beetle', 'attack', 1150, 300, 140)
    enemy('roomba_king', 'attack', 1000, G, 300)
    fx('bullets', 'pellet_1', 0, 960, 315)
    fx('bullets', 'pellet_2', 0, 860, 335)
    fx('bullets', 'garbage_can', 0, 760, 380, rot=40)
    fx('bullets', 'garbage_paper', 0, 690, 300)
    # 飛彈：頭朝下掉（轉 -90 度＝頭朝下），尾焰接在尾巴
    fx('bullets', 'missile', 0, 560, 200, rot=-90)
    fx('bullets', 'missile_flame', 0, 560, 200 - FX['bullets']['missile']['w'] * 0.25, rot=-90)
    fx('explosions', 'explosion_large', 3, 420, 470)
    fx('particles', 'smoke_white', 2, 800, 540)
    s1.player(CUR, 0, 200, G)
    hud(56850, 2, 1, '手裏劍', '∞', '爆裂符', 6, 492, '村貓 3 / 4', boss=('掃地機王', 0.45))
    outs.append(save('5_工廠爆炸'))
    # 6. 第三關屋頂：鐵爪雷射（光束段重複＋發射口＋打中點）、重生光柱、新花色村貓、任務完成
    base('s3', 18600, 's3_roof', 616)
    G3 = 616
    enemy('iron_claw_p2', 'attack', 1060, G3, 380)
    e = FX['bullets']['laser_beam']
    beam = np.asarray(Image.open(ART / e['path']).convert('RGBA')).astype(np.float32)
    k = 110 / (beam.shape[0] * e['displayScale']) * e['displayScale']
    beam = rs(beam, beam.shape[1] * k, beam.shape[0] * k)
    cy = G3 - 160
    x = 860
    first = beam.copy()
    first[:, -50:, 3] *= np.linspace(1, 0, 50)[None, :]   # 起點（嘴巴那端）淡入 50 像素，不要一刀切
    b = first
    while x > -beam.shape[1]:
        add_light(b, x - beam.shape[1], cy - beam.shape[0] / 2)
        x -= beam.shape[1] - 1
        b = beam
    fx('bullets', 'laser_muzzle', 0, 870, cy, flip=True)
    fx('bullets', 'laser_hit', 0, 330, cy, flip=False)
    pil = FX['qiuqiu']['respawn_pillar']
    pa = np.asarray(Image.open(ART / pil['frames'][0]).convert('RGBA')).astype(np.float32)
    pa = rs(pa, pa.shape[1] * 0.5, pa.shape[0] * 0.5)
    add_light(pa * np.array([0.8, 0.8, 0.8, 1.0], np.float32), 160 - pa.shape[1] / 2, G3 - pa.shape[0])
    s1.player(CUR, 0, 160, G3)
    npc('npc_siamese_happy', 560, G3)
    npc('npc_black_tied', 680, G3)
    hud(122250, 3, 3, '手裏劍', '∞', '爆裂符', 4, 346, '村貓 4 / 4', boss=('鐵爪機關貓（發怒）', 0.08))
    sign('sign_clear', 250, 700, '鐵爪機關城 → 工廠 → 天守閣頂')
    outs.append(save('6_雷射與過關'))
    # 7. 接關畫面
    base('s3', 12000, 's3_grate')
    CUR[:] = CUR * 0.35
    sign('sign_continue', 300, 560)
    im = Image.fromarray(np.clip(CUR + 0.5, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    text(d, (VW / 2, 420), '按 Enter 接關（命補滿、分數歸零）', 22, (255, 255, 255), 'mm', 4, (20, 10, 20))
    text(d, (VW / 2, 500), '9', 80, (255, 90, 90), 'mm', 8, (40, 10, 10))
    CUR[:] = np.asarray(im).astype(np.float32)
    outs.append(save('7_接關'))
    for p in outs:
        print(p)


if __name__ == '__main__':
    main()
