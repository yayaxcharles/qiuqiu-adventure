/**
 * 球球被打扣多少血（2026-10-10 使用者：「HP 三格不行，改血量條，每隻怪打到我扣的血不同」）。
 * 滿血 100。小東西 14、一般 17～26、重的 31～34、爆炸 42、魔王大招 34～45（最痛封頂 45，不到半條血）、蒸氣 17、掉坑 25。
 * 數字＝規劃的基準（小 8、一般 10～15、重 18～20、爆炸 25、魔王 25～35）× 1.7：自動玩量出來基準太簡單（倒下次數不到改版前三成），
 * 乘 1.7 後自動玩倒下次數約為改版前的五成半到九成（第三關最難；docs/平衡_1010_改後.csv）
 * src 是 hurtPlayer 收到的來源：子彈種類、'steam'、'pit'、'explosion:…'、'敵人種類:動作'。
 */
export const MAX_HP = 100;

/** 子彈與場景 */
const BY_SRC: Record<string, number> = {
  // 第一關
  kunai: 17, bone: 20, wave: 26, blast: 45,
  // 第二關
  fireball: 20, water: 17, fan: 20, foxfire: 20, leaf: 14, splash: 17, bubble: 20, gust: 0,
  // 第三關
  pellet: 14, garbage: 20, missile: 34, spark: 0,
  steam: 17, pit: 25, explosion: 42,
  // 魔王的招（同一種子彈，魔王丟的比較痛）
  'orange_king:bone': 26, 'orange_king:wave': 34, 'drum_tanuki:wave': 26,
  'frog_daimyo:slime': 31, 'frog_daimyo:wave': 34, 'tanuki_lord:giantwave': 42,
  'roomba_king:spit': 31, 'iron_claw:fireblade': 42, 'iron_claw:rampage': 42, 'iron_claw:laser': 45,
};

/** 敵人自己出招（判定框打到）：照敵人種類 */
const BY_ENEMY: Record<string, number> = {
  rat: 14, orange_bandit: 20, black_ninja: 20, crow_small: 17, wild_boar: 31, drum_tanuki: 26, tanuki_kid: 14,
  paper_crane: 14, kasa_obake: 17, lantern_ghost: 17, kappa: 20, mask_dancer: 20, fox_miko: 20, tengu: 20, tadpole: 14,
  vacuum: 20, mini_broom: 14, broom_centipede: 26, iron_arhat: 34, armor_ghost: 26, wraith_samurai: 31, guardian_statue: 34, plated_beetle: 20,
  orange_king: 45, tanuki_lord: 42, frog_daimyo: 42, roomba_king: 45, iron_claw: 45, frog: 42,
};

/** 表上查不到的來源（測試會抓出來，不准默默用預設值） */
export const unknownDamage = new Set<string>();

/** 調難度用：整張表一起乘（量平衡時先試倍率，定案後寫回表上） */
export const DMG_SCALE = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.QQ_DMG ?? 1);

export function damageFor(src: string): number {
  return Math.round(baseDamage(src) * DMG_SCALE);
}
function baseDamage(src: string): number {
  if (src in BY_SRC) return BY_SRC[src]!;
  const head = src.split(':')[0]!;
  if (head === 'explosion') return BY_SRC.explosion!;
  if (head in BY_ENEMY) return BY_ENEMY[head]!;
  unknownDamage.add(src);
  return 15;
}
