"""第二版「畫面往上捲」大攀爬段的背景上半部（2026-09-28 使用者同意做）。

兩種：
  中景往上延伸（mid）：在第二版中景長卷某個 x 範圍（寬 1536，攀爬段鏡頭左右鎖住時看得到的那一塊）往上接 4 段，
    每段畫布 1536x1024：下三分之一＝目前最上面 341 列、上三分之二灰色 → Codex 往上畫。約多出 2,700 列（快四個畫面高）。
  最遠景往上延伸（far）：整條第二版最遠景（不透明天空）往上接一段約 680 列；橫向一塊塊接（每塊左三分之一＝上一塊的右邊）。
接法：段與段之間 ECC 對位＋最小差異橫切線羽化；最底一段跟原本長卷在 y＝0 硬接（不改原本長卷的任何一張）。

  python tools/gen_v2_climb.py run s1_mid s2_mid s3_mid s3_shaft      中景往上（依序生到完，多條並行）
  python tools/gen_v2_climb.py run s1_far s2_far s3_far
  python tools/gen_v2_climb.py export
原檔在 art_raw/v2/climb/。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_panels as gp       # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art_raw' / 'v2' / 'climb'
LOG = RAW / 'prompts.json'
ART = ROOT / 'public' / 'art'
VP = ROOT / 'art_raw' / 'v2' / 'panels' / 'v2_panels.json'
CW, CH = 1536, 1024
KEEP = 341
_LOCK = threading.Lock()
STYLE = gp.STYLE
NO_CHAR = gp.NO_CHAR

UP_HEAD = ('The input image is one panel of the {what} of a 2D platform game that SCROLLS UPWARD in this section, in '
           + STYLE + '. Its BOTTOM THIRD already contains finished artwork (the upper end of the part below). Keep that '
           'bottom third EXACTLY as it is: same objects at the same positions, same scale, colours, lighting and '
           'outlines. The TOP TWO-THIRDS are still EMPTY (flat grey placeholder) and must be painted now: continue the '
           'scenery seamlessly UPWARD from the bottom third, so that everything that touches the boundary continues '
           'naturally across it. Pure side view (the camera just moved up; the same horizon-less side-on view, NO '
           'perspective looking up). New content for the upper part: {scene}. {light}. ')
MID_TAIL = ('Everything behind the scenery (the sky and any distant landscape) stays completely EMPTY and TRANSPARENT '
            '(transparent background: NO sky, NO clouds, NO moon; other layers are drawn behind). ' + NO_CHAR +
            ' No grey placeholder may remain.')
INDOOR_TAIL = ('This is INDOORS: the dark riveted iron walls fill the whole picture, nothing is transparent. ' + NO_CHAR
               + ' No grey placeholder may remain.')
FAR_HEAD = ('The input image is one panel of the SKY LAYER (farthest parallax layer, opaque) of a 2D platform game '
            'that scrolls UPWARD here, in ' + STYLE + '. The BOTTOM THIRD{left} already contains finished artwork: '
            'keep it EXACTLY as it is. The rest is still EMPTY (flat grey placeholder) and must be painted now: '
            'continue the sky seamlessly UPWARD{leftcont}: {scene}. The colours change gradually upward; no ground, no '
            'buildings, no trees, no mountains in the upper part. ' + NO_CHAR + ' No grey placeholder may remain.')

MID = {
    's1_mid': dict(insert='s1_mid_B', find='waterfall', light='Lighting: blue-purple twilight, silver-violet glow on '
                   'the falling water and mist, cool shadows, fireflies', steps=[
        'the tall cliff of dark wet layered rock continues up, the big white waterfall keeps pouring down from much '
        'higher up, wet rock ledges and outcrops on both sides of the falls, long hanging vines, ferns and moss, a '
        'twisted pine clinging to the rock',
        'higher up the cliff: the waterfall narrows and splits around a big mossy boulder, more rock ledges, hanging '
        'vines, a small stone shrine on a ledge, ferns, mist drifting',
        'near the top of the cliff: rugged rock faces, roots and hanging vines, pines leaning out over the edge, the '
        'waterfall still pouring from above']),
    's2_mid': dict(insert='s2_mid_B', find='waterfall', light='Lighting: moonlit night, cool silver-blue light on the '
                   'water and mist, deep blue-black shadows, a few warm candle lanterns', steps=[
        'the tall black wet cliffs continue up, the big silver-blue waterfall keeps pouring down from much higher up, '
        'rock ledges on both sides, hanging vines, ferns and moss',
        'higher up: the waterfall splits around a mossy rock pillar, a small red torii gate in front of a cave mouth '
        'on a ledge with candle lanterns, hanging vines',
        'near the top of the cliff: rugged rock faces, roots, red maple branches leaning over, the waterfall still '
        'pouring from above',
        'the cliff continues up across the WHOLE width of the picture (keep its full width, do not narrow it) and '
        'ends at its flat top edge about 30% from the top of the picture: along that top edge a stream flows over '
        'the lip between mossy boulders, red maple trees and a tiny stone lantern and becomes the waterfall; above '
        'the top edge is empty transparent space']),
    's3_mid': dict(insert='s3_mid_B', find='castle', light='Lighting: cold blue-purple storm light, wet shining tiles '
                   'with white lightning highlights, warm lantern and window glow, rain', steps=[
        'the outer wall of the castle keep continues up: white plaster walls with black wooden beams, another layer '
        'of curved dark tiled roof eaves sticking out, arrow-slit windows with warm light, an iron ladder bolted to '
        'the wall, rain pouring off the eaves',
        'higher up the keep: more stacked curved roofs with golden ornaments, mechanical iron cannons in wall ports, '
        'gears and chains built into the wall, lanterns with a round gear crest (no writing)',
        'the upper storeys of the keep: a balcony walkway with a railing around the wall, big iron gears and '
        'lightning rods, stacked roofs',
        'the TOP of the castle keep: the highest roof with big golden fish-shaped ornaments (shachihoko) at both ends '
        'of the ridge, iron lightning rods crackling; above the roof there is nothing but empty transparent space (the '
        'upper part of the picture is mostly empty)']),
    's3_shaft': dict(insert='s3_mid_A', find='shaft', indoor=True, light='Lighting: cold steel-blue light, white steam '
                     'glowing, warm orange lamp spots, wet shining metal', steps=[
        'a tall iron cooling shaft continues up: riveted iron walls, water pouring down a stepped iron spillway, '
        'pipes, chains, iron ladders and catwalks at different heights',
        'higher up the shaft: big pipe outlets gushing water, pumps, valves and gauges, hanging chains, steam clouds',
        'near the top of the shaft: iron girders crossing, big pulleys, a water tank with pipes',
        'the TOP of the shaft: an iron ceiling with a big round hatch, huge pipes bending in from the sides, cranes and '
        'chains, warning lamps']),
}
FAR = {
    's1_far': 'the evening sky higher up: deep violet fading to dark indigo at the top, thin long clouds lit pink from '
              'below, the first stars',
    's2_far': 'the night sky higher up: deep navy with many stars and thin silver clouds, getting darker toward the top',
    's3_far': 'the storm sky higher up: dark churning blue-purple storm clouds, flashes of lightning inside the clouds, '
              'getting darker toward the top',
}


def record(name: str, entry: dict) -> None:
    with _LOCK:
        data = json.loads(LOG.read_text(encoding='utf-8')) if LOG.exists() else {}
        data.setdefault(name, []).append(entry)
        LOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def next_try(name: str) -> int:
    with _LOCK:
        n = 1
        while any((RAW / f'{name}.try{n}{s}').exists() for s in ('.png', '.pending', '.reject.png')):
            n += 1
        (RAW / f'{name}.try{n}.pending').write_text('', encoding='utf-8')
    return n


def pick(name: str) -> Path | None:
    picks = json.loads((RAW / 'picks.json').read_text(encoding='utf-8')) if (RAW / 'picks.json').exists() else {}
    if name in picks:
        return RAW / f'{name}.try{picks[name]}.png'
    t = sorted((p for p in RAW.glob(f'{name}.try*.png') if '.reject.' not in p.name),
               key=lambda p: int(re.search(r'try(\d+)', p.name).group(1)))
    return t[-1] if t else None


def load(path: Path, transp: bool) -> np.ndarray:
    im = Image.open(path).convert('RGBA')
    if im.size != (CW, CH):
        im = im.resize((CW, CH), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    if transp:
        return gp.clean_alpha(a)
    a[..., 3] = 255
    return a


def v2_strip(stage: str, ly: str) -> tuple[np.ndarray, list[dict]]:
    items = json.loads(VP.read_text(encoding='utf-8'))[stage][ly]['items']
    parts = [np.asarray(Image.open(ART / it['path']).convert('RGBA')).astype(np.float32) for it in items]
    return np.concatenate(parts, axis=1), items


def mid_window(key: str) -> tuple[str, int]:
    """中景窗：插段裡最「像瀑布／高牆」的地方：插段範圍內，上面 40% 列實心最多的 1536 寬（瀑布：再加亮度）。"""
    d = MID[key]
    st = key.split('_')[0]
    strip, items = v2_strip(st, 'mid')
    xs = [it for it in items if it.get('insert') == d['insert']]
    x0, x1 = xs[0]['x'], xs[-1]['x'] + xs[-1]['w']
    fixed = json.loads((RAW / 'windows.json').read_text(encoding='utf-8')) if (RAW / 'windows.json').exists() else {}
    if key in fixed:
        return st, int(fixed[key])
    top = strip[:260, x0:x1]
    score = (top[..., 3] > 128).mean(0)
    if d['find'] == 'waterfall':
        lum = top[..., :3].mean(-1) * (top[..., 3] > 128)
        score = score + (lum > 150).mean(0) * 2
    k = np.convolve(score, np.ones(CW) / CW, mode='valid')
    return st, int(x0 + int(np.argmax(k)))


def column(key: str, upto: int | None = None) -> tuple[np.ndarray, list[dict]]:
    """中景：回傳（往上延伸的部分，y 由上到下；高＝接上的列數, 接縫資訊）。不含原本長卷。"""
    d = MID[key]
    st, x = mid_window(key)
    strip, _ = v2_strip(st, 'mid')
    base = strip[:, x:x + CW]
    ext = np.zeros((0, CW, 4), np.float32)
    seams = []
    n = len(d['steps']) if upto is None else upto
    for k in range(1, n + 1):
        src = pick(f'{key}_{k}')
        if src is None:
            raise SystemExit(f'{key}_{k} 還沒生')
        R = load(src, not d.get('indoor'))
        cur = np.concatenate([ext, base], axis=0)
        tail = cur[:KEEP]
        m, reg = gp.register(tail, R[CH - KEEP:])
        R = gp.warp(R, m)
        kept = float(np.abs(gp.premul(tail) - gp.premul(R[CH - KEEP:])).mean())
        if k == 1:   # 跟原本長卷硬接在 y=0
            ext = R[:CH - KEEP]
            seams.append({'k': k, 'kept': round(kept, 2), 'reg': reg, 'join': 'hard y=0'})
        else:
            A = tail.transpose(1, 0, 2)
            Bv = R[CH - KEEP:].transpose(1, 0, 2)
            path = gp.min_cut(Bv, A, 40)        # 轉置後「左」＝上（新圖）、「右」＝下（舊）
            bl = gp.blend(Bv, A, path).transpose(1, 0, 2)
            ext = np.concatenate([R[:CH - KEEP], bl, ext[KEEP:]], axis=0)
            seams.append({'k': k, 'kept': round(kept, 2), 'reg': reg})
    return ext, seams


def far_ext(key: str, upto: int | None = None) -> tuple[np.ndarray, list[dict], int]:
    st = key.split('_')[0]
    strip, _ = v2_strip(st, 'far')
    strip[..., 3] = 255
    W = strip.shape[1]
    n_need = int(np.ceil((W - CW) / (CW - 512))) + 1
    n = n_need if upto is None else upto
    E = CH - KEEP   # 延伸高
    ext = None
    seams = []
    for k in range(1, n + 1):
        src = pick(f'{key}_{k}')
        if src is None:
            raise SystemExit(f'{key}_{k} 還沒生')
        R = load(src, False)
        x0 = min(W - CW, (k - 1) * (CW - 512))
        tail = strip[:KEEP, x0:x0 + CW]
        m, reg = gp.register(tail, R[E:])
        R = gp.warp(R, m)
        top = R[:E]
        if ext is None:
            ext = np.zeros((E, W, 4), np.float32)
            ext[:, :CW] = top
            filled = CW
        else:
            ov = filled - x0
            A, Bn = ext[:, x0:filled], top[:, :ov]
            path = gp.min_cut(A, Bn, 30)
            ext[:, x0:filled] = gp.blend(A, Bn, path)
            ext[:, filled:x0 + CW] = top[:, ov:]
            filled = x0 + CW
        seams.append({'k': k, 'x0': x0, 'reg': reg})
    return ext, seams, W


def canvas_for(key: str, k: int) -> np.ndarray:
    c = np.zeros((CH, CW, 4), np.float32)
    c[...] = (128, 128, 128, 255)
    if key in MID:
        st, x = mid_window(key)
        strip, _ = v2_strip(st, 'mid')
        base = strip[:, x:x + CW]
        ext, _ = column(key, k - 1) if k > 1 else (np.zeros((0, CW, 4), np.float32), [])
        cur = np.concatenate([ext, base], axis=0)
        c[CH - KEEP:] = cur[:KEEP]
        if MID[key].get('indoor'):
            c[..., 3] = 255
    else:
        st = key.split('_')[0]
        strip, _ = v2_strip(st, 'far')
        W = strip.shape[1]
        x0 = min(W - CW, (k - 1) * (CW - 512))
        c[CH - KEEP:] = strip[:KEEP, x0:x0 + CW]
        if k > 1:
            ext, _, _ = far_ext(key, k - 1)
            prev_fill = min(W, (k - 2) * (CW - 512) + CW) if k > 2 else CW
            prev_fill = min(W - CW, (k - 2) * (CW - 512)) + CW
            ov = prev_fill - x0
            c[:CH - KEEP, :ov] = ext[:, x0:prev_fill]
        c[..., 3] = 255
    return c


def prompt(key: str, k: int) -> str:
    if key in MID:
        d = MID[key]
        what = ('INDOOR SCENERY LAYER' if d.get('indoor') else 'NEAR-SCENERY LAYER (main parallax layer, transparent sky)')
        return UP_HEAD.format(what=what, scene=d['steps'][k - 1], light=d['light']) + (
            INDOOR_TAIL if d.get('indoor') else MID_TAIL)
    return FAR_HEAD.format(left='' if k == 1 else ' and the LEFT THIRD of the upper part',
                           leftcont='' if k == 1 else ' and to the right', scene=FAR[key])


def steps(key: str) -> int:
    if key in MID:
        return len(MID[key]['steps'])
    st = key.split('_')[0]
    strip, _ = v2_strip(st, 'far')
    return int(np.ceil((strip.shape[1] - CW) / (CW - 512))) + 1


def gen_one(key: str, k: int) -> str:
    name = f'{key}_{k}'
    transp = key in MID and not MID[key].get('indoor')
    lines = []
    for _ in range(5):
        n = next_try(name)
        out = RAW / f'{name}.try{n}.png'
        inp = RAW / f'_in_{name}.try{n}.png'
        Image.fromarray(np.clip(canvas_for(key, k) + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(inp)
        t0 = time.time()
        status = gp.call_codex(prompt(key, k), inp, out, transp)
        (RAW / f'{name}.try{n}.pending').unlink(missing_ok=True)
        ok, info = False, ''
        if status == 'ok':
            R = load(out, transp)
            c = canvas_for(key, k)
            kept = float(np.abs(gp.premul(R[CH - KEEP:]) - gp.premul(c[CH - KEEP:])).mean())
            grey = float(((np.abs(R[..., :3] - 128).max(-1) < 6) & (R[..., 3] > 200))[:CH - KEEP].mean())
            ok = kept < 22 and grey < 0.03
            info = f'保留差 {kept:.2f}、灰殘 {grey:.3f}、透明 {float((R[..., 3] < 16).mean()):.2f}'
        record(name, {'attempt': n, 'status': status, 'check': info, 'pass': ok, 'prompt': prompt(key, k),
                      'at': time.strftime('%Y-%m-%d %H:%M:%S')})
        lines.append(f'{name} 第 {n} 次：{status[:200]}（{time.time() - t0:.0f} 秒）{info}{"" if ok else " ✗"}')
        print(lines[-1], flush=True)
        if ok:
            break
        if out.exists():
            out.rename(RAW / f'{name}.try{n}.reject.png')
    return '\n'.join(lines)


def run(key: str) -> str:
    for k in range(1, steps(key) + 1):
        if pick(f'{key}_{k}') is None:
            gen_one(key, k)
            if pick(f'{key}_{k}') is None:
                return f'{key} 卡在 {k}'
    return f'{key} 完成'


def export() -> dict:
    res: dict = {}
    out_dir = ART / 'v2' / 'climb'
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, d in MID.items():
        if any(pick(f'{key}_{k}') is None for k in range(1, len(d['steps']) + 1)):
            print('未完成', key)
            continue
        st, x = mid_window(key)
        ext, seams = column(key)
        # 分段存（每段 720 高，由下往上編號），免得單張太大
        H = ext.shape[0]
        pieces = []
        y = H
        i = 0
        while y > 0:
            y0 = max(0, y - 720)
            i += 1
            rel = f'v2/climb/{key}_up{i}.webp'
            gp.save_webp(ext[y0:y], ART / rel, not d.get('indoor'))
            pieces.append({'path': rel, 'y': y0 - H, 'h': y - y0})
            y = y0
        res[key] = {'layer': 'mid', 'stage': st, 'x': x, 'w': CW, 'height': H, 'pieces': pieces, 'seams': seams,
                    'opaque': bool(d.get('indoor')), 'insert': d['insert'],
                    'use': f'中景長卷（第二版 v2_panels {st}.mid）x={x}～{x + CW} 的正上方往上延伸 {H} 列：pieces 的 y 是相對長卷頂'
                           '（負值＝在長卷上面），由下往上一塊接一塊；鏡頭往上捲時中景用自己的上下捲速率畫這些塊。'
                           '攀爬段鏡頭左右要鎖在「中景看到的範圍落在這 1536 寬之內」。最底一塊跟長卷在 y=0 硬接。'}
        print(key, 'x', x, 'H', H, [s.get('kept') for s in seams])
    for key in FAR:
        n = steps(key)
        if any(pick(f'{key}_{k}') is None for k in range(1, n + 1)):
            print('未完成', key)
            continue
        ext, seams, W = far_ext(key)
        rel = f'v2/climb/{key}_up.webp'
        gp.save_webp(ext, ART / rel, False)
        res[key] = {'layer': 'far', 'stage': key.split('_')[0], 'x': 0, 'w': W, 'height': ext.shape[0],
                    'path': rel, 'y': -ext.shape[0],
                    'use': '第二版最遠景長卷整條的正上方往上延伸（不透明天空），寬＝整條長卷；最遠景往上捲得很慢（建議速率 0.15～0.25）。'}
        print(key, ext.shape)
    (RAW / 'climb.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run', 'export', 'window'])
    ap.add_argument('keys', nargs='*')
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if a.cmd == 'run':
        with ThreadPoolExecutor(max_workers=8) as pool:
            for line in pool.map(run, a.keys):
                print(line, flush=True)
    elif a.cmd == 'window':
        for k in a.keys:
            print(k, mid_window(k))
    else:
        export()


if __name__ == '__main__':
    main()
