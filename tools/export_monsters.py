"""怪物的 Vids 動作片 → 遊戲用動作圖（public/sprites/monsters/<怪>/<動作>/NN.webp ＋ 每隻一份 anims.json）。

用法：python tools/export_monsters.py              （全部）
      python tools/export_monsters.py rat crow_small （只做這幾隻）

跟球球的 tools/export_sprites.py 同一套做法，差別：
  - 去綠照影片門檻（soft 130／hard 200）；去綠的算法跟 qiuqiu-coop 的 chroma_key.key_out 一樣，改用 numpy 一次算整張（原版逐像素，一格要一秒多）。
  - 大小：每隻怪照「站姿那一格的角色高度」正規化，匯出成遊戲裡畫的高度 × 1.25（EXPORT_SCALE，放大視窗時還清楚），
    遊戲畫的時候再縮成 ENEMY_DEFS 的 drawH。橘皮大王一階、二階各自用自己的站姿量（兩個樣子畫出來一樣高）。
  - 腳底：一律用「實心腳底」（一列至少 3 個透明度 ≥128 的點），跟遊戲載入時的量法一樣；不拿半透明淡影當腳底。
  - 片段都是 4 秒 24 格；SPEC 裡的 seg、marks 都是影片裡的格號（從 0 起算），寫進 anims.json 時換成動作裡的格號。

每個動作：
  clip    vids/monsters/clips/<clip>.mp4
  seg     取哪幾格（含頭尾）；也可以給好幾段 [(起, 迄), (起, 迄)] 接起來（跳過壞掉的格）
  loop    循環動作：在 seg 裡找「頭尾最像」的一圈（最少、最多幾格）
  solo    只留跟身體連在一起的那一塊（打過來的箭頭、飛走的鼓棒、丟出去的魚骨頭、頭上轉的星星拿掉）
  anchor  'fixed'＝整段用第一格的身體中線（往前撲、被打退的位移保留）；'centroid'＝每格對齊身體中線（烏鴉俯衝：位置交給遊戲）
  form    用哪個樣子的站姿量大小（預設＝這隻怪）
  marks   關鍵格（影片格號）：hit＝出手、hurtEnd＝受傷那一小段的最後一格、fall＝倒地……
"""
import json
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
CLIPS = ROOT / "vids" / "monsters" / "clips"
TMP = ROOT / "vids" / "_mexport_tmp"
OUT = ROOT / "public" / "sprites" / "monsters"
EXPORT_SCALE = 1.25
SOFT, HARD, BAND = 130, 200, 2

# 遊戲裡畫多高（要跟 src/enemies.ts 的 ENEMY_DEFS.drawH 一樣）
# 級距照爪破魔塔（small／medium／large）跟第一關一致：小的 95～135、中的 170～210、中魔王 300～320、魔王 380～400
DRAW_H = {"rat": 132, "orange_bandit": 196, "black_ninja": 200, "crow_small": 165, "wild_boar": 150,
          "tanuki_kid": 118, "drum_tanuki": 300, "orange_king": 380, "orange_king_p2": 380,
          # 第二關
          "lantern_ghost": 170, "kasa_obake": 190, "paper_crane": 110, "kappa": 180, "mask_dancer": 210,
          "fox_miko": 210, "tengu": 210, "tadpole": 95, "frog_daimyo": 320, "frog_daimyo_p2": 320,
          "tanuki_lord": 380, "tanuki_lord_p2": 400,
          # 第三關
          "vacuum": 105, "mini_broom": 120, "broom_centipede": 140, "iron_arhat": 230, "armor_ghost": 220,
          "plated_beetle": 140, "wraith_samurai": 220, "guardian_statue": 270, "roomba_king": 300,
          "iron_claw": 380, "iron_claw_p2": 380}
