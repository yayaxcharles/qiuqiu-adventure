/**
 * 第二版階段一（docs/2026-09-28_第二版規劃.md 第 2～5.1、7 節）：斜上丟、手裏劍削弱、揮爪修正、翻滾、拿掉教學字幕。
 * 動作圖用真的 anims.json（格數、標記、速度照實際）。
 */
import { damageFor, MAX_HP } from '../src/damage';
import { describe, expect, it } from 'vitest';
import { enemyBox } from '../src/enemies';
import { NO_INPUT, type Frame } from '../src/input';
import { CLAW, ROLL, SHURIKEN_MAX } from '../src/player';
import { parseAnims } from '../src/sprite';
import { STAGES } from '../src/stages';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { WEAPONS } from '../src/weapons';
import { CLAW_DMG, CLAW_DMG_BOSS, INTRO_FREEZE, SHURIKEN_LIFE, SHURIKEN_SPEED, World } from '../src/world';
import ANIMS from '../public/sprites/qiuqiu/anims.json';

const DEFS = parseAnims(ANIMS as unknown as Record<string, unknown>);
const DT = 1 / 120;
const F = (o: Partial<Frame> = {}): Frame => ({ ...NO_INPUT, ...o });
function flatStage(): StageDef {
  return {
    id: 'test', num: 9, mission: '測試', name: '測試關', titleArt: '', panels: 'x', length: 8000, start: 300, timeLimit: 300,
    terrain: new TerrainBuilder(596).flat(8000).build(),
    zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff' }],
    platforms: [], props: [], breakables: [], captives: [], spawns: [], bosses: [],
  };
}
function run(w: World, sec: number, f: Frame = F()): void { for (let i = 0; i < Math.round(sec * 120); i++) w.update(DT, f); }
function started(): World { const w = new World(flatStage(), DEFS); run(w, INTRO_FREEZE + 0.05); w.events.length = 0; return w; }
/** 按一下（只有第一格算「剛按下」），之後照 held 按著 */
function tap(w: World, press: Partial<Frame>, held: Partial<Frame> = {}): void { w.update(DT, F({ ...held, ...press })); }

describe('斜上 45 度丟', () => {
  it('↑＋→：手裏劍朝右上 45 度飛（速度 760）；↑＋←朝左上；只按 ↑ 還是正上方', () => {
    const w = started();
    tap(w, { attackPressed: true }, { up: true, right: true });
    const s = w.shots[0]!;
    expect(s.aim).toBe('diag');
    expect(s.vx).toBeCloseTo(SHURIKEN_SPEED * Math.SQRT1_2, 0);
    expect(s.vy).toBeCloseTo(-SHURIKEN_SPEED * Math.SQRT1_2, 0);

    const w2 = started();
    tap(w2, { attackPressed: true }, { up: true, left: true });
    expect(w2.shots[0]!.vx).toBeLessThan(0);
    expect(w2.shots[0]!.vx).toBeCloseTo(w2.shots[0]!.vy, 0);

    const w3 = started();
    tap(w3, { attackPressed: true }, { up: true });
    expect(w3.shots[0]!.aim).toBe('up');
    expect(w3.shots[0]!.vx).toBeCloseTo(0, 5);
  });

  it('各種忍具斜丟都打得到斜上方的敵人（直線飛的、火藥竹筒、鎖鎌、撒菱、毛球、紙鶴）', () => {
    for (const id of ['shuriken', 'H', 'R', 'F', 'S', 'L', 'C', 'D', 'B'] as const) {
      const w = started();
      w.god = true;
      w.player.arsenal.pick(id);
      const b = w.player.body;
      // 木樁人放在斜上 45 度、離手 230 像素的地方（每一格釘住位置，不讓它掉下來）
      const e = w.spawn('dummy', b.x + 92 + 190, b.y - 168 - 110);
      const pin = (): void => { e.x = b.x + 92 + 190; e.y = b.y - 168 - 110 + 88; e.vy = 0; };
      let hit = false;
      for (let i = 0; i < 120 && !hit; i++) {
        pin();
        w.update(DT, F({ up: true, right: true, attackPressed: i % 30 === 0, attackHeld: true }));
        b.x = 300; b.vx = 0;
        hit = w.events.some((ev) => ev.type === 'hit' && ev.kind === 'dummy');
      }
      expect(hit, id).toBe(true);
    }
  });

  it('副武器斜上：落點在朝前和朝上之間、飛得比朝前高', () => {
    const land = (held: Partial<Frame>): { x: number; top: number } => {
      const w = started();
      const x0 = w.player.body.x;
      tap(w, { subPressed: true }, held);
      let top = Infinity;
      for (let i = 0; i < 600 && w.bombs.length; i++) { top = Math.min(top, w.bombs[0]!.y); w.update(DT, F()); }
      const ex = w.events.find((e) => e.type === 'explode');
      expect(ex).toBeTruthy();
      return { x: (w.explosions[0]?.x ?? NaN) - x0, top };
    };
    const fwd = land({}), up = land({ up: true }), diag = land({ up: true, right: true });
    expect(diag.x).toBeGreaterThan(up.x);
    expect(diag.x).toBeLessThan(fwd.x + 60);   // 按著 → 起跑的速度會帶一點點
    expect(diag.top).toBeLessThan(fwd.top - 60);
  });
});

