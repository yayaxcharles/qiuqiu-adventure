/**
 * 第二版階段二：二段跳、貼牆下滑＋蹬牆跳、陡坡、實心方塊、攀爬、畫面往上捲、練習場自動玩（docs/2026-09-28_第二版規劃.md 5.2～5.5、9.3）。
 */
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/autopilot';
import { Game, KEY_HELP, KEY_HELP_TOUCH } from '../src/game';
import { NO_INPUT } from '../src/input';
import { BODY_H, BODY_HW, findClimb, grabClimb, newBody, PARAMS, stepBody, stepClimb, type Body, type Ctrl, type World } from '../src/physics';
import { PRACTICE } from '../src/stages/practice';
import { TerrainBuilder, Terrain } from '../src/terrain';
import { fakeAssets } from './botsim';

const DT = 1 / 120;
const idle: Ctrl = { left: false, right: false, jumpHeld: false, jumpPressed: false };
const FLAT: World = { ground: 600, minX: -1e5, maxX: 1e5, platforms: [] };
const H1 = PARAMS.jumpVel ** 2 / (2 * PARAMS.gravity), H2 = PARAMS.airJumpVel ** 2 / (2 * PARAMS.gravity);

/** 按住跳、到最高點（開始往下）時按第二下；回傳最高點離地多高、有沒有二段跳、第三下有沒有用 */
function doubleJump(w: World = FLAT): { top: number; air: number; third: number } {
  const b = newBody(100, 600);
  let top = b.y, air = 0, third = 0, phase = 0;
  for (let i = 0; i < 400; i++) {
    let press = i === 0;
    if (phase === 0 && i > 5 && b.vy >= 0) { press = true; phase = 1; } else if (phase === 1 && b.vy >= 0 && i > 60) { press = true; phase = 2; }
    const r = stepBody(b, { ...idle, jumpPressed: press, jumpHeld: true }, DT, w);
    if (r.airJumped) { if (phase === 2) third++; else air++; }
    top = Math.min(top, b.y);
    if (b.onGround && i > 10) break;
  }
  return { top: 600 - top, air, third };
}

describe('二段跳', () => {
  it('最高約 177＋129＝306（物理算的），只能一次', () => {
    const r = doubleJump();
    expect(r.air).toBe(1);
    expect(r.third).toBe(0);
    expect(r.top).toBeGreaterThan((H1 + H2) * 0.97);
    expect(r.top).toBeLessThan((H1 + H2) * 1.02);
    expect(r.top).toBeGreaterThan(290);
  });
  it('落地補回：落地後再跳一次還有二段跳', () => {
    const w = FLAT, b = newBody(100, 600);
    stepBody(b, { ...idle, jumpPressed: true, jumpHeld: true }, DT, w);
    for (let i = 0; i < 40; i++) stepBody(b, { ...idle, jumpHeld: true }, DT, w);
    expect(stepBody(b, { ...idle, jumpPressed: true, jumpHeld: true }, DT, w).airJumped).toBe(true);
    for (let i = 0; i < 300 && !b.onGround; i++) stepBody(b, idle, DT, w);
    expect(b.onGround).toBe(true);
    expect(b.airJumps).toBe(PARAMS.airJumps);
  });
  it('快落地時按的跳留給落地那一下（一般跳 960，不是二段跳）', () => {
    const b = newBody(100, 540);
    b.onGround = false; b.vy = 700;
    let air = false, jumped = false;
    for (let i = 0; i < 60 && !jumped; i++) {
      const press = !air && 600 - b.y < b.vy * 0.06 && 600 - b.y > 0;
      const r = stepBody(b, { ...idle, jumpPressed: press, jumpHeld: true }, DT, FLAT);
      air = air || r.airJumped; jumped = r.jumped;
    }
    expect(air).toBe(false);
    expect(jumped).toBe(true);
  });
  it('走出平台邊緣沒跳：空中那一次照樣能用', () => {
    const w: World = { ...FLAT, platforms: [{ x: 0, y: 400, w: 200 }] };
    const b = newBody(190, 400);
    for (let i = 0; i < 24; i++) stepBody(b, { ...idle, right: true }, DT, w);
    expect(b.onGround).toBe(false);
    expect(b.coyote).toBe(0);
    expect(stepBody(b, { ...idle, jumpPressed: true, jumpHeld: true }, DT, w).airJumped).toBe(true);
  });
});

