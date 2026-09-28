"""球球橫向試做的生圖（2026-09-25）：Codex（codex-oauth）。

  python tools/gen_art.py parts        球球的零件圖（切件綁骨用，真透明）
  python tools/gen_art.py bg           橫向捲動的背景
  python tools/gen_art.py all          兩張一起（平行）
  加 --note "..." 補一句提示；每次存成 art_raw/<名稱>.try<N>.png，不蓋舊的。

零件圖為什麼要另外畫：火龍那次是整張圖直接切，翅膀、尾巴轉一點角度看不出破綻；
球球要跑要跳，腿和手臂轉動時會露出原本被身體擋住的地方，所以請它把每個零件**分開、完整**畫出來。
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

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw'
REF = RAW / '_ref'
IMAGE_GEN = Path.home() / '.codex/skills/codex-ppt/scripts/image_gen.py'
HERO = Path('F:/ClaudeWork/qiuqiu-coop/public/assets/sprites/hero')
LOG = RAW / 'prompts.json'
_LOCK = threading.Lock()

LOOK = ('QIUQIU: a small young chibi cat ninja. Cream-white fur with grey-brown tabby stripes on the head, back and '
        'tail, three short brown stripes on each cheek, pink inner ears, black eyes with a white highlight, a tiny pink '
        'nose. He wears a NAVY BLUE ninja gi (wrap top with a white-edged collar, loose navy trousers), a BLACK belt '
        'tied at the front, black cloth wraps on the lower legs, white paws. A NAVY headband around his forehead with '
        'two long navy ribbon tails at the back. Big round head (as big as his whole body), short chubby body.')

PARTS = (
    'A 2D CUTOUT-ANIMATION PUPPET PARTS SHEET for a side-scrolling game character. ' + LOOK + ' '
    'Reference images 1 and 2 show him: copy his face, markings, colours, outfit and drawing style EXACTLY '
    '(thick black outlines, flat colours with soft gradients, cute chibi proportions). '
    'Every part is drawn in STRICT SIDE VIEW FACING RIGHT, all at the SAME SCALE (as if he were 700 pixels tall). '
    'Draw each body part SEPARATELY, NOT attached to any other part, with at least 60 pixels of empty space around '
    'each part. Each part must be COMPLETE: also draw the portions that are normally hidden behind the body '
    '(the full rounded top of each leg and each arm where it joins the body), so rotating a part never shows a gap. '
    'Lay the parts out in THREE ROWS, left to right: '
    'ROW 1: (a) the HEAD in side view facing right, with ears, face and the navy headband band and knot, but WITHOUT '
    'the long ribbon tails; (b) the TORSO: navy gi top with collar and the black belt, no head, no arms, no legs, '
    'with a short neck stub at the top; (c) the TAIL: one striped tail, gently curved. '
    'ROW 2: (d) FRONT ARM: one whole arm in a navy sleeve from shoulder to white paw, hanging straight down, paw '
    'loosely closed; (e) BACK ARM: the same arm again but a slightly darker shade; (f) the HEADBAND RIBBONS: the two '
    'long navy ribbon tails as one piece, streaming horizontally to the left from their knot end. '
    'ROW 3: (g) FRONT LEG: one whole leg from hip to foot, navy trouser, black leg wrap and white foot pointing right, '
    'straight; (h) BACK LEG: the same leg again but a slightly darker shade; (i) a SHURIKEN: one four-pointed steel '
    'ninja star. '
    'Exactly nine separate pieces. Transparent background. Everything solid and opaque. No text, no labels, no '
    'numbers, no guide lines, no shadows, no border.')

BG = (
    'A wide 2D SIDE-SCROLLING GAME BACKGROUND in a cute cartoon style (thick black outlines, flat colours with soft '
    'gradients), matching a chibi ninja cat game. Scene: a quiet Japanese mountain village path at dusk - warm '
    'orange sky fading to purple, distant misty mountains, a few pagoda roofs and paper lanterns, bamboo groves, '
    'wooden fences. Pure side view like a platformer: the BOTTOM 18% of the picture is a FLAT, LEVEL dirt road seen '
    'exactly from the side (a straight horizontal top edge), where characters will walk. Keep the middle band '
    'fairly calm so characters stay readable in front of it. No characters, no animals, no text, no UI. The left '
    'and right edges should look like the scene simply continues.')


def refs() -> None:
    REF.mkdir(parents=True, exist_ok=True)
    for name in ('ninja', 'ninja_walk'):
        im = Image.open(HERO / f'{name}.webp').convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        bg.convert('RGB').save(REF / f'{name}.png')


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def generate(name: str, note: str) -> str:
    with _LOCK:
        n = 1
        while (RAW / f'{name}.try{n}.png').exists() or (RAW / f'{name}.try{n}.pending').exists():
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    out = RAW / f'{name}.try{n}.png'
    text = (PARTS if name == 'parts' else BG) + (f' {note}' if note else '')
    if name == 'parts':
        cmd = [sys.executable, str(IMAGE_GEN), 'edit', '--backend', 'codex-oauth', '--model', 'gpt-image-1.5',
               '--background', 'transparent', '--size', '1536x1024', '--quality', 'high', '--prompt', text,
               '--image', str(REF / 'ninja.png'), '--image', str(REF / 'ninja_walk.png'), '--out', str(out), '--force']
    else:
        cmd = [sys.executable, str(IMAGE_GEN), 'generate', '--backend', 'codex-oauth',
               '--size', '1536x1024', '--quality', 'high', '--prompt', text, '--out', str(out), '--force']
    t0 = time.time()
    status = 'failed'
    for _ in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0 and out.exists():
            status = 'ok'
            break
        status = f'failed: {r.stderr.strip()[-300:]}'
        if 'at capacity' not in r.stderr:
            break
        time.sleep(30)
    (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
    record(name, {'attempt': n, 'status': status, 'prompt': text, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    return f'{name} 第 {n} 次：{status}（{time.time() - t0:.0f} 秒）'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('what', choices=['parts', 'bg', 'all'])
    ap.add_argument('--note', default='')
    ap.add_argument('--n', type=int, default=1, help='同一種生幾張（平行）')
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    refs()
    names = ['parts', 'bg'] if a.what == 'all' else [a.what]
    jobs = [nm for nm in names for _ in range(a.n)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for line in pool.map(lambda nm: generate(nm, a.note), jobs):
            print(line, flush=True)


if __name__ == '__main__':
    main()
