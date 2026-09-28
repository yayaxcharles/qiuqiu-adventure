# -*- coding: utf-8 -*-
r"""球球大冒險配音：一個聲音（群組）的台詞併成一次 Gemini 請求，存整批原檔。

改寫自 E:\AI\voice-clone-v2\audio_gemini.py（原檔不動）：同一個模型、同一種讀金鑰方式、同一套卡住限時與額度判斷；
差別是用內建聲音＋風格提示（speech_metadata style），而且每一次真的送出的請求都記在 public/voice/requests_log.json
（只記時間、群組、字數、結果，不記金鑰），總數到 30 次就拒絕再送（2026-09-27 使用者裁定）。

用法（Gemini 的 venv）：
  E:\AI\gemini-tts-eval\venv\Scripts\python.exe tools\voice\voice_gen.py --group announcer [--ids a,b,c] [--try 1]
輸出：vids\_audio\voice_work\<群組>\try<N>\raw.wav（已轉 24 kHz 單聲道）＋ job.json（要切的每一句）
"""
import argparse, base64, datetime, json, os, re, subprocess, sys, threading, time, winreg
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from google import genai

PROJ = Path(__file__).resolve().parents[2]
SCRIPT = PROJ / "public" / "voice" / "script.json"
LOG = PROJ / "public" / "voice" / "requests_log.json"
WORK = PROJ / "vids" / "_audio" / "voice_work"
MODEL = "gemini-3.8-flash-tts"
CAP = 30

p = argparse.ArgumentParser()
p.add_argument("--group", required=True)
p.add_argument("--ids", default="", help="只重生這幾句（逗號分隔）；空白＝整組")
p.add_argument("--try", dest="tryn", type=int, default=0)
a = p.parse_args()

S = json.loads(SCRIPT.read_text(encoding="utf-8"))
G = S["groups"][a.group]
lines = [l for l in S["lines"] if l["group"] == a.group]
if a.ids:
    want = a.ids.split(",")
    lines = [l for l in lines if l["id"] in want]
    assert len(lines) == len(want), f"找不到：{set(want) - {l['id'] for l in lines}}"


def end_punct(t):
    return t if re.search(r"[。！？!?…～〜]$", t) else t + "。"


text = "\n\n".join(end_punct(l["tts"]) for l in lines)
out_dir = WORK / a.group / f"try{a.tryn}"
out_dir.mkdir(parents=True, exist_ok=True)
raw = out_dir / "raw.wav"
if raw.exists():
    sys.exit(f"{raw} 已存在，換 --try 編號")


def load_log():
    return json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else {"cap": CAP, "requests": []}


def log_request(kind, chars, result):
    d = load_log()
    d["requests"].append({"time": datetime.datetime.now().isoformat(timespec="seconds"), "group": a.group,
                          "role": G["name"], "try": a.tryn, "kind": kind, "chars": chars,
                          "lines": len(lines), "result": result})
    d["used"] = len(d["requests"])
    LOG.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def used():
    return len(load_log()["requests"])


with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    API_KEY = winreg.QueryValueEx(k, "GEMINI_API_KEY")[0]
client = genai.Client(api_key=API_KEY)


def with_deadline(fn, secs):
    box = {}
    def run():
        try:
            box["r"] = fn()
        except Exception as e:
            box["e"] = e
    t = threading.Thread(target=run, daemon=True)
    t.start(); t.join(secs)
    if t.is_alive():
        raise TimeoutError(f"{secs} 秒沒回應")
    if "e" in box:
        raise box["e"]
    return box["r"]


def daily_quota_hit():
    """同 audio_gemini.py：卡住時改用舊入口問一次額度（這一問本身也算一次請求，照樣記帳）。"""
    if used() >= CAP:
        return False
    code = ("import sys\nfrom google import genai\nc = genai.Client()\n"
            "c.models.generate_content(model=sys.argv[1], contents='好。', "
            "config={'response_modalities': ['AUDIO'], 'speech_config': {'voice_config': "
            "{'prebuilt_voice_config': {'voice_name': 'Kore'}}}})")
    try:
        r = subprocess.run([sys.executable, "-c", code, MODEL], env={**os.environ, "GEMINI_API_KEY": API_KEY},
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    except subprocess.TimeoutExpired:
        log_request("quota_probe", 2, "timeout")
        return False
    hit = bool(re.search(r"per.?day", r.stderr, re.I))
    log_request("quota_probe", 2, "daily_quota" if hit else ("ok" if r.returncode == 0 else r.stderr[-80:]))
    return hit


content = {"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": G["style"]}]}
print(f"{a.group}（{G['name']}／{G['voice']}）{len(lines)} 句、{len(text)} 字；已用 {used()}/{CAP} 次請求")
print(text)
for attempt in range(3):
    if used() >= CAP:
        sys.exit(f"已用滿 {CAP} 次請求，停止")
    try:
        t0 = time.time()
        it = with_deadline(lambda: client.interactions.create(
            model=MODEL,
            input=[{"type": "user_input", "content": [content]}],
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": G["voice"]}]}), 120)
        tmp = out_dir / "raw_src.wav"
        tmp.write_bytes(base64.b64decode(it.output_audio.data))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-ar", "24000", "-ac", "1", str(raw)],
                       check=True)
        tmp.unlink()
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                    str(raw)], capture_output=True, text=True).stdout)
        log_request("tts", len(text), f"ok {dur:.1f}s")
        print(f"完成：{dur:.1f} 秒，花 {time.time() - t0:.0f} 秒")
        break
    except Exception as e:
        msg = str(e)
        if isinstance(e, TimeoutError):
            log_request("tts", len(text), "timeout")
            if daily_quota_hit():
                sys.exit("今天的額度用完了（每天 100 次，約台灣早上 8 點重置）")
            client = genai.Client(api_key=API_KEY)
        else:
            log_request("tts", len(text), "error " + re.sub(r"\s+", " ", msg)[:120])
        if "402" in msg or "prepayment credits are depleted" in msg:
            sys.exit("Gemini 預付額度用完了")
        if re.search(r"per.?day", msg, re.I):
            sys.exit(f"今天的額度用完了：{msg[:160]}")
        if isinstance(e, TimeoutError) or any(c in msg for c in ("429", "500", "503", "RESOURCE_EXHAUSTED")):
            print(f"暫時錯誤，{20 * (attempt + 1)} 秒後重試：{msg[:160]}")
            time.sleep(20 * (attempt + 1))
            continue
        sys.exit(f"失敗：{msg[:300]}")
else:
    sys.exit("重試三次仍失敗")

job = {"group": a.group, "lang": G["lang"], "split": G["split"], "wav": str(raw),
       "lines": [{"id": l["id"], "tts": l["tts"]} for l in lines],
       "outs": [str(out_dir / "clips" / f"{l['id']}.wav") for l in lines]}
(out_dir / "clips").mkdir(exist_ok=True)
(out_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"→ {out_dir}")
