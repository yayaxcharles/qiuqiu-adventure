/**
 * 09-26 獨立審查（docs/2026-09-26_獨立審查.md）修正的驗收測試：每一條修好的，都有一個會在「沒修之前」紅的測試。
 * 螢幕更新率那一條（高 1）在 tests/framerate.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/autopilot';
import { ENEMY_DEFS } from '../src/enemies';
import { HUD_BOTTOM, VIEW_W, type DropKind } from '../src/entities';
import { Game } from '../src/game';
import { NO_INPUT, type Frame } from '../src/input';
import { STAGES } from '../src/stages';
import { STAGE1 } from '../src/stages/stage1';
import type { StageDef } from '../src/stages/types';
import { TerrainBuilder } from '../src/terrain';
import { SUB_ORDER, WEAPONS } from '../src/weapons';
import { INTRO_FREEZE, World } from '../src/world';
import { fakeAssets, seedRandom } from './botsim';

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

describe('高 2：十種忍具、三種副武器正式關卡都拿得到；有兩種以上副武器時 Q 換得了', () => {
  it('三關的村貓、打得爛的東西加起來，每一種都至少出現一次', () => {
    const got = new Set<DropKind>();
    for (const st of STAGES) {
      for (const c of st.captives) got.add(c.drop);
      for (const b of st.breakables) if (b.drop) got.add(b.drop);
    }
    for (const id of Object.keys(WEAPONS)) if (id !== 'shuriken') expect(got.has(id as DropKind), `忍具 ${id}`).toBe(true);
    for (const s of SUB_ORDER) expect(got.has(s), `副武器 ${s}`).toBe(true);
  });
  it('撿到焙烙玉之後按 Q：在爆裂符和焙烙玉之間換', () => {
    const w = world();
    w.player.arsenal.pickSub('bigbomb');
    expect(w.player.arsenal.sub).toBe('bigbomb');
    w.update(DT, F({ subSwitchPressed: true }));   // 按一下 Q（剛按下只算那一格）
    expect(w.player.arsenal.sub).toBe('bomb');
    run(w, 0.3);
    w.update(DT, F({ subSwitchPressed: true }));
    expect(w.player.arsenal.sub).toBe('bigbomb');
  });
});

describe('高 3：第二階段的橘皮大王（全身是刺）', () => {
  it('在牠前面 160、220、260 像素按攻擊：改丟忍具、不會自己出爪撞刺扣血', () => {
    for (const d of [160, 220, 260]) {
      const w = world({}, false);
      const p = w.player.body;
      const k = w.spawn('orange_king', p.x + d, 596);
      k.p2 = true; k.part!.broken = true; k.state = 'idle'; k.mem.cd = 99; k.facing = -1; k.invuln = 0;
      p.facing = 1;
      const shots0 = w.shots.length;
      run(w, 0.02, F({ attackPressed: true, attackHeld: true }));
      run(w, 0.4);
      expect(w.player.hp, `距離 ${d}`).toBe(3);
      expect(w.events.some((e) => e.type === 'claw'), `距離 ${d}`).toBe(false);
      expect(w.events.some((e) => e.type === 'fire') || w.shots.length > shots0, `距離 ${d}`).toBe(true);
    }
  });
});

describe('中 1：出生點都在關卡範圍內，魔王出場後很快就看得到', () => {
  it('三關所有出怪、魔王的位置都在關卡長度以內', () => {
    for (const st of STAGES) {
      for (const s of st.spawns) if (s.x !== undefined) expect(s.x, `${st.id} ${s.kind}@${s.at}`).toBeLessThanOrEqual(st.length);
      for (const b of st.bosses) expect(b.at + VIEW_W, `${st.id} ${b.kind}`).toBeLessThanOrEqual(st.length);
    }
  });
  it('三關每隻魔王：鏡頭鎖住後 1.5 秒內身體至少一半進到畫面', () => {
    for (const st of STAGES) {
      for (const bd of st.bosses) {
        const w = new World(st, A.sprites.defs, MON);
        w.god = true;
        for (let i = 0; i < 130; i++) w.update(DT, F());
        w.skipTo(bd.at + VIEW_W * 0.42 + 5);
        w.enemies.length = 0;
        let seen = -1;
        for (let t = 0; t < 3 && seen < 0; t += DT) {
          w.update(DT, F());
          const b = w.boss;
          if (b && b.kind === bd.kind && w.onScreen(b.x, 0)) seen = t;
        }
        expect(seen, `${st.id} ${bd.kind}`).toBeGreaterThanOrEqual(0);
        expect(seen, `${st.id} ${bd.kind}`).toBeLessThan(1.5);
      }
    }
  });
  it('自動玩三關：從畫面外（左、右、天上、地洞）出來的小兵，5 秒內都會進到畫面（沒先被打倒的話）', () => {
    for (const st of STAGES) {
      const restore = seedRandom(2);
      const g = new Game(A);
      g.bot = createBot();
      g.start(st);
      const born = new Map<number, { t: number; kind: string; x: number; y: number }>();
      const bad: string[] = [];
      let t = 0;
      while (t < 600 && g.screen !== 'result' && g.screen !== 'gameover') {
        g.update(DT, NO_INPUT); t += DT;
        const w = g.world;
        if (!w || g.screen !== 'play') continue;
        for (const e of w.enemies) {
          const s = e.group >= 0 && e.group < 1000 ? st.spawns[e.group] : undefined;
          if (!s || s.from === 'place' || s.from === 'water') continue;   // 擺好的、躲在水坑裡等人的（河童）不算：位置是固定的
          if (!born.has(e.id)) born.set(e.id, { t, kind: e.kind, x: e.x, y: e.y });
          const b = born.get(e.id)!;
          if (b.t < 0) continue;
          if (w.onScreen(e.x, 0)) { b.t = -1; continue; }
          if (t - b.t > 5 && e.dying <= 0 && !e.dead) { bad.push(`${st.id} ${b.kind} 出生 (${Math.round(b.x)},${Math.round(b.y)}) 5 秒後在 (${Math.round(e.x)},${Math.round(e.y)}) 鏡頭 ${Math.round(w.camX)}`); b.t = -1; }
        }
      }
      restore();
      if (bad.length) console.log(bad.join('\n'));
      expect(bad).toEqual([]);
    }
  }, 300000);
});

describe('中 2：預兆看得到（不在資訊欄裡）', () => {
  it('烏鴉盤旋的時候整隻在資訊欄下面；出招（閃紅＋「！」）的時候也是（換 8 組亂數）', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const restore = seedRandom(seed);
      const w = world();
      const c = w.spawn('crow_small', w.player.body.x + 400, -90);
      c.onGround = false; c.aware = true;
      let top = Infinity;
      for (let i = 0; i < 120 * 8; i++) {
        w.update(DT, F());
        if (c.dead || c.dying > 0) break;
        if (c.state === 'hover' && c.t > 1) top = Math.min(top, c.y - ENEMY_DEFS.crow_small.drawH);
        if (c.warn > 0) expect(c.y - ENEMY_DEFS.crow_small.drawH * 0.9, `亂數 ${seed}`).toBeGreaterThan(HUD_BOTTOM);
      }
      restore();
      expect(top, `亂數 ${seed}`).toBeGreaterThan(HUD_BOTTOM - 10);
    }
  });
  it('天狗從天上下來：整隻進到資訊欄下面之前不出招', () => {
    const w = world();
    const tg = w.spawn('tengu', w.player.body.x + 300, -90);
    tg.onGround = false; tg.aware = true;
    for (let i = 0; i < 120 * 5; i++) {
      w.update(DT, F());
      if (tg.state === 'windup' && tg.t < 0.02) expect(w.fullyVisible(tg)).toBe(true);
    }
  });
});

describe('中 4：還沒打爛的門後面出來的敵人，從門前出來、站在地上', () => {
  it('從右邊出場的點剛好在寨門裡：改到門前、腳踩地面（不是門頂）', () => {
    const w = world({ breakables: [{ x: 1800, kind: 'gate' }], spawns: [{ at: 0, kind: 'orange_bandit', from: 'right' }] });
    w.camX = 1800 - VIEW_W - 70 + 10;   // 右邊出場點＝鏡頭＋畫面寬＋70 → 落在門裡
    run(w, 0.3);
    const e = w.enemies.find((x) => x.kind === 'orange_bandit')!;
    expect(e).toBeDefined();
    expect(e.x).toBeLessThan(1800 - 100);
    expect(e.y).toBeGreaterThan(590);
  });
  it('第一關：鏡頭停在寨門前那一波山賊，沒有站在寨門頂上的', () => {
    const w = new World(STAGE1, A.sprites.defs, MON);
    w.god = true;
    for (let i = 0; i < 130; i++) w.update(DT, F());
    w.skipTo(16800 + 20793 + VIEW_W * 0.42 + 5);   // 第二版加長：山賊寨整段往後挪 20,793
    run(w, 3);
    for (const e of w.enemies.filter((x) => x.kind === 'orange_bandit' && x.dying <= 0)) expect(e.y, `山賊 x=${Math.round(e.x)}`).toBeGreaterThan(400);
  });
});

describe('中 9：魔王跳起來砸之前，落點在蹲下那一刻就決定（地上畫紅圈）', () => {
  it('蛙大名：蹲下的第一格就有落點，而且跳過去真的落在那裡', () => {
    const w = world({ bosses: [{ at: 600, kind: 'frog_daimyo', final: true }] });
    w.skipTo(600 + VIEW_W * 0.42);
    run(w, 4);
    const f = w.boss!;
    f.state = 'jumpWind'; f.t = 0; f.mem.tx = undefined as unknown as number; f.mem.cd = 99;
    run(w, 0.05);
    const tx = f.mem.tx;
    expect(tx).toBeDefined();
    for (let i = 0; i < 240 && f.state !== 'splash'; i++) w.update(DT, F());
    expect(Math.abs(f.x - tx!)).toBeLessThan(30);
  });
});

describe('低級修正', () => {
  it('低 1：飛彈落地的爆炸會傷人（站在落點旁邊 45 像素會扣血）', () => {
    const w = world({}, false);
    w.addMark(w.player.body.x + 45, 0.3);
    run(w, 1.5);
    expect(w.player.hp).toBe(2);
  });
  it('低 2：時間到扣一條命，再給 60 秒', () => {
    const w = world({}, false);
    w.timeLeft = 0.05;
    const lives = w.lives;
    run(w, 0.2);
    expect(w.lives).toBe(lives - 1);
    expect(w.timeLeft).toBeGreaterThan(59);
  });
  it('低 4：接關時爆裂符補到 10 個', () => {
    const w = world({}, false);
    w.player.arsenal.subs.bomb = 0;
    (w as unknown as { state: string }).state = 'continue';
    w.continueGame();
    expect(w.player.arsenal.subs.bomb).toBe(10);
  });
});

describe('09-26：網址直接開第二關，開局整個畫面白霧＋抖 10 秒、時間不走', () => {
  it('主迴圈第一格的時間是負的（時間戳比開始計時早）：1.5 秒內時間開始倒數、沒有閃白和震動', () => {
    for (const st of STAGES) {
      const g = new Game(A);
      g.start(st);
      g.update(-3.27, NO_INPUT);   // 實機量到的第一格：負 3271 毫秒
      for (let i = 0; i < 180; i++) g.update(DT, NO_INPUT);
      const w = g.world!;
      expect(w.state, st.id).toBe('play');
      expect(w.timeLeft, st.id).toBeLessThan(st.timeLimit);
      expect(w.flash, st.id).toBe(0);
      expect(w.shake, st.id).toBe(0);
    }
  });
});
