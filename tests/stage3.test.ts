import { describe, expect, it } from 'vitest';
import { P2_HP } from '../src/enemies';
import { LASER_BAND } from '../src/enemies3';
import { VIEW_W, type Shot } from '../src/entities';
import { NO_INPUT, type Frame } from '../src/input';
import { STAGE3 } from '../src/stages/stage3';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { INTRO_FREEZE, World } from '../src/world';
import { fakeAssets } from './botsim';

const DT = 1 / 120;
const F = (o: Partial<Frame> = {}): Frame => ({ ...NO_INPUT, ...o });
const A = fakeAssets();
const MON = Object.fromEntries([...A.monsters].map(([k, v]) => [k, v.lib.defs]));

function stage(extra: Partial<StageDef> = {}): StageDef {
  return {
    id: 't', num: 9, mission: '測試', name: '測試', titleArt: '', panels: 'x', length: 9000, start: 300, timeLimit: 300,
    terrain: new TerrainBuilder(596).flat(9000).build(),
    zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff' }],
    platforms: [], props: [], breakables: [], captives: [], spawns: [], bosses: [], ...extra,
  };
}
function world(extra: Partial<StageDef> = {}, god = true): World {
  const w = new World(stage(extra), A.sprites.defs, MON);
  w.god = god;
  for (let i = 0; i < Math.round((INTRO_FREEZE + 0.05) * 120); i++) w.update(DT, F());
  return w;
}
const run = (w: World, sec: number, f: Frame = F()): void => { for (let i = 0; i < Math.round(sec * 120); i++) w.update(DT, f); };
/** 在 x 丟一發往 dir 飛的手裏劍（直接放進世界，不經過球球的動作） */
function shuriken(w: World, x: number, y: number, dir: 1 | -1, o: Partial<Shot> = {}): Shot {
  const s: Shot = { id: 90000 + w.shots.length, kind: 'shuriken', x, y, vx: dir * 1100, vy: 0, rot: 0, spin: 0, age: 0, life: 2, dmg: 10, r: 20, pierce: false, rehit: 0, phase: 0, target: null, bounces: 0, aim: 'fwd', facing: dir, ...o };
  w.shots.push(s);
  return s;
}

describe('第三關的敵人', () => {
  it('吸塵機器：吸的時候前面飛來的手裏劍被吸掉（打不到牠），吸到了就吐回來', () => {
    const w = world();
    const v = w.spawn('vacuum', w.player.body.x + 400, 596);
    v.facing = -1; v.state = 'suck'; v.t = 0; v.mem.eaten = 0;
    const s = shuriken(w, w.player.body.x + 60, 596 - 60, 1);
    run(w, 0.5);
    expect(w.shots.includes(s)).toBe(false);
    expect(v.hp).toBe(v.maxHp);
    run(w, 1.0);
    expect(w.bullets.some((b) => b.kind === 'pellet')).toBe(true);
  });
  it('鐵羅漢：正面打來的手裏劍擋掉；從背後、出拳（護甲打開）的時候打得進去', () => {
    const w = world();
    const a = w.spawn('iron_arhat', w.player.body.x + 500, 596);
    a.facing = -1; a.mem.cd = 99;
    shuriken(w, a.x - 200, 596 - 100, 1);
    run(w, 0.3);
    expect(a.hp).toBe(a.maxHp);
    expect(w.events.some((e) => e.type === 'blocked')).toBe(true);
    shuriken(w, a.x + 200, 596 - 100, -1);
    run(w, 0.3);
    expect(a.hp).toBe(a.maxHp - 10);
    a.state = 'windup'; a.t = 0;
    shuriken(w, a.x - 200, 596 - 100, 1);
    run(w, 0.25);
    expect(a.hp).toBe(a.maxHp - 20);
  });
  it('鐵羅漢的直拳打在頭的高度：蹲下躲得過、站著會被打', () => {
    for (const duck of [true, false]) {
      const w = world({}, false);
      const a = w.spawn('iron_arhat', w.player.body.x + 180, 596);
      a.facing = -1; a.state = 'windup'; a.t = 0; a.mem.cd = 99;
      run(w, 1.0, F({ down: duck }));
      expect(w.player.hp).toBe(duck ? 3 : 2);
    }
  });
  it('掃把蜈蚣：打倒分裂成三隻小掃把（跟牠同一波）', () => {
    const w = world();
    const c = w.spawn('broom_centipede', w.player.body.x + 500, 596);
    c.group = 7;
    w.damageEnemy(c, 999, { x: c.x, y: c.y - 50, dir: 1, kind: 'test' });
    const kids = w.enemies.filter((e) => e.kind === 'mini_broom');
    expect(kids.length).toBe(3);
    expect(kids.every((k) => k.group === 7)).toBe(true);
  });
  it('機關城城門：守門石獅還在就打不動，石獅打爛才打得動', () => {
    const w = world({ breakables: [{ x: 1400, kind: 's3_gate' }] });
    const gate = w.breakables.find((b) => b.kind === 's3_gate')!;
    const st = w.spawn('guardian_statue', 1150, 596);
    w.damageBreakable(gate, 50, gate.x, gate.y - 100, 1);
    expect(gate.hp).toBe(gate.maxHp);
    w.damageEnemy(st, 9999, { x: st.x, y: st.y - 100, dir: 1, kind: 'test' });
    run(w, 0.1);
    w.damageBreakable(gate, 50, gate.x, gate.y - 100, 1);
    expect(gate.hp).toBe(gate.maxHp - 50);
  });
});

