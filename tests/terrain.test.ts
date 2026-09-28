import { describe, expect, it } from 'vitest';
import { newBody, stepBody, STEP_UP, type Ctrl, type World } from '../src/physics';
import { Terrain, TerrainBuilder } from '../src/terrain';

const DT = 1 / 120;
const idle: Ctrl = { left: false, right: false, jumpHeld: false, jumpPressed: false };
const right: Ctrl = { ...idle, right: true };

function worldOf(t: Terrain): World {
  return { ground: 596, minX: -1e6, maxX: 1e6, platforms: [], groundAt: t.groundAt };
}

describe('地形折線', () => {
  const t = new Terrain(new TerrainBuilder(596).flat(100).slope(100, -50).cliff(80).pit(60).flat(100).build());
  it('照 x 查地面高度：平地、斜坡中間、斷崖右側、坑裡', () => {
    expect(t.groundAt(50)).toBe(596);
    expect(t.groundAt(150)).toBeCloseTo(571);
    expect(t.groundAt(200)).toBe(626);        // 垂直落差剛好在 x 上：算右側（低的那邊）
    expect(t.groundAt(199.9)).toBeCloseTo(546, 0);
    expect(t.groundAt(230)).toBe(Infinity);   // 坑
    expect(t.groundAt(300)).toBe(626);
  });
  it('畫地面用的斜段會把坑扣掉、垂直段會列成崖壁', () => {
    const spans = t.spans(0, 400);
    expect(spans.some((s) => s.x0 < 230 && s.x1 > 230)).toBe(false);
    const walls = t.walls(0, 400);
    expect(walls.find((w) => w.x === 200)).toEqual({ x: 200, top: 546, bottom: 626 });
    expect(walls.filter((w) => w.bottom === Infinity).length).toBe(2);   // 坑的兩側
  });
});

describe('在地形上走（手感參數沒動）', () => {
  it('上坡：一路貼著地、不會離地，高度跟著坡走', () => {
    const t = new Terrain(new TerrainBuilder(596).flat(200).slope(400, -150).flat(400).build());
    const b = newBody(100, 596);
    let air = 0;
    for (let i = 0; i < 240; i++) { stepBody(b, right, DT, worldOf(t)); if (!b.onGround) air++; }
    expect(air).toBe(0);
    expect(b.y).toBeCloseTo(t.groundAt(b.x), 3);
    expect(b.x).toBeGreaterThan(600);   // 全速上坡也沒被卡住
  });
  it('下坡：貼著地走下來，不會一小段一小段變成空中', () => {
    const t = new Terrain(new TerrainBuilder(446).flat(200).slope(400, 150).flat(400).build());
    const b = newBody(100, 446);
    let air = 0;
    for (let i = 0; i < 240; i++) { stepBody(b, right, DT, worldOf(t)); if (!b.onGround) air++; }
    expect(air).toBe(0);
    expect(b.y).toBeCloseTo(t.groundAt(b.x), 3);
  });
  it('跑出斷崖：掉下去、落在下面那層地面（有落地事件）', () => {
    const t = new Terrain(new TerrainBuilder(450).flat(300).cliff(146).flat(600).build());
    const b = newBody(200, 450);
    let fell = false, landed = false;
    for (let i = 0; i < 240; i++) {
      const r = stepBody(b, right, DT, worldOf(t));
      if (!b.onGround) fell = true;
      if (r.landed) landed = true;
    }
    expect(fell).toBe(true);
    expect(landed).toBe(true);
    expect(b.y).toBe(596);
  });
  it('高台的崖壁會擋住，要跳才上得去', () => {
    const t = new Terrain(new TerrainBuilder(596).flat(300).cliff(-120).flat(600).build());
    const b = newBody(200, 596);
    for (let i = 0; i < 120; i++) stepBody(b, right, DT, worldOf(t));
    expect(b.x).toBeLessThan(300);
    expect(b.x).toBeGreaterThan(299);
    expect(b.y).toBe(596);
    // 跳上去
    for (let i = 0; i < 120; i++) stepBody(b, { ...right, jumpPressed: i === 0, jumpHeld: true }, DT, worldOf(t));
    expect(b.x).toBeGreaterThan(300);
    expect(b.y).toBe(476);
  });
  it('樓梯：每階不超過 STEP_UP 就直接走上去；往下走也一階一階貼著、不會變成空中', () => {
    const t = new Terrain(new TerrainBuilder(596).flat(200).stairs(4, 50, -(STEP_UP - 8)).flat(300).stairs(4, 50, STEP_UP - 8).flat(400).build());
    const b = newBody(100, 596);
    for (let i = 0; i < 180; i++) stepBody(b, right, DT, worldOf(t));
    expect(b.x).toBeGreaterThan(400);
    expect(b.x).toBeLessThan(700);
    expect(b.y).toBeCloseTo(596 - 4 * (STEP_UP - 8));
    let air = 0;
    for (let i = 0; i < 180; i++) { stepBody(b, right, DT, worldOf(t)); if (!b.onGround) air++; }
    expect(air).toBe(0);
    expect(b.y).toBe(596);
  });
  it('坑：走進去會一直往下掉；助跑跳得過 180 像素寬的坑', () => {
    const t = new Terrain(new TerrainBuilder(596).flat(300).pit(180).flat(600).build());
    const b = newBody(200, 596);
    for (let i = 0; i < 120; i++) stepBody(b, right, DT, worldOf(t));
    expect(b.y).toBeGreaterThan(700);   // 掉進坑（遊戲裡掉到畫面外就扣血）
    const c = newBody(100, 596);
    for (let i = 0; i < 240; i++) {
      const jump = c.x > 270 && c.onGround && c.x < 300;
      stepBody(c, { ...right, jumpPressed: jump, jumpHeld: true }, DT, worldOf(t));
    }
    expect(c.y).toBe(596);
    expect(c.x).toBeGreaterThan(480);
  });
});

