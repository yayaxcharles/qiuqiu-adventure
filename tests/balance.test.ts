/**
 * 平衡報表（第二版規劃 9.1）：三關 × 亂數種子 1～5，每局一列存成 CSV。
 * 平常的 npm test 跳過（15 局要跑一陣子）；要量的時候：
 *   QQ_BALANCE=docs/平衡_xxx.csv npx vitest run tests/balance.test.ts
 * 欄位：破關、秒數、倒下、接關、被打次數、揮爪中被打、翻滾中被打、被什麼打到、每場魔王戰秒數（出場到倒下）、丟出幾發、殺幾隻。
 */
import { describe, expect, it } from 'vitest';
import { STAGE1 } from '../src/stages/stage1';
import { STAGE2 } from '../src/stages/stage2';
import { STAGE3 } from '../src/stages/stage3';
import { seedRandom, simulate } from './botsim';

const OUT = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.QQ_BALANCE;
const SEEDS = [1, 2, 3, 4, 5];

describe.skipIf(!OUT)('平衡報表', () => {
  it('三關 × 5 種子', async () => {
    // 型別檢查沒裝 node 的型別：用動態載入
    const { writeFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { writeFileSync: (p: string, s: string) => void };
    const rows: string[] = ['stage,seed,cleared,sec,deaths,continues,hurts,hurtInClaw,hurtInRoll,hurtBy,bossSec,fired,kills,stuck,clawHurtBy,claws,rolls,diagFired,bodyInClaw'];
    for (const [si, st] of [STAGE1, STAGE2, STAGE3].entries()) {
      for (const seed of SEEDS) {
        const restore = seedRandom(seed);
        const r = simulate(st, 900, 1e6);
        restore();
        const log = r.g.eventLog, w = r.g.world!;
        const hurts = log.filter((e) => e.type === 'playerHurt');
        const by: Record<string, number> = {};
        for (const e of hurts) { const k = String(e.src || (e.pit ? 'pit' : '?')).split(':')[0]!; by[k] = (by[k] ?? 0) + 1; }
        const enter = new Map<string, number>();
        const boss: string[] = [];
        for (const e of log) {
          if (e.type === 'bossEnter') enter.set(String(e.kind), e.t as number);
          if (e.type === 'bossDown' && enter.has(String(e.kind))) boss.push(`${e.kind}=${((e.t as number) - enter.get(String(e.kind))!).toFixed(1)}`);
        }
        rows.push([si + 1, seed, r.cleared ? 1 : 0, r.sec.toFixed(1), w.deaths, w.continues, hurts.length,
          hurts.filter((e) => e.act === 'claw').length, hurts.filter((e) => e.act === 'roll').length,
          Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' '),
          boss.join(' '), log.filter((e) => e.type === 'fire').length, w.kills, JSON.stringify(r.stuck ?? '').replace(/,/g, ';'),
          [...new Set(hurts.filter((e) => e.act === 'claw').map((e) => String(e.src)))].map((k) => `${k}×${hurts.filter((e) => e.act === 'claw' && e.src === k).length}`).join(' '),
          log.filter((e) => e.type === 'claw').length, log.filter((e) => e.type === 'roll').length, log.filter((e) => e.type === 'fire' && e.aim === 'diag').length,
          hurts.filter((e) => e.act === 'claw' && e.how === 'body').length].join(','));
        console.log(rows[rows.length - 1]);
      }
    }
    writeFileSync(OUT!, rows.join('\n') + '\n');
    expect(rows.length).toBe(16);
  }, 1800000);
});
