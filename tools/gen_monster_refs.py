"""把爪破魔塔的正面立繪，用 Codex 重畫成「側面朝左」的綠幕參考圖，給 Google Vids 動起來用。

用法：
  python tools/gen_monster_refs.py gen [名字...]   # 叫 Codex 重畫（透明背景），存 art_raw/monster_side/<名>_codex<N>.png
  python tools/gen_monster_refs.py green [名字...] # 選定的那張貼到 1280x720 純綠畫布 → vids/monsters/<名>_參考圖_綠幕.png
  python tools/gen_monster_refs.py sheet           # 所有側面圖排一張總覽 art_raw/monster_side/_sheet.png

怪物朝左（牠們從畫面右邊來），擺在畫布偏右，左邊留空間給撲、揮、衝的動作。
"""
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("F:/ClaudeWork/qiuqiu-coop/public/assets/monsters")
RAW = ROOT / "art_raw" / "monster_side"
OUT = ROOT / "vids" / "monsters"
GEN = Path.home() / ".codex/skills/codex-ppt/scripts/image_gen.py"

STYLE = ("Keep EXACTLY the same character design as the reference image: same species, same colors and markings, same "
         "costume and accessories, same face, same cute chunky cartoon proportions, same thick black outline and flat "
         "cel shading. ")
POSE = ("Redraw the character in a STRICT SIDE PROFILE VIEW FACING LEFT (we see only its left side, nose pointing to the "
        "left edge of the image, like an enemy in a 2D side-scrolling action game), full body, feet visible, neutral "
        "ready stance. Transparent background, no ground, no shadow, no text, nothing else in the image.")