describe('第一關拉高的屋頂跳得上去（手感參數沒動）', () => {
  it('地面 → 踏腳木台 → 屋頂 → 下一棟屋頂，一路按住跳就上得去', async () => {
    const { STAGE1 } = await import('../src/stages/stage1');
    const t = new Terrain(STAGE1.terrain);
    const w: World = { ground: 596, minX: 0, maxX: 1e6, platforms: STAGE1.platforms, groundAt: t.groundAt };
    const roofs = STAGE1.platforms.filter((p) => p.look === 'roof' && p.x < 4000);
    const b = newBody(1900, t.groundAt(1900));
    const reached = new Set<number>();
    // 像玩家一樣往右跑：跑到腳下這塊的邊緣、或前面 140 像素內有更高的台子，才按跳（按住 0.3 秒）
    let hold = 0;
    const plats = STAGE1.platforms;
    for (let i = 0; i < 120 * 12 && b.x < 3300; i++) {
      const under = plats.find((p) => Math.abs(b.y - p.y) < 0.5 && b.x >= p.x && b.x <= p.x + p.w);
      const atEdge = !!under && b.x > under.x + under.w - 20;
      const higherAhead = plats.some((p) => p.y < b.y - 20 && p.x > b.x + 40 && p.x < b.x + 140);
      const press = b.onGround && hold <= 0 && (atEdge || higherAhead);
      if (press) hold = 0.3;
      hold -= DT;
      stepBody(b, { ...right, jumpPressed: press, jumpHeld: hold > 0 }, DT, w);
      for (const r of roofs) if (b.onGround && Math.abs(b.y - r.y) < 0.5 && b.x >= r.x && b.x <= r.x + r.w) reached.add(r.x);
    }
    expect([...reached].sort()).toEqual(roofs.map((r) => r.x).sort());
  });
});