# 每個樣子的站姿：(片段, 格號)——這一格的角色高度＝drawH
FORMS = {"rat": ("rat_attack", 0), "orange_bandit": ("bandit_attack", 0), "black_ninja": ("ninja_throw", 0),
         "crow_small": ("crow_fly", 0), "wild_boar": ("boar_charge", 0), "tanuki_kid": ("kid_run", 0),
         "drum_tanuki": ("drum_attack", 0), "orange_king": ("king_walk", 0), "orange_king_p2": ("p2_walk", 0),
         "lantern_ghost": ("lantern_float", 0), "kasa_obake": ("kasa_hop", 0), "paper_crane": ("crane_fly", 0),
         "kappa": ("kappa_walk", 0), "mask_dancer": ("dancer_walk", 0), "fox_miko": ("fox_cast", 0), "tengu": ("tengu_hover", 0),
         "tadpole": ("tadpole_swim", 0), "frog_daimyo": ("frog_walk", 0), "frog_daimyo_p2": ("frog2_walk", 0),
         "tanuki_lord": ("tanuki_walk", 0), "tanuki_lord_p2": ("tanuki2_walk", 0),
         "vacuum": ("vacuum_glide", 0), "mini_broom": ("broom_hop", 0), "broom_centipede": ("centipede_crawl", 16),
         "iron_arhat": ("arhat_walk", 0), "armor_ghost": ("armor_walk", 0), "plated_beetle": ("beetle_crawl", 0),
         "wraith_samurai": ("wraith_walk", 0), "guardian_statue": ("statue_attack", 0), "roomba_king": ("roomba_drive", 0),
         "iron_claw": ("claw_walk", 0), "iron_claw_p2": ("claw2_walk", 0)}

