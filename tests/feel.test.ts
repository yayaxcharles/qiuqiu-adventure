import { afterEach, describe, expect, it } from 'vitest';
import { Feel, FEEL, feelEnabledFromUrl, feelSwitch, type FeelInput } from '../src/feel';

const base: FeelInput = { dt: 1 / 60, onGround: true, vx: 0, vy: 0, facing: 1, runSpeed: 340, dir: 0, jumped: false, landed: false, fallSpeed: 0, calm: false };
const run = (f: Feel, n: number, o: Partial<FeelInput> = {}): void => { for (let i = 0; i < n; i++) f.update({ ...base, ...o }); };

describe('角色手感 feel.ts', () => {
  afterEach(() => { feelSwitch.on = true; });

  it('起跳拉長、落地壓扁，0.4 秒內彈回 1', () => {
    const f = new Feel();
    f.update({ ...base, jumped: true });
    run(f, 4);
    expect(f.scaleY).toBeGreaterThan(1.02);
    run(f, 30);
    expect(Math.abs(f.scaleY - 1)).toBeLessThan(0.01);
    f.update({ ...base, landed: true, fallSpeed: 1400 });
    run(f, 4);
    expect(f.scaleY).toBeLessThan(0.97);
    expect(f.scaleX).toBeGreaterThan(1.01);
    run(f, 30);
    expect(Math.abs(f.scaleY - 1)).toBeLessThan(0.01);
  });

  it('變形有上下限：連續重落地也不會壓成餅', () => {
    const f = new Feel();
    for (let i = 0; i < 10; i++) f.update({ ...base, landed: true, fallSpeed: 5000 });
    expect(f.scaleY).toBeGreaterThanOrEqual(0.8);
  });

  it('跑到最高速往前傾、急停往後仰，calm 狀態回正', () => {
    const f = new Feel();
    run(f, 60, { vx: 340, dir: 1 });
    expect(f.lean * 180 / Math.PI).toBeCloseTo(FEEL.leanDeg, 0);
    // 放開方向、速度在下降＝急停
    for (let i = 0; i < 20; i++) f.update({ ...base, vx: 300 - i * 10, dir: 0 });
    expect(f.lean).toBeLessThan(0);
    run(f, 60, { vx: 340, dir: 1, calm: true });
    expect(Math.abs(f.lean)).toBeLessThan(0.002);
  });

  it('轉身時壓窄、0.12 秒後恢復；calm 狀態轉身不壓', () => {
    const f = new Feel();
    run(f, 5);
    f.update({ ...base, facing: -1 });
    expect(f.scaleX).toBeLessThan(0.7);
    run(f, 10, { facing: -1 });
    expect(f.scaleX).toBeCloseTo(1, 2);
    const g = new Feel();
    g.update({ ...base, facing: -1, calm: true });
    expect(g.scaleX).toBeCloseTo(1, 2);
  });

  it('關掉（F8、?feel=old）時一律是原樣', () => {
    const f = new Feel();
    f.update({ ...base, jumped: true, vx: 340, dir: 1 });
    run(f, 3, { vx: 340, dir: 1 });
    feelSwitch.on = false;
    expect([f.scaleX, f.scaleY, f.lean]).toEqual([1, 1, 0]);
    expect(feelEnabledFromUrl('?feel=old')).toBe(false);
    expect(feelEnabledFromUrl('?pick=2')).toBe(true);
  });
});
