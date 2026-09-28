import { describe, expect, it, vi } from 'vitest';
import { Animator, footRow, parseAnims } from '../src/sprite';

const fr = (n: number) => Array.from({ length: n }, (_, i) => ({ f: `${String(i).padStart(2, '0')}.webp`, ax: 100, ay: 200 }));
const DEFS = parseAnims({
  idle: { fps: 10, loop: true, frames: fr(4) },
  swing: { fps: 10, loop: false, frames: fr(6), hit: 2, src: 'x.mp4' },
  spin: { fps: 10, loop: true, frames: fr(4), tick: 1 },
  _meta: { standHeight: 240 },
});

/** 把 total 秒切成 steps 小步餵進去，收集所有標記 */
function run(a: Animator, total: number, steps: number): string[] {
  const ev: string[] = [];
  for (let i = 0; i < steps; i++) ev.push(...a.update(total / steps));
  return ev;
}

describe('讀 anims.json', () => {
  it('挑出動作、整數欄位當標記、底線開頭的不算動作', () => {
    expect(Object.keys(DEFS).sort()).toEqual(['idle', 'spin', 'swing']);
    expect(DEFS.swing!.markers).toEqual({ hit: 2 });
    expect(DEFS.swing!.src).toBe('x.mp4');
    expect(DEFS.idle!.markers).toEqual({});
  });
});

describe('Animator', () => {
  it('照時間換格：10 fps 過 0.25 秒在第 2 格，不管切成幾小步', () => {
    for (const steps of [1, 3, 25, 240]) {
      const a = new Animator(DEFS);
      a.play('swing');
      run(a, 0.25, steps);
      expect(a.frame).toBe(2);
    }
  });
  it('剛開始播就是第 0 格（換動作那一格就畫得出來）', () => {
    const a = new Animator(DEFS);
    a.play('idle');
    a.update(0.3);
    a.play('swing');
    expect(a.name).toBe('swing');
    expect(a.frame).toBe(0);
    expect(a.current()).toBeDefined();
  });
  it('循環：播過最後一格接回第 0 格', () => {
    const a = new Animator(DEFS);
    a.play('idle');
    a.update(0.45);   // 4.5 格 → 第 0 格
    expect(a.frame).toBe(0);
    a.update(0.5);    // 9.5 格 → 第 1 格
    expect(a.frame).toBe(1);
    expect(a.done).toBe(false);
  });
  it('不循環：停在最後一格，播完的回呼只叫一次', () => {
    const a = new Animator(DEFS);
    const end = vi.fn();
    a.play('swing', { onEnd: end });
    a.update(0.55);
    expect(a.frame).toBe(5);
    expect(end).not.toHaveBeenCalled();   // 最後一格還沒播滿
    a.update(0.1);
    expect(a.done).toBe(true);
    a.update(1);
    a.update(1);
    expect(a.frame).toBe(5);
    expect(end).toHaveBeenCalledTimes(1);
  });
  it('標記只觸發一次：小步慢慢播、一大步跳過去都一樣', () => {
    for (const steps of [1, 2, 7, 100]) {
      const a = new Animator(DEFS);
      a.play('swing');
      const ev = run(a, 1.2, steps);
      expect(ev).toEqual(['hit']);
    }
  });
  it('循環動作的標記每一圈一次', () => {
    const a = new Animator(DEFS);
    a.play('spin');
    const ev = run(a, 1.0, 50);   // 10 格＝兩圈半，第 1 格經過三次
    expect(ev).toEqual(['tick', 'tick', 'tick']);
  });
  it('倍速：2 倍速 0.1 秒走兩格；重播同一個動作不打斷，要求重播才從頭', () => {
    const a = new Animator(DEFS);
    a.play('swing', { rate: 2 });
    a.update(0.1);
    expect(a.frame).toBe(2);
    a.play('swing', { rate: 2 });
    expect(a.frame).toBe(2);
    a.play('swing', { restart: true, rate: 2 });
    expect(a.frame).toBe(0);
    a.play('swing', { rate: 0.5 });   // 播到一半改速度
    a.update(0.2);
    expect(a.frame).toBe(1);
  });
  it('指定一段（from～to）：從 from 開始、播到 to 停住', () => {
    const a = new Animator(DEFS);
    a.play('idle', { from: 1, to: 2 });
    expect(a.frame).toBe(1);
    a.update(1);
    expect(a.frame).toBe(2);
    expect(a.done).toBe(true);
  });
  it('沒有的動作：回傳 false，原本的照播', () => {
    const a = new Animator(DEFS);
    a.play('idle');
    a.update(0.1);
    expect(a.play('jump')).toBe(false);
    expect(a.name).toBe('idle');
    expect(a.frame).toBe(1);
    expect(a.has('jump')).toBe(false);
  });
});

describe('量腳底（修「球球浮在空中」）', () => {
  /** 做一張 w×h 的透明度圖：rows 裡列出的列填上那個透明度 */
  function img(w: number, h: number, rows: Record<number, number>): Uint8ClampedArray {
    const px = new Uint8ClampedArray(w * h * 4);
    for (const [y, a] of Object.entries(rows)) for (let x = 0; x < w; x++) px[(Number(y) * w + x) * 4 + 3] = a;
    return px;
  }
  it('腳下那條淡影（去綠底剩的半透明）不算腳底，只算實心的', () => {
    const px = img(10, 12, { 2: 255, 3: 255, 4: 255, 5: 200, 6: 90, 7: 60, 8: 30, 9: 10 });
    expect(footRow(px, 10, 12)).toBe(6);
  });
  it('只有零星一兩個實心像素的列不算（雜點）', () => {
    const px = img(10, 12, { 3: 255 });
    px[(8 * 10 + 4) * 4 + 3] = 255;   // 第 8 列只有一個點
    expect(footRow(px, 10, 12)).toBe(4);
    expect(footRow(new Uint8ClampedArray(10 * 12 * 4), 10, 12)).toBe(-1);
  });
});
