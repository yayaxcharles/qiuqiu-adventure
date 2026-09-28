/**
 * 程式合成音效的小引擎（像 sfxr／jsfxr 的做法：振盪器、雜訊、包絡、濾波、滑音），不用任何音檔。
 * 一個音效＝好幾層（Layer）疊起來；每一層是一個聲源（正弦、方波、鋸齒、三角、白雜訊），
 * 經過濾波器、音量包絡，最後接到輸出。即時播放（AudioContext）與離線渲染（OfflineAudioContext）共用同一份程式。
 * 只用 Web Audio 的基本節點，不碰遊戲的其他檔案。
 */

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface Layer {
  wave: Wave;
  /** 從音效開始算，這一層晚幾秒才出來 */
  at?: number;
  /** 這一層多長（秒，含尾音） */
  dur: number;
  /** 峰值音量（0～1） */
  gain: number;
  /** 起音：從無聲爬到峰值花幾秒 */
  a?: number;
  /** 爬到峰值後維持幾秒才開始衰減 */
  hold?: number;
  /** 衰減形狀：exp＝指數（打擊感）、lin＝直線（比較平） */
  curve?: 'exp' | 'lin';
  /** 起始頻率（Hz）；雜訊層不用 */
  f?: number;
  /** 滑到哪個頻率 */
  f2?: number;
  /** 滑音花幾秒（預設整層長度） */
  slide?: number;
  /** 多段音高：[[時間, 頻率], …]（喵叫、彈簧聲、警報用），有這個就不看 f／f2 */
  fs?: [number, number][];
  /** 顫音：[每秒幾次, 上下幾 Hz]；雜訊層改成晃濾波器 */
  vib?: [number, number];
  /** 音量抖動（呼呼聲、嘶嘶聲）：[每秒幾次, 深度 0～1] */
  trem?: [number, number];
  /** 調頻（金屬聲、鐘聲）：調變器頻率＝載波 × ratio，深度（Hz）從 depth 衰減到 depth2 */
  fm?: { ratio: number; depth: number; depth2?: number };
  filter?: { type: BiquadFilterType; f: number; f2?: number; q?: number; slide?: number };
  /** 左右聲道（-1 左、1 右） */
  pan?: number;
}

export interface SfxDef {
  layers: Layer[];
  /** 整體音量倍率 */
  vol?: number;
  /** 每次播放音高隨機飄動幾個半音（連射時不會每發都一模一樣） */
  jit?: number;
  /** 節流：同名最多幾個同時響 */
  max?: number;
  /** 節流：同名兩次之間至少隔幾秒 */
  gap?: number;
}

/** 固定種子的亂數（不用 Math.random：錄影、自動玩會固定 Math.random 的種子，音效不能去吃它的亂數） */
export function makeRng(seed = 0x2f6b1a3d): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defaultRng = makeRng(0x7a11);

/** 一個音效從頭到尾多長（秒） */
export function sfxDuration(def: SfxDef): number {
  return Math.max(0, ...def.layers.map((l) => (l.at ?? 0) + l.dur));
}

// 每個 AudioContext 各做一份 2 秒白雜訊，大家共用（起點隨機，聽起來不會每次一樣）
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = Math.floor(ctx.sampleRate * 2);
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = makeRng(0x51f15eed);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** 音量包絡：0 → 峰值 → （維持）→ 衰減到 0 */
function envelope(g: AudioParam, t: number, l: Layer, peak: number): number {
  const a = Math.min(l.a ?? 0.004, l.dur * 0.9);
  const hold = Math.min(l.hold ?? 0, l.dur - a);
  const end = t + l.dur;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) g.setValueAtTime(peak, t + a + hold);
  if ((l.curve ?? 'exp') === 'exp') g.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), end);
  else g.linearRampToValueAtTime(0, end);
  g.setValueAtTime(0, end);
  return end;
}

function pitchCurve(p: AudioParam, t: number, l: Layer, k: number): void {
  if (l.fs && l.fs.length) {
    p.setValueAtTime(l.fs[0]![1] * k, t + l.fs[0]![0]);
    for (const [tt, f] of l.fs.slice(1)) p.exponentialRampToValueAtTime(Math.max(1, f * k), t + tt);
    return;
  }
  p.setValueAtTime((l.f ?? 440) * k, t);
  if (l.f2 !== undefined) p.exponentialRampToValueAtTime(Math.max(1, l.f2 * k), t + (l.slide ?? l.dur));
}

