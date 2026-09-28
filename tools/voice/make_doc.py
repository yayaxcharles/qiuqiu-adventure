# -*- coding: utf-8 -*-
r"""依 script.json＋收尾結果產生 docs\2026-09-27_配音台詞.md（台詞表＋聲音選擇＋進度）。每次收尾後重跑即可更新。
用法（系統 Python）：python tools\voice\make_doc.py
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
PROJ = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
S = json.loads((PROJ / "public" / "voice" / "script.json").read_text(encoding="utf-8"))
REP = json.loads((HERE / "_final_report.json").read_text(encoding="utf-8")) if (HERE / "_final_report.json").exists() else {}
LOG = json.loads((PROJ / "public" / "voice" / "requests_log.json").read_text(encoding="utf-8"))
VERD = json.loads((HERE / "verdicts.json").read_text(encoding="utf-8"))

VOICE_WHY = {
    "announcer": "Google 內建日文聲音目錄裡描述為「65 歲、東京腔、有活力、色彩豐富、語速快」的男聲",
    "qiuqiu_kiai": "內建多語聲音 Leda（年輕、活潑、音調偏高），用風格提示要它演「女聲優配的十歲小男孩」",
    "qiuqiu_line": "同上，跟日文氣合聲用同一個聲音，球球前後才是同一個人",
    "villager1": "Sulafat（溫暖、親切的女聲）→ 溫柔大嬸",
    "villager2": "Laomedeia（高音、開朗的女聲）→ 小孩",
    "villager3": "Achird（友善、溫暖的低音男聲）→ 豪爽大叔",
    "drum_tanuki": "Puck（開朗、有活力的男聲）→ 廟會大叔",
    "orange_king": "Fenrir（激動、高能量的男聲）→ 容易暴怒的自大國王",
    "frog_daimyo": "Algieba（平順、從容的低音男聲）→ 慢條斯理的大名",
    "tanuki_lord": "Enceladus（帶氣音、輕聲的低音男聲）→ 壓低聲音的狡猾老狸",
    "roomba_king": "Pulcherrima（中性、直接的聲音）→ 沒有性別感的機器人",
    "iron_claw": "Algenib（沙啞、厚重的低音男聲）→ 低沉的機械貓",
    "grunt": "Orus（堅定、嚴肅的男聲）→ 粗魯的山賊小兵",
}
STYLE_ZH = {
    "announcer": "（英文原文）熱血的日本街機播報員，像九〇年代橫向射擊街機那種大聲的旁白；每句都爆發、低沉有力、短促；倒數數字要緊張；結尾是「……」的（任務失敗）要沉重緩慢；每句之間停一秒；標準東京腔。",
    "qiuqiu_kiai": "（英文原文）可愛有活力的十歲少年忍者貓，女聲優配的動畫少年音；這些是丟、揮爪、跳、受傷、倒下的短氣合聲，每聲短促、有出力感；結尾是「……」的要虛脫拉長；每句之間停一秒；自然的日文。",
}

out = ["# 球球大冒險 配音台詞表（2026-09-27）", "",
       "使用者 09-27 裁定：**喊聲用日文、台詞用中文（台灣口音）、用 Gemini 內建聲音（不用本人克隆聲）**；"
       "付費第一級每天只有 100 次請求、跟講課影片共用，所以整件事的請求總數壓在 **30 次以內**，"
       "同一個聲音的台詞併成一次請求生，再自動切回每一句。", "",
       "正本是 `public/voice/script.json`（本檔由 `tools/voice/make_doc.py` 依它產生，改台詞改 json 再重跑）。"
       "接進遊戲用的是 `public/voice/voice.json`（事件→音檔清單、優先順序、建議音量）。", ""]

# 進度
used = len(LOG["requests"])
ok_tts = sum(1 for r in LOG["requests"] if r["kind"] == "tts" and r["result"].startswith("ok"))
pend = [l["id"] for l in S["lines"] if l["id"] not in REP]
out += ["## 目前進度", "",
        f"- 請求用了 **{used} 次**（上限 30）：成功生成 {ok_tts} 次，其餘是卡住逾時與額度查詢（保守起見全部算進上限）。",
        f"- 已生成 {len(REP)} 句、還沒生成 {len(pend)} 句。"]
if pend:
    out += ["- 09-27 上午 10:43 當天 100 次額度用完（同一天早上講課影片已經用掉大半），依規定停下。"
            "額度約台灣早上 8 點重置，之後在專案資料夾跑 `python tools\\voice\\run_rest.py` 會從沒做的接著做"
            "（剩 11 個聲音各一次＋播報員重生一次，約 12 次請求）。"]
bad = [k for k, v in REP.items() if v["bad"]]
doubt = [k for k, v in REP.items() if v.get("doubt")]
if bad:
    out.append(f"- 待重生：{'、'.join(bad)}")
if doubt:
    out.append(f"- 有疑慮（先用）：{'、'.join(doubt)}")
out += ["- **沒有人耳聽過**：判斷只靠語音辨識把成品轉回文字、跟原稿比，加上響度數據。好不好聽、像不像角色，要實際聽試聽檔 `vids/_audio/配音試聽.mp3`。", ""]

# 聲音選擇
out += ["## 每個角色用的聲音", "",
        "聲音清單用 `client.voices.list()` 查（`tools/voice/list_voices.py`，存在 `vids/_audio/voice_work/_voices_catalog.json`，"
        "查清單不算語音生成的額度）：內建 2089 個，日文有 115 個、**沒有中文專屬的聲音**，"
        "所以中文台詞用 30 個多語聲音（講課時試過的 Kore 念繁體中文字錯率 0%），再用風格提示要求台灣口音。", "",
        "| 群組 | 角色 | 語言 | 聲音 | 為什麼選它 | 目標響度 |", "|---|---|---|---|---|---|"]
for gk, G in S["groups"].items():
    out.append(f"| {gk} | {G['name']} | {'日文' if G['lang'] == 'ja' else '中文'} | `{G['voice']}` | {VOICE_WHY.get(gk, '')} | {G['lufs']} LUFS |")
out += ["", "### 風格提示（跟台詞一起送出的語氣說明）", ""]
for gk, G in S["groups"].items():
    out.append(f"- **{G['name']}**：{STYLE_ZH.get(gk, G['style'])}")
out.append("")

# 台詞表
out += ["## 台詞表", "",
        "「事件」＝`voice.json` 裡的事件名稱；`say:` 開頭＝遊戲裡已經有這句字幕（`w.say`），配音跟字幕一字不差。"
        "「變化」＝同一事件的第幾個版本，播放時隨機挑。", ""]
for gk, G in S["groups"].items():
    lines = [l for l in S["lines"] if l["group"] == gk]
    out += [f"### {G['name']}（{len(lines)} 句）", ""]
    ja = G["lang"] == "ja"
    out += ["| 編號 | 台詞 | " + ("讀音／中文意思 | " if ja else "") + "事件 | 變化 | 狀態 |",
            "|---|---|" + ("---|" if ja else "") + "---|---|---|"]
    for l in lines:
        r = REP.get(l["id"])
        st = "還沒生成" if not r else ("待重生" if r["bad"] else "合格（有疑慮）" if r.get("doubt") else "合格")
        if r:
            st += f"，回轉「{r.get('hyp_final', r['hyp_clip'])}」"
        note = l.get("note", "")
        if l["id"] in VERD and not note:
            note = VERD[l["id"]]["why"]
        sent = r["sent"] if r else l["tts"]  # 目前這一版實際送去念的文字
        extra = (f"{l.get('reading', '')}／{l.get('zh', '')}" + (f"（送去念：{sent}）" if sent != l["text"] else "")
                 + (f"（下次重生改送：{l['tts']}）" if r and l["tts"] != sent else ""))
        out.append(f"| {l['id']} | {l['text']} | " + (f"{extra} | " if ja else "") + f"`{l['event']}` | {l['variant']} | {st}"
                   + (f"。{note}" if note else "") + " |")
    out.append("")

out += ["## 產線與檔案", "",
        "- `tools/voice/voice_gen.py`（Gemini 環境）：一個群組一次請求，存整批原檔；每次送出都記在 `public/voice/requests_log.json`（只記時間、角色、字數、結果，不記金鑰），滿 30 次拒絕再送。",
        "- `tools/voice/voice_split.py`（stable-ts 環境）：原稿逐字對齊（日文 ja、中文 zh）決定哪幾段聲音屬於哪一句，切點用「有聲區段」的空檔；"
        "球球的氣合聲沒有字可對，直接數有聲區段。09-27 播報員那批，單靠對齊會把「じゅう！」擠進下一個數字，所以改成兩者搭配。可在 job.json 用 `force` 人工指定切點。",
        "- `tools/voice/voice_check.py`（系統 Python）：faster-whisper large-v3 回轉；中文比字錯率＋拼音（含聲調）錯率，日文把回轉結果轉平假名跟人工寫的讀音比。",
        "- `tools/voice/verdicts.json`：分數超標但人工看回轉判定其實念對（多半是讀音轉換把漢字讀錯）或其實念錯的紀錄。",
        "- `tools/voice/voice_finalize.py`：挑每句最好的一版→修頭尾靜音→響度統一（短句接四遍量整合響度；限幅 -2.5 dB 後再補一次音量）→播報員加短迴音→單聲道 mp3 24 kHz 48 kbps→`voice.json`→試聽檔與清單。",
        "- `tools/voice/run_rest.py`：額度重置後接著做剩下的。",
        "- 中間檔（整批原檔、切片、回轉結果）在 `vids/_audio/voice_work/`（不進版控）。",
        "- 講課產線 `E:\\AI\\voice-clone-v2\\` 的原檔都沒動，改寫版都在 `tools/voice/`。", ""]
out += ["## 注意", "",
        "- 「村の猫」的「猫」是日文正字，不是簡體字。",
        "- 太鼓狸、掃地機王是中魔王，遊戲目前沒有第二階段；它們的「換階段」台詞先備著，可改在血量剩一半時播。",
        "- 接關倒數：遊戲畫面從 9 開始倒（`CONTINUE_SECONDS=10`、顯示 `ceil-1`），「十！」可以不用。",
        "- 加命（`extraLife`）遊戲目前沒有這個道具，先備著。",
        "- 中文破音字：台詞裡刻意避開「垃圾」（台灣念ㄌㄜˋㄙㄜˋ）；「脫落」「運轉」「少年仔」這類，語音辨識會自動補成正確的字，念錯聲調抓不到，要人耳確認。", ""]
p = PROJ / "docs" / "2026-09-27_配音台詞.md"
p.write_text("\n".join(out), encoding="utf-8")
print(f"→ {p}（{len(out)} 行）")
