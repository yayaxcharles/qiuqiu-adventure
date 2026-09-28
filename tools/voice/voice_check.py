# -*- coding: utf-8 -*-
r"""念錯檢查：每句用 faster-whisper large-v3 回轉文字，跟原稿比對。

改寫自 E:\AI\voice-clone-v2\asr_check.py（原檔不動），多了日文：
- 中文（zh）：跟原檔一樣，轉簡體、數字轉中文讀法後算字錯率，另算拼音（含聲調）錯率抓破音字。
- 日文（ja）：回轉結果用 pykakasi 轉平假名，跟台詞表裡人工寫好的讀音（reading）比；
  濁音半濁音、促音、長音符號都先拿掉再比（回轉常把「ぎり」寫成「きり」這類，不算念錯）。
- 氣合聲（kiai）：只記回轉結果，不打分數（「はっ！」這種沒有標準答案）。
短句前後各補 0.3 秒靜音再回轉，減少語音辨識亂補字。

用法（系統 Python）：python tools\voice\voice_check.py <check.json>
check.json：{"items":[{"id","wav","lang","ref","reading"?,"alt_reading"?,"kiai"?}], "out": 結果路徑}
"""
import io
import json
import re
import sys
import unicodedata

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from opencc import OpenCC
from pypinyin import Style, lazy_pinyin
import pykakasi

cc = OpenCC("t2s")
kks = pykakasi.kakasi()
DIG = "零一二三四五六七八九"


def _int2zh(n):
    if n < 10:
        return DIG[n]
    if n < 20:
        return "十" + (DIG[n % 10] if n % 10 else "")
    if n < 100:
        return DIG[n // 10] + "十" + (DIG[n % 10] if n % 10 else "")
    return "".join(DIG[int(d)] for d in str(n))


def zh_norm(s):
    s = cc.convert(s.lower())
    s = re.sub(r"\d+", lambda m: _int2zh(int(m.group(0))), s)
    return re.sub(r"[，。、！？；：,\.!\?;:\s「」『』（）()%％—…\-'\"‘’“”`｜|～~]", "", s)


JA_NUM = {0: "ぜろ", 1: "いち", 2: "に", 3: "さん", 4: "よん", 5: "ご", 6: "ろく", 7: "なな", 8: "はち", 9: "きゅう",
          10: "じゅう"}


def ja_num(n):
    if n in JA_NUM:
        return JA_NUM[n]
    if n < 100:
        t, o = divmod(n, 10)
        return (JA_NUM[t] if t > 1 else "") + "じゅう" + (JA_NUM[o] if o else "")
    return "".join(JA_NUM[int(d)] for d in str(n))


def ja_kana(s):
    s = re.sub(r"\d+", lambda m: ja_num(int(m.group(0))), s)
    return "".join(x["hira"] for x in kks.convert(s))


def ja_norm(kana):
    kana = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in kana)  # 片假名→平假名
    kana = unicodedata.normalize("NFD", kana)
    kana = "".join(c for c in kana if unicodedata.category(c) != "Mn")  # 拿掉濁點半濁點
    kana = unicodedata.normalize("NFC", kana)
    kana = kana.replace("っ", "").replace("ー", "")
    small = str.maketrans("ぁぃぅぇぉゃゅょゎ", "あいうえおやゆよわ")
    kana = kana.translate(small)
    return re.sub(r"[^\u3041-\u309f]", "", kana)


def cer(r, h):
    m, n = len(r), len(h)
    if m == 0:
        return 0.0 if n == 0 else 1.0
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return dp[n] / m


def pinyin(s):
    return lazy_pinyin(s, style=Style.TONE3, neutral_tone_with_five=True)


spec = json.load(open(sys.argv[1], encoding="utf-8"))
model = WhisperModel("large-v3", device="cuda", compute_type="float16")
pad = np.zeros(int(16000 * 0.3), dtype=np.float32)
results = {}
for it in spec["items"]:
    audio = np.concatenate([pad, decode_audio(it["wav"], sampling_rate=16000), pad])
    segs, _ = model.transcribe(audio, language=it["lang"], beam_size=5, vad_filter=False,
                               condition_on_previous_text=False, without_timestamps=True)
    hyp = "".join(s.text for s in segs).strip()
    r = {"hyp": hyp}
    if it["lang"] == "zh":
        rn, hn = zh_norm(it["ref"]), zh_norm(hyp)
        r.update(cer=round(cer(rn, hn), 3), pinyin_cer=round(cer(pinyin(rn), pinyin(hn)), 3))
        r["score"] = r["pinyin_cer"]
    else:
        hk = ja_norm(ja_kana(hyp))
        refs = [it["reading"]] + it.get("alt_reading", [])
        best = min(cer(ja_norm(x), hk) for x in refs)
        r.update(hyp_kana=ja_kana(hyp), kana_cer=round(best, 3))
        r["score"] = r["kana_cer"]
    if it.get("kiai"):
        r["score"] = None
    results[it["id"]] = r
    sc = "（氣合聲不打分）" if r["score"] is None else f"錯率 {r['score']:.0%}"
    print(f"{it['id']:16s} {sc:10s} 原稿「{it['ref']}」→ 回轉「{hyp}」", flush=True)

json.dump(results, open(spec["out"], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done ->", spec["out"])