# 名字: (描述, 參考圖)
MONSTERS = {
    "rat": ("a small grey rat foot-soldier wearing a folded paper hat, holding a long thin bamboo spear pointing "
            "forward, standing upright on its two hind legs, long pink tail behind", "rat_idle"),
    "orange_bandit": ("an orange tabby cat bandit with a red eye-mask bandana knotted at the back of the head, "
                      "holding a wooden club raised in its front paw, standing upright on two legs, tail curled up",
                      "orange_bandit_idle"),
    "black_ninja": ("a black cat ninja in a black ninja outfit with a black headband whose tails flutter behind, "
                    "yellow eyes, standing upright on two legs in a low ninja stance, tail behind", "black_ninja_idle"),
    "crow_small": ("ONE single black crow with glowing red eyes and a faint purple smoky aura, FLYING with both wings "
                   "spread wide (only one crow, not a flock)", "crow_small_idle"),
    "wild_boar": ("a big dark-brown wild boar with white tusks, a red scar on its shoulder, a thick red rope with a "
                  "golden bell around its neck, standing on all four legs, head lowered ready to charge",
                  "wild_boar_idle"),
    "drum_tanuki": ("a chubby tanuki drummer wearing a blue happi coat and a twisted red-white headband, a big red "
                    "taiko drum hanging on its belly in front, holding one wooden drumstick in each front paw, "
                    "standing upright on two legs, striped fluffy tail behind", "drum_tanuki_idle"),
    "tanuki_kid": ("a small cute tanuki kid, standing upright on two legs, fluffy striped tail behind",
                   "tanuki_kid_idle"),
    "orange_king": ("a HUGE very fat orange tabby cat king with a small golden crown and a red cape, a big round "
                    "cream belly sticking out in front, holding a fish-bone in one paw, standing upright on two "
                    "short legs", "orange_king_idle"),
    "orange_king_p2": ("the same HUGE very fat orange tabby cat king with a small golden crown and a torn red cape, "
                       "now ANGRY and his whole round body covered in sharp orange spikes, standing upright on two "
                       "short legs, fists raised", "orange_king_p2_idle"),
    # ── 第二關 ──
    "lantern_ghost": ("a red paper lantern ghost (chochin-obake) with one big eye, a wide mouth with a long red tongue "
                      "hanging out, small stubby arms and legs, floating", "lantern_ghost_idle"),
    "kasa_obake": ("a one-eyed purple paper umbrella yokai (kasa-obake) with a long red tongue and thin arms, hopping "
                   "on its single leg wearing one wooden geta sandal", "kasa_obake_idle"),
    "paper_crane": ("a cute white folded-paper origami bird with two small dot eyes, gliding with both paper wings "
                    "spread wide",
                    "paper_crane_idle"),
    "kappa": ("a green kappa with a water dish on top of its head, a yellow duck beak, a brown turtle shell on its "
              "back, holding a cucumber, standing upright on two webbed feet", "kappa_idle"),
    "mask_dancer": ("a slim cat dancer wearing a white kitsune half-mask, a black and red floral kimono with long "
                    "sleeves, holding an open red folding fan, standing on two legs in a graceful dance pose",
                    "mask_dancer_idle"),
    "fox_miko": ("a white fox shrine maiden (kitsune miko) in red and white robes with several big fluffy fox tails, "
                 "holding a tall shakujo staff with rings, faint blue fox-fire around her, standing upright",
                 "fox_miko_idle"),
    "tengu": ("a crow tengu with a black beak and black wings, white yamabushi clothes with red pom-poms, holding a "
              "big feather fan over the shoulder, standing on tall one-tooth wooden geta", "tengu_idle"),
    "frog_daimyo": ("a HUGE fat orange toad lord wearing a red and gold samurai kimono with a big gold crest, holding "
                    "a folding fan, standing upright on short thick legs", "frog_daimyo_idle"),
    "frog_daimyo_p2": ("the same HUGE fat orange toad lord in the red and gold kimono, now furious with both cheeks "
                       "puffed out enormously, standing upright on short thick legs", "frog_daimyo_p2_idle"),
    "tadpole": ("a small black tadpole foot-soldier with big white eyes and a tiny straw hat, holding a spear, a "
                "wiggly tail instead of legs, hovering just above the ground", "tadpole_idle"),
    "tanuki_lord": ("a big chubby tanuki lord wearing a wide straw hat, a sake gourd and a paw-print pouch on his "
                    "back, a round cream belly, standing upright on two legs", "tanuki_lord_idle"),
    "tanuki_lord_p2": ("the same big chubby tanuki lord without his hat, a leaf on his head, angry red face, a sake "
                       "gourd on his back, a round cream belly, standing upright on two legs", "tanuki_lord_p2_idle"),
    # ── 第三關 ──
    "vacuum": ("a round dark-grey robot vacuum cleaner with angry glowing orange eyes on its front and little "
               "brushes underneath, gliding on the floor", "vacuum_idle"),
    "mini_broom": ("a small living straw broom with a cute face on the wooden handle, standing upright on its "
                   "bristles", "mini_broom_idle"),
    "broom_centipede": ("a long centipede made of straw broom segments joined in a row, with a wooden box head with "
                        "angry eyes at the LEFT end, its body stretched out STRAIGHT and flat along the ground in one "
                        "horizontal line (not coiled), crawling", "broom_centipede_idle"),
    "iron_arhat": ("a big heavy iron-armored cat monk (arhat) with a prayer-bead necklace, riveted bronze plates, "
                   "fists raised, standing upright", "iron_arhat_idle"),
    "armor_ghost": ("an empty black samurai armor ghost with glowing red eyes inside the helmet, holding a wooden "
                    "tower shield and a spear, standing upright", "armor_ghost_idle"),
    "plated_beetle": ("a big armored rhinoceros beetle covered in red and gold samurai plates, a long curved horn, "
                      "standing on six legs", "plated_beetle_idle"),
    "wraith_samurai": ("a ghostly samurai in dark armor wreathed in purple flames with a glowing purple face, holding "
                       "a katana low, standing upright", "wraith_samurai_idle"),
    "guardian_statue": ("a stone komainu lion-dog guardian statue with glowing purple runes, sitting on a stone "
                        "pedestal", "guardian_statue_idle"),
    "roomba_king": ("a big blue and purple robot vacuum king on tank treads, wearing a golden crown on top, one "
                    "sleepy eye on its front", "roomba_king_idle"),
    "iron_claw": ("a giant steampunk mechanical cat made of dark iron plates and brass gears with glowing orange "
                  "eyes and a wind-up key on its back, standing on all four legs", "iron_claw_idle"),
    "iron_claw_p2": ("the same giant steampunk mechanical cat, its armor broken open showing a glowing orange furnace "
                     "core and spinning gears, sparks flying, standing on all four legs", "iron_claw_p2_idle"),
}
WIDE = {"wild_boar", "crow_small", "paper_crane", "broom_centipede", "plated_beetle", "vacuum", "roomba_king",
        "iron_claw", "iron_claw_p2"}
