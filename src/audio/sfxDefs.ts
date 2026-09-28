/**
 * 每個音效怎麼合成（名稱 → 層）。名稱對照 sfx.ts 的 SFX_MAP 與變體（不同忍具、不同敵人招式各自一種聲音）。
 * 數字的單位：秒、Hz、音量 0～1。調聲音只改這個檔。
 */
import type { Layer, SfxDef } from './synth';

/** MIDI 音號 → 頻率（69＝A4＝440 Hz） */
export const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** 一串音符（旋律、琶音）：[音號, 開始秒, 長度秒] */
function mel(wave: Layer['wave'], notes: [number, number, number][], gain: number, o: Partial<Layer> = {}): Layer[] {
  return notes.map(([m, at, dur]) => ({ wave, f: hz(m), at, dur, gain, a: 0.006, ...o }));
}

/** 太鼓咚一下（號角樂句、警報裡用） */
function don(at: number, gain = 0.7): Layer[] {
  return [
    { wave: 'sine', at, f: 150, f2: 52, slide: 0.22, dur: 0.5, gain, a: 0.002 },
    { wave: 'noise', at, dur: 0.05, gain: gain * 0.5, filter: { type: 'lowpass', f: 1100 } },
  ];
}

/** 木頭碎片敲擊聲（木箱、竹籠碎掉） */
function knocks(at: number[], fs: number[], gain: number): Layer[] {
  return at.map((t, i) => ({ wave: 'triangle' as const, at: t, f: fs[i % fs.length]!, f2: fs[i % fs.length]! * 0.8, dur: 0.06, gain, a: 0.001 }));
}

/** 金屬叮噹（鍊子、撒菱）：調頻正弦，泛音不和諧才像金屬 */
function clinks(at: number[], fs: number[], gain: number, dur = 0.07): Layer[] {
  return at.map((t, i) => ({ wave: 'sine' as const, at: t, f: fs[i % fs.length]!, dur, gain, a: 0.001, fm: { ratio: 2.76, depth: 2600, depth2: 200 } }));
}