describe('貼牆下滑、蹬牆跳', () => {
  // 右邊一面實心牆（x 500 起），左邊另一面（夾縫 260 寬）
  const W: World = { ...FLAT, solids: [{ x: 500, y: 0, w: 100, h: 600 }, { x: 140, y: 0, w: 100, h: 450 }] };
  const fallAgainst = (): Body => {
    const b = newBody(500 - BODY_HW - 1, 200);
    b.onGround = false;
    return b;
  };
  it('貼牆往下掉最快 240（沒貼著照樣越掉越快）', () => {
    const b = fallAgainst();
    let maxV = 0;
    for (let i = 0; i < 120; i++) { stepBody(b, { ...idle, right: true }, DT, W); maxV = Math.max(maxV, b.vy); }
    expect(b.wall).toBe(1);
    expect(maxV).toBeLessThanOrEqual(PARAMS.wallSlide + 1);
    const c = newBody(300, 100); c.onGround = false;
    for (let i = 0; i < 60; i++) stepBody(c, idle, DT, FLAT);
    expect(c.vy).toBeGreaterThan(600);
  });
  it('蹬牆：往離開牆的方向 560、往上 900；0.15 秒內按回牆那邊無效', () => {
    const b = fallAgainst();
    for (let i = 0; i < 10; i++) stepBody(b, { ...idle, right: true }, DT, W);
    const r = stepBody(b, { ...idle, right: true, jumpPressed: true, jumpHeld: true }, DT, W);
    expect(r.wallJumped).toBe(true);
    expect(b.vx).toBe(-PARAMS.wallJumpVx);
    expect(b.vy).toBeLessThan(-PARAMS.wallJumpVy + PARAMS.gravity * DT + 1);
    expect(b.facing).toBe(-1);
    // 一直按著回牆那邊：鎖方向期間水平速度不變（不會馬上黏回去）
    for (let i = 0; i < 12; i++) stepBody(b, { ...idle, right: true, jumpHeld: true }, DT, W);
    expect(b.vx).toBe(-PARAMS.wallJumpVx);
    expect(b.x).toBeLessThan(500 - BODY_HW - 50);
  });
  it('離開牆 0.1 秒內按跳還算蹬牆；太久就變二段跳', () => {
    const late = (steps: number): { wall: boolean; air: boolean } => {
      const b = fallAgainst();
      for (let i = 0; i < 6; i++) stepBody(b, { ...idle, right: true }, DT, W);
      b.x -= 10;   // 離開牆
      for (let i = 0; i < steps; i++) stepBody(b, idle, DT, W);
      const r = stepBody(b, { ...idle, jumpPressed: true, jumpHeld: true }, DT, W);
      return { wall: r.wallJumped, air: r.airJumped };
    };
    expect(late(6).wall).toBe(true);
    expect(late(20)).toEqual({ wall: false, air: true });
  });
  it('夾縫（260 寬）左右蹬：蹬得比二段跳還高', () => {
    const b = newBody(370, 600);
    let dir = 1, top = 600;
    for (let i = 0; i < 1200; i++) {
      const press = i === 0 || (b.wall !== 0 && b.vy > -600);
      if (press && b.wall !== 0) dir = -b.wall;
      stepBody(b, { ...idle, left: dir < 0, right: dir > 0, jumpPressed: press, jumpHeld: true }, DT, W);
      top = Math.min(top, b.y);
    }
    expect(600 - top).toBeGreaterThan(H1 + H2 + 60);
  });
  it('地形的落差：120 以上算牆、以下不算', () => {
    const mk = (h: number): World => { const t = new Terrain(new TerrainBuilder(600).flat(500).cliff(-h).flat(500).build()); return { ...FLAT, groundAt: t.groundAt }; };
    for (const [h, want] of [[200, 1], [100, 0]] as const) {
      const w = mk(h), b = newBody(480, 600);
      for (let i = 0; i < 30; i++) stepBody(b, { ...idle, right: true }, DT, w);   // 走到牆前
      b.onGround = false; b.y = 520; b.vy = 50;
      stepBody(b, { ...idle, right: true }, DT, w);
      expect(b.wall).toBe(want);
    }
  });
});

