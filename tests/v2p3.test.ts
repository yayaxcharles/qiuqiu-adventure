/**
 * 第二版階段三：第一關加長一倍（docs/2026-09-28_第二版規劃.md 6.2、9.3）。
 * 梯田坡道、山溪瀑布（畫面往上捲的大攀爬）、山路三段新地形：跳得上去、撿得到、自動玩走得到每一段，而且 9 分鐘內破關。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBot } from '../src/autopilot';
import { Game } from '../src/game';
import { NO_INPUT } from '../src/input';
import { BODY_HW, PARAMS } from '../src/physics';
import { S1_SECTIONS, STAGE1 } from '../src/stages/stage1';
import { Terrain } from '../src/terrain';
import { World } from '../src/world';
import V2 from '../public/art/v2/v2.json';
import { fakeAssets, seedRandom } from './botsim';

const DT = 1 / 120;
const H1 = PARAMS.jumpVel ** 2 / (2 * PARAMS.gravity), H2 = PARAMS.airJumpVel ** 2 / (2 * PARAMS.gravity);
const T = new Terrain(STAGE1.terrain);
const VS = STAGE1.vscroll![0]!;
const ledges = STAGE1.platforms.filter((p) => p.look === 'ledge' && p.x > VS.x0 - 100 && p.x < VS.x1);

describe('第一關加長：長度、段落、背景', () => {
  it('42,000 長、魔王鎖在最後一個畫面、限時 1000 秒；六段照順序', () => {
    expect(STAGE1.length).toBe(42000);
    expect(STAGE1.bosses.find((b) => b.final)!.at).toBe(42000 - 1280);
    expect(STAGE1.timeLimit).toBe(1000);
    expect(STAGE1.zones.map((z) => z.name)).toEqual(['黃昏山村', '梯田坡道', '竹林', '山溪瀑布', '山路', '山賊寨']);
    const froms = STAGE1.zones.map((z) => z.from);
    expect([...froms].sort((a, b) => a - b)).toEqual(froms);
    // 中魔王還在竹林的平地上、各段接縫都在平地 596（原本的竹林、山賊寨整段挪過去）
    const mid = STAGE1.bosses.find((b) => !b.final)!;
    expect(mid.at).toBeGreaterThan(S1_SECTIONS.bamboo);
    expect(mid.at).toBeLessThan(S1_SECTIONS.stream);
    for (const x of [S1_SECTIONS.terrace, S1_SECTIONS.bamboo, S1_SECTIONS.stream, S1_SECTIONS.fort]) expect(T.groundAt(x)).toBe(596);
  });
  it('中景長卷（v2.json）照關卡長度捲剛好看完；瀑布攀爬鏡頭停住時，往上延伸的那一欄蓋滿畫面', () => {
    const mid = V2.panels.s1.mid;
    const rMid = (mid.totalW - 1280) / STAGE1.bosses.find((b) => b.final)!.at;
    expect(rMid).toBeCloseTo(mid.rateSuggested, 3);
    const C = V2.climbUp.s1_mid, x = C.x - VS.hold! * rMid;
    expect(x).toBeLessThanOrEqual(0);
    expect(x).toBeGreaterThanOrEqual(1280 - C.w);
    // 往上捲最高：中景往上延伸的那一欄高 2049（中景上下捲 0.8 倍）夠蓋到畫面頂
    expect(-VS.top * 0.8 + 0).toBeLessThanOrEqual(C.height);
  });
});

describe('新段落跳得上去（照物理算）', () => {
  it('梯田：田埂石牆 177～306 之間（一定要二段跳）、農舍屋脊比地面高 220（二段跳才上得去）', () => {
    const wall = STAGE1.terrain.line.find((p, i, a) => i > 0 && a[i - 1]![0] === p[0] && p[0] > S1_SECTIONS.terrace && p[0] < S1_SECTIONS.bamboo)!;
    const h = 596 - wall[1];
    expect(h).toBeGreaterThan(H1 + 10);
    expect(h).toBeLessThan(H1 + H2 - 60);
    const roofs = STAGE1.platforms.filter((p) => p.look === 'roof' && p.x > S1_SECTIONS.terrace && p.x < S1_SECTIONS.bamboo);
    expect(roofs.length).toBe(2);
    for (const r of roofs) { const d = T.groundAt(r.x + r.w / 2) - r.y; expect(d).toBeGreaterThan(H1 + 10); expect(d).toBeLessThan(H1 + H2 - 60); }
  });
  it('新的陡坡都照坡帶實際畫的角度拉（22～33 度）', () => {
    const L = STAGE1.terrain.line;
    const degs: number[] = [];
    for (let i = 1; i < L.length; i++) {
      const [x0, y0] = L[i - 1]!, [x1, y1] = L[i]!;
      if (x1 === x0 || y1 === y0 || x0 < S1_SECTIONS.terrace || (x0 >= S1_SECTIONS.bamboo && x0 < S1_SECTIONS.stream) || x0 >= S1_SECTIONS.fort) continue;
      degs.push(Math.atan(Math.abs(y1 - y0) / (x1 - x0)) * 180 / Math.PI);
    }
    expect(degs.length).toBeGreaterThan(10);
    for (const d of degs) { expect(d).toBeGreaterThan(22); expect(d).toBeLessThan(33); }
  });
  it('瀑布大攀爬：岩棚一層一層一跳上得去、左右隔不到 240；藤蔓頂有岩棚；夾縫 200～320 寬', () => {
    const chain = [...ledges].filter((p) => p.y < 596).sort((a, b) => b.y - a.y);
    let prev = { y: 596, x0: -Infinity, x1: VS.x0 + 480 };
    for (const p of chain) {
      const up = prev.y - p.y;
      // 藤蔓那一段（36 → -324）不用跳
      const vine = STAGE1.climbs!.find((c) => c.bottom === prev.y && c.top === p.y);
      if (!vine) expect(up, `岩棚 ${p.x},${p.y}`).toBeLessThan(H1 - 10);
      expect(Math.max(0, p.x - prev.x1, prev.x0 - (p.x + p.w)), `岩棚 ${p.x},${p.y} 離上一層`).toBeLessThanOrEqual(240);
      prev = { y: p.y, x0: p.x, x1: p.x + p.w };
    }
    for (const z of STAGE1.shafts!) { expect(z.x1 - z.x0).toBeGreaterThanOrEqual(200); expect(z.x1 - z.x0).toBeLessThanOrEqual(320); }
    for (const c of STAGE1.climbs!) {
      const top = [...STAGE1.platforms, ...STAGE1.solids!.map((s) => ({ ...s, look: 'solid' }))].some((p) => Math.abs(p.y - c.top) < 2 && c.x + BODY_HW > p.x && c.x - 40 < p.x + p.w);
      expect(top, `攀爬物 ${c.x} 頂上要有地方站`).toBe(true);
    }
    // 整段攀爬都在鏡頭停住的那一個畫面寬裡（左緣＋36～右緣−36）
    for (const p of ledges) { expect(p.x).toBeGreaterThanOrEqual(VS.hold! + 36); expect(p.x + p.w).toBeLessThanOrEqual(VS.hold! + 1280); }
    // 瀑布：水柱在水潭上面、水口比最高的岩棚還高
    const f = STAGE1.waterfalls![0]!;
    expect(T.groundAt(f.x)).toBe(Infinity);
    expect(f.top).toBeLessThan(Math.min(...ledges.map((p) => p.y)));
  });
});

describe('撿得到', () => {
  const w = new World(STAGE1, fakeAssets().sprites.defs, {});
  /** 照 world 的掉落物物理（重力 1600）算落點：落在站得到的面上（不是坑、不是畫面外） */
  const land = (x: number, y: number, vx: number, vy: number): { x: number; y: number } | null => {
    for (let t = 0; t < 4; t += DT) {
      const y0 = y;
      vy += 1600 * DT; x += vx * DT; y += vy * DT;
      const f = w.floorBelow(x, y0, y);
      if (f) return { x, y: f.y };
      if (y > 720 + 100) return null;
    }
    return null;
  };
  it('被綁的村貓丟過來的東西：往左、往右丟都落在站得到的地方；攀爬段高處的，東西落在同一塊上（鏡頭往右走了就回不去）', () => {
    for (const c of STAGE1.captives) {
      const cy = c.y ?? T.groundAt(c.x);
      for (const dir of [-1, 1]) {
        const p = land(c.x + dir * 20, cy - 150, dir * 170, -560);
        expect(p, `村貓 ${c.x} 往 ${dir} 丟`).not.toBeNull();
        if (c.y !== undefined && c.x > VS.x0 && c.x < VS.x1) expect(p!.y, `村貓 ${c.x}（綁在 ${c.y}）往 ${dir} 丟`).toBe(c.y);
      }
    }
  });
  it('高處的村貓都在二段跳、爬藤蔓梯子、蹬牆上得去的面上（屋頂、岩頂、原木高台）', () => {
    for (const c of STAGE1.captives.filter((k) => k.y !== undefined)) {
      const onRoof = STAGE1.platforms.some((p) => Math.abs(p.y - c.y!) < 1 && c.x > p.x && c.x < p.x + p.w);
      const onSolid = STAGE1.solids!.some((s) => Math.abs(s.y - c.y!) < 1 && c.x > s.x && c.x < s.x + s.w);
      expect(onRoof || onSolid, `村貓 ${c.x},${c.y}`).toBe(true);
    }
  });
  it('木箱、酒桶不在坑裡、不埋在實心方塊裡', () => {
    for (const b of STAGE1.breakables) {
      expect(Number.isFinite(T.groundAt(b.x)), `${b.kind} ${b.x}`).toBe(true);
      expect(STAGE1.solids!.some((s) => b.x > s.x - 30 && b.x < s.x + s.w + 30 && s.y + s.h >= T.groundAt(b.x) - 1), `${b.kind} ${b.x}`).toBe(false);
    }
  });
});