export const SFX_DEFS: Record<string, SfxDef> = {
  // ───────── 球球丟忍具 ─────────
  /** 手裏劍：短促的「咻」＋一點金屬亮音 */
  throw: {
    jit: 1.2, max: 3, gap: 0.05, vol: 2.5,
    layers: [
      { wave: 'noise', dur: 0.12, gain: 0.55, a: 0.004, filter: { type: 'bandpass', f: 2200, f2: 6500, q: 2.2 } },
      { wave: 'sine', dur: 0.08, gain: 0.1, f: 2400, f2: 3600, a: 0.002 },
    ],
  },
  /** 棒手裏劍連射：很短的「嗤」，輕快、疊起來不吵 */
  throw_bo: {
    jit: 2, max: 2, gap: 0.06, vol: 3.44,
    layers: [
      { wave: 'noise', dur: 0.05, gain: 0.45, a: 0.002, filter: { type: 'bandpass', f: 4200, f2: 7000, q: 2.5 } },
      { wave: 'square', dur: 0.035, gain: 0.06, f: 1500, f2: 900, a: 0.001 },
    ],
  },
  /** 風魔大手裏劍：重的「呼嗡」，帶旋轉的嗡嗡聲 */
  throw_fuma: {
    jit: 0.8, max: 2, gap: 0.1, vol: 1.6,
    layers: [
      { wave: 'noise', dur: 0.34, gain: 0.55, a: 0.02, filter: { type: 'bandpass', f: 450, f2: 2200, q: 1.4 } },
      { wave: 'triangle', dur: 0.32, gain: 0.2, f: 170, f2: 340, a: 0.02, vib: [22, 30] },
    ],
  },
  /** 火藥竹筒：噴火的「呼呼」（低頻轟＋抖動的雜訊） */
  throw_flame: {
    jit: 0.6, max: 2, gap: 0.12,
    layers: [
      { wave: 'noise', dur: 0.44, gain: 0.6, a: 0.02, trem: [13, 0.7], filter: { type: 'lowpass', f: 2600, f2: 700, q: 0.8 } },
      { wave: 'noise', dur: 0.2, gain: 0.25, a: 0.005, filter: { type: 'bandpass', f: 900, q: 1 } },
      { wave: 'sine', dur: 0.38, gain: 0.35, f: 95, f2: 55, a: 0.01 },
    ],
  },
  /** 撒菱：一把撒出去「嘩啦」（一串高音叮叮＋沙沙） */
  throw_caltrop: {
    jit: 0.8, max: 2, gap: 0.1,
    layers: [
      { wave: 'noise', dur: 0.24, gain: 0.25, a: 0.005, filter: { type: 'highpass', f: 3500 } },
      ...clinks([0, 0.03, 0.065, 0.1, 0.14, 0.19], [3100, 2500, 3700, 2800, 4200, 2300], 0.1, 0.06),
    ],
  },
  /** 鎖鎌：鐵鍊嘩啦甩出去，最後「鏘」一聲 */
  throw_chain: {
    jit: 0.6, max: 2, gap: 0.1,
    layers: [
      { wave: 'noise', dur: 0.24, gain: 0.35, a: 0.01, filter: { type: 'bandpass', f: 1200, f2: 3200, q: 1.5 } },
      ...clinks([0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15], [1900, 2300, 1700, 2600, 2000, 2400, 1800], 0.08, 0.05),
      { wave: 'sine', at: 0.17, dur: 0.3, gain: 0.16, f: 880, a: 0.001, fm: { ratio: 2.76, depth: 1800, depth2: 60 } },
    ],
  },
  /** 式神紙鶴：紙片拍翅的沙沙聲＋上揚的法術亮音 */
  throw_crane: {
    jit: 0.8, max: 2, gap: 0.08, vol: 1.4,
    layers: [
      { wave: 'noise', dur: 0.26, gain: 0.3, a: 0.01, trem: [28, 0.9], filter: { type: 'bandpass', f: 3000, q: 1.2 } },
      { wave: 'sine', at: 0.02, dur: 0.16, gain: 0.12, f: hz(84), f2: hz(88) },
      { wave: 'sine', at: 0.09, dur: 0.2, gain: 0.1, f: hz(91), f2: hz(96) },
    ],
  },
  /** 鼠火：引信嘶嘶＋老鼠吱吱 */
  throw_mouse: {
    jit: 1, max: 2, gap: 0.1, vol: 1.1,
    layers: [
      { wave: 'noise', dur: 0.3, gain: 0.22, a: 0.01, trem: [40, 0.6], filter: { type: 'highpass', f: 5000 } },
      { wave: 'square', at: 0.02, dur: 0.07, gain: 0.07, f: 1900, f2: 2700, filter: { type: 'lowpass', f: 5000 } },
      { wave: 'square', at: 0.12, dur: 0.08, gain: 0.07, f: 2100, f2: 2900, filter: { type: 'lowpass', f: 5000 } },
    ],
  },
  /** 毛球彈：軟軟的「啵嚶」 */
  throw_yarn: {
    jit: 1.5, max: 2, gap: 0.08, vol: 1.6,
    layers: [
      { wave: 'sine', dur: 0.16, gain: 0.4, fs: [[0, 260], [0.06, 560], [0.16, 480]], vib: [18, 20] },
      { wave: 'triangle', dur: 0.1, gain: 0.1, f: 600, f2: 1100 },
    ],
  },
  /** 吹箭：「噗」一口氣＋高速「咻」 */
  throw_dart: {
    jit: 1, max: 2, gap: 0.08, vol: 2.3,
    layers: [
      { wave: 'noise', dur: 0.06, gain: 0.45, a: 0.003, filter: { type: 'bandpass', f: 800, q: 1 } },
      { wave: 'noise', at: 0.02, dur: 0.09, gain: 0.3, filter: { type: 'bandpass', f: 6000, f2: 9500, q: 4 } },
    ],
  },
  /** 丟副武器（爆裂符、焙烙玉、煙玉）：甩出去的風聲＋引信嗤嗤 */
  throw_bomb: {
    jit: 0.8, max: 2, gap: 0.1, vol: 1.5,
    layers: [
      { wave: 'noise', dur: 0.18, gain: 0.35, a: 0.01, filter: { type: 'bandpass', f: 700, f2: 1500, q: 1.3 } },
      { wave: 'noise', dur: 0.36, gain: 0.16, a: 0.02, trem: [45, 0.7], filter: { type: 'highpass', f: 4500 } },
      { wave: 'triangle', dur: 0.05, gain: 0.12, f: 500, f2: 800 },
    ],
  },

  // ───────── 爆炸 ─────────
  /** 小爆炸（鼠火）：短的轟＋低頻一拳 */
  explosion: {
    jit: 0.8, max: 3, gap: 0.05,
    layers: [
      { wave: 'sine', dur: 0.45, gain: 0.8, f: 150, f2: 40, slide: 0.3, a: 0.002 },
      { wave: 'noise', dur: 0.5, gain: 0.65, a: 0.002, filter: { type: 'lowpass', f: 3200, f2: 300, q: 0.7 } },
      { wave: 'noise', dur: 0.14, gain: 0.3, filter: { type: 'bandpass', f: 1500, q: 0.8 } },
    ],
  },
  /** 大爆炸（爆裂符、焙烙玉、火藥桶、魔王倒下）：厚重、有次低頻、尾巴長 */
  explosion_big: {
    jit: 0.6, max: 3, gap: 0.06,
    layers: [
      { wave: 'sine', dur: 0.95, gain: 0.95, f: 120, f2: 30, slide: 0.7, a: 0.003 },
      { wave: 'sine', dur: 1.1, gain: 0.55, f: 62, f2: 28, a: 0.01 },
      { wave: 'noise', dur: 1.2, gain: 0.8, a: 0.002, filter: { type: 'lowpass', f: 4200, f2: 140, q: 0.7, slide: 1.0 } },
      { wave: 'noise', dur: 0.25, gain: 0.4, filter: { type: 'bandpass', f: 900, q: 0.6 } },
      { wave: 'noise', at: 0.05, dur: 1.35, gain: 0.35, a: 0.08, curve: 'lin', filter: { type: 'lowpass', f: 260 } },
    ],
  },

  // ───────── 打中、倒下、打爛 ─────────
  /** 揮爪打中：刷的一下＋肉肉的「碰」 */
  claw_hit: {
    jit: 1, max: 3, gap: 0.04, vol: 1.6,
    layers: [
      { wave: 'noise', dur: 0.08, gain: 0.5, a: 0.001, filter: { type: 'bandpass', f: 3200, f2: 1200, q: 1.2 } },
      { wave: 'sine', dur: 0.15, gain: 0.7, f: 190, f2: 70, a: 0.001 },
      { wave: 'square', dur: 0.05, gain: 0.18, f: 110, f2: 70, filter: { type: 'lowpass', f: 1500 } },
    ],
  },
  /** 忍具打中敵人（world.ts 目前沒有這個事件，先準備好） */
  hit: {
    jit: 1.5, max: 3, gap: 0.04, vol: 2.0,
    layers: [
      { wave: 'noise', dur: 0.05, gain: 0.4, a: 0.001, filter: { type: 'bandpass', f: 2200, q: 1 } },
      { wave: 'sine', dur: 0.08, gain: 0.4, f: 260, f2: 120, a: 0.001 },
    ],
  },
  /** 打掉敵人的子彈：金屬「叮」 */
  deflect: {
    jit: 1.5, max: 2, gap: 0.05, vol: 2.4,
    layers: [
      { wave: 'sine', dur: 0.16, gain: 0.16, f: 1800, a: 0.001, fm: { ratio: 2.4, depth: 2500, depth2: 100 } },
      { wave: 'noise', dur: 0.03, gain: 0.25, filter: { type: 'highpass', f: 4000 } },
    ],
  },
  /** 鐵羅漢正面擋掉忍具：比「叮」低沉厚重的鐵板「噹」 */
  block_clang: {
    jit: 1, max: 2, gap: 0.08, vol: 1.8,
    layers: [
      { wave: 'sine', dur: 0.35, gain: 0.2, f: 620, a: 0.001, fm: { ratio: 2.76, depth: 1800, depth2: 60 } },
      { wave: 'sine', dur: 0.25, gain: 0.06, f: 1240, a: 0.001 },
      { wave: 'noise', dur: 0.04, gain: 0.3, filter: { type: 'highpass', f: 3000 } },
    ],
  },
  /** 敵人倒下：滑稽的「啵～咻」往下掉＋落地一聲 */
  enemy_down: {
    jit: 1.5, max: 3, gap: 0.05, vol: 1.7,
    layers: [
      { wave: 'noise', dur: 0.08, gain: 0.35, a: 0.001, filter: { type: 'lowpass', f: 1800 } },
      { wave: 'square', dur: 0.24, gain: 0.15, f: 700, f2: 170, a: 0.002, filter: { type: 'lowpass', f: 2600 } },
      { wave: 'sine', dur: 0.16, gain: 0.45, f: 210, f2: 60, a: 0.001 },
      { wave: 'triangle', at: 0.05, dur: 0.12, gain: 0.07, f: hz(93) },
    ],
  },
  /** 木箱、竹籠、攤子打爛：木頭「喀啦」碎掉＋碎片 */
  break: {
    jit: 1, max: 3, gap: 0.05,
    layers: [
      { wave: 'noise', dur: 0.06, gain: 0.6, a: 0.001, filter: { type: 'bandpass', f: 1900, q: 1.5 } },
      { wave: 'noise', dur: 0.26, gain: 0.4, a: 0.002, filter: { type: 'bandpass', f: 520, f2: 300, q: 2 } },
      { wave: 'sine', dur: 0.13, gain: 0.45, f: 170, f2: 90, a: 0.001 },
      ...knocks([0.03, 0.07, 0.11, 0.16, 0.2], [430, 360, 520, 300, 470], 0.25),
    ],
  },
  /** 水桶打爛：木頭碎＋嘩啦水聲 */
  break_barrel: {
    jit: 1, max: 2, gap: 0.05,
    layers: [
      { wave: 'noise', dur: 0.06, gain: 0.55, a: 0.001, filter: { type: 'bandpass', f: 1700, q: 1.5 } },
      { wave: 'sine', dur: 0.12, gain: 0.4, f: 160, f2: 85, a: 0.001 },
      ...knocks([0.03, 0.08], [400, 330], 0.22),
      { wave: 'noise', at: 0.03, dur: 0.4, gain: 0.35, a: 0.02, filter: { type: 'lowpass', f: 3500, f2: 900, q: 1 } },
      { wave: 'sine', at: 0.06, dur: 0.07, gain: 0.18, f: 500, f2: 1100 },
      { wave: 'sine', at: 0.14, dur: 0.07, gain: 0.14, f: 650, f2: 1300 },
    ],
  },
  /** 瞭望台、寨門垮掉：大木頭斷裂的嘎吱聲＋倒塌 */
  break_big: {
    jit: 0.5, max: 2, gap: 0.2,
    layers: [
      { wave: 'noise', dur: 0.1, gain: 0.55, a: 0.001, filter: { type: 'bandpass', f: 1300, q: 1.2 } },
      { wave: 'sawtooth', dur: 0.5, gain: 0.18, f: 95, f2: 60, a: 0.02, vib: [9, 8], filter: { type: 'lowpass', f: 800 } },
      { wave: 'noise', at: 0.15, dur: 0.95, gain: 0.45, a: 0.03, filter: { type: 'lowpass', f: 1600, f2: 200, q: 0.8 } },
      ...knocks([0.2, 0.3, 0.42, 0.55, 0.7], [260, 210, 300, 190, 240], 0.3),
    ],
  },
  /** 橘皮大王的魚乾背包打爛：碎裂＋叮 */
  part_break: {
    max: 1, gap: 0.3,
    layers: [
      { wave: 'noise', dur: 0.22, gain: 0.55, a: 0.002, filter: { type: 'bandpass', f: 900, f2: 500, q: 1.2 } },
      { wave: 'sine', dur: 0.2, gain: 0.5, f: 150, f2: 60, a: 0.001 },
      ...knocks([0.03, 0.09, 0.14], [380, 300, 450], 0.25),
      ...mel('triangle', [[88, 0.12, 0.12], [93, 0.2, 0.3]], 0.12),
    ],
  },

  // ───────── 敵人 ─────────
  /** 敵人發現球球：短短兩聲「！」 */
  enemy_notice: {
    max: 2, gap: 0.15, vol: 1.26,
    layers: mel('square', [[81, 0, 0.06], [88, 0.06, 0.09]], 0.09, { filter: { type: 'lowpass', f: 4000 } }),
  },
  /** 敵人揮擊（木棒、舌頭）：揮空的風聲＋低吼 */
  enemy_attack: {
    jit: 1, max: 2, gap: 0.08, vol: 2.1,
    layers: [
      { wave: 'noise', dur: 0.2, gain: 0.35, a: 0.03, filter: { type: 'bandpass', f: 600, f2: 2000, q: 1.2 } },
      { wave: 'triangle', dur: 0.13, gain: 0.14, f: 170, f2: 110 },
    ],
  },
  /** 敵人丟東西（苦無、魚骨、扇子、葉子）：輕的「咻」＋金屬小聲 */
  enemy_throw: {
    jit: 1, max: 2, gap: 0.08, vol: 4.8,
    layers: [
      { wave: 'noise', dur: 0.13, gain: 0.3, a: 0.004, filter: { type: 'bandpass', f: 1600, f2: 4200, q: 1.8 } },
      { wave: 'triangle', dur: 0.03, gain: 0.1, f: 2200 },
    ],
  },
  /** 震波、肚皮壓、泰山壓頂、踩踏：低沉的「轟咚」 */
  enemy_slam: {
    jit: 0.8, max: 2, gap: 0.1, vol: 0.9,
    layers: [
      { wave: 'sine', dur: 0.5, gain: 0.85, f: 95, f2: 35, slide: 0.35, a: 0.002 },
      { wave: 'noise', dur: 0.45, gain: 0.45, a: 0.002, filter: { type: 'lowpass', f: 700, f2: 120 } },
      { wave: 'sine', dur: 0.2, gain: 0.3, f: 190, f2: 90 },
    ],
  },
  /** 吐火球、狐火：「轟」一口火＋怪怪的哨音 */
  enemy_fire: {
    jit: 1, max: 2, gap: 0.1, vol: 2.1,
    layers: [
      { wave: 'noise', dur: 0.3, gain: 0.4, a: 0.02, filter: { type: 'bandpass', f: 400, f2: 1600, q: 1 } },
      { wave: 'sine', dur: 0.24, gain: 0.1, f: 300, f2: 750, vib: [9, 25] },
    ],
  },
  /** 噴水、吹泡泡：「啵啵」 */
  enemy_water: {
    jit: 1.5, max: 2, gap: 0.08, vol: 0.65,
    layers: [
      { wave: 'sine', dur: 0.08, gain: 0.3, f: 380, f2: 900 },
      { wave: 'sine', at: 0.07, dur: 0.08, gain: 0.25, f: 480, f2: 1100 },
      { wave: 'noise', dur: 0.14, gain: 0.14, filter: { type: 'lowpass', f: 2200 } },
    ],
  },
  /** 叫小兵、分身、變石像：一團煙＋往下走的怪音 */
  enemy_summon: {
    max: 1, gap: 0.3, vol: 1.35,
    layers: [
      { wave: 'noise', dur: 0.32, gain: 0.3, a: 0.02, filter: { type: 'bandpass', f: 1000, q: 1 } },
      ...mel('square', [[76, 0, 0.09], [71, 0.08, 0.09], [67, 0.16, 0.16]], 0.08, { filter: { type: 'lowpass', f: 2200 } }),
    ],
  },
  /** 咬、撲、被舌頭抓：快速「喀」一口 */
  enemy_bite: {
    jit: 1, max: 2, gap: 0.08, vol: 1.9,
    layers: [
      { wave: 'noise', dur: 0.045, gain: 0.4, a: 0.001, filter: { type: 'highpass', f: 1800 } },
      { wave: 'square', dur: 0.07, gain: 0.12, f: 320, f2: 150, filter: { type: 'lowpass', f: 2000 } },
    ],
  },
  /** 衝鋒（山豬）：噴鼻＋低沉的轟隆 */
  enemy_charge: {
    max: 1, gap: 0.2, vol: 1.8,
    layers: [
      { wave: 'noise', dur: 0.42, gain: 0.5, a: 0.02, trem: [17, 0.8], filter: { type: 'lowpass', f: 450 } },
      { wave: 'sawtooth', dur: 0.36, gain: 0.18, f: 95, f2: 70, filter: { type: 'lowpass', f: 420 } },
      { wave: 'noise', dur: 0.12, gain: 0.25, filter: { type: 'bandpass', f: 1400, q: 2 } },
    ],
  },
  /** 烏鴉俯衝：往下掉的哨音＋風 */
  enemy_dive: {
    max: 2, gap: 0.1, vol: 1.25,
    layers: [
      { wave: 'sine', dur: 0.36, gain: 0.13, f: 1500, f2: 520 },
      { wave: 'noise', dur: 0.36, gain: 0.22, a: 0.03, filter: { type: 'bandpass', f: 1600, f2: 700, q: 1.5 } },
    ],
  },
  /** 天狗刮風：一陣長的風聲 */
  enemy_wind: {
    max: 1, gap: 0.4,
    layers: [
      { wave: 'noise', dur: 0.9, gain: 0.35, a: 0.15, curve: 'lin', trem: [5, 0.4], filter: { type: 'bandpass', f: 600, f2: 1300, q: 1.2 } },
    ],
  },

  // ───────── 球球 ─────────
  /** 受傷：撞一下＋短短的「嗚」 */
  player_hurt: {
    max: 1, gap: 0.15, vol: 2.3,
    layers: [
      { wave: 'noise', dur: 0.1, gain: 0.4, a: 0.001, filter: { type: 'bandpass', f: 1500, q: 1 } },
      { wave: 'sine', dur: 0.16, gain: 0.5, f: 160, f2: 60, a: 0.001 },
      { wave: 'sawtooth', dur: 0.2, gain: 0.14, fs: [[0, 820], [0.05, 900], [0.2, 450]], filter: { type: 'bandpass', f: 1400, q: 2.5 } },
    ],
  },
  /** 倒下：往下走的四個音＋落地 */
  player_down: {
    max: 1, gap: 0.5,
    layers: [
      ...mel('triangle', [[79, 0, 0.14], [76, 0.13, 0.14], [74, 0.26, 0.14], [67, 0.39, 0.4]], 0.2),
      { wave: 'sine', dur: 0.7, gain: 0.12, f: 500, f2: 110, a: 0.02 },
      ...don(0.55, 0.45),
    ],
  },
  /** 重生從天上掉下來：往上的亮晶晶琶音 */
  respawn: {
    max: 1, gap: 0.5, vol: 1.3,
    layers: [
      ...mel('triangle', [[74, 0, 0.12], [79, 0.06, 0.12], [83, 0.12, 0.12], [86, 0.18, 0.3]], 0.13),
      { wave: 'noise', dur: 0.4, gain: 0.06, a: 0.05, filter: { type: 'highpass', f: 6000 } },
    ],
  },
  /** 掉進坑：往下滑的哨音 */
  fall: {
    max: 1, gap: 0.5, vol: 1.6,
    layers: [{ wave: 'sine', dur: 0.7, gain: 0.22, f: 1300, f2: 180, a: 0.01, vib: [7, 14] }],
  },
  /** 撞到魔王的刺：尖銳的「叮刺」 */
  thorns: {
    max: 1, gap: 0.2, vol: 2.4,
    layers: [
      { wave: 'sine', dur: 0.12, gain: 0.16, f: 2600, a: 0.001, fm: { ratio: 3.5, depth: 4000, depth2: 300 } },
      { wave: 'noise', dur: 0.05, gain: 0.25, filter: { type: 'highpass', f: 5000 } },
      { wave: 'square', dur: 0.1, gain: 0.08, f: 700, f2: 350, filter: { type: 'lowpass', f: 3000 } },
    ],
  },
  /** 煙玉：「噗」一大團煙 */
  smoke: {
    max: 1, gap: 0.3, vol: 1.25,
    layers: [
      { wave: 'noise', dur: 0.6, gain: 0.5, a: 0.02, filter: { type: 'lowpass', f: 1300, f2: 280 } },
      { wave: 'noise', dur: 0.3, gain: 0.12, a: 0.01, filter: { type: 'bandpass', f: 3200, q: 1 } },
      { wave: 'sine', dur: 0.2, gain: 0.3, f: 150, f2: 80 },
      ...mel('sine', [[91, 0.1, 0.2], [96, 0.18, 0.3]], 0.05),
    ],
  },

  // ───────── 撿東西、村貓 ─────────
  /** 撿到魚乾、飯糰：上揚的「叮叮」 */
  pickup: {
    max: 2, gap: 0.06, vol: 1.6,
    layers: [
      ...mel('square', [[83, 0, 0.07], [88, 0.065, 0.2]], 0.08, { filter: { type: 'lowpass', f: 5000 } }),
      ...mel('sine', [[95, 0, 0.07], [100, 0.065, 0.2]], 0.07),
    ],
  },
  /** 撿到忍具、副武器：快速往上的琶音＋亮亮的和弦 */
  pickup_weapon: {
    max: 1, gap: 0.15,
    layers: [
      ...mel('triangle', [[74, 0, 0.08], [79, 0.045, 0.08], [83, 0.09, 0.08], [86, 0.135, 0.08]], 0.16),
      ...mel('triangle', [[91, 0.18, 0.4], [95, 0.18, 0.4]], 0.1),
      { wave: 'sine', at: 0.18, dur: 0.45, gain: 0.07, f: hz(98), fm: { ratio: 3, depth: 800, depth2: 20 } },
    ],
  },
  /** 村貓道謝：「喵～」＋可愛的四個音 */
  thank_you: {
    max: 1, gap: 0.3, vol: 1.25,
    layers: [
      { wave: 'sawtooth', dur: 0.3, gain: 0.16, a: 0.02, fs: [[0, 640], [0.08, 980], [0.3, 620]], filter: { type: 'bandpass', f: 1500, q: 3 } },
      { wave: 'sine', dur: 0.3, gain: 0.08, a: 0.02, fs: [[0, 1280], [0.08, 1960], [0.3, 1240]] },
      ...mel('triangle', [[79, 0.33, 0.1], [81, 0.43, 0.1], [83, 0.53, 0.1], [86, 0.63, 0.32]], 0.14),
      ...mel('sine', [[91, 0.33, 0.1], [93, 0.43, 0.1], [95, 0.53, 0.1], [98, 0.63, 0.32]], 0.05),
    ],
  },

  // ───────── 魔王 ─────────
  /** 魔王出場警報：「嗚～嗚～嗚～」三聲＋太鼓＋低鳴 */
  boss_warning: {
    max: 1, gap: 1,
    layers: [
      ...[0, 0.5, 1.0].map((at): Layer => ({ wave: 'sawtooth', at, dur: 0.46, gain: 0.13, a: 0.02, hold: 0.3, fs: [[0, 560], [0.3, 1120], [0.46, 1000]], filter: { type: 'lowpass', f: 2800 } })),
      ...[0, 0.5, 1.0].map((at): Layer => ({ wave: 'square', at, dur: 0.46, gain: 0.05, a: 0.02, hold: 0.3, fs: [[0, 566], [0.3, 1130], [0.46, 1010]], filter: { type: 'lowpass', f: 2000 } })),
      { wave: 'sine', dur: 1.6, gain: 0.35, f: 55, a: 0.05, hold: 1.1, curve: 'lin' },
      ...don(0, 0.6), ...don(0.5, 0.6), ...don(1.0, 0.8),
    ],
  },
  /** 魔王換階段：低吼（粗糙的鋸齒波＋抖動的雜訊） */
  boss_roar: {
    max: 1, gap: 1,
    layers: [
      { wave: 'sawtooth', dur: 0.95, gain: 0.3, f: 120, f2: 70, a: 0.04, hold: 0.3, vib: [28, 14], filter: { type: 'lowpass', f: 950 } },
      { wave: 'noise', dur: 0.95, gain: 0.35, a: 0.04, hold: 0.3, trem: [30, 0.6], filter: { type: 'bandpass', f: 420, q: 1.2 } },
      { wave: 'sine', dur: 0.9, gain: 0.35, f: 58, f2: 45, a: 0.05, hold: 0.3 },
      ...don(0, 0.7),
    ],
  },
  /** 魔王倒下：重擊＋長長往下沉的聲音＋鑼 */
  boss_down: {
    max: 1, gap: 1,
    layers: [
      { wave: 'noise', dur: 0.2, gain: 0.5, a: 0.001, filter: { type: 'bandpass', f: 1200, q: 0.8 } },
      { wave: 'sine', dur: 1.4, gain: 0.45, f: 230, f2: 40, a: 0.003 },
      { wave: 'square', dur: 1.2, gain: 0.08, f: 440, f2: 110, filter: { type: 'lowpass', f: 1500 } },
      { wave: 'noise', dur: 1.5, gain: 0.4, a: 0.01, filter: { type: 'lowpass', f: 2200, f2: 110 } },
      { wave: 'sine', at: 0.05, dur: 1.6, gain: 0.2, f: 110, fm: { ratio: 1.41, depth: 260, depth2: 10 } },
    ],
  },

  // ───────── 任務、接關、結算 ─────────
  /** 任務開始：法螺號角「叭叭叭～」＋太鼓 */
  mission_start: {
    max: 1, gap: 1,
    layers: [
      ...mel('sawtooth', [[69, 0, 0.2], [74, 0.22, 0.2], [76, 0.44, 0.75]], 0.16, { a: 0.03, hold: 0.08, filter: { type: 'lowpass', f: 1700, q: 1.5 } }),
      { wave: 'sawtooth', at: 0.44, dur: 0.75, gain: 0.06, f: hz(64), a: 0.05, hold: 0.3, filter: { type: 'lowpass', f: 1200 } },
      { wave: 'sine', at: 0.5, dur: 0.7, gain: 0.08, f: hz(88), a: 0.1, vib: [5.5, 8] },
      ...don(0, 0.6), ...don(0.22, 0.6), ...don(0.44, 0.85),
    ],
  },
  /** 任務完成：往上的號角樂句＋和弦＋太鼓收尾 */
  mission_complete: {
    max: 1, gap: 1,
    layers: [
      ...mel('sawtooth', [[74, 0, 0.13], [76, 0.13, 0.13], [79, 0.26, 0.13], [81, 0.39, 0.13], [86, 0.52, 0.95]], 0.15, { a: 0.02, hold: 0.05, filter: { type: 'lowpass', f: 2200, q: 1.3 } }),
      ...mel('triangle', [[69, 0.52, 0.95], [74, 0.52, 0.95], [78, 0.52, 0.95]], 0.08, { hold: 0.4 }),
      { wave: 'sine', at: 0.52, dur: 1.0, gain: 0.07, f: hz(98), fm: { ratio: 3, depth: 900, depth2: 20 } },
      ...don(0, 0.5), ...don(0.26, 0.5), ...don(0.39, 0.5), ...don(0.52, 0.9),
    ],
  },
  /** 接關？：太鼓兩下＋問句一樣往上的兩個音 */
  continue: {
    max: 1, gap: 1,
    layers: [
      ...don(0, 0.6), ...don(0.18, 0.5),
      ...mel('triangle', [[76, 0.3, 0.2], [83, 0.5, 0.45]], 0.16, { vib: [6, 5] }),
    ],
  },
  /** 接關倒數：木魚「叩」 */
  countdown_tick: {
    max: 1, gap: 0.5, vol: 2.2,
    layers: [
      { wave: 'triangle', dur: 0.05, gain: 0.3, f: 1250, a: 0.001 },
      { wave: 'sine', dur: 0.09, gain: 0.3, f: 820, a: 0.001 },
    ],
  },
  /** 時間到（扣一條命）：鈴「叮叮」兩聲＋低沉的鑼 */
  time_up: {
    max: 1, gap: 1,
    layers: [
      { wave: 'sine', dur: 0.4, gain: 0.15, f: 1320, a: 0.001, fm: { ratio: 3.5, depth: 1500, depth2: 20 } },
      { wave: 'sine', at: 0.22, dur: 0.4, gain: 0.15, f: 1320, a: 0.001, fm: { ratio: 3.5, depth: 1500, depth2: 20 } },
      { wave: 'sine', at: 0.44, dur: 1.0, gain: 0.25, f: 180, a: 0.002, fm: { ratio: 1.41, depth: 300, depth2: 10 } },
    ],
  },
  /** 畫面上跳提示字：輕輕的兩個音 */
  hint: {
    max: 1, gap: 0.5,
    layers: [
      ...mel('sine', [[88, 0, 0.25], [93, 0.1, 0.4]], 0.08),
      ...mel('triangle', [[76, 0, 0.25], [81, 0.1, 0.4]], 0.05),
    ],
  },
  /** 結算：琴一樣往上撥的五聲音階＋和弦 */
  result: {
    max: 1, gap: 1,
    layers: [
      ...mel('triangle', [[74, 0, 0.35], [76, 0.08, 0.35], [79, 0.16, 0.35], [81, 0.24, 0.35], [83, 0.32, 0.35], [86, 0.4, 0.8]], 0.13),
      ...mel('sine', [[62, 0.4, 0.9], [69, 0.4, 0.9]], 0.12),
    ],
  },
};
