# -*- coding: utf-8 -*-
r"""列出 Gemini 內建聲音目錄（只是查清單，不是語音生成請求，不吃每天 100 次的配音額度）。

用法：E:\AI\gemini-tts-eval\venv\Scripts\python.exe tools\voice\list_voices.py
輸出：vids\_audio\voice_work\_voices_catalog.json（約 1 MB、不進版控；只存聲音資料，不存金鑰）
"""
import json
import sys
import winreg
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from google import genai

with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    key = winreg.QueryValueEx(k, "GEMINI_API_KEY")[0]
c = genai.Client(api_key=key)

out, token = [], None
while True:
    r = c.voices.list(type_=["prebuilt"], page_size=1000, page_token=token) if token else \
        c.voices.list(type_=["prebuilt"], page_size=1000)
    for v in r.voices or []:
        d = v.model_dump() if hasattr(v, "model_dump") else dict(v)
        out.append(d)
    token = getattr(r, "next_page_token", None)
    if not token:
        break

p = Path(__file__).resolve().parents[2] / "vids" / "_audio" / "voice_work" / "_voices_catalog.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
print(f"{len(out)} 個內建聲音 → {p}")
langs = {}
for d in out:
    langs.setdefault(d.get("language_code"), 0)
    langs[d.get("language_code")] += 1
print(sorted(langs.items(), key=lambda x: -x[1])[:40])