describe('第三關的機關', () => {
  it('蒸氣噴口：在噴的時候站在上面會燙到，不噴的時候沒事', () => {
    const w = world({ vents: [{ x: 700, period: 3, offset: 0 }] }, false);
    w.player.body.x = 700;
    const v = w.stage.vents![0]!;
    // 找一個不噴、也不冒煙的時間點站上去
    while (w.ventState(v).on || w.ventState(v).warn) run(w, 0.05);
    const hp = w.player.hp;
    run(w, 0.2);
    expect(w.player.hp).toBe(hp);
    while (!w.ventState(v).on) run(w, 0.02);
    run(w, 0.1);
    expect(w.player.hp).toBe(hp - 1);
  });
  it('升降台：站上去會被載到上面', () => {
    const w = world({ platforms: [{ x: 500, y: 596, w: 230, look: 'lift', lift: { y1: 396, travel: 1.6, stop: 1.2 } }] });
    const b = w.player.body;
    b.x = 615; b.y = 596; b.onGround = true;
    let top = 596;
    for (let i = 0; i < 120 * 5; i++) { w.update(DT, F()); top = Math.min(top, b.y); }
    expect(top).toBeLessThan(400);
  });
  it('輸送帶：站著不動會被帶走（往左帶的往左）', () => {
    const w = world({ platforms: [{ x: 400, y: 596, w: 600, look: 'conveyor', belt: -120 }] });
    const b = w.player.body;
    b.x = 800; b.y = 596; b.onGround = true;
    run(w, 1);
    expect(b.x).toBeLessThan(800 - 100);
    expect(b.x).toBeGreaterThan(800 - 140);
  });
});