describe('手裏劍削弱', () => {
  it('數字：速度 760、飛 1 秒、連丟間隔 0.38（10-10 放慢）、同時最多 3 枚、傷害 10 不動', () => {
    expect(SHURIKEN_SPEED * SHURIKEN_LIFE).toBe(760);
    expect(WEAPONS.shuriken.cooldown).toBe(0.38);
    expect(SHURIKEN_MAX).toBe(3);
    expect(WEAPONS.shuriken.dmg).toBe(10);
  });
  it('連按：畫面上已經 3 枚就不出手，飛完一枚才又丟得出去', () => {
    const w = started();
    let most = 0;
    for (let i = 0; i < 240; i++) {
      w.update(DT, F({ attackPressed: i % 12 === 0 }));   // 每 0.1 秒按一次（比連丟間隔還快）
      most = Math.max(most, w.shots.filter((s) => s.kind === 'shuriken').length);
    }
    expect(most).toBe(3);
    expect(w.events.filter((e) => e.type === 'fire').length).toBeGreaterThan(3);
  });
});

describe('揮爪修正', () => {
  it('從第 6 格開始、打中前 2.4 倍速：出手到打中約 0.17 秒', () => {
    const hit = DEFS.claw!.markers.hit!;
    expect((hit - CLAW.from) / DEFS.claw!.fps / CLAW.rate).toBeCloseTo(0.17, 2);
  });
  it('鼠兵全速衝過來：一看到就按攻擊，爪子在牠咬到之前打中、球球不扣血', () => {
    for (const spd of [230, 290]) {
      const w = started();
      const b = w.player.body;
      const e = w.spawn('rat', b.x + 520, b.y);
      e.aware = true; e.state = 'run'; e.mem.spd = spd; e.facing = -1;
      let pressed = -1, hitAt = -1;
      for (let i = 0; i < 240; i++) {
        const want = pressed < 0 && w.meleeTarget(b.x, b.y, b.facing);
        if (want) pressed = i;
        w.update(DT, F({ attackPressed: want }));
        if (hitAt < 0 && w.events.some((ev) => ev.type === 'claw')) hitAt = i;
        if (hitAt >= 0 && i > hitAt + 30) break;
      }
      expect(pressed).toBeGreaterThanOrEqual(0);
      expect(hitAt, `速度 ${spd}`).toBeGreaterThan(pressed);
      expect(w.player.hp).toBe(MAX_HP);
      expect(w.events.some((ev) => ev.type === 'playerHurt')).toBe(false);
    }
  });
  it('打中小兵往後推約 80 像素、僵住 0.25 秒；重的（鐵羅漢）不推', () => {
    for (const [kind, pushed] of [['orange_bandit', true], ['iron_arhat', false]] as const) {
      const w = started();
      const b = w.player.body;
      const e = w.spawn(kind, b.x + 150, b.y);
      e.hp = e.maxHp = 999; e.state = 'walk';
      const x0 = e.x;
      tap(w, { attackPressed: true });
      for (let i = 0; i < 60 && !w.events.some((ev) => ev.type === 'claw'); i++) w.update(DT, F());
      expect(w.events.some((ev) => ev.type === 'claw'), kind).toBe(true);
      if (pushed) expect(e.stun).toBeGreaterThan(0.15);
      run(w, 0.4);
      if (pushed) { expect(e.x - x0).toBeGreaterThan(60); expect(e.x - x0).toBeLessThan(110); }
      else expect(Math.abs(e.x - x0)).toBeLessThan(40);
    }
  });
  it('出爪護身只擋敵人身體碰撞：子彈照樣扣', () => {
    const w = started();
    const b = w.player.body;
    const e = w.spawn('rat', b.x + 160, b.y);
    e.aware = true;
    tap(w, { attackPressed: true });
    expect(w.player.act).toBe('claw');
    expect(w.player.clawGuard()).toBe(true);
    w.bullets.push({ id: 999, kind: 'kunai', x: b.x + 10, y: b.y - 90, vx: -300, vy: 0, g: 0, w: 40, h: 16, rot: 0, spin: 0, age: 0, life: 2, ground: false });
    w.update(DT, F());
    expect(w.player.hp).toBeLessThan(MAX_HP);
  });
  it('魔王：揮爪傷害 25（小兵 40）', () => {
    expect(CLAW_DMG).toBe(40);
    expect(CLAW_DMG_BOSS).toBe(25);
  });
  it('打中判定：身體前方 0～210、高 190', () => {
    expect(CLAW.reach).toEqual([0, 210]);
    expect(CLAW.height).toBe(190);
  });
});

