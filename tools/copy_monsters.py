"""把第一關要用的敵人、魔王立繪從爪破魔塔複製過來（只複製，不改原檔）。

用法：python tools/copy_monsters.py
來源：F:/ClaudeWork/qiuqiu-coop/public/assets/monsters/<名>_{idle,attack,hurt,block,down}.webp（魔王另有 <名>_p2_*）
目的：public/enemies/（同名；已經一樣的就跳過）
第二、三關要用的敵人加進下面的 NAMES 再跑一次就好。
"""
import filecmp
import shutil
import sys
from pathlib import Path

SRC = Path("F:/ClaudeWork/qiuqiu-coop/public/assets/monsters")
DST = Path(__file__).resolve().parents[1] / "public" / "enemies"
POSES = ("idle", "attack", "hurt", "block", "down")

# 三關的小兵、中魔王、魔王（含第二階段）；村貓圖還沒生出來時的暫代
NAMES = [
    "rat", "orange_bandit", "black_ninja", "crow_small", "wild_boar",
    "drum_tanuki", "tanuki_kid", "orange_king", "orange_king_p2",
    "dozing_tabby",
    # 第二關
    "lantern_ghost", "kasa_obake", "paper_crane", "kappa", "mask_dancer", "fox_miko", "tengu", "tadpole",
    "frog_daimyo", "frog_daimyo_p2", "tanuki_lord", "tanuki_lord_p2",
    # 第三關
    "vacuum", "mini_broom", "broom_centipede", "iron_arhat", "armor_ghost", "plated_beetle", "wraith_samurai",
    "guardian_statue", "roomba_king", "iron_claw", "iron_claw_p2",
]


def main() -> int:
    if not SRC.is_dir():
        print(f"找不到來源資料夾：{SRC}")
        return 1
    DST.mkdir(parents=True, exist_ok=True)
    copied = same = missing = 0
    for name in NAMES:
        for pose in POSES:
            src = SRC / f"{name}_{pose}.webp"
            if not src.exists():
                missing += 1
                continue
            dst = DST / src.name
            if dst.exists() and filecmp.cmp(src, dst, shallow=False):
                same += 1
                continue
            shutil.copy2(src, dst)
            copied += 1
    print(f"複製 {copied} 張、已經一樣 {same} 張、來源沒有這個姿勢 {missing} 個（沒有的程式會用別的姿勢代替）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