describe('陡坡', () => {
  const run = (deg: number, dir: 1 | -1): { speed: number; airSteps: number } => {
    const t = new Terrain(new TerrainBuilder(600, -2000).flat(2000).slopeDeg(900, deg).flat(2000).build());
    const w: World = { ...FLAT, groundAt: t.groundAt };
    const b = newBody(dir > 0 ? 100 : 1000, t.groundAt(dir > 0 ? 100 : 1000));
    let airSteps = 0, speed = 0;
    for (let i = 0; i < 300; i++) {
      stepBody(b, { ...idle, right: dir > 0, left: dir < 0 }, DT, w);
      if (!b.onGround) airSteps++;
      if (b.x > 300 && b.x < 700) speed = Math.abs(b.vx);
    }
    return { speed, airSteps };
  };
  it('30 度上坡約剩 82%、下坡 ×1.1、下坡一路貼地不會一段一段掉', () => {
    expect(run(30, 1).speed).toBeCloseTo(PARAMS.runSpeed * (1 - PARAMS.slopeUp * 0.5), 0);
    const down = run(-32.1, 1);
    expect(down.speed).toBeCloseTo(PARAMS.runSpeed * PARAMS.slopeDown, 0);
    expect(down.airSteps).toBe(0);
    expect(run(30, -1).speed).toBeCloseTo(PARAMS.runSpeed * PARAMS.slopeDown, 0);   // 往左走下坡
  });
  it('舊關卡的坡（最陡 20.4 度）、台階不受影響', () => {
    expect(run(20.4, 1).speed).toBe(PARAMS.runSpeed);
    const t = new Terrain(new TerrainBuilder(600).flat(300).stairs(6, 60, -26).flat(600).build());
    const w: World = { ...FLAT, groundAt: t.groundAt };
    const b = newBody(100, 600);
    let minV = Infinity;
    for (let i = 0; i < 240; i++) { stepBody(b, { ...idle, right: true }, DT, w); if (b.x > 320 && b.x < 640) minV = Math.min(minV, b.vx); }
    expect(minV).toBeGreaterThan(PARAMS.runSpeed * 0.95);
  });
});

describe('實心方塊', () => {
  const W: World = { ...FLAT, solids: [{ x: 400, y: 300, w: 200, h: 150 }] };
  it('側面擋住（身體半寬 22）', () => {
    const b = newBody(200, 600);
    b.y = 440; b.onGround = false; b.vy = 0;
    const w: World = { ...FLAT, solids: [{ x: 400, y: 300, w: 200, h: 300 }] };
    for (let i = 0; i < 200; i++) stepBody(b, { ...idle, right: true }, DT, w);
    expect(b.x).toBeCloseTo(400 - BODY_HW, 3);
  });
  it('從下面跳上來撞頭；從上面掉下來站得住', () => {
    const b = newBody(500, 600);
    let bumped = false;
    for (let i = 0; i < 120; i++) bumped = stepBody(b, { ...idle, jumpPressed: i === 0, jumpHeld: true }, DT, W).bumped || bumped;
    expect(bumped).toBe(true);
    const c = newBody(500, 100); c.onGround = false;
    for (let i = 0; i < 200; i++) stepBody(c, idle, DT, W);
    expect(c.onGround).toBe(true);
    expect(c.y).toBe(300);
    // 站在頂上走出邊緣會掉
    for (let i = 0; i < 200; i++) stepBody(c, { ...idle, right: true }, DT, W);
    expect(c.y).toBe(600);
  });
  it('底下留 16 像素以上走得過去（練習場夾縫左邊那塊）', () => {
    const w: World = { ...FLAT, solids: [{ x: 400, y: 200, w: 200, h: 600 - BODY_H - 16 - 200 }] };
    const b = newBody(300, 600);
    for (let i = 0; i < 240; i++) stepBody(b, { ...idle, right: true }, DT, w);
    expect(b.x).toBeGreaterThan(620);
  });
});

describe('攀爬', () => {
  const W: World = { ...FLAT, platforms: [{ x: 300, y: 200, w: 300 }], climbs: [{ x: 320, top: 200, bottom: 600 }] };
  const up = { up: true, down: false, left: false, right: false, jumpPressed: false };
  it('按 ↑ 抓得住、沒有重力、上爬 230、到頂翻上平台', () => {
    const b = newBody(310, 600);
    const i = findClimb(b, W, up);
    expect(i).toBe(0);
    grabClimb(b, i, W);
    const y0 = b.y;
    for (let k = 0; k < 60; k++) stepClimb(b, { ...up, up: false }, DT, W);
    expect(b.y).toBe(y0);   // 沒按：不會掉
    for (let k = 0; k < 60; k++) stepClimb(b, up, DT, W);
    expect(y0 - b.y).toBeCloseTo(PARAMS.climbUp * 0.5, 0);
    let topped = false;
    for (let k = 0; k < 400 && !topped; k++) topped = stepClimb(b, up, DT, W).topped;
    expect(topped).toBe(true);
    expect(b.onGround).toBe(true);
    expect(b.y).toBe(200);
    expect(b.climb).toBe(-1);
  });
  it('按跳往旁邊跳開（水平 360、往上 700），剛跳開不會馬上又抓回去', () => {
    const b = newBody(320, 500);
    grabClimb(b, 0, W);
    const r = stepClimb(b, { ...up, up: false, left: true, jumpPressed: true }, DT, W);
    expect(r.jumped).toBe(true);
    expect(b.vx).toBe(-PARAMS.climbJumpVx);
    expect(b.vy).toBe(-PARAMS.climbJumpVy);
    expect(findClimb(b, W, up)).toBe(-1);
  });
  it('站在頂端按 ↓ 往下爬、爬到底落地', () => {
    const b = newBody(330, 200);
    const i = findClimb(b, W, { ...up, up: false, down: true });
    expect(i).toBe(0);
    grabClimb(b, i, W);
    let done = false;
    for (let k = 0; k < 400 && !done; k++) done = b.climb < 0 || stepClimb(b, { ...up, up: false, down: true }, DT, W).dropped;
    expect(b.y).toBe(600);
    expect(b.onGround).toBe(true);
  });
});

