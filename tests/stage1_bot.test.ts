/**
 * 每一關打得通嗎：用自動玩（src/autopilot.ts）在 Node 裡把關卡從頭玩到結算（不開無敵）。
 * 改了關卡、敵人、數值之後跑這個就知道還打不打得通、要接關幾次。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAGE1 } from '../src/stages/stage1';
import { STAGE2 } from '../src/stages/stage2';
import { STAGE3 } from '../src/stages/stage3';
import { seedRandom, simulate, summary } from './botsim';

let restore: () => void = () => {};
beforeAll(() => { restore = seedRandom(1); });
afterAll(() => restore());

describe('自動玩打得通（不開無敵）', () => {
  it('第一關', () => {
    const r = simulate(STAGE1);
    console.log(JSON.stringify(summary(r), null, 1));
    expect(r.cleared).toBe(true);
  }, 180000);
  it('第二關', () => {
    const r = simulate(STAGE2);
    console.log(JSON.stringify(summary(r), null, 1));
    expect(r.cleared).toBe(true);
  }, 180000);
  it('第三關', () => {
    const r = simulate(STAGE3);
    console.log(JSON.stringify(summary(r), null, 1));
    expect(r.cleared).toBe(true);
  }, 180000);
});