/**
 * 把一串層排進 AudioContext：when 秒開始、音高乘 pitch、音量乘 vol。回傳這個聲音什麼時候結束（秒）。
 * rnd 只拿來決定雜訊從哪裡開始讀。
 */
export function playLayers(ctx: BaseAudioContext, out: AudioNode, layers: Layer[], when: number, pitch = 1, vol = 1, rnd: () => number = defaultRng): number {
  const voice = ctx.createGain();
  voice.gain.value = vol;
  voice.connect(out);
  let end = when;
  let lastSrc: AudioScheduledSourceNode | null = null;
  for (const l of layers) {
    const t = when + (l.at ?? 0);
    const stopAt = t + l.dur + 0.02;
    let src: AudioScheduledSourceNode;
    let freqParam: AudioParam | null = null;
    if (l.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = l.wave;
      pitchCurve(o.frequency, t, l, pitch);
      freqParam = o.frequency;
      src = o;
    }
    let node: AudioNode = src;
    let filt: BiquadFilterNode | null = null;
    if (l.filter) {
      filt = ctx.createBiquadFilter();
      filt.type = l.filter.type;
      filt.Q.value = l.filter.q ?? 1;
      const fk = l.wave === 'noise' ? pitch : 1;
      filt.frequency.setValueAtTime(l.filter.f * fk, t);
      if (l.filter.f2 !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(10, l.filter.f2 * fk), t + (l.filter.slide ?? l.dur));
      node.connect(filt);
      node = filt;
    }
    // 顫音：接在振盪器頻率上；雜訊層接在濾波器頻率上
    const vibTarget = freqParam ?? filt?.frequency ?? null;
    if (l.vib && vibTarget) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = l.vib[0];
      const d = ctx.createGain();
      d.gain.value = l.vib[1] * (freqParam ? pitch : 1);
      lfo.connect(d).connect(vibTarget);
      lfo.start(t); lfo.stop(stopAt);
    }
    if (l.fm && freqParam) {
      const m = ctx.createOscillator();
      m.frequency.value = (l.f ?? l.fs?.[0]?.[1] ?? 440) * pitch * l.fm.ratio;
      const d = ctx.createGain();
      d.gain.setValueAtTime(l.fm.depth * pitch, t);
      if (l.fm.depth2 !== undefined) d.gain.exponentialRampToValueAtTime(Math.max(1, l.fm.depth2 * pitch), t + l.dur);
      m.connect(d).connect(freqParam);
      m.start(t); m.stop(stopAt);
    }
    const env = ctx.createGain();
    envelope(env.gain, t, l, l.gain);
    node.connect(env);
    node = env;
    if (l.trem) {
      const tg = ctx.createGain();
      tg.gain.value = 1 - l.trem[1] / 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = l.trem[0];
      const d = ctx.createGain();
      d.gain.value = l.trem[1] / 2;
      lfo.connect(d).connect(tg.gain);
      lfo.start(t); lfo.stop(stopAt);
      node.connect(tg);
      node = tg;
    }
    if (l.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = l.pan;
      node.connect(p);
      node = p;
    }
    node.connect(voice);
    if (src instanceof AudioBufferSourceNode) src.start(t, rnd() * 1.5);
    else src.start(t);
    src.stop(stopAt);
    if (stopAt >= end) { end = stopAt; lastSrc = src; }
  }
  // 最晚停的那個聲源停了，就把整串拆掉（不然節點會一直掛在圖上）
  if (lastSrc) lastSrc.onended = () => { try { voice.disconnect(); } catch { /* 已經拆了 */ } };
  return end;
}

/** 播一個音效定義（音高隨機飄動＋外加的音高、音量倍率） */
export function playSfx(ctx: BaseAudioContext, out: AudioNode, def: SfxDef, when: number, rnd: () => number, pitch = 1, vol = 1): number {
  const j = def.jit ? Math.pow(2, ((rnd() * 2 - 1) * def.jit) / 12) : 1;
  return playLayers(ctx, out, def.layers, when, pitch * j, (def.vol ?? 1) * vol, rnd);
}
