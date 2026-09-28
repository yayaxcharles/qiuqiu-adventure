/**
 * 日文配音接到遊戲裡（public/voice/voice.json＋mp3）。字幕照舊是中文：敵人頭上的對話框（w.say）顯示哪句，就播同一句的日文。
 *
 * - 遊戲事件（world.events）、敵人頭上新冒出的對話框、畫面切換（遊戲結束）、接關倒數 → 要講哪一句（這個檔）
 * - 誰先講、要不要打斷（src/audio/voice.ts 的 VoiceDirector）
 * - 真的出聲（這個檔的 WebSink）：跟音效共用同一個 AudioContext，接在靜音開關前面（按 M 一起靜音、錄影一起錄到）；
 *   講話時把配樂壓低；音檔第一次要用才載（進關時先在背景載這一關會用到的角色），不擋開局。
 *
 * 沒有畫面的對話（球球的台詞、播報員）沒有字幕：遊戲沒有現成的對話框可以放，照交辦不另外做新介面。
 */
import type { Enemy, GameEvent } from './entities';
import type { World } from './world';
import { MUSIC_LEVEL } from './audio/engine';
import { VoiceDirector, type VoiceClip, type VoiceData, type VoiceSink } from './audio/voice';
import { audioOut } from './sfx';

/** 連殺幾隻時播報（voice.json 的 combo:N） */
export const COMBO_STEPS = [5, 10, 20, 30, 50];
/** 沒有第二階段的中魔王：血剩一半時講「第二階段」那句（voice.json hint） */
export const HALF_HP_KINDS = ['drum_tanuki', 'roomba_king'];
export const VILLAGERS = ['villager1', 'villager2', 'villager3'];
/** 被救的村貓頭上的字（render.ts 畫的）：配音挑同一句 */
export const THANK_TEXT = '謝謝你！';
export const GIVE_TEXT = '這個給你！';
/** 球球喊聲的機率（voice.json hint：丟東西三成、揮爪四成、跳三成） */
export const KIAI_CHANCE: Record<string, number> = { fire: 0.3, claw: 0.4, jump: 0.3 };

/**
 * voice.json 每個事件在遊戲哪裡觸發（測試逐一對照；寫在這裡的字樣就是下面程式真的叫 say 的事件名）。
 * say:… 與 bossEnter:／bossPhase:（除中魔王半血）是看敵人頭上的對話框觸發，不在這張表。
 */
export const EVENT_TRIGGERS: Record<string, string> = {
  'missionStart:stageN': 'world 事件 missionStart（開關）',
  missionStart: 'missionStart：關卡那句講完接著講',
  missionComplete: 'world 事件 missionComplete：播報員講完換球球',
  bossEnter: 'world 事件 bossEnter（魔王出場警報）',
  bossDown: 'world 事件 bossDown：魔王自己的台詞 → 播報員 → 球球（中魔王；最終魔王接任務完成）',
  'bossDown:<kind>': 'world 事件 bossDown：同時在魔王頭上冒字幕',
  'bossPhase:drum_tanuki/roomba_king': '中魔王血剩一半（頭上冒字幕）',
  'continueCount:N': '接關畫面倒數（game.ts 每跳一個數字）',
  continuePrompt: 'world 事件 continuePrompt',
  gameOver: '畫面切到遊戲結束',
  'pickup:<kind>': 'world 事件 pickup（撿到忍具、副武器）',
  'combo:N': 'world 事件 kill 的連殺數到 5／10／20／30／50',
  allRescued: '這一關最後一隻村貓給完道具',
  fire: 'world 事件 fire（三成、按住連丟不喊）', claw: 'world 事件 claw（四成）', jump: 'player 起跳（三成）',
  playerHurt: 'world 事件 playerHurt', playerDown: 'world 事件 playerDown', respawn: 'world 事件 respawn（重生、接關）',
  captiveFreed: '村貓給完道具後球球講（五成）', captiveThank: 'world 事件 captiveFreed（村貓頭上「謝謝你！」）',
  captiveGive: 'world 事件 captiveGive（村貓頭上「這個給你！」）', notice: 'world 事件 notice（全場每 4 秒最多一次）',
};

