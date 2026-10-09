"""遊戲字型（2026-10-09，使用者：「文字改用藝術一點的字體試試看」）：兩款開源繁中字型只留遊戲用得到的字，做成小 woff2。

  jf 粉圓（jf-openhuninn 2.1，justfont，SIL OFL 1.1）：圓潤可愛
  霞鶩文楷 TC Medium（LXGW WenKai TC 1.522，SIL OFL 1.1）：手寫楷書

用法：python tools/make_fonts.py <放兩個原始 ttf 的資料夾>
  資料夾裡要有 huninn.ttf、wenkai_medium.ttf（原檔不進版控，從各自的 GitHub 發行頁下載）。
用到的字＝src 底下所有 .ts、public 底下所有 .json（關卡、配音字幕……）裡出現的非 ASCII 字，加上全部可見 ASCII 與常用全形標點。
新加台詞、招牌字之後要重跑，不然新字會退回系統字型（瀏覽器自動補字，不會變方塊，只是字體不一樣）。
"""
import sys
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1])
OUT = ROOT / "public" / "fonts"
OUT.mkdir(parents=True, exist_ok=True)

chars = set(chr(c) for c in range(0x20, 0x7F))
chars |= set("，。、！？：；「」『』（）《》〈〉…—～・×÷＋－＝／％０１２３４５６７８９▲▼◀▶←→↑↓★☆♪∞　")
files = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "public").rglob("*.json")) + [ROOT / "index.html"]
for f in files:
    try:
        t = f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    chars |= {c for c in t if ord(c) > 0x7F}
text = "".join(sorted(chars))
print(f"收集到 {len(chars)} 個字")

for src_name, out_name in [("huninn.ttf", "huninn-sub.woff2"), ("wenkai_medium.ttf", "wenkai-sub.woff2")]:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]          # 保留授權資訊（OFL 要求）
    opts.notdef_outline = True
    font = subset.load_font(str(SRC / src_name), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    subset.save_font(font, str(OUT / out_name), opts)
    print(out_name, round((OUT / out_name).stat().st_size / 1024), "KB")
