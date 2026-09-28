/**
 * 09-27 手機版與第三批美術的驗收測試：
 *   - 觸控按鈕送的鍵跟鍵盤同一套（按下那一格算「剛按下」、放開就不算按著）
 *   - 被救村貓每一關花色不重複（第三批美術九種花色）
 *   - 魔王倒下那一炸標成大爆炸（只有魔王倒下才畫大爆炸）
 *   - 打中敵人會冒打中火花（揮爪、手裏劍、爆炸三種圖）
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_DEFS } from '../src/enemies';
import { consume, virtualKey } from '../src/input';
import { STAGES } from '../src/stages';
import { World } from '../src/world';
import { fakeAssets } from './botsim';

const A = fakeAssets();
const MON = Object.fromEntries([...A.monsters].map(([k, v]) => [k, v.lib.defs]));

describe('觸控按鈕 → 跟鍵盤同一套', () => {
  it('按下那一格是「剛按下」，按著的格是「按著」，放開就沒了', () => {
    consume();
    virtualKey('KeyJ', true);
    const f1 = consume();
    expect(f1.attackPressed).toBe(true);
    expect(f1.attackHeld).toBe(true);
    const f2 = consume();
    expect(f2.attackPressed).toBe(false);
    expect(f2.attackHeld).toBe(true);
    virtualKey('KeyJ', false);
    const f3 = consume();
    expect(f3.attackHeld).toBe(false);
  });
  it('方向盤、跳、爆裂符、換副武器、暫停都對到遊戲的鍵', () => {
    consume();
    for (const k of ['ArrowRight', 'Space', 'KeyL', 'KeyQ', 'KeyP']) virtualKey(k, true);
    const f = consume();
    expect(f.right && f.jumpPressed && f.subPressed && f.subSwitchPressed && f.pausePressed).toBe(true);
    for (const k of ['ArrowRight', 'Space', 'KeyL', 'KeyQ', 'KeyP']) virtualKey(k, false);
    consume();
  });
});

describe('第三批美術', () => {
  it('被救村貓：每一關花色不重複', () => {
    for (const st of STAGES) {
      const arts = st.captives.map((c) => c.art);
      expect(new Set(arts).size, st.name).toBe(arts.length);
    }
  });

  it('魔王倒下那一炸標成大爆炸，其他爆炸不是', () => {
    const st = STAGES[0]!;
    const w = new World(st, A.sprites.defs, MON);
    w.explode(500, 400, 240, 0, 'player', true);   // 焙烙玉那麼大也不是魔王倒下
    expect(w.explosions.some((x) => x.boss)).toBe(false);
    const e = w.spawn('drum_tanuki', 900, w.groundAt(900));
    e.group = 1000; w.boss = e;
    w.bossDefeated(e);
    expect(w.explosions.filter((x) => x.boss).length).toBe(1);
  });

  it('打中敵人會冒打中火花：揮爪、手裏劍、爆炸各用各的圖', () => {
    const w = new World(STAGES[0]!, A.sprites.defs, MON);
    const e = w.spawn('rat', 900, w.groundAt(900));
    e.hp = e.maxHp = 9999;
    const hit = (kind: string): string | undefined => {
      w.particles.length = 0;
      w.damageEnemy(e, 1, { x: e.x, y: e.y - ENEMY_DEFS.rat.h / 2, dir: 1, kind });
      return w.particles.find((p) => p.kind === 'hit')?.sprite;
    };
    expect(hit('claw')).toBe('hit_claw');
    expect(hit('shuriken')).toBe('hit_shuriken');
    expect(hit('blast')).toBe('hit_blunt');
    w.particles.length = 0;
    w.damageEnemy(e, 1, { x: e.x, y: e.y, dir: 1, kind: 'dot' });   // 延燒這種持續傷害不冒
    expect(w.particles.some((p) => p.kind === 'hit')).toBe(false);
  });
});
