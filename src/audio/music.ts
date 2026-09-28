/**
 * 程式合成的和風配樂：太鼓節奏＋五聲音階旋律，一關一首、魔王戰一首，全部可以無縫循環。
 * 樂器也是用 synth.ts 的層做出來的（太鼓、締太鼓、鉦、笛、三味線、低音、持續低鳴）。
 *
 * 樂譜寫法（一格＝十六分音符）：
 * - 打擊樂：一個字一格，X＝重、x＝中、o＝輕、.＝休息（空白與 | 只是分隔，不算格）。
 * - 旋律：「音級:格數」用空白隔開；音級 1～5＝這首的五聲音階第幾個音，' 高八度、, 低八度，- 休息；格數省略＝2。
 */
import type { Layer } from './synth';
import { playLayers } from './synth';
import { hz } from './sfxDefs';

type Inst = (f: number, dur: number, vel: number) => Layer[];

/** 樂器（f＝頻率、dur＝這個音拍子上多長、vel＝力度 0～1） */
export const INSTRUMENTS: Record<string, Inst> = {
  /** 長胴太鼓「咚」 */
  taiko: (_f, _d, v) => [
    { wave: 'sine', dur: 0.55, gain: 0.9 * v, f: 150, f2: 50, slide: 0.22, a: 0.002 },
    { wave: 'sine', dur: 0.4, gain: 0.45 * v, f: 82, f2: 45, a: 0.003 },
    { wave: 'noise', dur: 0.05, gain: 0.4 * v, filter: { type: 'lowpass', f: 1000 } },
  ],
  /** 鼓框「咔」 */
  ka: (_f, _d, v) => [
    { wave: 'noise', dur: 0.03, gain: 0.5 * v, a: 0.001, filter: { type: 'bandpass', f: 2800, q: 3 } },
    { wave: 'triangle', dur: 0.025, gain: 0.25 * v, f: 1300, a: 0.001 },
  ],
  /** 締太鼓（小而緊的鼓）「咚咚」 */
  shime: (_f, _d, v) => [
    { wave: 'sine', dur: 0.1, gain: 0.5 * v, f: 430, f2: 280, a: 0.001 },
    { wave: 'noise', dur: 0.03, gain: 0.3 * v, filter: { type: 'bandpass', f: 2000, q: 1.5 } },
  ],
  /** 當り鉦（祭典的小銅鉦）「鏘」 */
  kane: (_f, _d, v) => [
    { wave: 'sine', dur: 0.2, gain: 0.22 * v, f: 2100, a: 0.001, fm: { ratio: 1.41, depth: 3000, depth2: 200 } },
    { wave: 'noise', dur: 0.03, gain: 0.18 * v, filter: { type: 'highpass', f: 6000 } },
  ],
  /** 篠笛：三角波＋氣音，起音從下面滑上來、後面帶顫音 */
  fue: (f, d, v) => {
    const dur = Math.max(0.12, d);
    return [
      { wave: 'triangle', dur, gain: 0.35 * v, a: 0.03, hold: dur * 0.55, fs: [[0, f * 0.97], [0.05, f]], vib: [5.5, f * 0.007] },
      { wave: 'sine', dur, gain: 0.06 * v, a: 0.03, hold: dur * 0.55, f: f * 2 },
      { wave: 'noise', dur, gain: 0.06 * v, a: 0.02, hold: dur * 0.4, filter: { type: 'bandpass', f: f * 2, q: 6 } },
    ];
  },
  /** 三味線：撥一下（鋸齒波＋快速關上的濾波器）＋撥子的「啪」 */
  shamisen: (f, d, v) => [
    { wave: 'sawtooth', dur: Math.min(0.45, d + 0.2), gain: 0.28 * v, f, a: 0.002, filter: { type: 'lowpass', f: 4500, f2: 650, q: 2, slide: 0.16 } },
    { wave: 'noise', dur: 0.015, gain: 0.2 * v, filter: { type: 'highpass', f: 2500 } },
  ],
  /** 低音（撐住節奏） */
  bass: (f, d, v) => [
    { wave: 'triangle', dur: d * 0.9 + 0.05, gain: 0.5 * v, f, a: 0.005, hold: d * 0.4 },
    { wave: 'sine', dur: d * 0.9 + 0.05, gain: 0.3 * v, f, a: 0.005, hold: d * 0.4 },
  ],
  /** 持續低鳴（機關城的緊張感） */
  drone: (f, d, v) => [
    { wave: 'sawtooth', dur: d, gain: 0.1 * v, f, a: 0.4, hold: Math.max(0, d - 1), curve: 'lin', filter: { type: 'lowpass', f: 480 } },
    { wave: 'sawtooth', dur: d, gain: 0.1 * v, f: f * 1.006, a: 0.4, hold: Math.max(0, d - 1), curve: 'lin', filter: { type: 'lowpass', f: 480 } },
  ],
};