describe('翻滾', () => {
  const rolling = (): World => {
    const w = started();
    tap(w, { dashPressed: true });
    expect(w.player.act).toBe('roll');
    return w;
  };
  it('地上按衝刺鍵＝翻滾：約 0.4 秒、滾約 280 像素、身體矮到 84', () => {
    const w = started();
    const x0 = w.player.body.x;
    tap(w, { dashPressed: true });
    expect(w.player.box().y1 - w.player.box().y0).toBe(ROLL.height);
    let t = DT;
    while (w.player.act === 'roll' && t < 1) { w.update(DT, F()); t += DT; }
    expect(t).toBeCloseTo(ROLL.time, 1);
    expect(w.player.body.x - x0).toBeGreaterThan(250);
    expect(w.player.body.x - x0).toBeLessThan(320);
    expect(w.events.some((e) => e.type === 'roll')).toBe(true);
  });
  it('0.04～0.34 秒內被打不扣血，之外會扣', () => {
    const w1 = rolling();
    run(w1, 0.02);
    expect(w1.player.rollSafe()).toBe(false);
    expect(w1.hurtPlayer(1, 'test')).toBe(true);

    const w2 = rolling();
    run(w2, 0.15);
    expect(w2.player.rollSafe()).toBe(true);
    expect(w2.hurtPlayer(1, 'test')).toBe(false);
    expect(w2.canGrab()).toBe(false);

    const w3 = rolling();
    run(w3, 0.36);
    expect(w3.player.act).toBe('roll');
    expect(w3.player.rollSafe()).toBe(false);
    expect(w3.hurtPlayer(1, 'test')).toBe(true);
  });
  it('穿過衝過來的野豬不扣血', () => {
    const w = started();
    const b = w.player.body;
    const e = w.spawn('wild_boar', b.x + 330, b.y);
    e.aware = true; e.state = 'charge'; e.t = 0; e.facing = -1;
    let rolled = false;
    for (let i = 0; i < 180; i++) {
      const eb = enemyBox(e);
      const go = !rolled && eb.x0 - b.x < 150;
      if (go) rolled = true;
      w.update(DT, F({ dashPressed: go }));
    }
    expect(rolled).toBe(true);
    expect(w.events.some((ev) => ev.type === 'playerHurt')).toBe(false);
    expect(b.x).toBeGreaterThan(e.x);
  });
  it('穿過魔王身體（翻滾中不被推開）', () => {
    const w = started();
    w.god = true;
    const b = w.player.body;
    const e = w.spawn('orange_king', b.x + 260, b.y);
    e.state = 'idle';
    const x0 = b.x;
    tap(w, { dashPressed: true });
    run(w, ROLL.time);
    expect(b.x - x0).toBeGreaterThan(250);
  });
  it('空中按同一顆鍵還是空中衝刺；滾完 0.25 秒內不能再滾', () => {
    const w = started();
    tap(w, { jumpPressed: true }, { jumpHeld: true });
    run(w, 0.1, F({ jumpHeld: true }));
    tap(w, { dashPressed: true });
    expect(w.player.act).toBe('dash');

    const w2 = rolling();
    run(w2, ROLL.time + 0.05);
    tap(w2, { dashPressed: true });
    expect(w2.player.act).not.toBe('roll');
    run(w2, 0.3);
    tap(w2, { dashPressed: true });
    expect(w2.player.act).toBe('roll');
  });
});

describe('不要長篇教學', () => {
  it('三關都沒有教學字幕', () => {
    for (const st of STAGES) expect(st.hints ?? [], st.id).toEqual([]);
  });
});