describe('敵人在實心方塊上（第二版階段三補：側面也擋）', () => {
  const mk = (): World => {
    const w = new World({ ...STAGE1, spawns: [], bosses: [] }, fakeAssets().sprites.defs, {});
    w.god = true;
    return w;
  };
  it('擺在瀑布頂的山賊站在岩頂上，走到邊緣就停（不會掉下去、不會走進夾縫）', () => {
    const w = mk();
    w.skipTo(27900);
    const e = w.spawn('orange_bandit', 27700, -850);
    e.aware = true;
    for (let i = 0; i < 600; i++) { e.facing = -1; w.update(DT, NO_INPUT); }
    expect(e.y).toBe(-850);
    expect(e.x).toBeGreaterThanOrEqual(27540);
  });
  it('地上的鼠兵走到原木高台前面就停（不會穿進方塊）', () => {
    const w = mk();
    const log = STAGE1.solids!.find((s) => s.art === 's1_log')!;
    w.skipTo(log.x + log.w + 700);
    const e = w.spawn('rat', log.x + log.w + 80, 596);
    e.aware = true;
    for (let i = 0; i < 240; i++) w.update(DT, NO_INPUT);
    w.player.body.x = log.x - 300;
    for (let i = 0; i < 600; i++) w.update(DT, NO_INPUT);
    expect(e.x).toBeGreaterThanOrEqual(log.x + log.w);
  });
});