export interface Part { inst: keyof typeof INSTRUMENTS; gain: number; pan?: number; pat?: string; seq?: string; oct?: number }
/** vol＝整首的音量倍率（各首聽起來一樣大聲） */
export interface Track { id: string; name: string; bpm: number; root: number; scale: number[]; vol?: number; parts: Part[] }

const YO = [0, 2, 5, 7, 9];        // 陽音階（明亮的民謠）
const MIYAKO = [0, 1, 5, 7, 8];    // 都節音階（緊張、和風小調）

export const TRACKS: Record<string, Track> = {
  /** 第一關　黃昏山村：輕快 */
  stage1: {
    id: 'stage1', name: '第一關　黃昏山村', bpm: 120, root: 62, scale: YO, vol: 0.85,
    parts: [
      { inst: 'fue', gain: 0.55, pan: 0.15, oct: 1, seq: "3:4 4 5 1':4 5:4 | 4 5 4 3 2:4 -:4 | 3:4 4 5 2':4 1' 5 | 4:4 3 2 1:6 -:2 | 5 5 1':4 2' 1' 5:4 | 4 5 1' 5 4:4 3:4 | 2 3 4:4 5 4 3:4 | 2:4 3 2 1:8" },
      { inst: 'shamisen', gain: 0.5, pan: -0.25, oct: 0, seq: '- 1 - 5, - 1 - 5, | - 3, - 1 - 4, - 5,' },
      { inst: 'taiko', gain: 0.8, pat: 'X.......x.x.....' },
      { inst: 'ka', gain: 0.35, pan: 0.2, pat: '....x.......x.o.' },
      { inst: 'shime', gain: 0.22, pan: -0.1, pat: 'o.o.o.o.o.o.o.o.' },
    ],
  },
  /** 第二關　夜祭：熱鬧（祭囃子：笛子高音、締太鼓一直打、鉦「鏘鏘鏘」） */
  stage2: {
    id: 'stage2', name: '第二關　夜祭', bpm: 144, root: 67, scale: YO, vol: 0.65,
    parts: [
      { inst: 'fue', gain: 0.5, pan: 0.15, oct: 0, seq: "1' 2' 1' 5 4 5 1':4 | 2' 3' 2' 1' 5:4 -:4 | 4 5 1' 2' 3':3 2':1 1':4 | 5 4 2 4 5:8 | 1' 2' 1' 5 4 5 1':4 | 3' 2' 3' 5' 3':4 2':4 | 1' 5 4 5 1' 2' 3':4 | 2' 1' 5 4 1':8" },
      { inst: 'shamisen', gain: 0.4, pan: -0.25, oct: 0, seq: '- 1 - 3 - 1 - 4' },
      { inst: 'taiko', gain: 0.8, pat: 'X...x...X.x.x...' },
      { inst: 'shime', gain: 0.3, pan: -0.1, pat: 'X.xoX.xoX.xoX.xo' },
      { inst: 'kane', gain: 0.35, pan: 0.3, pat: 'X..x..x.X..x..x.' },
    ],
  },
  /** 第三關　機關城：緊張（都節音階、低鳴、像齒輪的「咔噠」） */
  stage3: {
    id: 'stage3', name: '第三關　機關城', bpm: 132, root: 64, scale: MIYAKO, vol: 0.63,
    parts: [
      { inst: 'fue', gain: 0.5, pan: 0.15, oct: 0, seq: "-:8 5:6 4:2 | 3:8 2:8 | -:8 3:4 4:4 | 5:12 -:4 | -:4 1':4 5:4 4:4 | 3:6 4:2 3:4 2:4 | 1:4 2:4 3:4 2 3 | 1:12 -:4" },
      { inst: 'shamisen', gain: 0.5, pan: -0.25, oct: -1, seq: '1 1 2 1 3 1 2 1 | 1 1 2 1 4 3 2 1 | 1 1 2 1 3 1 2 1 | 3 3 4 3 5 4 3 2' },
      { inst: 'drone', gain: 0.5, oct: -2, seq: '1:64' },
      { inst: 'taiko', gain: 0.85, pat: 'X.....x.X.......X.....x.X...xxxx' },
      { inst: 'ka', gain: 0.35, pan: 0.25, pat: 'x.o.x.o.x.o.x.o.' },
    ],
  },
  /** 魔王戰：更快、更密的太鼓，三味線急促反覆 */
  boss: {
    id: 'boss', name: '魔王戰', bpm: 164, root: 62, scale: MIYAKO, vol: 0.48,
    parts: [
      { inst: 'fue', gain: 0.45, pan: 0.15, oct: 1, seq: "5:6 4 3:4 2:4 | 1 2 3 2 1:8 | 5:6 4 3:4 5:4 | 1':12 -:4 | 1' 5 4 5 1':4 2':4 | 1' 5 4 3 4:8 | 3 4 5 4 3 2 1:4 | 2:4 1:12" },
      { inst: 'shamisen', gain: 0.45, pan: -0.25, oct: -1, seq: '1:1 1:1 2:1 1:1 3:1 1:1 2:1 1:1 4:1 3:1 2:1 1:1 2 5, | 1:1 1:1 2:1 1:1 3:1 1:1 2:1 1:1 5:1 4:1 3:1 2:1 3 4' },
      { inst: 'bass', gain: 0.45, oct: -2, seq: '1:4 1:4 1 1 2:4 | 1:4 1:4 1 1 5,:4' },
      { inst: 'taiko', gain: 0.85, pat: 'X.x.X.x.X.x.XxXx' },
      { inst: 'shime', gain: 0.25, pan: -0.1, pat: 'xoxoxoxoxoxoxoxo' },
      { inst: 'kane', gain: 0.3, pan: 0.3, pat: 'X.......X...X...' },
    ],
  },
};