describe('第三關的魔王', () => {
  it('鐵爪機關貓：第一階段打完先換階段（無敵），再換第二階段的血', () => {
    const w = world({ bosses: [{ at: 3500, kind: 'iron_claw', final: true }] });
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    run(w, 4);
    const b = w.boss!;
    b.state = 'idle'; b.t = 0; b.invuln = 0; b.mem.cd = 9;
    w.damageEnemy(b, 99999, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' });
    expect(b.state).toBe('change');
    run(w, 3);
    expect(b.p2).toBe(true);
    expect(b.hp).toBe(P2_HP.iron_claw);
  });
  it('鐵爪雷射：低的站在地上會中、站上屋脊不會；高的站著會中、蹲下不會', () => {
    for (const [low, where, hit] of [[1, 'ground', true], [1, 'ridge', false], [0, 'ground', true], [0, 'crouch', false]] as const) {
      const w = world({ platforms: [{ x: 900, y: 446, w: 200, look: 'ridge' }], bosses: [{ at: 600, kind: 'iron_claw', final: true }] }, false);
      w.skipTo(600 + VIEW_W * 0.42);
      run(w, 3);
      const b = w.boss!;
      b.p2 = true; b.hp = b.maxHp = 1300; b.x = 1600; b.facing = -1; b.mem.cd = 99;
      const p = w.player.body;
      p.x = 1000; p.y = where === 'ridge' ? 446 : 596; p.vy = 0; p.onGround = true;
      w.player.invincible = 0;
      b.state = 'laserWind'; b.t = 0; b.mem.low = low;
      run(w, 2.2, F({ down: where === 'crouch' }));
      expect(w.player.hp < 3).toBe(hit);
      expect(LASER_BAND.low[1]).toBeLessThan(150);   // 屋脊（離地 150）比低雷射高
    }
  });
  it('鐵爪背後飛彈：瞄準圈的地方會炸，離開瞄準圈就沒事', () => {
    for (const [dx, hit] of [[0, true], [320, false]] as const) {
      const w = world({}, false);
      const x = w.player.body.x;
      w.addMark(x + dx, 0.5);
      run(w, 1.6);
      expect(w.player.hp < 3).toBe(hit);
    }
  });
  it('掃地機王衝撞：在衝撞範圍裡站地上會被撞，站上鐵走道就撞不到', () => {
    for (const onWalk of [false, true]) {
      const w = world({ platforms: [{ x: 850, y: 446, w: 240, look: 'catwalk' }], bosses: [{ at: 600, kind: 'roomba_king' }] }, false);
      w.skipTo(600 + VIEW_W * 0.42);
      run(w, 4);
      const r = w.boss!;
      r.x = 1500; r.facing = -1; r.state = 'ramWind'; r.t = 0; r.mem.cd = 99;
      const p = w.player.body;
      p.x = 970; p.y = onWalk ? 446 : 596; p.vy = 0; p.onGround = true; w.player.invincible = 0;
      run(w, 1.4);
      expect(w.player.hp < 3).toBe(!onWalk);
    }
  });
  it('掃地機王吸塵：站著不動會被往吸口拉過去', () => {
    const w = world({ bosses: [{ at: 600, kind: 'roomba_king' }] });
    w.skipTo(600 + VIEW_W * 0.42);
    run(w, 4);
    const r = w.boss!;
    r.x = w.player.body.x + 500; r.facing = -1; r.state = 'suck'; r.t = 0;
    const x0 = w.player.body.x;
    run(w, 1);
    expect(w.player.body.x).toBeGreaterThan(x0 + 100);
  });
});

describe('第三關的資料', () => {
  it('四隻村貓給 L、H、R、爆裂符；魔王在最後、長度＝魔王鎖定點＋一個畫面；地形總長＝關卡長', () => {
    expect(STAGE3.captives.map((c) => c.drop).sort()).toEqual(['H', 'I', 'L', 'R', 'bigbomb', 'bomb']);
    const fin = STAGE3.bosses.find((b) => b.final)!;
    expect(fin.at + VIEW_W).toBe(STAGE3.length);
    expect(STAGE3.terrain.line[STAGE3.terrain.line.length - 1]![0]).toBe(STAGE3.length);
  });
  it('升降台旁邊的牆跳不上去（一定要搭升降台）；屋脊、鐵走道跳得上去', () => {
    const lift = STAGE3.platforms.find((p) => p.look === 'lift')!;
    expect(lift.y - lift.lift!.y1).toBeGreaterThan(173);
    const w = new World(STAGE3, A.sprites.defs, MON);
    for (const p of STAGE3.platforms.filter((q) => q.look === 'catwalk' || q.look === 'ridge')) {
      // 坑上的鐵走道：從旁邊的地面跳上去
      const g = [p.x + 10, p.x + p.w / 2, p.x + p.w - 10].map((x) => w.terrain.groundAt(x)).filter(Number.isFinite);
      expect(Math.min(...g) - p.y).toBeLessThanOrEqual(160);
    }
  });
});