/** voice.json 裡刻意不接的事件與原因 */
export const NO_TRIGGER: Record<string, string> = {
  'continueCount:10': '接關倒數畫面上從 9 開始（voice.json hint：10 可不用）',
  extraLife: '遊戲目前沒有加命道具（voice.json hint：先備著）',
};

/** 事件名 → EVENT_TRIGGERS 的哪一條（測試用） */
export function triggerKey(event: string): string | null {
  if (EVENT_TRIGGERS[event]) return event;
  if (/^missionStart:stage\d+$/.test(event)) return 'missionStart:stageN';
  if (/^bossDown:/.test(event)) return 'bossDown:<kind>';
  if (HALF_HP_KINDS.some((k) => event === `bossPhase:${k}`)) return 'bossPhase:drum_tanuki/roomba_king';
  if (/^continueCount:\d+$/.test(event)) return 'continueCount:N';
  if (/^pickup:/.test(event)) return 'pickup:<kind>';
  if (/^combo:\d+$/.test(event) && COMBO_STEPS.includes(Number(event.slice(6)))) return 'combo:N';
  return null;
}

export class VoiceGame {
  /** 對話框的字 → 事件（voice.json 的 say，再加上魔王第二階段、倒下的台詞：那兩種的字幕是這裡自己冒的） */
  readonly sayMap = new Map<string, string>();
  private last = new Map<string, number>();
  private seen = new WeakSet<object>();
  private half = new WeakSet<object>();
  private villager = new Map<number, string>();
  private lastFire = -99;
  private count = -1;
  private allDone = false;

  constructor(readonly d: VoiceDirector, private readonly rand: () => number = Math.random) {
    for (const [text, ev] of Object.entries(d.data.say)) this.sayMap.set(text, ev);
    for (const [ev, groups] of Object.entries(d.data.events)) {
      if (!/^boss(Phase|Down):/.test(ev)) continue;
      for (const g of groups) for (const c of g.clips) if (!this.sayMap.has(c.text)) this.sayMap.set(c.text, ev);
    }
  }

  /** 距離上次 key 至少 sec 秒才回 true（並記下這次） */
  private gap(key: string, sec: number): boolean {
    const now = this.d.sink.now();
    if (now - (this.last.get(key) ?? -1e9) < sec) return false;
    this.last.set(key, now);
    return true;
  }

  onFrame(w: World, events: readonly GameEvent[]): void {
    this.d.wt = w.time;
    for (const ev of events) this.onEvent(w, ev);
    this.scanBubbles(w);
    this.checkHalf(w);
    this.d.tick();
  }