describe('自動玩走完加長的第一關', () => {
  let restore: () => void = () => {};
  beforeAll(() => { restore = seedRandom(1); });
  afterAll(() => restore());
  it('每一段都走得到、攀爬段往上捲、兩道夾縫都蹬上去、藤蔓梯子都爬、8 隻村貓都救到，9 分鐘內破關', () => {
    const g = new Game(fakeAssets());
    g.eventCap = 1e6;
    g.bot = createBot();
    g.start(STAGE1);
    const reach: Record<string, number> = {};
    const kicked = new Set<number>();
    let t = 0, minCamY = 0;
    while (t < 540 && g.screen !== 'result' && g.screen !== 'gameover') {
      g.update(DT, NO_INPUT); t += DT;
      const w = g.world;
      if (!w) continue;
      const b = w.player.body;
      for (const [k, x] of Object.entries(S1_SECTIONS)) if (reach[k] === undefined && b.x >= x) reach[k] = +t.toFixed(1);
      minCamY = Math.min(minCamY, w.camY);
      if (b.lockT > PARAMS.wallLock - 2 * DT) STAGE1.shafts!.forEach((z, i) => { if (b.x > z.x0 - 30 && b.x < z.x1 + 30) kicked.add(i); });
    }
    const n = (type: string): number => g.eventLog.filter((e) => e.type === type).length;
    console.log(JSON.stringify({ sec: +t.toFixed(1), reach, deaths: g.world?.deaths, rescued: g.world?.rescued }));
    expect(g.screen).toBe('result');
    expect(t).toBeLessThan(540);
    expect(Object.keys(reach).sort()).toEqual(Object.keys(S1_SECTIONS).sort());
    expect(minCamY).toBeLessThan(-1000);
    expect([...kicked].sort()).toEqual([0, 1]);
    expect(n('climbTop')).toBeGreaterThanOrEqual(2);
    expect(n('airJump')).toBeGreaterThan(0);
    expect(g.eventLog.filter((e) => e.type === 'captiveFreed').length).toBe(STAGE1.captives.length);
  }, 120000);
});
