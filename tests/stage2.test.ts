import { describe, expect, it } from 'vitest';
import { P2_HP } from '../src/enemies';
import { VIEW_W } from '../src/entities';
import { NO_INPUT, type Frame } from '../src/input';
import { STAGE2 } from '../src/stages/stage2';
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
    terrain: new TerrainBuilder(596).flat(1200).pit(200).flat(7600).build(),
    zones: [{ from: 0, name: 'z', ground: 'g', far: 'f', leaves: null, sky: '#fff', water: true }],
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

describe('第二關的敵人', () => {
  it('河童：在水裡的時候打不到（無敵），冒出來噴水，出手那一刻是出手格', () => {
    const w = world({ spawns: [{ at: 0, kind: 'kappa', from: 'water', x: 1300 }] });
    run(w, 0.1);
    w.player.body.x = 850;   // 站到水坑前面（河童看到人才會冒出來）
    const k = w.enemies.find((e) => e.kind === 'kappa')!;
    expect(k.mem.water).toBe(1);
    expect(w.damageEnemy(k, 10, { x: k.x, y: k.y - 50, dir: 1, kind: 'test' })).toBe(false);
    let spat = false;
    for (let i = 0; i < 1200 && !spat; i++) {
      const n = w.bullets.length;
      w.update(DT, F());
      if (w.bullets.length > n && w.bullets.some((b) => b.kind === 'water')) { spat = true; expect(k.anim!.name).toBe('attack'); expect(k.anim!.frame).toBe(k.anim!.def!.markers.hit); }
    }
    expect(spat).toBe(true);
    expect(k.invuln).toBe(0);
  });
  it('面具舞者的扇子：飛出去、轉回來，回到手上就不見', () => {
    const w = world();
    const d = w.spawn('mask_dancer', w.player.body.x + 500, 596);
    d.state = 'windup'; d.t = 0;
    run(w, 0.65);
    const fan = w.bullets.find((b) => b.kind === 'fan')!;
    expect(fan).toBeDefined();
    let far = 0;
    for (let i = 0; i < 400 && fan.age < fan.life; i++) { w.update(DT, F()); far = Math.max(far, Math.abs(fan.x - d.x)); }
    expect(far).toBeGreaterThan(250);
    expect(w.bullets.includes(fan)).toBe(false);
  });
  it('白狐巫女的狐火：會轉彎追人，手裏劍打得掉', () => {
    const w = world();
    const b = w.addBullet('foxfire', w.player.body.x + 400, 300, -150, -60, { homing: 1.3, hp: 1, life: 4 });
    run(w, 0.8);
    expect(b.vy).toBeGreaterThan(0);   // 本來往上飛，轉向往下追球球
    w.player.body.facing = 1;
    b.x = w.player.body.x + 300; b.y = w.player.body.y - 112; b.vx = 0; b.vy = 0; b.homing = 0;
    run(w, 0.05, F({ attackPressed: true }));
    run(w, 0.5);
    expect(w.bullets.includes(b)).toBe(false);
    expect(w.events.some((e) => e.type === 'bulletShot')).toBe(true);
  });
  it('天狗的風：不傷人，把球球往後吹', () => {
    const w = world({}, false);
    const x0 = w.player.body.x;
    w.addBullet('gust', x0 + 100, 520, -1, 0, { w: 560, h: 300, life: 1, push: 420 });
    run(w, 0.8);
    expect(w.player.body.x).toBeLessThan(x0 - 200);
    expect(w.player.hp).toBe(3);
  });
});