  private onEvent(w: World, ev: GameEvent): void {
    const d = this.d;
    switch (ev.type) {
      case 'missionStart': {
        d.clear(); this.villager.clear(); this.allDone = false; this.count = -1;
        d.prefetch(['announcer', 'qiuqiu', ...VILLAGERS, 'grunt', ...w.stage.bosses.map((b) => b.kind)]);
        const st = `missionStart:${String(ev.stage)}`;
        if (d.has(st)) { d.say(st, { wait: 1.5 }); d.say('missionStart', { polite: true, wait: 4 }); }
        else d.say('missionStart', { wait: 1.5 });
        break;
      }
      case 'missionComplete':
        d.say('missionComplete', { role: 'announcer', polite: true, wait: 6 });
        d.say('missionComplete', { role: 'qiuqiu', polite: true, wait: 9 });
        break;
      case 'bossEnter': d.say('bossEnter', { wait: 1, force: true }); break;
      case 'bossDown': {
        const kind = String(ev.kind), id = `bossDown:${kind}`;
        const boss = w.enemies.find((e) => e.kind === kind && e.state === 'die') ?? w.boss;
        const p = d.pick(id);
        if (p && boss) { w.say(boss, p.clip.text, Math.min(3.5, p.clip.dur + 0.3)); if (boss.bubble) this.seen.add(boss.bubble); }
        if (p) d.say(id, { text: p.clip.text, wait: 2 });
        // 中魔王：播報員講完換球球。最終魔王接著就是「任務完成」（播報員＋球球），這裡不重複
        if (!w.stage.bosses.find((b) => b.kind === kind)?.final) {
          d.say('bossDown', { role: 'announcer', polite: true, wait: 7 });
          d.say('bossDown', { role: 'qiuqiu', polite: true, wait: 10 });
        }
        break;
      }
      case 'continuePrompt': d.clear(); d.say('continuePrompt'); break;
      case 'pickup': { const k = `pickup:${String(ev.kind)}`; if (d.has(k)) d.say(k, { wait: 1 }); break; }
      case 'kill': {
        const n = Number(ev.combo);
        // 連殺播報：自動玩實測一關二十次上下太吵，播過一次後 8 秒內不再播連殺
        if (w.state === 'play' && COMBO_STEPS.includes(n) && this.gap('combo', 8)) d.say(`combo:${n}`, { wait: 1 });
        break;
      }
      case 'captiveFreed': {
        const role = VILLAGERS[Math.floor(this.rand() * VILLAGERS.length) % VILLAGERS.length]!;
        this.villager.set(Number(ev.id), role);
        d.say('captiveThank', { role, text: THANK_TEXT, wait: 1 });
        break;
      }
      case 'captiveGive': {
        const role = this.villager.get(Number(ev.id)) ?? VILLAGERS[0]!;
        d.say('captiveGive', { role, text: GIVE_TEXT, polite: true, wait: 1.5 });
        if (this.rand() < 0.5) d.say('captiveFreed', { polite: true, wait: 3 });
        if (!this.allDone && w.captives.length > 0 && w.rescued >= w.captives.length) { this.allDone = true; d.say('allRescued', { polite: true, wait: 8 }); }
        break;
      }
      case 'fire': {
        const held = w.time - this.lastFire < 0.45;   // 按住連丟：只有第一發可能喊
        this.lastFire = w.time;
        if (!held && this.rand() < KIAI_CHANCE.fire! && this.gap('kiai', 0.6)) d.say('fire', { polite: true });
        break;
      }
      case 'claw': case 'jump':
        if (this.rand() < KIAI_CHANCE[ev.type]! && this.gap('kiai', 0.6)) d.say(ev.type, { polite: true });
        break;
      case 'playerHurt': if (this.gap('hurt', 0.8)) d.say('playerHurt'); break;
      case 'playerDown': d.say('playerDown', { wait: 0.5 }); break;
      case 'respawn': d.say('respawn', { polite: true, wait: 1.5 }); break;
      case 'notice': if (this.gap('notice', 4)) d.say('notice', { polite: true }); break;
    }
  }

  /** 敵人頭上新冒出來的對話框：有配音的就播同一句 */
  private scanBubbles(w: World): void {
    for (const e of w.enemies) {
      const b = e.bubble;
      if (!b || this.seen.has(b)) continue;
      this.seen.add(b);
      const ev = this.sayMap.get(b.text);
      if (!ev) continue;
      const role = this.d.data.events[ev]?.[0]?.role;
      if (role === 'grunt') { if (this.gap('grunt', 2.5)) this.d.say(ev, { text: b.text, polite: true }); }
      // 魔王出場、換階段的台詞重要：播報員的警報還在講就排隊等；招式喊聲（say:…）晚了就沒意思，只等一下下
      else if (this.gap(ev, 1.5)) this.d.say(ev, { text: b.text, wait: ev.startsWith('say:') ? 0.8 : 3.5 });
    }
  }

  /** 太鼓狸、掃地機王沒有第二階段：血剩一半時頭上冒「第二階段」那句（下一格 scanBubbles 播配音） */
  private checkHalf(w: World): void {
    const b: Enemy | null = w.boss;
    if (!b || this.half.has(b) || !HALF_HP_KINDS.includes(b.kind) || b.state === 'die' || b.hp <= 0 || b.hp > b.maxHp * 0.5) return;
    this.half.add(b);
    const p = this.d.pick(`bossPhase:${b.kind}`);
    if (p) w.say(b, p.clip.text, Math.min(3.5, p.clip.dur + 0.3));
  }

  onScreen(s: string): void {
    if (s === 'gameover') this.d.say('gameOver', { wait: 1 });
    else if (s === 'title') this.d.clear();
    if (s === 'continue') this.count = -1;
  }

  /** 接關畫面的倒數（畫面上顯示的數字） */
  onCount(n: number): void {
    if (n === this.count) return;
    this.count = n;
    this.d.say(`continueCount:${n}`);
  }
}

// ───────────── 瀏覽器：真的出聲 ─────────────

/** 配音音量（再乘各角色的 volume） */
export const VOICE_LEVEL = 0.95;
/** 講話時配樂壓到原本的幾成 */
export const DUCK = 0.4;