SPEC = {
    "rat": {
        "idle": dict(clip="rat_attack", seg=(0, 20), loop=(8, 20)),
        "run": dict(clip="rat_run", seg=(0, 95), loop=(10, 40)),
        "attack": dict(clip="rat_attack", seg=(16, 80), marks={"hit": 36}),
        "down": dict(clip="rat_down", seg=(12, 95), solo=True, marks={"hurtEnd": 20, "fall": 56}),
    },
    "orange_bandit": {
        "idle": dict(clip="bandit_attack", seg=(0, 14), loop=(8, 14)),
        "walk": dict(clip="bandit_walk2", seg=(0, 95), loop=(16, 60)),
        "attack": dict(clip="bandit_attack", seg=(14, 95), marks={"hit": 48}),
        "down": dict(clip="bandit_down", seg=(16, 95), solo=True, marks={"hurtEnd": 24, "fall": 56}),
    },
    "black_ninja": {
        "idle": dict(clip="ninja_throw", seg=(0, 22), loop=(8, 22)),
        "run": dict(clip="ninja_run", seg=(0, 95), loop=(10, 40)),
        "attack": dict(clip="ninja_throw", seg=(22, 72), marks={"hit": 45}),
        "down": dict(clip="ninja_down", seg=(13, 95), solo=True, marks={"hurtEnd": 21, "fall": 54}),
    },
    "crow_small": {
        "fly": dict(clip="crow_fly", seg=(0, 95), loop=(8, 40), solo=True),
        "attack": dict(clip="crow_dive", seg=(0, 30), anchor="centroid", solo=True, marks={"hit": 21}),
    },
    "wild_boar": {
        "run": dict(clip="boar_charge", seg=(8, 95), loop=(8, 40)),
        "down": dict(clip="boar_down", seg=(7, 95), solo=True, marks={"hurtEnd": 15, "fall": 62}),
    },
    "tanuki_kid": {
        "run": dict(clip="kid_run", seg=(0, 95), loop=(8, 40)),
    },
    "drum_tanuki": {
        "walk": dict(clip="drum_walk", seg=(0, 95), loop=(12, 48)),
        "attack": dict(clip="drum_attack", seg=(8, 84), marks={"hit": 22, "hit2": 46, "hit3": 70}),
        "down": dict(clip="drum_down", seg=(4, 95), solo=True, marks={"hurtEnd": 12, "fall": 50}),
    },
    "orange_king": {
        "walk": dict(clip="king_walk", seg=(0, 95), loop=(12, 48)),
        # 第 18～34 格跳太高、頭被影片上緣切掉，跳過：蹲下起跳（6～17）直接接完整身體落下（35～84）
        "slam": dict(clip="king_slam", seg=[(6, 17), (35, 84)], solo=True, marks={"jump": 17, "air": 35, "land": 44, "up": 59}),
        "throw": dict(clip="king_throw", seg=(16, 72), solo=True, marks={"hit": 42}),
        "curl": dict(clip="king_roll", seg=(8, 26), solo=True),
        "roll": dict(clip="king_roll", seg=(31, 64), loop=(8, 33), solo=True),
        "uncurl": dict(clip="king_roll", seg=(66, 86), solo=True),
        "rage": dict(clip="king_rage", seg=(0, 95), solo=True, marks={"roar": 60, "burst": 72}),
        "walk_p2": dict(clip="p2_walk", seg=(0, 95), loop=(12, 48), form="orange_king_p2"),
        # 09-26 追加：二階跳起來（p2_roll、p2_throw 被 Vids 擋，二階的滾、丟魚骨頭維持單張立繪）
        "jump_p2": dict(clip="p2_jump", seg=(4, 80), form="orange_king_p2", marks={"jump": 18, "land": 51}),
        "down_p2": dict(clip="p2_down", seg=(7, 95), solo=True, form="orange_king_p2", marks={"hurtEnd": 15, "fall": 62}),
    },
    # ───────────── 第二關 ─────────────
    "lantern_ghost": {
        "float": dict(clip="lantern_float", seg=(0, 95), loop=(12, 48)),
        "attack": dict(clip="lantern_spit", seg=(16, 64), solo=True, marks={"hit": 36}),
        "down": dict(clip="lantern_down", seg=(18, 95), solo=True, marks={"hurtEnd": 28, "fall": 64}),
    },
    "kasa_obake": {
        "hop": dict(clip="kasa_hop", seg=(16, 95), loop=(16, 60)),
        "shut": dict(clip="kasa_hop", seg=(0, 14)),
        "down": dict(clip="kasa_down", seg=(7, 95), solo=True, marks={"hurtEnd": 16, "fall": 64}),
    },
    "paper_crane": {
        "fly": dict(clip="crane_fly", seg=(0, 95), loop=(8, 40)),
    },
    "kappa": {
        "walk": dict(clip="kappa_walk", seg=(0, 95), loop=(12, 48)),
        "attack": dict(clip="kappa_spit", seg=(16, 64), solo=True, marks={"hit": 32}),
        "down": dict(clip="kappa_down", seg=(7, 95), solo=True, marks={"hurtEnd": 16, "fall": 48}),
    },
    "mask_dancer": {
        "walk": dict(clip="dancer_walk", seg=(0, 95), loop=(12, 48)),
        "attack": dict(clip="dancer_throw", seg=(20, 72), solo=True, marks={"hit": 46}),
        "down": dict(clip="dancer_down", seg=(10, 95), solo=True, marks={"hurtEnd": 20, "fall": 56}),
    },
    # 09-26 重畫（照太鼓狸的畫風，Codex＋Vids 重生；舊版在 clips\_old_style）
    "fox_miko": {
        "idle": dict(clip="fox_cast", seg=(0, 14), loop=(6, 14), solo=True),
        # 舉杖（16～28）→ 狐火在手邊冒出來（32～44）→ 甩出去（50）；飛出去的狐火由遊戲放，片段裡的拿掉（solo）
        "attack": dict(clip="fox_cast", seg=(12, 80), solo=True, marks={"hit": 50}),
        "down": dict(clip="fox_down", seg=(12, 95), solo=True, marks={"hurtEnd": 22, "fall": 52}),
    },
    "tengu": {
        "fly": dict(clip="tengu_hover", seg=(0, 95), loop=(8, 40)),
        "attack": dict(clip="tengu_gust", seg=(16, 70), solo=True, marks={"hit": 36, "end": 57}),
        "down": dict(clip="tengu_down", seg=(18, 95), solo=True, marks={"hurtEnd": 28, "fall": 64}),
    },
    "tadpole": {
        "swim": dict(clip="tadpole_swim", seg=(0, 95), loop=(8, 40)),
    },
    "frog_daimyo": {
        "walk": dict(clip="frog_walk", seg=(0, 95), loop=(12, 48)),
        "tongue": dict(clip="frog_tongue", seg=(20, 80), marks={"hit": 38, "back": 68}),
        "jump": dict(clip="frog_jump", seg=(10, 80), marks={"jump": 20, "air": 26, "land": 50, "up": 65}),
        "change": dict(clip="frog_change", seg=(0, 95), marks={"puff": 52, "full": 66}),
        "walk_p2": dict(clip="frog2_walk", seg=(0, 95), loop=(12, 48), form="frog_daimyo_p2"),
        "down_p2": dict(clip="frog2_down", seg=(20, 95), solo=True, form="frog_daimyo_p2", marks={"hurtEnd": 30, "fall": 56}),
        # 09-26 補：二階吐舌頭（張嘴 12～16 → 舌頭伸出 20 → 伸最長 24～52 → 收回 56）、二階跳起來砸（蹲 8～12 → 起跳 16 → 落地濺水 34 → 站回 56）
        "tongue_p2": dict(clip="frog2_tongue", seg=(4, 72), form="frog_daimyo_p2", marks={"hit": 20, "back": 56}),
        "jump_p2": dict(clip="frog2_jump", seg=(4, 72), form="frog_daimyo_p2", marks={"jump": 16, "air": 20, "land": 34, "up": 56}),
    },
    "tanuki_lord": {
        "walk": dict(clip="tanuki_walk", seg=(0, 95), loop=(12, 48)),
        "leaf": dict(clip="tanuki_leaf", seg=(24, 74), solo=True, marks={"hit": 54}),
        "drum": dict(clip="tanuki_drum", seg=(20, 80), marks={"hit": 28, "hit2": 44, "hit3": 60}),
        "stone": dict(clip="tanuki_stone", seg=(26, 95), marks={"stone": 50, "crack": 74, "back": 90}),
        "change": dict(clip="tanuki_change", seg=(0, 95), marks={"smoke": 40, "clear": 84}),
        "walk_p2": dict(clip="tanuki2_walk", seg=(0, 95), loop=(12, 48), form="tanuki_lord_p2"),
        "stomp_p2": dict(clip="tanuki2_stomp", seg=(8, 90), form="tanuki_lord_p2", marks={"hit": 26, "hit2": 66}),
        # 09-26 補：二階舉手（4～24）→ 轉一圈（28～40）→ 甩出葉子（53）；飛出去的葉子由遊戲丟，片段裡的拿掉（solo）
        "leaf_p2": dict(clip="tanuki2_leaf", seg=(0, 80), solo=True, form="tanuki_lord_p2", marks={"hit": 53}),
        "down_p2": dict(clip="tanuki2_down", seg=(12, 95), solo=True, form="tanuki_lord_p2", marks={"hurtEnd": 20, "fall": 52}),
    },
    # ───────────── 第三關 ─────────────
    "vacuum": {
        "glide": dict(clip="vacuum_glide", seg=(0, 95), loop=(12, 48)),
        # 眼睛閃（28）→ 往前傾、吸口發光（32～44）→ 吸（48～72）
        "attack": dict(clip="vacuum_suck", seg=(16, 84), marks={"hit": 48, "end": 72}),
        "down": dict(clip="vacuum_down", seg=(20, 95), solo=True, marks={"hurtEnd": 28, "fall": 56}),
    },
    "mini_broom": {
        "hop": dict(clip="broom_hop", seg=(0, 95), loop=(12, 60)),
        "down": dict(clip="broom_down", seg=(24, 95), solo=True, marks={"hurtEnd": 32, "fall": 52}),
    },
    "broom_centipede": {
        # 第 12 格以後頭抬起來才是正常爬的樣子
        "crawl": dict(clip="centipede_crawl", seg=(14, 95), loop=(16, 72)),
    },
    "iron_arhat": {
        "walk": dict(clip="arhat_walk", seg=(0, 95), loop=(12, 60)),
        # 拳頭往後拉（24～40）→ 直拳打出去（48 白光、52 打中）
        "attack": dict(clip="arhat_punch", seg=(12, 80), marks={"hit": 50}),
        "down": dict(clip="arhat_down", seg=(20, 95), solo=True, marks={"hurtEnd": 28, "fall": 60}),
    },
    "armor_ghost": {
        "walk": dict(clip="armor_walk", seg=(0, 95), loop=(12, 60)),
        # 槍往後收（12～20）→ 伸出來（24～44）→ 往前突刺（48 白色速度線）→ 收回盾後（80）
        "attack": dict(clip="armor_thrust", seg=(8, 88), marks={"hit": 48, "back": 80}),
        # 盔甲一片片散開倒成一堆：碎片是身體的一部分，不用只留最大塊
        "down": dict(clip="armor_down", seg=(20, 95), marks={"hurtEnd": 28, "fall": 56}),
    },
    "plated_beetle": {
        "crawl": dict(clip="beetle_crawl", seg=(0, 95), loop=(12, 60)),
        # 角尖發亮（28～52）→ 射出去（56～60）
        # 角發光那幾格的黃綠光暈去綠去不乾淨：這一段去綠門檻放低（soft 40），光暈變透明
        "attack": dict(clip="beetle_shoot", seg=(16, 80), soft=(15, 80), solo=True, marks={"hit": 57}),
        "down": dict(clip="beetle_down", seg=(24, 95), solo=True, marks={"hurtEnd": 30, "fall": 46}),
    },
    "wraith_samurai": {
        "walk": dict(clip="wraith_walk", seg=(0, 95), loop=(12, 60)),
        # 化成紫煙（20～34）：遊戲在煙散掉的時候把牠移到球球附近
        "vanish": dict(clip="wraith_slash", seg=(8, 34)),
        # 出現在前面、壓低（36～48）→ 大橫斬（52～72）
        "attack": dict(clip="wraith_slash", seg=(38, 84), marks={"hit": 55, "end": 72}),
        "down": dict(clip="wraith_down", seg=(20, 95), solo=True, marks={"hurtEnd": 30, "fall": 56}),
    },
    "guardian_statue": {
        "idle": dict(clip="statue_attack", seg=(0, 22), loop=(8, 22)),
        # 符文變亮、站起來（24～44）→ 石爪橫掃（48～56）→ 坐回去
        "attack": dict(clip="statue_attack", seg=(24, 84), marks={"hit": 49}),
        "down": dict(clip="statue_down", seg=(20, 95), solo=True, marks={"hurtEnd": 30, "fall": 72}),
    },
    # 09-26 重畫（照太鼓狸的畫風，多了彩帶和刷子手臂；舊版在 clips\_old_style）
    "roomba_king": {
        "drive": dict(clip="roomba_drive", seg=(0, 95), loop=(12, 60)),
        # 眼睛睜大（12～24）→ 開始吸（36）→ 大旋風（40～76）→ 停（80）
        "suck": dict(clip="roomba_suck", seg=(8, 90), marks={"hit": 36, "end": 80}),
        # 履帶往後轉（20～32）→ 往前猛衝（38～58）→ 退回來（66～）；第 60～65 格影片有黑線壞格，跳過
        "ram": dict(clip="roomba_ram", seg=[(16, 59), (66, 90)], marks={"hit": 38, "back": 66}),
        # 王冠飛掉是這一段的重點，不要只留最大塊
        "down": dict(clip="roomba_down", seg=(12, 95), marks={"hurtEnd": 24, "fall": 40}),
    },
    "iron_claw": {
        "walk": dict(clip="claw_walk", seg=(0, 95), loop=(12, 60)),
        # 站起來（16～28）→ 爪子冒火花（28～40）→ 貼地大橫掃（44～60）
        "swipe": dict(clip="claw_swipe", seg=(8, 84), marks={"hit": 46, "end": 60}),
        # 背上的艙門打開（16～32）→ 三顆飛彈往上飛出畫面（36～44）
        "missile": dict(clip="claw_missile", seg=(8, 72), marks={"hit": 38}),
        "change": dict(clip="claw_change", seg=(0, 95), marks={"pop": 36, "core": 64}),
        "walk_p2": dict(clip="claw2_walk", seg=(0, 95), loop=(12, 60), form="iron_claw_p2"),
        # 眼睛、爐心越來越亮（16～36）→ 雷射（40～76）
        # 片段裡的雷射光束擦掉（身體左緣第 540 欄以外），雷射由遊戲照判定的高度畫
        "laser_p2": dict(clip="claw2_laser", seg=(8, 88), form="iron_claw_p2", cut_left=540, soft=(15, 80), marks={"hit": 40, "end": 77}),
        "down_p2": dict(clip="claw2_down", seg=(20, 95), form="iron_claw_p2", marks={"hurtEnd": 28, "fall": 56}),
    },
}