interface NoteEv { step: number; len: number; midi: number; vel: number }
interface Compiled { len: number; notes: Map<number, NoteEv[]> }

/** 把一個聲部的樂譜轉成「第幾格 → 要彈的音」 */
export function compilePart(p: Part, t: Track): Compiled {
  const notes = new Map<number, NoteEv[]>();
  const add = (e: NoteEv): void => { const l = notes.get(e.step); if (l) l.push(e); else notes.set(e.step, [e]); };
  if (p.pat !== undefined) {
    const cells = p.pat.replace(/[\s|]/g, '');
    [...cells].forEach((c, i) => { const vel = c === 'X' ? 1 : c === 'x' ? 0.7 : c === 'o' ? 0.45 : 0; if (vel) add({ step: i, len: 1, midi: 0, vel }); });
    return { len: cells.length, notes };
  }
  let step = 0;
  for (const tok of (p.seq ?? '').split(/[\s|]+/).filter(Boolean)) {
    const m = /^(-|[1-5])([',]*)(?::(\d+))?$/.exec(tok);
    if (!m) throw new Error(`看不懂的音符：${tok}`);
    const len = m[3] ? Number(m[3]) : 2;
    if (m[1] !== '-') {
      const up = (m[2]!.match(/'/g) ?? []).length - (m[2]!.match(/,/g) ?? []).length;
      const midi = t.root + (p.oct ?? 0) * 12 + t.scale[Number(m[1]) - 1]! + up * 12;
      add({ step, len, midi, vel: 1 });
    }
    step += len;
  }
  return { len: step, notes };
}

export const stepSec = (t: Track): number => 60 / t.bpm / 4;

const compiledCache = new WeakMap<Track, Compiled[]>();
function compiled(t: Track): Compiled[] {
  let c = compiledCache.get(t);
  if (!c) { c = t.parts.map((p) => compilePart(p, t)); compiledCache.set(t, c); }
  return c;
}

/** 排一格（第 step 格、在 when 秒）要響的所有音 */
export function scheduleStep(ctx: BaseAudioContext, out: AudioNode, t: Track, step: number, when: number, rnd: () => number): void {
  const sd = stepSec(t);
  compiled(t).forEach((c, i) => {
    if (!c.len) return;
    const evs = c.notes.get(step % c.len);
    if (!evs) return;
    const p = t.parts[i]!;
    for (const e of evs) {
      // 人味：力度每次差一點點（打擊樂才明顯）
      const vel = e.vel * (p.pat !== undefined ? 0.9 + rnd() * 0.1 : 1);
      const layers = INSTRUMENTS[p.inst]!(hz(e.midi || 69), e.len * sd, vel);
      if (p.pan) for (const l of layers) l.pan = p.pan;
      playLayers(ctx, out, layers, when, 1, p.gain * (t.vol ?? 1), rnd);
    }
  });
}

/** 離線渲染：從頭排 sec 秒（試聽檔用） */
export function renderTrack(ctx: BaseAudioContext, out: AudioNode, t: Track, sec: number, rnd: () => number, t0 = 0): void {
  const sd = stepSec(t);
  for (let s = 0; t0 + s * sd < sec; s++) scheduleStep(ctx, out, t, s, t0 + s * sd, rnd);
}

/** 一首歌的一個完整循環幾格（各聲部長度的最小公倍數） */
export function loopSteps(t: Track): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return compiled(t).reduce((acc, c) => (c.len ? (acc * c.len) / gcd(acc, c.len) : acc), 1);
}

/**
 * 即時播放：每 50 毫秒往前多排 0.3 秒的音（音樂靠音訊時鐘，不受畫面卡頓影響）。
 * 換歌時舊的淡出、新的淡入。
 */
export class MusicPlayer {
  private cur: { track: Track; gain: GainNode; t0: number; step: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode, private readonly rnd: () => number) {}

  get playing(): string | null { return this.cur?.track.id ?? null; }

  play(t: Track, delay = 0, fadeIn = 0.4): void {
    this.stop(0.5);
    const now = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.out);
    const t0 = now + delay + 0.06;
    g.gain.setValueAtTime(0, now);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + fadeIn);
    this.cur = { track: t, gain: g, t0, step: 0 };
    if (!this.timer) this.timer = setInterval(() => this.tick(), 50);
    this.tick();
  }

  stop(fade = 0.6): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const now = this.ctx.currentTime;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => { try { c.gain.disconnect(); } catch { /* 已經拆了 */ } }, (fade + 1) * 1000);
  }

  /** 暫時壓低（接關倒數時） */
  duck(level: number, time = 0.3): void {
    const c = this.cur;
    if (!c) return;
    const now = this.ctx.currentTime;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(level, now + time);
  }

  private tick(): void {
    const c = this.cur;
    if (!c) return;
    const now = this.ctx.currentTime;
    const sd = stepSec(c.track);
    // 主執行緒卡太久（落後超過 0.1 秒）：直接跳到現在，不要把欠的音一口氣全擠出來
    const behind = Math.floor((now - 0.1 - c.t0) / sd);
    if (behind > c.step) c.step = behind;
    for (;;) {
      const at = c.t0 + c.step * sd;
      if (at > now + 0.3) break;
      scheduleStep(this.ctx, c.gain, c.track, c.step, Math.max(at, now), this.rnd);
      c.step++;
    }
  }
}
