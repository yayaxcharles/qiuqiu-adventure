import { describe, expect, it } from 'vitest';
import { VIEW_W } from '../src/entities';
import { KING_BODY_CHIP, KING_PACK_HP, P2_HP } from '../src/enemies';
import { NO_INPUT, type Frame } from '../src/input';
import { HURT_IFRAMES, MAX_HP } from '../src/player';
import { parseAnims } from '../src/sprite';
import { STAGE1 } from '../src/stages/stage1';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { Arsenal, WEAPONS } from '../src/weapons';
import { CLEAR_TIME, DOWN_TIME, INTRO_FREEZE, LIVES, World } from '../src/world';

const fr = (n: number) => Array.from({ length: n }, (_, i) => ({ f: `${i}.webp`, ax: 100, ay: 200 }));
const DEFS = parseAnims({
  idle: { fps: 24, loop: true, frames: fr(10) },
  run: { fps: 24, loop: true, frames: fr(12) },
  throw: { fps: 24, loop: false, frames: fr(20), release: 6 },
  claw: { fps: 24, loop: false, frames: fr(40), hit: 12 },
});
const DT = 1 / 120;
const F = (o: Partial<Frame> = {}): Frame => ({ ...NO_INPUT, ...o });

function testStage(extra: Partial<StageDef> = {}): StageDef {
  return {
    id: 'test', num: 9, mission: '測試', name: '測試關', titleArt: '', panels: 'x', length: 8000, start: 300, timeLimit: 300,
    terrain: new TerrainBuilder(596).flat(3000).pit(200).flat(4800).build(),
    zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff' }],
    platforms: [], props: [], breakables: [], captives: [], spawns: [], bosses: [], ...extra,
  };
}
/** 推 sec 秒（跳過開場停頓） */
function run(w: World, sec: number, f: Frame = F()): void { for (let i = 0; i < Math.round(sec * 120); i++) w.update(DT, f); }
function started(stage: StageDef): World { const w = new World(stage, DEFS); run(w, INTRO_FREEZE + 0.05); return w; }

describe('出怪表', () => {
  it('鏡頭走到 at 才出；成群的照間隔一隻一隻從畫面右邊外衝進來', () => {
    const w = started(testStage({ spawns: [{ at: 1000, kind: 'rat', from: 'right', count: 3, gap: 0.5 }] }));
    run(w, 0.5);
    expect(w.enemies.length).toBe(0);
    w.skipTo(1000 + VIEW_W * 0.42 + 5);
    run(w, 0.1);
    expect(w.events.some((e) => e.type === 'spawnWave')).toBe(true);
    expect(w.enemies.length).toBe(1);
    expect(w.enemies[0]!.x).toBeGreaterThan(w.camX + VIEW_W);
    run(w, 1.1);
    expect(w.enemies.filter((e) => e.kind === 'rat').length).toBe(3);
  });
  it('鎖畫面的一波：沒打完鏡頭不往前，打完才解鎖', () => {
    const w = started(testStage({ spawns: [{ at: 1000, kind: 'orange_bandit', from: 'right', lock: true }] }));
    w.skipTo(1000 + VIEW_W * 0.42 + 5);
    run(w, 0.2);
    const lockedAt = w.camX;
    w.god = true;
    run(w, 1.5, F({ right: true }));
    expect(w.camX).toBeLessThanOrEqual(Math.max(lockedAt, 1000) + 0.01);
    for (const e of w.enemies) w.damageEnemy(e, 999, { x: e.x, y: e.y - 50, dir: 1, kind: 'test' });
    run(w, 1.0, F({ right: true }));
    expect(w.locks.size).toBe(0);
    expect(w.camX).toBeGreaterThan(lockedAt + 50);
  });
  it('第一關的資料：每一筆出怪都照鏡頭位置排得到、魔王在最後、長度＝魔王鎖定點＋一個畫面', () => {
    const final = STAGE1.bosses.find((b) => b.final)!;
    expect(final.at + VIEW_W).toBe(STAGE1.length);
    for (const s of STAGE1.spawns) expect(s.at).toBeLessThan(final.at);
    expect(STAGE1.captives.map((c) => c.drop).sort()).toEqual(['D', 'F', 'H', 'S', 'bomb']);
  });
});

