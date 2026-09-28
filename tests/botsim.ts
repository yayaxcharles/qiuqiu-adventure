/**
 * 測試用：在 Node 裡用自動玩（src/autopilot.ts）把一關從頭玩到結算（不畫畫面，照實際動作圖的格數、標記與速度）。
 * 動作圖的定義（anims.json）用真的，圖不載。亂數用固定種子，每次結果一樣。
 */
import type { Assets } from '../src/assets';
import { createBot } from '../src/autopilot';
import { Game } from '../src/game';
import { NO_INPUT } from '../src/input';
import { parseAnims } from '../src/sprite';
import type { StageDef } from '../src/stages/types';
import ANIMS from '../public/sprites/qiuqiu/anims.json';

/** 電腦版（每秒 24 格）；環境變數 QQ_MON_SET=m 改用手機版（monsters_m，約 12 格）跑同一套測試 */
const MON_D = import.meta.glob('../public/sprites/monsters/*/anims.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
const MON_M = import.meta.glob('../public/sprites/monsters_m/*/anims.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
const MON = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.QQ_MON_SET === 'm' ? MON_M : MON_D;

export function fakeAssets(): Assets {
  const defs = parseAnims(ANIMS as unknown as Record<string, unknown>);
  const monsters = new Map(Object.entries(MON).map(([path, v]) => {
    const name = /monsters(?:_m)?\/([^/]+)\/anims\.json$/.exec(path)![1]!;
    return [name, { lib: { defs: parseAnims(v), images: {} }, standHeight: 200 }] as const;
  }));
  return { sprites: { defs, images: {} }, art: new Map(), panels: new Map(), enemies: new Map(), fallback: { bg: null, shuriken: null }, dirt: new Map(), ambient: new Map(), monsters, terrain: null };
}

/** 固定種子的亂數（換掉 Math.random），回傳還原的函式 */
export function seedRandom(seed: number): () => void {
  const real = Math.random;
  let s = (seed * 2654435761) >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { Math.random = real; };
}

export interface SimResult { cleared: boolean; sec: number; g: Game; stuck: string }

/** 自動玩一關；卡住 40 秒沒前進就停下來，回傳卡在哪 */
export function simulate(stage: StageDef, maxSec = 900, eventCap = 6000): SimResult {
  const g = new Game(fakeAssets());
  g.eventCap = eventCap;
  g.bot = createBot();
  g.start(stage);
  const DT = 1 / 120;
  let t = 0, lastX = 0, lastProg = 0, stuck = '';
  while (t < maxSec && g.screen !== 'result' && g.screen !== 'gameover') {
    g.update(DT, NO_INPUT); t += DT;
    const w = g.world!, p = w.player.body;
    if (Math.abs(p.x - lastX) > 40) { lastX = p.x; lastProg = t; }
    if (t - lastProg > 40) {
      stuck = `卡在 x=${Math.round(p.x)} 鏡頭 ${Math.round(w.camX)} 鎖 ${[...w.locks].join(',')} 敵人 ${w.enemies.map((e) => `${e.kind}#${e.group}@${Math.round(e.x)},${Math.round(e.y)}:${e.state}${e.invuln > 5 ? '(無敵)' : ''}`).join(' ')}`;
      break;
    }
  }
  return { cleared: g.screen === 'result', sec: t, g, stuck };
}

/** 摘要（印出來看） */
export function summary(r: SimResult): Record<string, unknown> {
  const { g } = r, w = g.world!;
  const ev = (type: string) => g.eventLog.filter((e) => e.type === type);
  return {
    cleared: r.cleared, sec: Math.round(r.sec), x: Math.round(w.player.body.x), deaths: w.deaths, continues: w.continues, rescued: w.rescued,
    kills: w.kills, score: w.score, stuck: r.stuck || undefined,
    hurtBy: Object.entries(ev('playerHurt').reduce((m: Record<string, number>, e) => { const k = String(e.src || (e.pit ? 'pit' : '?')); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`),
    bosses: ev('bossDown').map((e) => `${e.kind}@${e.t}`), phases: ev('bossPhase').map((e) => `${e.kind}@${e.t}`),
    attacks: [...new Set(ev('enemyAttack').map((e) => `${e.kind}:${e.move}`))],
    pickups: [...new Set(ev('pickup').map((e) => e.kind))],
  };
}
