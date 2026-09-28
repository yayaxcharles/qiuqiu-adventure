"""第三批美術（2026-09-27）：補強現有的圖——敵人子彈與招式、粒子、爆炸、資訊欄、大字招牌、魔王登場特寫、村貓新花色、球球特效。
規劃見 docs/2026-09-26_美術補強與場景變化規劃.md 第四節。後製在 tools/post_fx2.py（輸出 public/art/fx2/ ＋ public/art/fx2.json）。

  python tools/gen_fx2.py b_fireball p_smoke_white ...     生幾張（art_raw/fx2/<名稱>.try<N>.png，不蓋舊的）
  python tools/gen_fx2.py bullets / particles / explosions / hud / banners / bosses / cats / qiuqiu / all
  加 --note "..." 補一句提示。
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp   # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'fx2'
LOG = RAW / 'prompts.json'
PANELS = ROOT / 'art_raw' / 'panels'
MON = ROOT / 'art_raw' / 'monster_side'
REF = {'wide': PANELS / '_style_ref_3x1.png', 'land': PANELS / '_style_ref_land.png',
       'tall': PANELS / '_style_ref_portrait.png'}
_LOCK = threading.Lock()

STYLE = ('richly detailed hand-painted 2D arcade game art in the style of classic run-and-gun games like Metal Slug: '
         'crisp dark outlines on solid shapes, bold readable silhouettes, rich shading, glowing highlights')
REF_TXT = ('Reference image 1 is a finished background from the same game: match its drawing style, line quality and '
           'rendering, but draw ONLY what is described below (nothing from the reference scene). ')
TR = ' TRANSPARENT background: everything outside the drawn items is fully transparent.'
NOTXT = ' NO text, NO letters, NO numbers, NO characters, NO people, NO animals, NO ground, NO frame, NO border.'
READ = (' These are small game sprites, so use big bold clear shapes with a dark outline and strong contrast, not '
        'tiny noisy detail.')


def frames(n: int, layout: str, what: str, cycle: str = '') -> str:
    return (REF_TXT + f'AN ANIMATION SHEET of {n} frames for a 2D side-scrolling game, in ' + STYLE + ': ' + what +
            f'. The {n} frames are laid out {layout}, each frame centred in its own equal cell, NOT touching each '
            'other, with wide transparent gaps between them. ' + (cycle + ' ' if cycle else '') + TR + READ + NOTXT)


def sheet(n: int, layout: str, items: str) -> str:
    return (REF_TXT + f'A SPRITE SHEET of {n} separate game sprites for a 2D side-scrolling game, in ' + STYLE +
            f', laid out {layout}, NOT touching each other, with wide transparent gaps between them: ' + items + '.' +
            TR + READ + NOTXT)


def J(prompt: str, ref: str | Path | list, bg: str = 'transparent') -> dict:
    refs = ref if isinstance(ref, list) else [REF[ref] if isinstance(ref, str) else ref]
    return {'prompt': prompt, 'refs': refs, 'bg': bg}


def jobs() -> dict[str, dict]:
    j: dict[str, dict] = {}
    # ───────── 1. 敵人子彈與招式 ─────────
    j['b_fireball'] = J(frames(3, 'in one row from left to right', (
        'an enemy FIREBALL flying to the LEFT: a round glowing orange-red ball of fire with a bright yellow-white core, '
        'its flame tail trailing to the RIGHT, a few sparks; all three frames the same size and shape, only the flame '
        'tongues and the tail flicker differently'), 'Frame 3 loops back into frame 1.'), 'land')
    j['b_fireball_cyan'] = J(frames(3, 'in one row from left to right', (
        'a ghostly enemy FIREBALL flying to the LEFT: a round glowing CYAN and pale-blue spirit flame ball with a white '
        'core, its flame tail trailing to the RIGHT, a few pale sparks; all three frames the same size and shape, only '
        'the flame tongues and the tail flicker differently'), 'Frame 3 loops back into frame 1.'), 'land')
    j['b_wave'] = J(frames(3, 'in one row from left to right', (
        'a GROUND SHOCKWAVE sliding along the floor to the RIGHT (seen from the side): a low curved arc of bright '
        'yellow-orange energy rising from the ground line, with flying dirt clods and small rocks, dust at its base; '
        'every frame has its flat bottom edge on the same baseline'),
        'The three frames show the wave pulsing: (1) compact and bright, (2) taller with more debris, (3) wider and '
        'crackling.'), 'land')
    j['b_water_splash'] = J(sheet(5, 'in two rows: 2 items in the top row, 3 items in the bottom row', (
        'Top row: (1) and (2) two frames of a WATER BULLET flying to the LEFT: a glossy blue water blob with a white '
        'shine and a splashy tail trailing to the right, slightly different wobble in each frame. Bottom row: (3), (4), '
        '(5) three frames of a WATER SPLASH seen from the side, rising from a flat baseline: (3) a small crown of '
        'water just starting, (4) a tall full splash crown with droplets, (5) the splash falling apart into scattered '
        'droplets')), 'land')
    j['b_misc'] = J(sheet(5, 'in two rows: 3 items in the top row, 2 items in the bottom row', (
        'Top row: (1) an open red Japanese FOLDING FAN with gold ribs and a small gold wave pattern, fully spread in a '
        'half-circle, seen flat from the front; (2) and (3) two frames of a glowing ORANGE ENERGY PELLET: a small '
        'bright ball with a white-yellow core and an orange glow ring, the second frame slightly bigger and brighter. '
        'Bottom row: (4) and (5) two frames of a big shiny SOAP BUBBLE: transparent-looking with a thin bright rim, '
        'rainbow sheen and a white highlight, the second frame slightly squashed (wobbling)')), 'land')
    j['b_foxfire'] = J(frames(3, 'in one row from left to right', (
        'a floating FOXFIRE (kitsune-bi): a teardrop-shaped spirit flame of pale blue and white, glowing, with a '
        'bright white core and a wispy flame tip pointing UP; all three frames the same size, only the flame shape '
        'flickers'), 'Frame 3 loops back into frame 1.'), 'land')
    j['b_gust'] = J(frames(3, 'stacked in three rows from top to bottom', (
        'a strong horizontal GUST OF WIND blowing to the RIGHT: a wide band of curling pale white-blue wind streaks and '
        'swirls with a few torn leaves caught in it, semi-transparent looking, about three times wider than tall'),
        'The three frames show the swirls rolling forward.'), 'land')
    j['b_garbage'] = J(sheet(3, 'in one row from left to right', (
        '(1) a crushed dented empty tin CAN with a peeling label (no writing); (2) a dirty grey-white FISH SKELETON with '
        'head and tail; (3) a crumpled dirty PAPER BALL with a stain')), 'land')
    j['b_missile'] = J(sheet(3, 'in one row from left to right', (
        '(1) a cartoon ROCKET MISSILE lying horizontally with its pointed red nose to the RIGHT: a riveted dark iron '
        'body with a red nose cone, a yellow-and-black hazard band and four small tail fins at the left end, NO flame; '
        '(2) and (3) two frames of the rocket EXHAUST FLAME alone, pointing to the LEFT (a short bright jet of yellow-white '
        'fire turning orange with a puff of smoke at its end), the second frame a little longer and more flickering')),
        'land')
    j['b_laser_beam'] = J(
        REF_TXT + 'A 2D side-scrolling game LASER BEAM SEGMENT, very wide 3:1 picture, in ' + STYLE + ': one perfectly '
        'straight HORIZONTAL beam of energy running across the WHOLE width of the picture from the left edge to the '
        'right edge, centred vertically, about 30% of the picture height thick: a blinding white-yellow core, orange '
        'and red outer glow, small crackles of energy along its edges. HORIZONTALLY SEAMLESS: the left and right ends '
        'continue into each other exactly (same thickness, same colours).' + TR + NOTXT, 'wide')
    j['b_laser_ends'] = J(sheet(2, 'side by side', (
        '(1) a MUZZLE FLASH where a laser beam fires to the RIGHT: a bright white-yellow starburst with orange rays and '
        'a round glow, flattened sideways; (2) a laser IMPACT burst: an explosive splash of white-hot sparks and orange '
        'fire spraying back to the LEFT with a few chunks of debris')), 'land')
    # ───────── 2. 粒子 ─────────
    j['p_smoke_white'] = J(frames(4, 'in one row from left to right', (
        'a puff of WHITE-GREY SMOKE: a soft round cloud with a thin grey outline and light shading'),
        '(1) small and dense, (2) bigger and rounder, (3) big and starting to break up, (4) biggest, thin and fading '
        'into wisps.'), 'land')
    j['p_smoke_black'] = J(frames(4, 'in one row from left to right', (
        'a puff of thick BLACK-BROWN SMOKE from a fire or explosion: a round billowing cloud with dark outlines and '
        'a faint warm orange glow at its bottom'),
        '(1) small and dense, (2) bigger and rounder, (3) big and starting to break up, (4) biggest, thin and fading '
        'into wisps.'), 'land')
    j['p_fire'] = J(frames(4, 'in one row from left to right', (
        'a small FLAME burning upward: bright yellow-white core, orange and red tongues, a thick dark outline; every '
        'frame has its base on the same baseline and is the same size'), 'The four frames form a looping flicker.'),
        'land')
    j['p_dust'] = J(frames(4, 'in one row from left to right', (
        'a LANDING DUST CLOUD seen from the side: a low cloud of pale brown dust and small pebbles puffing out sideways '
        'to both left and right from a flat baseline'),
        '(1) a small low burst just starting, (2) spreading wide, (3) widest and rising a little, (4) fading into thin '
        'wisps.'), 'land')
    j['p_small'] = J(sheet(6, 'in one row from left to right', (
        '(1) a small bright four-pointed white-yellow SPARK star with a glow; (2) a small glowing orange EMBER (a hot '
        'fleck of fire); (3) a single clear blue WATER DROP with a white shine; (4) a yellow cartoon DIZZY STAR (five '
        'points, rounded, thick dark outline, with a white shine); (5) a small purple POISON DROP with a shine; (6) a '
        'small gold COIN seen from the front with a square hole in the middle')), 'land')
    j['p_hits'] = J(sheet(3, 'in one row from left to right', (
        '(1) a CLAW-SLASH HIT: three parallel curved white-hot slash streaks with a bright white-yellow burst where they '
        'cross and a few sparks; (2) a SHURIKEN HIT: a sharp white-yellow star-shaped metal impact flash with thin '
        'spark lines shooting out; (3) a BLUNT HIT: a big round comic-style impact burst of jagged orange-yellow and '
        'white spikes with a white centre')), 'land')
    # ───────── 3. 爆炸 ─────────
    for size, zh, desc in (('small', '小', 'a SMALL explosion (like a grenade or a small crate)'),
                           ('medium', '中', 'a MEDIUM explosion (like a gunpowder barrel)'),
                           ('large', '大', 'a HUGE explosion (like a boss being destroyed)')):
        j[f'x_{size}'] = J(frames(8, 'in two rows of four (frames 1-4 in the top row, 5-8 in the bottom row)', (
            desc + ' in the Metal Slug style: layered rolling orange and yellow fireballs with a white-hot centre, '
            'thick black-brown smoke billowing, flying debris chunks and sparks'),
            '(1) a small white-yellow flash, (2) a bright expanding fireball, (3) a big layered fireball, (4) the '
            'biggest fireball with debris flying out, (5) fire turning into thick smoke, (6) mostly black smoke with '
            'glowing embers, (7) smoke thinning, (8) last wisps of smoke. All frames are drawn at ONE consistent '
            'scale, so the explosion clearly grows and then dissipates.'), 'land')
    # ───────── 4. 資訊欄 ─────────
    j['hud_frames'] = J(sheet(3, 'stacked in three rows from top to bottom', (
        '(1) a wide horizontal WOODEN SIGNBOARD frame for a game HUD: a sturdy dark weathered wooden plank frame with '
        'iron corner brackets and nail heads, a thin rope wrapped around the left and right ends, and a large EMPTY '
        'recessed flat dark-brown panel inside (plain, no texture in the inner panel, room for text), about 3.5 times '
        'wider than tall; (2) the same style frame but SHORTER, about 2.5 times wider than tall; (3) the same style frame '
        'but VERY LONG and thin, about 9 times wider than tall, with a narrow empty dark groove inside for a health bar')),
        'land')
    j['hud_paws'] = J(sheet(3, 'in one row from left to right', (
        '(1) a FULL health icon: a cute round cat PAW PRINT, cream-white paw with bright pink toe beans and a pink '
        'palm pad, a thick dark brown outline and a small shine; (2) an EMPTY health icon: the same paw shape but dark '
        'grey-brown and hollow-looking, faded; (3) a small round wooden token with a carved cat face (no text)')),
        'land')
    # ───────── 5. 大字招牌 ─────────
    SIGN = ('A 2D game TITLE SIGN on a TRANSPARENT background, in ' + STYLE + ': a horizontal wooden signboard with '
            'weathered dark wood, iron corner fittings and a red tasseled rope hanging from each end, and on it BIG '
            'BOLD Japanese brush calligraphy in shining gold with a thick black-red outline. The text on the board is '
            'EXACTLY these Chinese characters in this order and nothing else: 「{text}」 ({spell}). Write every '
            'character correctly and completely. The sign is about 3 times wider than tall. No other text, no '
            'characters, no people.')
    for key, text, spell in (('sign_m1', '任務一 開始！', 'the characters 任 務 一, a space, then 開 始 and a full-width exclamation mark'),
                             ('sign_m2', '任務二 開始！', 'the characters 任 務 二, a space, then 開 始 and a full-width exclamation mark'),
                             ('sign_m3', '任務三 開始！', 'the characters 任 務 三, a space, then 開 始 and a full-width exclamation mark'),
                             ('sign_clear', '任務完成！', 'the characters 任 務 完 成 and a full-width exclamation mark'),
                             ('sign_continue', '接關？', 'the characters 接 關 (traditional Chinese 關) and a full-width question mark')):
        j[key] = J(SIGN.format(text=text, spell=spell), 'wide')
    j['sign_warning'] = J(
        'A 2D game BOSS WARNING BANNER on a TRANSPARENT background, in ' + STYLE + ': a long horizontal banner that '
        'spans the whole width of the picture: a dark red lacquered wooden board with a big EMPTY flat dark red centre '
        'area (for text added later), framed at the top and bottom by bold yellow-and-black diagonal hazard stripes, '
        'gold metal studs, two red paper lanterns hanging at the left and right ends, and a small red warning emblem '
        '(an exclamation-mark shape made of a flame, no letters) at each end. About 6 times wider than tall. NO text, '
        'NO letters, NO characters anywhere.', 'wide')
    # ───────── 6. 魔王登場特寫 ─────────
    BOSS = ('Reference image 1 only sets the picture shape and the painting style (hand-painted Metal Slug-like game '
            'art); draw NOTHING from its scene. Reference image 2 is the BOSS character {name}: copy the character\'s '
            'design EXACTLY (same body shape, colours, clothes, accessories, face) but render it bigger and more '
            'dramatic with rich shading, rim light and a thick dark outline. BOSS INTRO CLOSE-UP for a fighting-game '
            'style entrance: a wide horizontal banner composition, the boss shown from the waist up (or the front half '
            'of the machine) large on the RIGHT half of the picture, facing LEFT toward the camera side with a fierce '
            'confident expression and a dynamic pose ({pose}), dramatic speed lines and a burst of {aura} energy behind '
            'it, the left 40% of the picture kept mostly empty for the boss name added later. TRANSPARENT background '
            '(no scenery, no sky). NO text, NO letters.')
    for key, ref, name, pose, aura in (
            ('boss_drum_tanuki', 'drum_tanuki_codex1', 'Drum Tanuki (a raccoon dog drummer)', 'raising both drumsticks over the big taiko drum', 'orange'),
            ('boss_orange_king', 'orange_king_codex1', 'Orange King (a huge fat orange cat king with a crown and red cape)', 'puffing out his big belly, holding a dried fish like a sceptre', 'golden'),
            ('boss_frog_daimyo', 'frog_daimyo_codex1', 'Frog Daimyo (a frog lord in a red kimono)', 'snapping open his folding fan, cheeks puffed', 'green-blue'),
            ('boss_tanuki_lord', 'tanuki_lord_codex1', 'Tanuki Lord (a raccoon dog lord with a straw hat and a sake bottle)', 'grinning with a leaf on his head, ready to transform', 'purple magic'),
            ('boss_roomba_king', 'roomba_king_codex2', 'Roomba King (a giant robot vacuum cleaner with a crown and a sash)', 'charging forward, brushes spinning, one angry eye glaring', 'electric blue'),
            ('boss_iron_claw', 'iron_claw_codex1', 'Iron Claw (a giant mechanical iron cat robot with gears and a wind-up key)', 'raising one huge iron claw, glowing eyes, steam bursting', 'fiery orange')):
        j[key] = J(BOSS.format(name=name, pose=pose, aura=aura), [REF['wide'], MON / f'{ref}.png'])
    # ───────── 7. 被救村貓 ─────────
    CAT = ('Reference image 1 shows two poses of a rescued village cat from this game (LEFT: tied to a wooden stake, '
           'worried; RIGHT: freed and happily waving). Redraw BOTH poses EXACTLY the same: same drawing style, same '
           'poses, same size and position, same wooden stake and ropes, same layout with the same gap between them, '
           'facing LEFT, on a TRANSPARENT background - but as a DIFFERENT village cat: {look}. No text, no ground, no '
           'shadows, no other characters, no border.')
    for key, look in (('cat_orange_white', 'an ORANGE-AND-WHITE cat (orange back and head, white muzzle, chest and paws) wearing a short green village kimono with a brown sash'),
                      ('cat_black', 'an all-BLACK cat with bright yellow-green eyes wearing a short red happi jacket with a white sash'),
                      ('cat_white', 'an all-WHITE fluffy cat with blue eyes wearing a short pink kimono with a red ribbon sash'),
                      ('cat_siamese', 'a SIAMESE cat (cream body with dark brown face mask, ears, paws and tail, blue eyes) wearing a short indigo work apron over a light shirt'),
                      ('cat_grey_tabby', 'a GREY TABBY cat (silver-grey with dark grey stripes) wearing a straw hat and a blue neckerchief'),
                      ('cat_calico_long', 'a LONG-HAIRED fluffy CALICO cat (white, orange and black patches, bushy tail) wearing a short purple kimono with a yellow sash')):
        j[key] = J(CAT.format(look=look), ROOT / 'art_raw' / 'stage_art' / 'npc_calico.try1.png')
    # ───────── 8. 球球特效 ─────────
    j['q_claw'] = J(frames(3, 'in one row from left to right', (
        'a CLAW SWIPE ARC effect for a ninja cat swiping to the RIGHT: three parallel curved crescent slash trails of '
        'white-hot light edged with pale blue, sweeping from top-left down to the right, like a big arc'),
        '(1) the arc just starting, short and bright, (2) the full big arc, (3) the arc fading and breaking into sparks.'),
        'land')
    j['q_flash'] = J(sheet(2, 'side by side', (
        '(1) a THROWING FLASH: a small bright white-yellow burst with short speed lines pointing to the RIGHT (the flash '
        'when a shuriken leaves the hand); (2) a small round white-blue TWINKLE sparkle with four long thin rays')),
        'land')
    j['q_respawn'] = J(
        REF_TXT + 'A RESPAWN LIGHT PILLAR effect for a 2D side-scrolling game, in ' + STYLE + ': a tall vertical column '
        'of warm white-gold light coming down from the top edge to the bottom edge of the picture, brightest in the '
        'middle, with soft glowing edges, small sparkles and a few floating light motes around it, and a bright round '
        'glow splash where it hits the bottom. The pillar is about 30% of the picture width.' + TR + NOTXT, 'tall')
    return j


GROUPS = {'bullets': 'b_', 'particles': 'p_', 'explosions': 'x_', 'hud': 'hud_', 'banners': 'sign_', 'bosses': 'boss_',
          'cats': 'cat_', 'qiuqiu': 'q_'}


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
    cmd = [sys.executable, str(gp.IMAGE_GEN), 'edit', '--backend', 'codex-oauth', '--model', 'gpt-image-1.5', '--size',
           '1536x1024', '--quality', 'high', '--prompt', prompt, '--out', str(out), '--force', '--background', job['bg']]
    for r in job['refs']:
        cmd += ['--image', str(r)]
    t0 = time.time()
    status = 'failed'
    for _ in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists():
            status = 'ok'
            break
        status = f'failed: {r.stderr.strip()[-400:]}'
        low = r.stderr.lower()
        if not any(t in low for t in ('capacity', 'rate', 'timed out', 'timeout', 'http 5', 'overloaded')):
            break
        time.sleep(30)
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    from PIL import Image
    size = Image.open(out).size if out.exists() else None
    record(name, {'attempt': n, 'status': status, 'size': size, 'refs': [Path(x).name for x in job['refs']],
                  'prompt': prompt, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status[:300]}（{time.time() - t0:.0f} 秒）{size}'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', nargs='+')
    ap.add_argument('--note', default='')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    table = jobs()
    names: list[str] = []
    for w in a.what:
        if w == 'all':
            names += list(table)
        elif w in GROUPS:
            names += [k for k in table if k.startswith(GROUPS[w])]
        elif w in table:
            names.append(w)
        else:
            sys.exit(f'不認得：{w}')
    for nm in names:
        for r in table[nm]['refs']:
            if not Path(r).exists():
                sys.exit(f'{nm} 的參考圖不存在：{r}')
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for line in pool.map(lambda nm: gen(nm, table[nm], a.note), names):
            print(line, flush=True)


if __name__ == '__main__':
    main()