describe('忍具彈數', () => {
  it('撿到限量忍具：丟一發少一發，丟完退回手裏劍；撿同一種加彈數', () => {
    const a = new Arsenal();
    expect(a.weapon).toBe('shuriken');
    a.pick('H');
    expect(a.ammo).toBe(WEAPONS.H.ammo);
    a.pick('H');
    expect(a.ammo).toBe(WEAPONS.H.ammo * 2);
    for (let i = 0; i < WEAPONS.H.ammo * 2 - 1; i++) expect(a.use()).toBe('H');
    expect(a.weapon).toBe('H');
    expect(a.use()).toBe('H');
    expect(a.weapon).toBe('shuriken');
    expect(a.ammo).toBe(Infinity);
    a.pick('S'); a.pick('R');
    expect(a.weapon).toBe('R');
    expect(a.ammo).toBe(WEAPONS.R.ammo);
  });
  it('副武器：爆裂符開局 10 個；撿到焙烙玉先用焙烙玉，用完自動換回爆裂符', () => {
    const a = new Arsenal();
    expect(a.subs.bomb).toBe(10);
    expect(a.useSub()).toBe('bomb');
    expect(a.subs.bomb).toBe(9);
    a.pickSub('bigbomb');
    expect(a.sub).toBe('bigbomb');
    for (let i = 0; i < 3; i++) expect(a.useSub()).toBe('bigbomb');
    expect(a.sub).toBe('bomb');
    for (let i = 0; i < 9; i++) expect(a.useSub()).toBe('bomb');
    expect(a.useSub()).toBe(null);
  });
  it('遊戲裡：按住攻擊鍵照冷卻時間連丟，彈數照丟出去的數量扣', () => {
    const w = started(testStage());
    w.player.arsenal.pick('H');
    run(w, 1.0, F({ attackHeld: true }));
    const thrown = WEAPONS.H.ammo - w.player.arsenal.ammo;
    expect(thrown).toBeGreaterThanOrEqual(12);
    expect(thrown).toBeLessThanOrEqual(14);   // 每秒 13 發
    expect(w.events.filter((e) => e.type === 'fire' && e.weapon === 'H').length).toBe(thrown);
  });
});

describe('傷害與無敵時間', () => {
  it('被打扣一滴、之後無敵 1.2 秒（這段時間再被打不算），過了才會再扣', () => {
    const w = started(testStage());
    expect(w.player.hp).toBe(MAX_HP);
    expect(w.hurtPlayer(1)).toBe(true);
    expect(w.player.hp).toBe(MAX_HP - 1);
    run(w, HURT_IFRAMES - 0.1);
    expect(w.hurtPlayer(1)).toBe(false);
    expect(w.player.hp).toBe(MAX_HP - 1);
    run(w, 0.15);
    expect(w.hurtPlayer(1)).toBe(true);
    expect(w.player.hp).toBe(MAX_HP - 2);
  });
  it('血扣光倒下、掉一條命、重生時血補滿；三條命用完出現接關，接關命補滿', () => {
    const w = started(testStage());
    for (let life = 1; life <= LIVES; life++) {
      for (let k = 0; k < MAX_HP; k++) { w.player.invincible = 0; w.hurtPlayer(1); }
      expect(w.lives).toBe(LIVES - life);
      expect(w.state).toBe('dying');
      run(w, DOWN_TIME + 0.1);
      if (life < LIVES) { expect(w.state).toBe('play'); expect(w.player.hp).toBe(MAX_HP); }
    }
    expect(w.state).toBe('continue');
    w.continueGame();
    expect(w.state).toBe('play');
    expect(w.lives).toBe(LIVES);
    expect(w.continues).toBe(1);
  });
  it('敵人的子彈打到會扣血；手裏劍打中敵人扣牠 10', () => {
    const w = started(testStage());
    const b = w.player.body;
    w.addBullet('kunai', b.x + 60, b.y - 110, -500, 0);
    run(w, 0.3);
    expect(w.player.hp).toBe(MAX_HP - 1);
    run(w, 0.6);   // 被打的踉蹌演完
    const e = w.spawn('orange_bandit', w.player.body.x + 500, 596);
    w.player.body.facing = 1;
    run(w, 0.05, F({ attackPressed: true }));
    run(w, 0.6);
    expect(e.hp).toBe(40 - WEAPONS.shuriken.dmg);
  });
  it('掉進坑：扣一滴血，從坑前的安全地面重來', () => {
    const w = started(testStage());
    w.skipTo(2800);
    for (let i = 0; i < 300 && !w.events.some((e) => e.type === 'fellInPit'); i++) w.update(DT, F({ right: true }));
    expect(w.events.some((e) => e.type === 'fellInPit')).toBe(true);
    expect(w.player.hp).toBe(MAX_HP - 1);
    expect(w.player.body.x).toBeLessThan(3000);
  });
});

