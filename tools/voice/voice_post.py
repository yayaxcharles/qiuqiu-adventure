# -*- coding: utf-8 -*-
r"""一批生完之後：切句（stable-ts 環境）→ 念錯檢查（系統 Python）→ 印出每句結果。

用法（系統 Python）：python tools\voice\voice_post.py <群組> <try 編號> [--mode align|gaps]
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
PROJ = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
STABLE_PY = r"E:\AI\stable-ts\venv\Scripts\python.exe"
group, tryn = sys.argv[1], int(sys.argv[2])
extra = sys.argv[3:]
d = PROJ / "vids" / "_audio" / "voice_work" / group / f"try{tryn}"
S = json.loads((PROJ / "public" / "voice" / "script.json").read_text(encoding="utf-8"))
L = {l["id"]: l for l in S["lines"]}

r = subprocess.run([STABLE_PY, str(HERE / "voice_split.py"), str(d / "job.json"), *extra],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
print(r.stdout.strip())
if "Traceback" in r.stderr:
    print(r.stderr[-1500:])
sp = json.loads((d / "split.json").read_text(encoding="utf-8"))
items = []
for i, v in sp["lines"].items():
    l = L[i]
    items.append({"id": i, "wav": str(d / "clips" / f"{i}.wav"), "lang": l["lang"], "ref": l["text"],
                  "reading": l.get("reading", ""), "alt_reading": l.get("alt_reading", []), "kiai": l.get("kiai", False)})
if not items:
    sys.exit("沒有切出任何一句")
cf = d / "check.json"
cf.write_text(json.dumps({"items": items, "out": str(d / "check_out.json")}, ensure_ascii=False), encoding="utf-8")
(d / "check_out.json").unlink(missing_ok=True)
subprocess.run([sys.executable, str(HERE / "voice_check.py"), str(cf)])  # 不看結束碼：語音辨識套件在 Windows 收尾偶爾當掉
