import { describe, expect, it } from 'vitest';
import { KING_PACK_HP } from '../src/enemies';
import { VIEW_W } from '../src/entities';
import { NO_INPUT } from '../src/input';
import { parseAnims } from '../src/sprite';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { INTRO_FREEZE, World } from '../src/world';

const fr = (n: number) => Array.from({ length: n }, (_, i) => ({ f: `${i}.webp`, ax: 100, ay: 200 }));
const PLAYER = parseAnims({ idle: { fps: 24, loop: true, frames: fr(10) }, run: { fps: 24, loop: true, frames: fr(12) }, throw: { fps: 24, loop: false, frames: fr(20), release: 6 } });
const MON = {
  rat: parseAnims({
    idle: { fps: 24, loop: true, frames: fr(8) }, run: { fps: 24, loop: true, frames: fr(14) },
    attack: { fps: 24, loop: false, frames: fr(60), hit: 20 }, down: { fps: 24, loop: false, frames: fr(80), hurtEnd: 8, fall: 44 },
  }),
  black_ninja: parseAnims({
    idle: { fps: 24, loop: true, frames: fr(8) }, run: { fps: 24, loop: true, frames: fr(16) },
    attack: { fps: 24, loop: false, frames: fr(50), hit: 23 }, down: { fps: 24, loop: false, frames: fr(80), hurtEnd: 8, fall: 41 },
  }),
  orange_king: parseAnims({
    walk: { fps: 24, loop: true, frames: fr(44) }, slam: { fps: 24, loop: false, frames: fr(62), jump: 11, air: 12, land: 21, up: 36 },
    throw: { fps: 24, loop: false, frames: fr(57), hit: 26 }, curl: { fps: 24, loop: false, frames: fr(19) }, roll: { fps: 24, loop: true, frames: fr(8) },
    uncurl: { fps: 24, loop: false, frames: fr(21) }, rage: { fps: 24, loop: false, frames: fr(96), roar: 60, burst: 72 },
    walk_p2: { fps: 24, loop: true, frames: fr(32) }, down_p2: { fps: 24, loop: false, frames: fr(89), hurtEnd: 8, fall: 55 },
  }),
};
const DT = 1 / 120;

function stage(extra: Partial<StageDef> = {}): StageDef {
  return {
    id: 't', num: 9, mission: '測試', name: '測試', titleArt: '', panels: 'x', length: 8000, start: 300, timeLimit: 300,
    terrain: new TerrainBuilder(596).flat(8000).build(), zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff' }],
    platforms: [], props: [], breakables: [], captives: [], spawns: [], bosses: [], ...extra,
  };
}
function world(extra: Partial<StageDef> = {}): World {
  const w = new World(stage(extra), PLAYER, MON);
  w.god = true;
  for (let i = 0; i < Math.round((INTRO_FREEZE + 0.05) * 120); i++) w.update(DT, NO_INPUT);
  return w;
}

describe('怪物的逐格動畫', () => {
  it('鼠兵：魚骨吐出去那一刻畫面剛好是出手格', () => {
    const w = world();
    const e = w.spawn('rat', w.player.body.x + 400, 596);
    let seen = false;
    for (let i = 0; i < 600 && !seen; i++) {
      const before = w.bullets.length;
      w.update(DT, NO_INPUT);
      if (w.bullets.length > before) { seen = true; expect(e.anim!.name).toBe('attack'); expect(e.anim!.frame).toBe(20); }
    }
    expect(seen).toBe(true);
  });
  it('黑衣忍者：苦無飛出去那一刻是出手格', () => {
    const w = world();
    const e = w.spawn('black_ninja', w.player.body.x + 500, 596);
    let seen = false;
    for (let i = 0; i < 1200 && !seen; i++) {
      const before = w.bullets.length;
      w.update(DT, NO_INPUT);
      if (w.bullets.length > before) { seen = true; expect(e.anim!.name).toBe('attack'); expect(e.anim!.frame).toBe(23); }
    }
    expect(seen).toBe(true);
  });
  it('走路時被打：插 0.3 秒受傷格（down 開頭）再回來；打死：在地上播倒下、演完才消失', () => {
    const w = world();
    const e = w.spawn('rat', w.player.body.x + 700, 596);
    for (let i = 0; i < 12; i++) w.update(DT, NO_INPUT);
    expect(e.anim!.name).toBe('run');
    e.maxHp = e.hp = 100;
    w.damageEnemy(e, 10, { x: e.x, y: e.y - 50, dir: 1, kind: 'test' });
    for (let i = 0; i < 12; i++) w.update(DT, NO_INPUT);
    expect(e.anim!.name).toBe('down');
    expect(e.anim!.frame).toBeLessThanOrEqual(8);
    for (let i = 0; i < 40; i++) w.update(DT, NO_INPUT);
    expect(e.anim!.name).not.toBe('down');
    w.damageEnemy(e, 999, { x: e.x, y: e.y - 50, dir: 1, kind: 'test' });
    expect(e.mem.ko).toBe(1);
    const koTime = e.mem.koTime!;
    for (let i = 0; i < Math.round(koTime * 120) - 10; i++) w.update(DT, NO_INPUT);
    expect(e.dead).toBe(false);
    expect(e.anim!.name).toBe('down');
    expect(e.y).toBe(596);   // 倒在地上，不是飛走
    for (let i = 0; i < 120; i++) w.update(DT, NO_INPUT);
    expect(w.enemies.includes(e)).toBe(false);
  });
  it('被爆裂符炸死的照舊轉圈飛出去', () => {
    const w = world();
    const e = w.spawn('rat', w.player.body.x + 400, 596);
    w.damageEnemy(e, 999, { x: e.x, y: e.y - 50, dir: 1, kind: 'blast' });
    expect(e.mem.ko).toBeUndefined();
    expect(e.vy).toBeLessThan(0);
  });
  it('橘皮大王：背包打爛播暴怒（長出刺）→ 換二階走路；二階倒下播 down_p2', () => {
    const w = world({ bosses: [{ at: 3500, kind: 'orange_king', final: true }] });
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    for (let i = 0; i < 400; i++) w.update(DT, NO_INPUT);
    const k = w.boss!;
    w.damageEnemy(k, KING_PACK_HP, { x: k.x, y: k.y - 50, dir: -1, kind: 'blast' });
    for (let i = 0; i < 60; i++) w.update(DT, NO_INPUT);
    expect(k.state).toBe('break');
    expect(k.anim!.name).toBe('rage');
    for (let i = 0; i < 200; i++) w.update(DT, NO_INPUT);
    expect(k.p2).toBe(true);
    expect(k.anim!.name).toBe('walk_p2');
    for (let i = 0; i < 100; i++) w.update(DT, NO_INPUT);   // 換階段後有 0.6 秒無敵
    w.damageEnemy(k, 99999, { x: k.x, y: k.y - 100, dir: -1, kind: 'test' });
    for (let i = 0; i < 30; i++) w.update(DT, NO_INPUT);
    expect(k.anim!.name).toBe('down_p2');
  });
});
