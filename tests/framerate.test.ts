/**
 * 螢幕更新率不能改變遊戲結果（09-26 獨立審查 高 1：天狗的風每一小步固定推 1/120 秒份，240 赫茲螢幕上風大一倍多）。
 * 照主迴圈（src/main.ts）的推法：每一格畫面切成不超過 1/120 秒的小步。60 赫茲＝每格兩步 1/120、144 赫茲＝每格一步 1/144、240 赫茲＝一步 1/240。
 * 同一段 0.5 秒，三種更新率推出來的結果要一樣（差幾個像素以內）。
 */
import { describe, expect, it } from 'vitest';
import { heldOnly, NO_INPUT, type Frame } from '../src/input';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { INTRO_FREEZE, World } from '../src/world';
import { fakeAssets } from './botsim';

const A = fakeAssets();
const MON = Object.fromEntries([...A.monsters].map(([k, v]) => [k, v.lib.defs]));
const F = (o: Partial<Frame> = {}): Frame => ({ ...NO_INPUT, ...o });

function stage(extra: Partial<StageDef> = {}): StageDef {
  return {
    id: 't', num: 9, mission: '測試', name: '測試', titleArt: '', panels: 'x', length: 9000, start: 300, timeLimit: 300,
    terrain: new TerrainBuilder(596).flat(9000).build(),
    zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff' }],
    platforms: [], props: [], breakables: [], captives: [], spawns: [], bosses: [], ...extra,
  };
}

/** 照主迴圈的推法跑 sec 秒：每格畫面 1/hz 秒，切成不超過 1/120 秒的小步 */
function runAt(w: World, hz: number, sec: number, f: Frame): void {
  const dt = 1 / hz, n = Math.max(1, Math.ceil(dt / (1 / 120) - 1e-6));
  for (let k = 0; k < Math.round(sec * hz); k++) for (let i = 0; i < n; i++) w.update(dt / n, i === 0 ? f : heldOnly(f));
}

function fresh(extra: Partial<StageDef> = {}): World {
  const w = new World(stage(extra), A.sprites.defs, MON);
  w.god = true;
  for (let i = 0; i < Math.round((INTRO_FREEZE + 0.05) * 120); i++) w.update(1 / 120, F());
  return w;
}

const RATES = [60, 144, 240];

describe('螢幕更新率不影響結果（60／144／240 赫茲）', () => {
  it('天狗的風：頂風往右跑 0.5 秒，退多少跟更新率無關', () => {
    const got = RATES.map((hz) => {
      const w = fresh();
      const x0 = w.player.body.x;
      w.addBullet('gust', x0 + 60, 520, -1, 0, { w: 900, h: 300, life: 5, push: 420 });
      runAt(w, hz, 0.5, F({ right: true }));
      return w.player.body.x - x0;
    });
    expect(Math.max(...got) - Math.min(...got)).toBeLessThan(4);
  });
  it('烏鴉俯衝前抖動：抖完的位置跟更新率無關', () => {
    const got = RATES.map((hz) => {
      const w = fresh();
      const c = w.spawn('crow_small', w.player.body.x + 300, 300);
      c.onGround = false; c.state = 'windup'; c.t = 0; c.aware = true;
      runAt(w, hz, 0.4, F());
      return c.x;
    });
    expect(Math.max(...got) - Math.min(...got)).toBeLessThan(3);
  });
  it('跑步、輸送帶、掃地機王吸人：推出來的位置跟更新率無關', () => {
    const run = (hz: number): number[] => {
      const w = fresh({ platforms: [{ x: 1000, y: 596, w: 800, look: 'conveyor', belt: -120 }] });
      const b = w.player.body;
      runAt(w, hz, 0.5, F({ right: true }));
      const ran = b.x;
      b.x = 1400; b.y = 596; b.vx = 0; b.onGround = true;
      runAt(w, hz, 0.5, F());
      const belt = b.x;
      const r = w.spawn('roomba_king', 2100, 596);
      r.facing = -1; r.state = 'suck'; r.t = 0; r.mem.cd = 99; w.boss = r;
      b.x = 1850;
      runAt(w, hz, 0.5, F());
      return [ran, belt, b.x];
    };
    const [a, b2, c] = RATES.map(run);
    for (let i = 0; i < 3; i++) {
      const v = [a![i]!, b2![i]!, c![i]!];
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(4);
    }
  });
});