class WebSink implements VoiceSink {
  private bufs = new Map<string, AudioBuffer>();
  private pending = new Set<string>();
  private bad = new Set<string>();
  private src: AudioBufferSourceNode | null = null;
  private bus: GainNode | null = null;

  now(): number {
    const o = audioOut();
    return o ? o.ctx.currentTime : performance.now() / 1000;
  }

  ready(c: VoiceClip): boolean { return this.bufs.has(c.id); }

  load(c: VoiceClip): void {
    if (this.bufs.has(c.id) || this.pending.has(c.id) || this.bad.has(c.id)) return;
    const o = audioOut();
    if (!o) return;
    this.pending.add(c.id);
    fetch(c.file)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((b) => o.ctx.decodeAudioData(b))
      .then((buf) => { this.bufs.set(c.id, buf); }, () => { this.bad.add(c.id); })
      .finally(() => { this.pending.delete(c.id); });
  }

  play(c: VoiceClip, volume: number): boolean {
    const o = audioOut(), buf = this.bufs.get(c.id);
    if (!o || !buf || o.ctx.state !== 'running') return false;
    const ctx = o.ctx;
    this.halt();
    if (!this.bus) { this.bus = ctx.createGain(); this.bus.gain.value = VOICE_LEVEL; this.bus.connect(o.bus); }
    const g = ctx.createGain(); g.gain.value = volume;
    const s = ctx.createBufferSource(); s.buffer = buf;
    s.connect(g).connect(this.bus);
    s.onended = () => { if (this.src === s) this.src = null; g.disconnect(); };
    s.start();
    this.src = s;
    // 配樂壓低，講完 0.4 秒回來（下一句打斷或接著講會重新排）
    const m = o.music.gain, now = ctx.currentTime, low = MUSIC_LEVEL * DUCK;
    m.cancelScheduledValues(now); m.setValueAtTime(m.value, now);
    m.linearRampToValueAtTime(low, now + 0.1);
    m.setValueAtTime(low, now + buf.duration);
    m.linearRampToValueAtTime(MUSIC_LEVEL, now + buf.duration + 0.4);
    return true;
  }

  private halt(): void {
    const s = this.src;
    this.src = null;
    if (s) try { s.stop(); } catch { /* 已經停了 */ }
  }

  stop(): void {
    this.halt();
    const o = audioOut();
    if (!o) return;
    const m = o.music.gain, now = o.ctx.currentTime;
    m.cancelScheduledValues(now); m.setValueAtTime(m.value, now); m.linearRampToValueAtTime(MUSIC_LEVEL, now + 0.3);
  }
}

let active: VoiceGame | null = null;

/** 接上配音（瀏覽器載完 voice.json 自動叫；測試用假的播放器直接叫） */
export function installVoice(data: VoiceData, sink: VoiceSink, rand: () => number = Math.random): VoiceGame {
  active = new VoiceGame(new VoiceDirector(data, sink, rand), rand);
  return active;
}
export function uninstallVoice(): void { active = null; }

/** game.ts 叫的入口：還沒載好 voice.json（或在 Node 裡）就什麼都不做 */
export const voice = {
  onFrame(w: World, events: readonly GameEvent[]): void { try { active?.onFrame(w, events); } catch { /* 配音出錯不影響遊戲 */ } },
  onScreen(s: string): void { try { active?.onScreen(s); } catch { /* 同上 */ } },
  onCount(n: number): void { try { active?.onCount(n); } catch { /* 同上 */ } },
  /** 不在打的畫面（結算、接關、遊戲結束）也要讓排隊的句子講完 */
  tick(): void { try { active?.d.tick(); } catch { /* 同上 */ } },
};

if (typeof window !== 'undefined' && typeof fetch === 'function') {
  fetch('voice/voice.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data: VoiceData | null) => {
      if (!data?.events) return;
      const g = installVoice(data, new WebSink());
      (window as unknown as { __qqVoice: unknown }).__qqVoice = {
        log: g.d.log,
        busy: () => g.d.busy(),
        /** 配樂匯流現在的音量（講話時會壓低；錄影檢查用） */
        music: () => audioOut()?.music.gain.value ?? null,
      };
    })
    .catch(() => { /* 沒有配音也照玩 */ });
}