FLYING = {"crow_small", "paper_crane", "lantern_ghost"}


def gen_one(name: str) -> str:
    desc, ref = MONSTERS[name]
    RAW.mkdir(parents=True, exist_ok=True)
    n = 1
    while (RAW / f"{name}_codex{n}.png").exists():
        n += 1
    out = RAW / f"{name}_codex{n}.png"
    src = SRC / f"{ref}.webp"
    tmp = RAW / f"_src_{name}.png"
    im = Image.open(src).convert("RGBA")
    bg = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    im.thumbnail((900, 900))
    bg.paste(im, ((1024 - im.width) // 2, (1024 - im.height) // 2), im)
    bg.convert("RGB").save(tmp)
    prompt = f"The character: {desc}. {STYLE}{POSE}"
    r = subprocess.run([sys.executable, str(GEN), "edit", "--backend", "codex-oauth", "--model", "gpt-image-1.5",
                        "--quality", "high", "--background", "transparent", "--size", "1024x1024",
                        "--image", str(tmp), "--out", str(out), "--prompt", prompt],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    ok = out.exists()
    return f"{name}: {'OK ' + out.name if ok else 'FAIL ' + (r.stderr or r.stdout)[-400:]}"


def to_green(name: str, pick: Path) -> Path:
    im = Image.open(pick).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    im = im.crop(a.getbbox())
    maxw, maxh = (760, 440) if name in WIDE else (560, 520)
    s = min(maxw / im.width, maxh / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    canvas = Image.new("RGBA", (1280, 720), (0, 255, 0, 255))
    cx = 820                                   # 偏右，左邊留空間出招
    x = cx - im.width // 2
    y = 360 - im.height // 2 if name in FLYING else 650 - im.height   # 腳底落在 650
    canvas.alpha_composite(im, (x, y))
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{name}_參考圖_綠幕.png"
    canvas.convert("RGB").save(out)
    return out


def sheet():
    files = sorted(p for p in RAW.glob("*_codex*.png"))
    C = 300
    cols = 5
    rows = (len(files) + cols - 1) // cols
    sh = Image.new("RGB", (cols * C, rows * (C + 20)), (70, 74, 90))
    dr = ImageDraw.Draw(sh)
    for i, p in enumerate(files):
        im = Image.open(p).convert("RGBA")
        im.thumbnail((C - 8, C - 8))
        x, y = (i % cols) * C, (i // cols) * (C + 20)
        sh.paste(im, (x + (C - im.width) // 2, y + 20 + (C - im.height) // 2), im)
        dr.text((x + 4, y + 4), p.stem, fill=(255, 255, 255))
    out = RAW / "_sheet.png"
    sh.save(out)
    print(out)


def main():
    cmd, names = sys.argv[1], sys.argv[2:] or list(MONSTERS)
    if cmd == "gen":
        with ThreadPoolExecutor(4) as ex:
            for line in ex.map(gen_one, names):
                print(line, flush=True)
    elif cmd == "green":
        for spec in names:          # 名字 或 名字=codex編號
            name, _, k = spec.partition("=")
            pick = RAW / f"{name}_codex{k or 1}.png"
            print(to_green(name, pick))
    elif cmd == "sheet":
        sheet()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