# ───────────── 去綠（跟 chroma_key.key_out 同一套：綠度＝綠−max(紅,藍)，≥hard 全透明、≤soft 全不透明、中間線性；邊緣帶去綠；alpha 收 1 像素） ─────────────

def key_np(im: Image.Image, soft=SOFT) -> Image.Image:
    soft, hard = soft if isinstance(soft, tuple) else (soft, HARD)
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    gr = g - np.maximum(r, b)
    alpha = np.full(gr.shape, 255.0)
    alpha[gr >= hard] = 0
    mid = (gr > soft) & (gr < hard)
    alpha[mid] = 255 * (1 - (gr[mid] - soft) / float(hard - soft))
    alpha = alpha.astype(np.uint8)
    out = a.copy()
    out[gr >= hard] = 0
    # 邊緣帶去綠：透明區往內推 BAND 像素以內、還偏綠的，綠壓到 max(紅,藍)
    band = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(2 * BAND + 1)))
    edge = (alpha > 0) & (band < 255) & (g > np.maximum(r, b))
    out[..., 1] = np.where(edge, np.maximum(r, b), out[..., 1])
    # 全圖再把綠壓到不超過紅藍（半透明殘影、煙塵混到的綠；怪物身上沒有綠色）
    out[..., 1] = np.minimum(out[..., 1], np.maximum(out[..., 0], out[..., 2]))
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)))
    rgba = np.dstack([out.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA")


def solo_np(k: Image.Image) -> Image.Image:
    """只留最大那塊（膨脹 9 像素再找連通塊，細的爪痕、衣角還連得上）"""
    a = np.asarray(k.getchannel("A"))
    mask = a > 40
    grown = ndimage.binary_dilation(mask, iterations=4)
    lab, n = ndimage.label(grown)
    if n <= 1:
        return k
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = lab == (int(np.argmax(sizes)) + 1)
    keep = ndimage.binary_dilation(keep, iterations=2)
    out = np.asarray(k).copy()
    out[..., 3] = np.where(keep, out[..., 3], 0)
    return Image.fromarray(out, "RGBA")


def solid_foot(k: Image.Image) -> int:
    a = np.asarray(k.getchannel("A")) >= 128
    rows = np.where(a.sum(axis=1) >= 3)[0]
    return int(rows.max()) + 1 if len(rows) else k.height


def solid_height(k: Image.Image) -> int:
    a = np.asarray(k.getchannel("A")) >= 128
    rows = np.where(a.sum(axis=1) >= 3)[0]
    return int(rows.max() - rows.min() + 1) if len(rows) else 1


def centroid_x(k: Image.Image) -> float:
    a = np.asarray(k.getchannel("A")).astype(np.float64)
    a = np.where(a > 200, a, 0)
    s = a.sum()
    return float((a.sum(axis=0) * np.arange(a.shape[1])).sum() / s) if s else k.width / 2


def sig(k: Image.Image) -> np.ndarray:
    bg = Image.new("RGBA", k.size, (40, 44, 60, 255))
    bg.alpha_composite(k)
    return np.asarray(bg.convert("L").resize((k.width // 8, k.height // 8))).astype(np.int16)


def best_loop(ks, lo, hi):
    sigs = [sig(k) for k in ks]
    best = (1e9, 0, len(ks))
    for s in range(0, max(1, len(ks) - lo)):
        for e in range(s + lo, min(len(ks), s + hi + 1)):
            d = float(np.abs(sigs[s] - sigs[e]).mean())
            if d < best[0]:
                best = (d, s, e)
    return best


def clip_frames(clip: str) -> list:
    d = TMP / clip
    files = sorted(d.glob("*.png"))
    return files


def extract(clip: str) -> None:
    d = TMP / clip
    d.mkdir(parents=True, exist_ok=True)
    if len(list(d.glob("*.png"))) >= 90:
        return
    for f in d.glob("*.png"):
        f.unlink()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(CLIPS / f"{clip}.mp4"), str(d / "%04d.png")], check=True)


def load_keyed(clip: str, i: int, solo: bool, soft: int = SOFT, cut_left: int = 0) -> Image.Image:
    im = Image.open(clip_frames(clip)[i]).convert("RGB")
    # Gemini 小星星浮水印在右下角：只塗掉最角落一小塊（角色偏右擺，塗太大會吃到尾巴）
    W, H = im.size
    im.paste((0, 255, 0), (int(W * 0.86), int(H * 0.8), W, H))
    k = key_np(im, soft)
    if cut_left:
        # 片段裡自己畫的特效（鐵爪的雷射）：身體前面（左邊）cut_left 以外擦掉，40 像素淡出；雷射改由遊戲畫
        a = np.asarray(k).copy()
        xs = np.arange(a.shape[1])
        f = np.clip((xs - (cut_left - 40)) / 40.0, 0, 1)
        a[..., 3] = (a[..., 3] * f[None, :]).astype(np.uint8)
        k = Image.fromarray(a, "RGBA")
    return solo_np(k) if solo else k


def form_height(form: str) -> tuple:
    clip, i = FORMS[form]
    return form, solid_height(load_keyed(clip, i, True))


def export_action(job):
    monster, action, spec, heights = job
    clip = spec["clip"]
    n = len(clip_frames(clip))
    ranges = spec["seg"] if isinstance(spec["seg"], list) else [spec["seg"]]
    idx = [i for a, b in ranges for i in range(a, min(b, n - 1) + 1)]   # 動作裡第 k 格＝影片第 idx[k] 格
    ks = [load_keyed(clip, i, spec.get("solo", False), spec.get("soft", SOFT), spec.get("cut_left", 0)) for i in idx]
    loop_info = None
    if spec.get("loop"):
        d, s, e = best_loop(ks, *spec["loop"])
        ks, idx = ks[s:e], idx[s:e]
        loop_info = {"from": idx[0], "frames": e - s, "seam_diff": round(d, 2)}
    form = spec.get("form", monster)
    scale = DRAW_H[form] * EXPORT_SCALE / heights[form]
    out = OUT / monster / action
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.webp"):
        f.unlink()
    fx = centroid_x(ks[0])
    frames = []
    for i, k in enumerate(ks):
        bb = k.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        if not bb:
            bb = (0, 0, 1, 1)
        ax = centroid_x(k) if spec.get("anchor") == "centroid" else fx
        ay = solid_foot(k)
        crop = k.crop(bb)
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)
        fn = f"{i:02d}.webp"
        crop.save(out / fn, "WEBP", quality=90, method=6)
        frames.append({"f": fn, "ax": round((ax - bb[0]) * scale, 1), "ay": round((ay - bb[1]) * scale, 1)})
    entry = {"fps": 24.0, "loop": bool(spec.get("loop")), "frames": frames, "src": f"{clip}.mp4", "videoFrames": idx}
    for mk, fi in (spec.get("marks") or {}).items():
        entry[mk] = min(range(len(idx)), key=lambda k: abs(idx[k] - fi))   # 影片格號 → 動作裡最接近的那一格
    if loop_info:
        entry["loopInfo"] = loop_info
    (out / "_anim.json").write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"{monster}/{action}：{len(frames)} 格（影片第 {idx[0]}～{idx[-1]} 格）" + (f" 循環接縫差 {loop_info['seam_diff']}" if loop_info else "") + \
        (" " + str({k: entry[k] for k in (spec.get('marks') or {})}) if spec.get("marks") else "")


def main():
    want = [m for m in sys.argv[1:] if m in SPEC] or list(SPEC)
    forms_needed = {s.get("form", m) for m in want for s in SPEC[m].values()}
    clips = sorted({s["clip"] for m in want for s in SPEC[m].values()} | {FORMS[f][0] for f in forms_needed})
    missing = [c for c in clips if not (CLIPS / f"{c}.mp4").exists()]
    if missing:
        print("缺片段（這些動作跳過）：", missing)
    for c in clips:
        if c not in missing:
            extract(c)
    forms = sorted({s.get("form", m) for m in want for s in SPEC[m].values() if s["clip"] not in missing})
    with Pool(min(16, max(1, len(forms)))) as pool:
        heights = dict(pool.map(form_height, forms))
    print("站姿高度（影片像素）：", heights)
    jobs = [(m, a, s, heights) for m in want for a, s in SPEC[m].items() if s["clip"] not in missing]
    with Pool(min(8, len(jobs))) as pool:   # 一個動作最多 90 張 1280×720 在記憶體裡，開太多會不夠（09-26 開 24 個爆記憶體）
        for line in pool.imap_unordered(export_action, jobs):
            print(line, flush=True)
    index = []
    for m in sorted(p.name for p in OUT.iterdir() if p.is_dir()):
        anims = {}
        for f in sorted((OUT / m).glob("*/_anim.json")):
            anims[f.parent.name] = json.loads(f.read_text(encoding="utf-8"))
        if not anims:
            continue
        anims["_meta"] = {"standHeight": round(DRAW_H[m] * EXPORT_SCALE), "drawH": DRAW_H[m], "facing": "left",
                          "note": "每格 (ax, ay)＝基準點（腳底、身體中線）在這張圖裡的位置；站姿的角色＝standHeight 像素高、遊戲裡畫成 drawH；圖都朝左"}
        (OUT / m / "anims.json").write_text(json.dumps(anims, ensure_ascii=False, indent=1), encoding="utf-8")
        index.append(m)
    (OUT / "index.json").write_text(json.dumps({"monsters": index}, ensure_ascii=False, indent=1), encoding="utf-8")
    # 縮成遊戲裡畫的大小、每秒約 12 格（手機記憶體，見 tools/shrink_frames.py），順便預先算好裁切框與腳底（bake_frames.py）
    from shrink_frames import main as shrink
    shrink([m for m in want if (OUT / m).is_dir()])
    print("完成：", index)


if __name__ == "__main__":
    main()
