/**
 * 球球被打扣多少血（2026-10-10 使用者：「HP 三格不行，改血量條，每隻怪打到我扣的血不同」）。
 * 滿血 100。小東西 8、一般 10～15、重的 18～20、爆炸 25、魔王大招 25～35、蒸氣 10、掉坑 20。
 * src 是 hurtPlayer 收到的來源：子彈種類、'steam'、'pit'、'explosion:…'、'敵人種類:動作'。
 */
export const MAX_HP = 100;

/** 子彈與場景 */
const BY_SRC: Record<string, number> = {
  // 第一關
  kunai: 10, bone: 12, wave: 15, blast: 30,
  // 第二關
  fireball: 12, water: 10, fan: 12, foxfire: 12, leaf: 8, splash: 10, bubble: 12, gust: 0,
  // 第三關
  pellet: 8, garbage: 12, missile: 20, spark: 0,
  steam: 10, pit: 20, explosion: 25,
  'frog:tongue': 20,
};

/** 敵人自己出招（判定框打到）：照敵人種類 */
const BY_ENEMY: Record<string, number> = {
  rat: 8, orange_bandit: 12, black_ninja: 12, crow_small: 10, wild_boar: 18, drum_tanuki: 15,
  paper_crane: 8, kasa_obake: 10, lantern_ghost: 10, kappa: 12, mask_dancer: 12, fox_miko: 12, tengu: 12, tadpole: 8,
  vacuum: 12, mini_broom: 8, broom_centipede: 15, iron_arhat: 20, armor_ghost: 15, wraith_samurai: 18, guardian_statue: 20, plated_beetle: 12,
  orange_king: 30, tanuki_lord: 25, frog_daimyo: 25, roomba_king: 30, iron_claw: 30, frog: 25,
};

/** 表上查不到的來源（測試會抓出來，不准默默用預設值） */
export const unknownDamage = new Set<string>();

export function damageFor(src: string): number {
  if (src in BY_SRC) return BY_SRC[src]!;
  const head = src.split(':')[0]!;
  if (head === 'explosion') return BY_SRC.explosion!;
  if (head in BY_ENEMY) return BY_ENEMY[head]!;
  unknownDamage.add(src);
  return 15;
}
