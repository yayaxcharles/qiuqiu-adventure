/**
 * 日文配音（src/voice.ts、src/audio/voice.ts）：
 * - voice.json 每個事件都有觸發點（或列在不接清單、寫明原因）
 * - voice.json 的 say（字幕 → 配音）每一句字幕，都跟程式裡 w.say 的字一字不差（字幕跟配音對得上）
 * - 誰先講、打不打斷、排隊的規則
 * - 三關自動玩：播報員開始／過關、魔王出場／換階段／倒下都有講，而且同一時間只有一句
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VoiceDirector, type VoiceClip, type VoiceData, type VoiceSink } from '../src/audio/voice';
import { Game } from '../src/game';
import { NO_INPUT, type Frame } from '../src/input';
import { STAGE1 } from '../src/stages/stage1';
import { STAGE2 } from '../src/stages/stage2';
import { STAGE3 } from '../src/stages/stage3';
import type { StageDef } from '../src/stages/types';
import { EVENT_TRIGGERS, HALF_HP_KINDS, installVoice, NO_TRIGGER, triggerKey, uninstallVoice, VoiceGame } from '../src/voice';
import { seedRandom, simulate } from './botsim';
import VOICE_JSON from '../public/voice/voice.json';

const DATA = VOICE_JSON as unknown as VoiceData;
const RAW = import.meta.glob('../src/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SRC: Record<string, string> = Object.fromEntries(Object.entries(RAW).map(([p, s]) => [p.replace('../src/', ''), s.replace(/\r\n/g, '\n')]));
const GAME_SRC = Object.entries(SRC).filter(([f]) => f !== 'voice.ts').map(([, s]) => s).join('\n');
const VOICE_SRC = SRC['voice.ts']!;

/** 程式裡 w.say／this.say／phaseUp 那幾行出現的所有字串 */
function saidStrings(): Set<string> {
  const out = new Set<string>();
  for (const line of GAME_SRC.split('\n')) {
    if (!/\bsay\(|phaseUp\(/.test(line)) continue;
    for (const m of line.matchAll(/'([^'\n]*)'/g)) out.add(m[1]!);
  }
  return out;
}

/** 遊戲程式發出的事件種類（w.event('x'…)／this.event('x'…)） */
const EMITTED = new Set([...GAME_SRC.matchAll(/\.event\('([a-zA-Z]+)'/g)].map((m) => m[1]!));

class FakeSink implements VoiceSink {
  t = 0;
  loaded = new Set<string>();
  playing: string | null = null;
  auto = true;
  now(): number { return this.t; }
  ready(c: VoiceClip): boolean { return this.auto || this.loaded.has(c.id); }
  load(c: VoiceClip): void { this.loaded.add(c.id); }
  play(c: VoiceClip): boolean { this.playing = c.id; return true; }
  stop(): void { this.playing = null; }
}

describe('voice.json 對照程式', () => {
  it('每個事件都有觸發點，或在不接清單寫明原因', () => {
    const say = new Set(Object.values(DATA.say));
    const g = new VoiceGame(new VoiceDirector(DATA, new FakeSink()));
    const said = saidStrings();
    const missing: string[] = [];
    for (const ev of Object.keys(DATA.events)) {
      if (NO_TRIGGER[ev]) continue;
      // 看對話框觸發：某一句字幕對到這個事件，而且程式真的會 w.say 那句
      const viaBubble = [...g.sayMap].some(([text, e]) => e === ev && said.has(text));
      if (viaBubble && say.has(ev)) continue;
      const key = triggerKey(ev);
      if (key && EVENT_TRIGGERS[key]) continue;
      missing.push(ev);
    }
    expect(missing).toEqual([]);
    // 不接清單裡的真的存在於 voice.json
    for (const ev of Object.keys(NO_TRIGGER)) expect(DATA.events[ev], ev).toBeDefined();
  });

  it('程式裡 say 的事件名都寫得出來（voice.ts 真的有叫、遊戲真的有發對應的事件）', () => {
    const named = [...VOICE_SRC.matchAll(/d\.say\('([a-zA-Z]+)'/g)].map((m) => m[1]!);
    for (const n of named) expect(DATA.events[n], n).toBeDefined();
    const cases = [...VOICE_SRC.matchAll(/case '([a-zA-Z]+)'/g)].map((m) => m[1]!);
    for (const c of cases) expect(EMITTED.has(c), `遊戲沒有發 ${c} 事件`).toBe(true);
    for (const t of ['missionStart', 'missionComplete', 'bossEnter', 'bossDown', 'continuePrompt', 'pickup', 'kill', 'captiveFreed', 'captiveGive', 'fire', 'claw', 'jump', 'playerHurt', 'playerDown', 'respawn', 'notice']) {
      expect(cases, t).toContain(t);
    }
  });

  it('say 的每一句字幕都跟程式裡 w.say 的字一字不差', () => {
    const said = saidStrings();
    const bad = Object.keys(DATA.say).filter((t) => !said.has(t));
    expect(bad).toEqual([]);
    for (const [text, ev] of Object.entries(DATA.say)) {
      const clips = DATA.events[ev]!.flatMap((g) => g.clips);
      expect(clips.some((c) => c.text === text), `${ev} 沒有「${text}」這句`).toBe(true);
    }
  });

  it('中魔王半血那句、村貓頭上的字都有同一句配音', () => {
    for (const k of HALF_HP_KINDS) expect(DATA.events[`bossPhase:${k}`]?.[0]?.clips.length, k).toBeGreaterThan(0);
    for (const v of ['villager1', 'villager2', 'villager3']) {
      expect(DATA.events.captiveThank!.find((g) => g.role === v)!.clips.some((c) => c.text === '謝謝你！')).toBe(true);
      expect(DATA.events.captiveGive!.find((g) => g.role === v)!.clips.some((c) => c.text === '這個給你！')).toBe(true);
    }
    // render.ts 村貓頭上畫的就是這兩句
    expect(SRC['render.ts']).toContain("'謝謝你！'");
    expect(SRC['render.ts']).toContain("'這個給你！'");
  });
});

describe('誰先講、打不打斷', () => {
  const mk = (): { d: VoiceDirector; s: FakeSink } => { const s = new FakeSink(); return { d: new VoiceDirector(DATA, s, () => 0), s }; };

  it('優先順序高的打斷；同順序、比較低的略過', () => {
    const { d, s } = mk();
    expect(d.say('playerHurt')).toBe('play');          // 球球 3
    expect(d.say('respawn')).toBe('skip');             // 球球 3：同順序不打斷
    expect(d.say('notice')).toBe('skip');              // 小兵 1
    expect(d.say('bossEnter')).toBe('play');           // 播報員 5：打斷
    expect(s.playing).toBe('ann_warn_1');
    expect(d.log.some((l) => l.act === 'cut' && l.event === 'playerHurt')).toBe(true);
    expect(d.say('missionComplete')).toBe('skip');     // 播報員 5：同順序
    expect(d.say('combo:5', { force: true })).toBe('play');   // 指定 force（魔王警報）同順序也打斷
    s.t = 10;                                          // 講完了
    expect(d.say('notice')).toBe('play');
  });

  it('客氣的不打斷任何人；排隊的前一句講完接著講、排太久就丟掉', () => {
    const { d, s } = mk();
    d.say('captiveThank', { role: 'villager2', text: '謝謝你！' });   // 村貓 2
    expect(d.say('fire', { polite: true })).toBe('skip');              // 球球 3 但客氣
    expect(d.say('missionComplete', { role: 'qiuqiu', polite: true, wait: 5 })).toBe('queue');
    d.tick();
    expect(s.playing).toBe('vil2_thank_1');
    s.t = 1.3; d.tick();                                               // 1.06 秒＋間隔後
    expect(s.playing?.startsWith('qq_clear')).toBe(true);
    d.say('bossEnter');
    expect(d.say('bossDown', { role: 'qiuqiu', polite: true, wait: 1 })).toBe('queue');
    s.t = 3; d.tick();                                                 // 警報 2.47 秒還沒講完就過期
    expect(d.log.some((l) => l.act === 'expire' && l.event === 'bossDown')).toBe(true);
  });

  it('指定字幕就挑同一句；音檔還沒載好先載、載好就講', () => {
    const { d, s } = mk();
    expect(d.pick('bossEnter:drum_tanuki', { text: '祭典才正要開始咧！' })!.clip.id).toBe('drum_enter_2');
    s.auto = false;
    expect(d.say('missionStart:stage1', { wait: 1.5 })).toBe('queue');
    expect(s.loaded.has('ann_m1_start')).toBe(true);
    d.tick();
    expect(s.playing).toBe('ann_m1_start');
  });
});

describe('三關自動玩：配音時間表', () => {
  let restore: () => void = () => {};
  beforeAll(() => { restore = seedRandom(1); });
  afterAll(() => { restore(); uninstallVoice(); });

  const run = (stage: StageDef): VoiceDirector => {
    let s = 0x2545f491;
    const rng = (): number => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const sink = new FakeSink();
    const g = installVoice(DATA, sink, rng);
    // 時鐘：照遊戲每一步真的經過的時間走（世界時間在定格、結算畫面時會停）
    const orig = Game.prototype.update;
    Game.prototype.update = function (this: Game, dt: number, f: Frame) { sink.t += dt; orig.call(this, dt, f); };
    let r;
    try {
      r = simulate(stage);
      for (let i = 0; i < 120 * 10; i++) r.g.update(1 / 120, NO_INPUT);   // 結算畫面再待 10 秒：排隊的「任務完成」講完
    } finally { Game.prototype.update = orig; }
    expect(r.cleared).toBe(true);
    return g.d;
  };

  const check = (d: VoiceDirector, stage: string, bosses: string[]): void => {
    const plays = d.log.filter((l) => l.act === 'play');
    const counts: Record<string, number> = {};
    for (const p of plays) counts[p.role] = (counts[p.role] ?? 0) + 1;
    console.log(stage, JSON.stringify(counts));
    const has = (ev: string, role?: string): boolean => plays.some((p) => p.event === ev && (!role || p.role === role));
    expect(has(`missionStart:${stage}`)).toBe(true);
    expect(has('missionComplete', 'announcer')).toBe(true);
    expect(has('missionComplete', 'qiuqiu')).toBe(true);
    expect(plays.filter((p) => p.event === 'bossEnter').length, '兩隻魔王出場都有警報').toBe(2);
    for (const b of bosses) {
      expect(has(`bossEnter:${b}`), `${b} 出場`).toBe(true);
      expect(has(`bossPhase:${b}`), `${b} 換階段／半血`).toBe(true);
      expect(has(`bossDown:${b}`), `${b} 倒下`).toBe(true);
    }
    // 同一時間只有一句：下一句開始前，前一句已經講完（或被記下打斷）
    for (let i = 1; i < plays.length; i++) {
      const a = plays[i - 1]!, b = plays[i]!;
      if (a.at + a.dur <= b.at + 1e-6) continue;
      const cut = d.log.some((l) => l.act === 'cut' && l.id === a.id && Math.abs(l.at - b.at) < 1e-6);
      expect(cut, `${a.id}@${a.at} 跟 ${b.id}@${b.at} 疊在一起`).toBe(true);
    }
  };

  it('第一關', () => check(run(STAGE1), 'stage1', ['drum_tanuki', 'orange_king']), 180000);
  it('第二關', () => check(run(STAGE2), 'stage2', ['frog_daimyo', 'tanuki_lord']), 180000);
  it('第三關', () => check(run(STAGE3), 'stage3', ['roomba_king', 'iron_claw']), 180000);
});