describe('練習場：新動作那一段', () => {
  const T = new Terrain(PRACTICE.terrain);
  it('每一關卡都「一定要用那個新動作」：二段跳牆 177～306 之間、岩棚高台與藤蔓岩塊比二段跳高、夾縫 200～320 寬', () => {
    const wallH = T.groundAt(4650) - T.groundAt(4750);
    expect(wallH).toBeGreaterThan(H1 + 20);
    expect(wallH).toBeLessThan(H1 + H2 - 30);
    for (const x of [5900, 7580]) expect(596 - PRACTICE.solids!.find((s) => s.x === x)!.y).toBeGreaterThan(H1 + H2 + 20);
    for (const z of PRACTICE.shafts!) { expect(z.x1 - z.x0).toBeGreaterThanOrEqual(200); expect(z.x1 - z.x0).toBeLessThanOrEqual(320); }
    // 岩棚每一層都一跳上得去
    const L = PRACTICE.platforms.filter((p) => p.look === 'ledge').map((p) => p.y).filter((y) => y > 0);
    expect(Math.max(...L.map((y, i) => (i ? L[i - 1]! : 596) - y).filter((d) => d > 0))).toBeLessThan(H1 - 10);
  });
  it('坡照美術實際畫的角度拉（上 30.2°、下 32.1°）', () => {
    const k = (T.groundAt(3850) - T.groundAt(3750)) / 100;
    expect(Math.atan(-k) * 180 / Math.PI).toBeCloseTo(30.2, 0);
  });
  it('自動玩走完練習場：二段跳、蹬牆、攀爬都用到，畫面往上捲超過 1000、爬完才放開往右', () => {
    const g = new Game(fakeAssets());
    g.bot = createBot();
    g.start(PRACTICE);
    let t = 0, minCamY = 0, heldAt = -1;
    const kicked = new Set<number>(), PRACTICE_KICK = PARAMS.wallLock - 2 * DT;
    while (t < 150 && g.world!.player.body.x < PRACTICE.length - 300) {
      g.update(DT, NO_INPUT); t += DT;
      const w = g.world!;
      minCamY = Math.min(minCamY, w.camY);
      const b = w.player.body;
      if (b.lockT > PRACTICE_KICK) PRACTICE.shafts!.forEach((z, i) => { if (b.x > z.x0 - 30 && b.x < z.x1 + 30) kicked.add(i); });
      if (w.vsHolding()) heldAt = Math.max(heldAt, w.camX);
    }
    const w = g.world!, n = (type: string): number => g.eventLog.filter((e) => e.type === type).length;
    expect(w.player.body.x).toBeGreaterThanOrEqual(PRACTICE.length - 300);
    expect(n('airJump')).toBeGreaterThan(0);
    expect(n('wallKick')).toBeGreaterThan(3);
    expect([...kicked].sort()).toEqual([0, 1]);   // 兩道夾縫都是蹬上去的（不是從旁邊繞過去）
    expect(n('climbGrab')).toBe(2);
    expect(n('climbTop')).toBe(2);
    expect(minCamY).toBeLessThan(-1000);
    expect(heldAt).toBeLessThanOrEqual(PRACTICE.vscroll![0]!.hold! + 0.5);
    expect(w.camY).toBe(0);   // 跳下來回到地面：鏡頭回到原本的高度
    expect(w.deaths).toBe(0);
  }, 60000);
  it('往上捲區段外鏡頭不上下動（舊關卡照舊）', () => {
    const g = new Game(fakeAssets());
    g.start(PRACTICE);
    const w = g.world!;
    for (let i = 0; i < 200; i++) g.update(DT, NO_INPUT);
    w.skipTo(5000);
    w.player.body.y = 100; w.player.body.onGround = false;
    for (let i = 0; i < 10; i++) g.update(DT, NO_INPUT);
    expect(w.camY).toBe(0);
  });
});

describe('按鍵一覽', () => {
  it('電腦、手機都寫到二段跳、蹬牆、攀爬、翻滾、斜丟', () => {
    const pc = KEY_HELP.join('\n'), tc = KEY_HELP_TOUCH.join('\n');
    for (const k of ['二段跳', '蹬牆', '藤蔓', '翻滾', '斜上丟']) expect(pc).toContain(k);
    for (const k of ['二段跳', '蹬牆', '藤蔓']) expect(tc).toContain(k);
  });
});
