"""第二版原檔總覽（檢查用）：python tools/contact_v2.py <glob> <輸出.jpg> [每格寬]"""
import glob
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    pat, out = sys.argv[1], sys.argv[2]
    cw = int(sys.argv[3]) if len(sys.argv) > 3 else 300
    fs = sorted(f for f in glob.glob(pat) if 'reject' not in f and '_guide' not in f and '_in_' not in f)
    th = []
    for f in fs:
        im = Image.open(f).convert('RGBA')
        im.thumbnail((cw, cw))
        bg = Image.new('RGBA', (cw + 10, cw + 30), (120, 130, 150, 255))
        for y in range(0, cw + 30, 20):
            for x in range(0, cw + 10, 20):
                if (x // 20 + y // 20) % 2:
                    bg.paste((150, 160, 180, 255), (x, y, x + 20, y + 20))
        bg.alpha_composite(im, (5, 5))
        d = ImageDraw.Draw(bg)
        d.rectangle((0, cw + 10, cw + 10, cw + 30), fill=(0, 0, 0, 255))
        d.text((4, cw + 14), Path(f).name[:40], fill=(255, 255, 255, 255))
        th.append(bg)
    cols = 8
    rows = (len(th) + cols - 1) // cols
    o = Image.new('RGB', (cols * (cw + 10), rows * (cw + 30)), 'white')
    for i, t in enumerate(th):
        o.paste(t.convert('RGB'), ((i % cols) * (cw + 10), (i // cols) * (cw + 30)))
    o.save(out, quality=85)
    print(len(fs), o.size)


if __name__ == '__main__':
    main()
