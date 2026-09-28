# -*- coding: utf-8 -*-
r"""接著做：還沒生成的群組逐一生成→切句→念錯檢查，再重生播報員待重生的句子，最後收尾出 mp3／voice.json／試聽檔。
遇到額度用完、或 30 次請求用滿就停，已完成的保留，下次再跑會從沒做的接著做。

用法（系統 Python，在專案資料夾）：python tools\voice\run_rest.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
PROJ = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
WORK = PROJ / "vids" / "_audio" / "voice_work"
GEM_PY = r"E:\AI\gemini-tts-eval\venv\Scripts\python.exe"
ORDER = ["qiuqiu_line", "villager1", "villager2", "villager3", "drum_tanuki", "orange_king", "frog_daimyo",
         "tanuki_lord", "roomba_king", "iron_claw", "grunt"]
REGEN = [("announcer", 1, "ann_w_F,ann_w_B")]  # 播報員：火薬竹筒念錯、吹き矢有疑慮，改全假名重生


def gen(group, tryn, ids=""):
    d = WORK / group / f"try{tryn}"
    if not (d / "raw.wav").exists():
        cmd = [GEM_PY, str(HERE / "voice_gen.py"), "--group", group, "--try", str(tryn)] + (["--ids", ids] if ids else [])
        if subprocess.run(cmd).returncode != 0:
            sys.exit(f"{group} 生成失敗或額度用完，停在這裡（已完成的保留）")
    if not (d / "check_out.json").exists():
        subprocess.run([sys.executable, str(HERE / "voice_post.py"), group, str(tryn)])


for g in ORDER:
    gen(g, 0)
for g, t, ids in REGEN:
    gen(g, t, ids)
subprocess.run([sys.executable, str(HERE / "voice_finalize.py")])
rep = json.loads((HERE / "_final_report.json").read_text(encoding="utf-8"))
bad = [k for k, v in rep.items() if v["bad"]]
print(f"待重生：{bad or '無'}（先看回轉文字判斷是不是真的念錯，再用 voice_gen.py --ids 重生、verdicts.json 記判定）")
