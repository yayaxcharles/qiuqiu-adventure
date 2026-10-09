/**
 * 2026-10-10 使用者：「碰到敵人就扣血不行，要敵人丟出東西才扣血」「HP 改血量條，每隻怪打到我扣的血不同」。
 * 用自動玩把三關各玩一次，檢查真的跑出來的扣血事件：
 *   - 沒有一次是身體碰到（how === 'body'）
 *   - 敵人出招判定框（how === 'harm'）只剩噴的、射的：河童水柱、鐵爪雷射
 *   - 每個扣血來源都在 damage.ts 的表上（unknownDamage 是空的）
 */
import { describe, expect, it } from 'vitest';
import { damageFor, unknownDamage } from '../src/damage';
import { BODY_HW, newBody, shoveTo } from '../src/physics';
import { STAGE1 } from '../src/stages/stage1';
import { STAGE2 } from '../src/stages/stage2';
import { STAGE3 } from '../src/stages/stage3';
import { seedRandom, simulate } from './botsim';

/** 還保留判定框的招：噴的水柱、射的雷射（不是身體） */
const SPRAY = [/^kappa:/, /^iron_claw:laser$/];

describe('丟東西才傷人（自動玩三關）', () => {
  for (const [i, st] of [STAGE1, STAGE2, STAGE3].entries()) {
    it(`第 ${i + 1} 關：沒有身體碰撞扣血、判定框只剩噴射類、扣血來源都在表上`, () => {
      unknownDamage.clear();
      const restore = seedRandom(1);
      const r = simulate(st, 900, 1e6);
      restore();
      const hurts = r.g.eventLog.filter((e) => e.type === 'playerHurt');
      expect(hurts.length).toBeGreaterThan(0);
      expect(hurts.filter((e) => e.how === 'body')).toEqual([]);
      const harm = hurts.filter((e) => e.how === 'harm').map((e) => String(e.src));
      expect(harm.filter((s) => !SPRAY.some((re) => re.test(s)))).toEqual([]);
      expect([...unknownDamage]).toEqual([]);
      for (const e of hurts) expect(e.dmg, String(e.src)).toBe(damageFor(String(e.src)));
    }, 180_000);
  }
});

describe('被撞開、被吹、被吸：不會被推進牆裡', () => {
  const W = { ground: 596, minX: 0, maxX: 5000, platforms: [], solids: [{ x: 100, y: 0, w: 100, h: 596 }],
    groundAt: (x: number) => (x > 400 && x < 500 ? 400 : 596) };
  it('方塊側面：從左邊推過去停在牆面前；從右邊推過去也一樣', () => {
    expect(shoveTo(newBody(60, 596), 150, W)).toBe(100 - BODY_HW);
    expect(shoveTo(newBody(240, 596), 150, W)).toBe(200 + BODY_HW);
  });
  it('地形的牆（比腳高很多的地面）：推不上去', () => {
    expect(shoveTo(newBody(350, 596), 450, W)).toBeLessThan(401);
  });
  it('沒有牆：照推', () => {
    expect(shoveTo(newBody(300, 596), 360, W)).toBe(360);
  });
});
