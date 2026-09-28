# -*- coding: utf-8 -*-
r"""除錯用：印出整批原檔的有聲區段（不同門檻）和 stable-ts 對齊出的每句起訖，對照看切點。
用法：E:\AI\stable-ts\venv\Scripts\python.exe tools\voice\debug_islands.py <job.json>
"""
import json, re, subprocess, sys, os
sys.stdout.reconfigure(encoding="utf-8")
job = json.load(open(sys.argv[1], encoding="utf-8"))
wav = job["wav"]


def _norm(s):
    return re.sub(r"[\s，。？！；：、「」『』（）…—－\-,.?!;:()'\"～〜・ー]+", "", s)


dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                           capture_output=True, text=True).stdout)
for noise in ("-50dB", "-40dB", "-30dB"):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", f"silencedetect=noise={noise}:d=0.1", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    isl, t = [], 0.0
    for s, e in zip(st, en + [dur]):
        if s > t: isl.append((round(t, 2), round(s, 2)))
        t = e
    if t < dur: isl.append((round(t, 2), round(dur, 2)))
    print(noise, len(isl), "段：", isl)
import stable_whisper
model = stable_whisper.load_faster_whisper("large-v3", device="cuda", compute_type="float16")
texts = [l["tts"] for l in job["lines"]]
res = model.align(wav, "".join(texts), language=job["lang"])
times = []
for w in res.all_words():
    n = len(_norm(w.word))
    times += [(w.start + (w.end - w.start) * k / n, w.start + (w.end - w.start) * (k + 1) / n) for k in range(n)]
i = 0
for l in job["lines"]:
    n = len(_norm(l["tts"]))
    s, e = times[i][0], times[i + n - 1][1]
    print(f"{l['id']:16s} {s:6.2f}–{e:6.2f}  {l['tts']}")
    i += n
sys.stdout.flush()
os._exit(0)