describe('魔王', () => {
  it('橘皮大王：背包打爛 → 演出之後換第二階段（換立繪、血重新算）；第二階段打倒 → 任務完成 → 結算', () => {
    const w = started(testStage({ bosses: [{ at: 3500, kind: 'orange_king', final: true }] }));
    w.god = true;
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    run(w, 3.5);
    const k = w.boss!;
    expect(k.kind).toBe('orange_king');
    expect(k.part!.hp).toBe(KING_PACK_HP);
    // 打在身上只算一半
    w.damageEnemy(k, 100, { x: k.x, y: k.y - 50, dir: -1, kind: 'test' });
    expect(k.part!.hp).toBeCloseTo(KING_PACK_HP - 100 * KING_BODY_CHIP);
    w.damageEnemy(k, KING_PACK_HP, { x: k.x, y: k.y - 50, dir: -1, kind: 'blast' });
    expect(k.part!.broken).toBe(true);
    expect(k.state).toBe('break');
    expect(k.p2).toBe(false);
    run(w, 1.8);
    expect(k.p2).toBe(true);
    expect(k.hp).toBe(P2_HP.orange_king);
    expect(w.events.some((e) => e.type === 'bossPhase' && e.phase === 2)).toBe(true);
    run(w, 1.0);
    w.damageEnemy(k, 99999, { x: k.x, y: k.y - 100, dir: -1, kind: 'test' });
    expect(k.state).toBe('die');
    run(w, 3.0);
    expect(w.state).toBe('clear');
    run(w, CLEAR_TIME + 0.5);
    expect(w.state).toBe('done');
    expect(w.resultRows().length).toBeGreaterThan(3);
  });
  it('太鼓狸：叫小狸會跳出兩隻；打倒後鏡頭解鎖', () => {
    const w = started(testStage({ bosses: [{ at: 3500, kind: 'drum_tanuki' }] }));
    w.god = true;
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    run(w, 5);
    const t = w.boss!;
    t.state = 'summonWind'; t.t = 0;
    run(w, 0.7);
    expect(w.enemies.filter((e) => e.kind === 'tanuki_kid').length).toBeGreaterThanOrEqual(2);
    w.damageEnemy(t, 99999, { x: t.x, y: t.y - 100, dir: -1, kind: 'test' });
    run(w, 3.0);
    expect(w.boss).toBe(null);
    expect(w.lockX).toBe(null);
  });
});

describe('被綁的村貓', () => {
  it('碰到就放了牠：道謝 → 掏出忍具丟給你 → 撿到換武器', () => {
    const w = started(testStage({ captives: [{ x: 700, art: 'grey', drop: 'S' }] }));
    run(w, 1.6, F({ right: true }));
    expect(w.rescued).toBe(1);
    run(w, 2.5);
    run(w, 1.0, F({ left: true }));
    run(w, 1.0, F({ right: true }));
    expect(w.player.arsenal.weapon).toBe('S');
  });
});
