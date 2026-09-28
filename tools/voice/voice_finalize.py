# -*- coding: utf-8 -*-
r"""收尾：每句挑最好的一版 → 修頭尾靜音 → 響度統一（播報員加迴音）→ 單聲道 mp3 → voice.json → 試聽檔。

用法（系統 Python）：python tools\voice\voice_finalize.py [--no-asr]
- 每句的候選＝vids\_audio\voice_work\<群組>\try*\clips\<id>.wav（切得合理的才算），挑念錯分數最低的；
  tools\voice\verdicts.json 可以人工改判（例如讀音轉換造成的假錯）。
- 成品：public\voice\<角色>\<id>.mp3（24 kHz、48 kbps），public\voice\voice.json（事件→音檔清單）。
- 試聽：vids\_audio\配音試聽.mp3（依角色串起來，每句之間 0.4 秒空白）＋ 配音試聽_清單.txt
  （第幾秒是哪一句、原稿、成品 mp3 再回轉一次的結果）。
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
PROJ = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
WORK = PROJ / "vids" / "_audio" / "voice_work"
VOUT = PROJ / "public" / "voice"
TMP = WORK / "_final_tmp"
S = json.loads((VOUT / "script.json").read_text(encoding="utf-8"))
VERD = json.loads((HERE / "verdicts.json").read_text(encoding="utf-8"))
PICKS = json.loads((HERE / "picks.json").read_text(encoding="utf-8")) if (HERE / "picks.json").exists() else {}
NO_ASR = "--no-asr" in sys.argv
if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)

ROLE_INFO = {  # 優先順序：播報員＞魔王＞球球＞村貓＞小兵；volume＝建議播放音量（0～1，各角色響度已先統一過）
    "announcer": (5, 1.0), "drum_tanuki": (4, 1.0), "orange_king": (4, 1.0), "frog_daimyo": (4, 1.0),
    "tanuki_lord": (4, 1.0), "roomba_king": (4, 1.0), "iron_claw": (4, 1.0), "qiuqiu": (3, 0.9),
    "villager1": (2, 0.85), "villager2": (2, 0.85), "villager3": (2, 0.85), "grunt": (1, 0.7)}
EVENT_HINT = {
    "fire": "丟東西很頻繁：建議約三成機率才喊、同一種喊聲 0.6 秒內不重播；按住連丟時不要每發都喊",
    "claw": "同上，約四成機率",
    "jump": "約三成機率，二段跳不喊",
    "notice": "小兵發現你：同一時間只放一句、全場每 4 秒最多一次，避免吵",
    "captiveThank": "村貓被救時隨機挑一隻村貓的聲音（甲乙丙），同一隻村貓的謝謝跟給道具用同一個聲音",
    "captiveGive": "跟上一句同一隻村貓的聲音",
    "continueCount:10": "遊戲的接關倒數目前畫面上從 9 開始（CONTINUE_SECONDS=10、顯示 ceil-1），10 這句可不用",
    "bossPhase:drum_tanuki": "太鼓狸是中魔王，遊戲目前沒有第二階段；可改在血量剩一半時播",
    "bossPhase:roomba_king": "掃地機王是中魔王，遊戲目前沒有第二階段；可改在血量剩一半時播",
    "extraLife": "遊戲目前沒有加命道具，先備著",
}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def dur_of(p):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).stdout)


def loudness(p):
    """短句直接量整合響度不準（量測區塊 0.4 秒），把句子接成四遍再量。"""
    r = run(["ffmpeg", "-hide_banner", "-stream_loop", "3", "-i", str(p), "-af", "ebur128=framelog=quiet", "-f", "null", "-"])
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    return float(m[-1]) if m else None


def peak(p):
    m = re.search(r"max_volume: (-?[\d.]+) dB", run(["ffmpeg", "-hide_banner", "-i", str(p), "-af", "volumedetect",
                                                     "-f", "null", "-"]).stderr)
    return float(m.group(1)) if m else None


def is_bad(line, r, tryn):
    v = VERD.get(line["id"])
    if v and v.get("try", 0) == tryn:
        return not v["ok"]
    if line.get("kiai"):
        return not r.get("hyp")
    return (r.get("pinyin_cer") if line["lang"] == "zh" else r.get("kana_cer", 1)) > (0.15 if line["lang"] == "zh" else 0.25)


def candidates(line):
    out = []
    for tdir in sorted((WORK / line["group"]).glob("try*"), key=lambda p: int(p.name[3:])):
        clip, ck, sp = tdir / "clips" / f"{line['id']}.wav", tdir / "check_out.json", tdir / "split.json"
        if not (clip.exists() and ck.exists() and sp.exists()):
            continue
        spl = json.loads(sp.read_text(encoding="utf-8"))["lines"].get(line["id"])
        res = json.loads(ck.read_text(encoding="utf-8")).get(line["id"])
        if not spl or not spl["ok"] or not res:
            continue
        tryn = int(tdir.name[3:])
        job = json.loads((tdir / "job.json").read_text(encoding="utf-8"))
        sent = next(x["tts"] for x in job["lines"] if x["id"] == line["id"])  # 這一版實際送去念的文字
        v = VERD.get(line["id"])
        out.append({"try": tryn, "clip": clip, "res": res, "bad": is_bad(line, res, tryn), "sent": sent,
                    "doubt": bool(v and v.get("try", 0) == tryn and v.get("doubt"))})
    return out


done, pending, report = [], [], {}
for line in S["lines"]:
    cands = candidates(line)
    if not cands:
        pending.append(line["id"])
        continue
    if line["id"] in PICKS:
        c = next(x for x in cands if x["try"] == PICKS[line["id"]])
    else:
        c = min(cands, key=lambda x: (x["bad"], x["res"]["score"] if x["res"]["score"] is not None else 0, x["try"]))
    G = S["groups"][line["group"]]
    role = G["role"]
    (VOUT / role).mkdir(exist_ok=True)
    mp3 = VOUT / role / f"{line['id']}.mp3"
    t1 = TMP / f"{line['id']}_trim.wav"
    trim = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01:detection=peak,areverse,"
            "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04:detection=peak,areverse")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(c["clip"]), "-af", trim, str(t1)])
    if dur_of(t1) < 0.08:  # 修過頭（整句被當成靜音）就用原切片
        shutil.copy(c["clip"], t1)
    if G.get("fx") == "echo":  # 播報員：短迴音，像街機裡的大會場；先加迴音再量響度（aecho 本身會把音量壓低約 6 dB）
        t2 = TMP / f"{line['id']}_fx.wav"
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(t1), "-af",
             "apad=pad_dur=0.35,aecho=0.8:0.6:60|120:0.25|0.12", "-c:a", "pcm_f32le", str(t2)])
        t1 = t2
    L = loudness(t1)
    gain = G["lufs"] - L if L is not None else 0.0
    t3 = TMP / f"{line['id']}_lvl.wav"
    for it in range(3):  # 限幅會把峰值多的句子壓小聲，量一次、補差額，最多補三輪、最多多加 4 dB
        chain = [f"volume={gain:.2f}dB", "alimiter=limit=0.75:level=false",
                 "afade=t=in:d=0.005,areverse,afade=t=in:d=0.025,areverse"]
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(t1), "-af", ",".join(chain), "-c:a", "pcm_f32le", str(t3)])
        L3 = loudness(t3)
        if L3 is None or abs(G["lufs"] - L3) < 0.5:
            break
        gain = min(gain + (G["lufs"] - L3), (G["lufs"] - L if L is not None else 0.0) + 4.0)
    r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(t3), "-ac", "1", "-ar", "24000",
             "-c:a", "libmp3lame", "-b:a", "48k", "-map_metadata", "-1", str(mp3)])
    if r.returncode:
        sys.exit(f"{line['id']} 轉檔失敗：{r.stderr[-300:]}")
    report[line["id"]] = {"try": c["try"], "bad": c["bad"], "doubt": c["doubt"], "sent": c["sent"],
                          "score": c["res"]["score"], "hyp_clip": c["res"]["hyp"],
                          "tries": len(cands), "dur": round(dur_of(mp3), 2), "lufs": loudness(mp3), "peak_db": peak(mp3),
                          "file": f"voice/{role}/{line['id']}.mp3", "bytes": mp3.stat().st_size}
    done.append(line)
    print(f"{line['id']:16s} try{c['try']} {'✗待重生' if c['bad'] else '合格'}  {report[line['id']]['dur']:.2f}s "
          f"{report[line['id']]['lufs']} LUFS  峰值 {report[line['id']]['peak_db']} dB", flush=True)

# 成品再回轉一次（清單要列的是交付檔的回轉結果）
if done and not NO_ASR:
    items = [{"id": l["id"], "wav": str(VOUT / S["groups"][l["group"]]["role"] / f"{l['id']}.mp3"), "lang": l["lang"],
              "ref": l["text"], "reading": l.get("reading", ""), "alt_reading": l.get("alt_reading", []),
              "kiai": l.get("kiai", False)} for l in done]
    cf, of = TMP / "final_check.json", TMP / "final_check_out.json"
    cf.write_text(json.dumps({"items": items, "out": str(of)}, ensure_ascii=False), encoding="utf-8")
    subprocess.run([sys.executable, str(HERE / "voice_check.py"), str(cf)], stdout=subprocess.DEVNULL)
    fin = json.loads(of.read_text(encoding="utf-8")) if of.exists() else {}
    for k, v in fin.items():
        report[k]["hyp_final"] = v["hyp"]
        report[k]["score_final"] = v["score"]

# voice.json
events, say = {}, {}
for l in done:
    G = S["groups"][l["group"]]
    role = G["role"]
    pri, vol = ROLE_INFO[role]
    if l.get("kiai"):
        vol = 0.7
    lst_ = events.setdefault(l["event"], [])  # 同一事件可能有好幾個角色（例如任務完成：播報員＋球球）
    ev = next((x for x in lst_ if x["role"] == role), None)
    if ev is None:
        ev = {"role": role, "priority": pri, "volume": vol, "clips": []}
        lst_.append(ev)
        lst_.sort(key=lambda x: -x["priority"])
    ev["clips"].append({"id": l["id"], "file": report[l["id"]]["file"], "text": l["text"], "variant": l["variant"],
                        "dur": report[l["id"]]["dur"], "ok": not report[l["id"]]["bad"],
                        **({"doubt": True} if report[l["id"]]["doubt"] else {})})
    if l["event"] in EVENT_HINT:
        ev["hint"] = EVENT_HINT[l["event"]]
    if l.get("in_game"):
        say[l["text"]] = l["event"]
roles = {}
for gk, G in S["groups"].items():
    r = roles.setdefault(G["role"], {"name": G["name"].split("（")[0], "voices": {}, "priority": ROLE_INFO[G["role"]][0],
                                     "volume": ROLE_INFO[G["role"]][1]})
    r["voices"][G["lang"]] = G["voice"]
vj = {"version": "2026-09-27", "format": "mp3 單聲道 24 kHz 48 kbps；路徑相對於網站根目錄（public）",
      "priority_order": ["announcer", "boss", "qiuqiu", "villager", "grunt"],
      "priority_note": "數字越大越優先：同時要講話時，新的一句優先順序比正在講的高才打斷；同順序不打斷、直接略過",
      "roles": roles,
      "events_note": "events[事件] 是一串「角色＋可用音檔」，已照優先順序排好；clips 裡隨機挑一個（ok=false 的先別用）。"
                     "同一事件有兩個角色時（任務完成、打倒魔王：播報員喊完球球再講），可以依序播或只播第一個；"
                     "村貓的 captiveThank／captiveGive 有甲乙丙三個角色：每隻被救的村貓隨機分到一個，謝謝跟給道具用同一個角色",
      "events": events,
      "say": say, "say_note": "遊戲裡 w.say(敵人, 字幕) 顯示這些字幕時，查 events[say[字幕]] 播同一句（字幕跟配音一字不差）",
      "pending": pending, "pending_note": "還沒生成的句子（額度用完），檔案還不存在"}
(VOUT / "voice.json").write_text(json.dumps(vj, ensure_ascii=False, indent=1), encoding="utf-8")
(HERE / "_final_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

# 試聽檔：依群組順序串起來，每句之間 0.4 秒空白
gap = TMP / "gap.wav"
run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.4", str(gap)])
lst, rows, t = [], [], 0.0
order = list(S["groups"].keys())
for l in sorted(done, key=lambda x: order.index(x["group"])):
    w = TMP / f"{l['id']}_dec.wav"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(VOUT / S["groups"][l["group"]]["role"] / f"{l['id']}.mp3"),
         "-ar", "24000", "-ac", "1", str(w)])
    d = dur_of(w)
    rp = report[l["id"]]
    rows.append(f"{int(t // 60):02d}:{t % 60:05.2f}｜{S['groups'][l['group']]['name']}｜{l['id']}｜原稿「{l['text']}」"
                + (f"（念：{rp['sent']}）" if rp["sent"] != l["text"] else "")
                + f"｜回轉「{rp.get('hyp_final', rp['hyp_clip'])}」｜"
                + ("待重生" if rp["bad"] else "合格（有疑慮）" if rp["doubt"] else "合格")
                + (f"｜第 {rp['try'] + 1} 版" if rp["try"] else ""))
    lst += [f"file '{w.as_posix()}'", f"file '{gap.as_posix()}'"]
    t += d + 0.4
(TMP / "concat.txt").write_text("\n".join(lst), encoding="utf-8")
prev = PROJ / "vids" / "_audio" / "配音試聽.mp3"
r = run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(TMP / "concat.txt"),
         "-c:a", "libmp3lame", "-b:a", "64k", str(prev)])
if r.returncode:
    sys.exit(r.stderr[-400:])
head = [f"球球大冒險 配音試聽（{len(done)} 句，共 {t:.1f} 秒；每句之間 0.4 秒空白）",
        "格式：時間｜角色｜編號｜原稿（念：實際送去念的文字）｜回轉（成品 mp3 再用語音辨識轉回文字）｜判定",
        "回轉只能抓大錯，好不好聽要人耳聽。"]
if pending:
    head.append(f"還沒生成（額度用完）：{len(pending)} 句：{'、'.join(pending)}")
(PROJ / "vids" / "_audio" / "配音試聽_清單.txt").write_text("\n".join(head + [""] + rows) + "\n", encoding="utf-8")
tot = sum(v["bytes"] for v in report.values())
print(f"\n完成 {len(done)} 句（待重生 {sum(v['bad'] for v in report.values())}）、還沒生成 {len(pending)} 句；"
      f"mp3 合計 {tot / 1024:.0f} KB；試聽 {t:.1f} 秒 → {prev}")
