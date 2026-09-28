# -*- coding: utf-8 -*-
r"""把一次請求生出的整批原檔切回每一句。

改寫自 E:\AI\voice-clone-v2\split_by_align.py（原檔不動）：
- align 模式：stable-ts 把原稿逐字對上音檔（日文 language=ja、中文 zh），在「上一句最後一個字」與
  「下一句第一個字」之間切，切點往 0.5 秒內最近的短停頓靠，再用語音偵測收緊頭尾。
- gaps 模式（球球的氣合聲，沒有字可以對）：找出有聲音的區段，把最短的空檔合併，直到剛好剩下句數那麼多段。
  段數不夠就判失敗。
每句各自判斷切得合不合理，結果寫 split.json；有任何一句不合理，結束碼 1。

用法：E:\AI\stable-ts\venv\Scripts\python.exe tools\voice\voice_split.py <job.json> [--mode align|gaps]
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

job_path = Path(sys.argv[1])
job = json.loads(job_path.read_text(encoding="utf-8"))
mode = sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else job["split"]
wav, lines, outs, lang = job["wav"], job["lines"], job["outs"], job["lang"]
texts = [l["tts"] for l in lines]
N = len(texts)


def _norm(s):
    return re.sub(r"[\s，。？！；：、「」『』（）…—－\-,.?!;:()'\"～〜・ー]+", "", s)


def ffdur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                 str(p)], capture_output=True, text=True).stdout)


dur = ffdur(wav)


def silences(noise="-40dB", d=0.12):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", f"silencedetect=noise={noise}:d={d}",
                        "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    if len(en) < len(st):
        en.append(dur)
    return list(zip(st, en))


def islands(noise="-40dB", d=0.12):
    sil = silences(noise, d)
    out, t = [], 0.0
    for s, e in sil:
        if s > t:
            out.append((t, s))
        t = e
    if t < dur:
        out.append((t, dur))
    return [(a, b) for a, b in out if b - a >= 0.06]


FADE = "afade=t=in:d=0.01,areverse,afade=t=in:d=0.03,areverse"


def write(spans):
    res = {}
    for (st, en), o, l in zip(spans, outs, lines):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ss", f"{st:.3f}", "-to", f"{en:.3f}",
                        "-af", FADE, "-c:a", "pcm_s16le", o], check=True)
        d = ffdur(o)
        n = max(1, len(_norm(l["tts"])))
        ok = 0.12 <= d <= 0.5 * n + 2.2
        res[l["id"]] = {"ok": ok, "start": round(st, 3), "end": round(en, 3), "dur": round(d, 3),
                        **({} if ok else {"reason": f"長度不合理：{d:.2f} 秒對 {n} 字"})}
    return res


def split_gaps():
    for noise in ("-40dB", "-35dB", "-45dB", "-30dB"):
        isl = islands(noise, 0.10)
        if len(isl) >= N:
            break
    if len(isl) < N:
        return None, f"有聲區段只有 {len(isl)} 段，比句數 {N} 少"
    while len(isl) > N:  # 把最短的空檔合併
        gaps = [isl[i + 1][0] - isl[i][1] for i in range(len(isl) - 1)]
        i = gaps.index(min(gaps))
        isl[i:i + 2] = [(isl[i][0], isl[i + 1][1])]
    spans = [(max(0.0, a - 0.03), min(dur, b + 0.08)) for a, b in isl]
    return spans, f"{noise} 找到 {N} 段"


def split_align():
    import stable_whisper
    model = stable_whisper.load_faster_whisper("large-v3", device="cuda", compute_type="float16")
    result = model.align(wav, "".join(texts), language=lang)
    times = []
    for w in result.all_words():
        n = len(_norm(w.word))
        times += [(w.start + (w.end - w.start) * k / n, w.start + (w.end - w.start) * (k + 1) / n) for k in range(n)]
    lens = [len(_norm(t)) for t in texts]
    if len(times) != sum(lens):
        return None, f"字數對不上：對齊 {len(times)}／原稿 {sum(lens)}"
    al, i = [], 0  # 每句對齊出的起訖
    for n in lens:
        al.append((times[i][0], times[i + n - 1][1]))
        i += n
    # 有聲區段＋對齊的「依序配對」：2026-09-27 播報員那批，對齊把「じゅう！」擠進下一個數字裡（起訖顛倒），
    # 但有聲區段本身很乾淨（句與句之間都有停頓）。所以用有聲區段當切點，對齊時間只拿來決定哪幾段屬於哪一句。
    isl = islands("-40dB", 0.10)
    # 兩句連在一起沒停頓：對齊的交界若落在某段中間、兩邊都夠長，就在交界把那段切開
    for k in range(N - 1):
        c = (al[k][1] + al[k + 1][0]) / 2
        for j, (a0, b0) in enumerate(isl):
            if a0 + 0.15 < c < b0 - 0.15:
                isl[j:j + 1] = [(a0, c), (c, b0)]
                break
    M = len(isl)
    if M < N:
        return None, f"有聲區段 {M} 段，比句數 {N} 少"
    INF = float("inf")
    # dp[k][j]：前 k 句用掉前 j 段的最小代價；每句拿連續的一段或多段，代價＝頭尾跟對齊時間差多少
    dp = [[INF] * (M + 1) for _ in range(N + 1)]
    bk = [[0] * (M + 1) for _ in range(N + 1)]
    dp[0][0] = 0.0
    for k in range(1, N + 1):
        s, e = al[k - 1]
        for j in range(k, M - (N - k) + 1):
            for i0 in range(k - 1, j):
                if dp[k - 1][i0] == INF:
                    continue
                c = dp[k - 1][i0] + abs(isl[i0][0] - s) + abs(isl[j - 1][1] - e)
                if c < dp[k][j]:
                    dp[k][j], bk[k][j] = c, i0
    runs, j = [], M
    for k in range(N, 0, -1):
        i0 = bk[k][j]
        runs.append((i0, j))
        j = i0
    runs.reverse()
    spans = []
    for k, (i0, j) in enumerate(runs):
        a0, b0 = isl[i0][0], isl[j - 1][1]
        lo = (isl[i0 - 1][1] + a0) / 2 if i0 > 0 else 0.0  # 不能超過前後兩段空檔的中點
        hi = (b0 + isl[j][0]) / 2 if j < M else dur
        spans.append((max(lo, a0 - 0.05), min(hi, b0 + 0.12)))
    far = [lines[k]["id"] for k, (st, en) in enumerate(spans) if en < al[k][0] - 1.0 or st > al[k][1] + 1.0]
    return spans, f"對齊＋有聲區段 {M} 段配對" + (f"；跟對齊差超過 1 秒：{far}" if far else "")


spans, info = (split_gaps() if mode == "gaps" else split_align())
if spans is None and mode == "align":
    print(f"對齊失敗（{info}），改用空檔切", flush=True)
    spans, info2 = split_gaps()
    info = f"{info}；改用空檔切：{info2}"
    mode = "gaps(退路)"
if spans is None:
    res, ok = {}, False
else:
    for k, l in enumerate(lines):  # 人工指定的切點（job.json 的 force：{id: [起, 訖]}，單位秒）
        if l["id"] in job.get("force", {}):
            spans[k] = tuple(job["force"][l["id"]])
            info += f"；{l['id']} 用人工切點"
    res = write(spans)
    ok = all(v["ok"] for v in res.values())
out = {"ok": ok, "mode": mode, "info": info, "raw_dur": round(dur, 2), "lines": res}
(job_path.parent / "split.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{job['group']}：{mode}，{info}；{sum(v['ok'] for v in res.values())}/{N} 句長度合理", flush=True)
for k, v in res.items():
    print(f"  {k:16s} {v['start']:7.2f}–{v['end']:7.2f}  {v['dur']:.2f}s {'' if v['ok'] else '✗ ' + v['reason']}")
sys.stdout.flush()
os._exit(0 if ok else 1)  # 跳過收尾：語音辨識套件在 Windows 關閉時偶爾當掉