describe('第二關的魔王', () => {
  it('蛙大名：舌頭伸出來蹲下躲得過；站著會被抓住拉過去咬一口', () => {
    for (const duck of [true, false]) {
      const w = world({}, false);
      const fg = w.spawn('frog_daimyo', w.player.body.x + 380, 596);
      fg.facing = -1; fg.state = 'tongueWind'; fg.t = 0; fg.group = 1000;
      run(w, 1.6, F({ down: duck }));
      expect(w.player.hp).toBe(duck ? 3 : 2);
      if (!duck) expect(w.events.some((e) => e.type === 'grabbed')).toBe(true);
    }
  });
  it('蛙大名、狸大人：第一階段血打完先演換階段（無敵），再換第二階段的血；第二階段打完才倒', () => {
    for (const kind of ['frog_daimyo', 'tanuki_lord'] as const) {
      const w = world({ bosses: [{ at: 3500, kind, final: true }] });
      w.skipTo(3500 + VIEW_W * 0.42 + 10);
      run(w, 4);
      const b = w.boss!;
      b.state = 'idle'; b.t = 0; b.invuln = 0; b.mem.cd = 9;   // 從待機開始（不要剛好在石像狀態）
      w.damageEnemy(b, 99999, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' });
      expect(b.state).toBe('change');
      expect(b.p2).toBe(false);
      expect(w.damageEnemy(b, 50, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' })).toBe(false);   // 換階段中打不動
      run(w, 3.2);
      expect(b.p2).toBe(true);
      expect(b.hp).toBe(P2_HP[kind]);
      run(w, 1);
      b.state = 'idle'; b.t = 0; b.invuln = 0; b.mem.cd = 9;
      w.damageEnemy(b, 99999, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' });
      expect(b.state).toBe('die');
    }
  });
  it('狸大人二階：分身三隻，打到真的，假的一起散掉', () => {
    const w = world({ bosses: [{ at: 3500, kind: 'tanuki_lord', final: true }] });
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    run(w, 4);
    const b = w.boss!;
    b.p2 = true; b.hp = b.maxHp = 1200; b.state = 'cloneWind'; b.t = 0; b.invuln = 0;
    run(w, 0.8);
    expect(w.enemies.filter((e) => e.kind === 'tanuki_clone' && !e.dead).length).toBe(2);
    w.damageEnemy(b, 10, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' });
    run(w, 0.05);
    expect(w.enemies.filter((e) => e.kind === 'tanuki_clone' && !e.dead).length).toBe(0);
  });
  it('狸大人變石像：石像的時候打不動，裂開後頭暈（可以打）', () => {
    const w = world({ bosses: [{ at: 3500, kind: 'tanuki_lord', final: true }] });
    w.skipTo(3500 + VIEW_W * 0.42 + 10);
    run(w, 4);
    const b = w.boss!;
    b.state = 'stone'; b.t = 0; b.invuln = 0;
    run(w, 1.5);
    expect(w.damageEnemy(b, 10, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' })).toBe(false);
    run(w, 1.5);
    expect(b.state).toBe('dizzy');
    expect(w.damageEnemy(b, 10, { x: b.x, y: b.y - 100, dir: -1, kind: 'test' })).toBe(true);
  });
});

describe('第二關的資料', () => {
  it('四隻村貓給 F、C、R、爆裂符；魔王在最後、長度＝魔王鎖定點＋一個畫面；河童從水坑冒出來', () => {
    expect(STAGE2.captives.map((c) => c.drop).sort()).toEqual(['B', 'C', 'F', 'R', 'bomb', 'smoke']);
    const fin = STAGE2.bosses.find((b) => b.final)!;
    expect(fin.at + VIEW_W).toBe(STAGE2.length);
    const w = new World(STAGE2, A.sprites.defs, MON);
    for (const s of STAGE2.spawns.filter((x) => x.from === 'water')) expect(w.isWaterPit(s.x!) && !Number.isFinite(w.terrain.groundAt(s.x!))).toBe(true);
  });
});

describe('第二關的平台跳得上去（第二批美術：攤位長屋、祭典木台、大鳥居）', () => {
  it('攤位街：地面 → 三間攤位長屋的屋脊；煙火廣場：地面 → 祭典木台 → 大鳥居上橫樑', async () => {
    const { Terrain } = await import('../src/terrain');
    const { newBody, stepBody } = await import('../src/physics');
    const t = new Terrain(STAGE2.terrain);
    const plats = STAGE2.platforms;
    const w = { ground: 596, minX: 0, maxX: 1e6, platforms: plats, groundAt: t.groundAt };
    for (const [from, to, want] of [[1800, 3000, ['stall']], [3700, 4400, ['stage', 'torii']]] as const) {
      const targets = plats.filter((p) => (want as readonly string[]).includes(p.look) && p.x > from && p.x < to);
      const b = newBody(from, t.groundAt(from));
      const reached = new Set<number>();
      let hold = 0;
      // 像玩家一樣往右跑：跑到腳下這塊的邊緣、或前面 10～100 像素有更高的台子，才按跳（按住 0.3 秒）。
      // 這裡的台子比第一關高（140～160，跳最高 173），起跳點要比第一關的屋頂晚一點（實際可起跳的範圍約 230 像素寬）
      for (let i = 0; i < 120 * 12 && b.x < to; i++) {
        const under = plats.find((p) => Math.abs(b.y - p.y) < 0.5 && b.x >= p.x && b.x <= p.x + p.w);
        const atEdge = !!under && b.x > under.x + under.w - 20;
        const higherAhead = plats.some((p) => p.y < b.y - 20 && p.x > b.x + 10 && p.x < b.x + 100);
        const press = b.onGround && hold <= 0 && (atEdge || higherAhead);
        if (press) hold = 0.3;
        hold -= DT;
        stepBody(b, { left: false, right: true, jumpPressed: press, jumpHeld: hold > 0 }, DT, w);
        for (const r of targets) if (b.onGround && Math.abs(b.y - r.y) < 0.5 && b.x >= r.x && b.x <= r.x + r.w) reached.add(r.x);
      }
      expect([...reached].sort()).toEqual(targets.map((r) => r.x).sort());
    }
  });
});
