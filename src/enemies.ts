/**
 * 敵人與魔王：數值表＋行為（不碰畫面）。立繪沿用爪破魔塔（每隻 idle／attack／hurt／block／down 五張，魔王另有 _p2），
 * 動感全部由程式做：待機呼吸、走路擺動、出招換 attack 圖往前衝、受傷閃白後退、死掉轉圈彈飛。
 *
 * 越南大戰的規矩：
 *   - 每一招出手前都有「預兆」（warn：身上一閃一閃＋頭上「！」，或蹲低蓄力、跺腳冒煙），看得到就躲得掉。
 *   - 敵人不是站著等你：還沒發現球球前各做各的事（圍營火、搬箱子、屋頂打瞌睡），發現了先嚇一跳才進攻。
 *   - 快死時會嚇到逃跑；被打死時誇張地轉圈飛出畫面。
 */
import { boxAt, VIEW_W, type Box, type Enemy, type EnemyKind } from './entities';
import { updateStage2 } from './enemies2';
import { Animator, type AnimDefs } from './sprite';
import type { World } from './world';

export interface EnemyDef {
  name: string;
  /** public/enemies/ 裡的檔名開頭（<img>_idle.webp…） */
  img: string;
  /** 立繪畫多高（畫面像素） */
  drawH: number;
  /** 身體判定範圍（寬、高，腳底置中） */
  w: number; h: number;
  hp: number;
  score: number;
  fly?: boolean;
  boss?: boolean;
  /** 很重：被打不會後退 */
  heavy?: boolean;
}

// 09-26 獨立審查 中 8：一般小兵最多挨 4 發手裏劍（量過：原本面具舞者 4.4、白狐巫女 6.3、天狗 5.8、空鎧武者 5.1、怨靈武士 5.2、野豬 6.7 發）。
// 硬的只留給有特色的：鐵羅漢（正面擋）、掃把蜈蚣（會分裂）、守門石獅（擋城門）
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  rat: { name: '鼠兵', img: 'rat', drawH: 132, w: 64, h: 108, hp: 10, score: 100 },
  orange_bandit: { name: '橘貓山賊', img: 'orange_bandit', drawH: 196, w: 88, h: 168, hp: 40, score: 300 },
  black_ninja: { name: '黑衣忍者', img: 'black_ninja', drawH: 200, w: 74, h: 172, hp: 30, score: 500 },
  crow_small: { name: '烏鴉', img: 'crow_small', drawH: 165, w: 136, h: 104, hp: 20, score: 200, fly: true },   // 09-26 放大（單隻 118 太小）
  wild_boar: { name: '野豬', img: 'wild_boar', drawH: 150, w: 146, h: 104, hp: 40, score: 800, heavy: true },
  tanuki_kid: { name: '小狸', img: 'tanuki_kid', drawH: 118, w: 66, h: 96, hp: 20, score: 100 },
  drum_tanuki: { name: '太鼓狸', img: 'drum_tanuki', drawH: 300, w: 210, h: 250, hp: 900, score: 5000, boss: true, heavy: true },
  orange_king: { name: '橘皮大王', img: 'orange_king', drawH: 380, w: 240, h: 316, hp: 1100, score: 20000, boss: true, heavy: true },
  dummy: { name: '木樁人', img: 'wood_dummy', drawH: 190, w: 80, h: 176, hp: 50, score: 0, heavy: true },
  // ── 第二關（大小級距照爪破魔塔：小 95～135、中 170～210、中魔王 320、魔王 380～400）──
  lantern_ghost: { name: '燈籠鬼', img: 'lantern_ghost', drawH: 170, w: 96, h: 140, hp: 20, score: 400, fly: true },
  kasa_obake: { name: '傘妖', img: 'kasa_obake', drawH: 190, w: 90, h: 165, hp: 30, score: 300 },
  paper_crane: { name: '紙鶴', img: 'paper_crane', drawH: 110, w: 110, h: 70, hp: 10, score: 150, fly: true },
  kappa: { name: '河童', img: 'kappa', drawH: 180, w: 90, h: 160, hp: 40, score: 500 },
  mask_dancer: { name: '面具舞者', img: 'mask_dancer', drawH: 210, w: 80, h: 190, hp: 40, score: 600 },
  fox_miko: { name: '白狐巫女', img: 'fox_miko', drawH: 210, w: 120, h: 190, hp: 40, score: 800 },
  tengu: { name: '天狗', img: 'tengu', drawH: 210, w: 100, h: 180, hp: 40, score: 800, fly: true },
  tadpole: { name: '蝌蚪兵', img: 'tadpole', drawH: 95, w: 70, h: 64, hp: 10, score: 100, fly: true },
  frog_daimyo: { name: '蛙大名', img: 'frog_daimyo', drawH: 320, w: 230, h: 270, hp: 800, score: 6000, boss: true, heavy: true },
  tanuki_lord: { name: '狸大人', img: 'tanuki_lord', drawH: 380, w: 220, h: 320, hp: 1100, score: 25000, boss: true, heavy: true },
  tanuki_clone: { name: '狸大人的分身', img: 'tanuki_lord', drawH: 380, w: 220, h: 320, hp: 1, score: 0, heavy: true },
  // ── 第三關 ──
  vacuum: { name: '吸塵機器', img: 'vacuum', drawH: 105, w: 130, h: 96, hp: 30, score: 300 },
  mini_broom: { name: '小掃把', img: 'mini_broom', drawH: 120, w: 50, h: 110, hp: 10, score: 100 },
  broom_centipede: { name: '掃把蜈蚣', img: 'broom_centipede', drawH: 140, w: 300, h: 96, hp: 80, score: 800 },
  iron_arhat: { name: '鐵羅漢', img: 'iron_arhat', drawH: 230, w: 110, h: 210, hp: 90, score: 1000, heavy: true },
  armor_ghost: { name: '空鎧武者', img: 'armor_ghost', drawH: 220, w: 100, h: 200, hp: 40, score: 800 },
  plated_beetle: { name: '甲蟲砲台', img: 'plated_beetle', drawH: 140, w: 130, h: 100, hp: 40, score: 600, fly: true },
  wraith_samurai: { name: '怨靈武士', img: 'wraith_samurai', drawH: 220, w: 90, h: 200, hp: 40, score: 900 },
  guardian_statue: { name: '守門石獅', img: 'guardian_statue', drawH: 270, w: 170, h: 240, hp: 200, score: 3000, heavy: true },
  roomba_king: { name: '掃地機王', img: 'roomba_king', drawH: 300, w: 340, h: 220, hp: 900, score: 8000, boss: true, heavy: true },
  iron_claw: { name: '鐵爪機關貓', img: 'iron_claw', drawH: 380, w: 300, h: 300, hp: 1100, score: 30000, boss: true, heavy: true },
};

/** 橘皮大王第一階段的魚乾背包（打爛就進第二階段） */
export const KING_PACK_HP = 600;
/** 打在大王身上（沒打到背包）時，背包吃幾成傷害 */
export const KING_BODY_CHIP = 0.5;
/** 魔王的第二階段血量 */
export const P2_HP: Partial<Record<EnemyKind, number>> = { orange_king: 1100, frog_daimyo: 700, tanuki_lord: 1200, iron_claw: 1300 };

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export function newEnemy(id: number, kind: EnemyKind, x: number, y: number, defs?: AnimDefs): Enemy {
  const d = ENEMY_DEFS[kind];
  return {
    id, kind, x, y, vx: 0, vy: 0, facing: -1, hp: d.hp, maxHp: d.hp,
    state: 'start', t: 0, pose: 'idle', p2: false, aware: true, act: 'none',
    onGround: !d.fly, plat: null, flash: 0, warn: 0, bubble: null,
    lunge: 0, lean: 0, squash: 0, rot: 0, spin: 0, stun: 0, dying: 0, dead: false,
    harm: null, bodyHarm: !!d.boss, group: -1, burn: 0, poison: 0, dotT: 0, hitCd: new Map(),
    mem: { phase: Math.random() * 10, home: x, cd: rnd(0.3, 1) }, boss: !!d.boss, invuln: 0, fled: false,
    part: kind === 'orange_king' ? { hp: KING_PACK_HP, maxHp: KING_PACK_HP, broken: false, flash: 0 } : null,
    life: 0,
    anim: defs ? new Animator(defs) : null, animOn: false, lastState: 'start', prevState: '',
  };
}

/** 身體判定（飛的、滾的另外算） */
export function enemyBox(e: Enemy): Box {
  const d = ENEMY_DEFS[e.kind];
  const g = e.mem.giant ?? 1;
  if (g !== 1) return boxAt(e.x, e.y, d.w * g, d.h * g);
  if (e.kind === 'orange_king' && e.state === 'roll') return boxAt(e.x, e.y, 150, 130);
  const h = e.kind === 'black_ninja' && e.act === 'sleep' && !e.aware ? d.h * 0.7 : d.h;
  return boxAt(e.x, e.y, d.w, h);
}

/** 橘皮大王的魚乾背包在哪（背在身後、比球球站著丟的高度高：跳起來丟、爆裂符才打得到；打在身上只算一半） */
export function kingPackBox(e: Enemy): Box {
  const bx = e.x - e.facing * 70, top = e.y - 360;
  return { x0: bx - 80, y0: top, x1: bx + 80, y1: top + 160 };
}

export function setState(e: Enemy, s: string): void { e.state = s; e.t = 0; }
export function faceTo(e: Enemy, x: number): void { if (Math.abs(x - e.x) > 4) e.facing = x > e.x ? 1 : -1; }

/** 在地面（或平台）上走 dx；前面是坑、太高的牆、太深的落差、平台邊緣就停下。回傳有沒有走成 */
export function walkOn(e: Enemy, w: World, dx: number): boolean {
  if (dx === 0) return true;
  const nx = e.x + dx;
  if (e.plat) {
    if (nx >= e.plat.x + 12 && nx <= e.plat.x + e.plat.w - 12) { e.x = nx; e.y = e.plat.y; return true; }
    // 走下平台：接著是一樣高的地面（橋、輸送帶接到地面）就走過去
    const g0 = w.groundAt(nx);
    if (Number.isFinite(g0) && Math.abs(g0 - e.plat.y) < 8) { e.plat = null; e.x = nx; e.y = g0; return true; }
    return false;
  }
  const g = w.groundAt(nx);
  if (!Number.isFinite(g) || g > e.y + 70) {
    // 前面是坑：有一樣高的平台（橋、輸送帶）就走上去
    const pl = w.platforms.find((p) => nx >= p.x + 12 && nx <= p.x + p.w - 12 && Math.abs(p.y - e.y) < 8);
    if (pl) { e.plat = pl; e.x = nx; e.y = pl.y; return true; }
    return false;
  }
  if (g < e.y - 36) return false;
  if (nx < w.terrain.startX || nx > w.stage.length) return false;
  e.x = nx; e.y = g;
  return true;
}

/** 空中：重力＋落地（平台從上面踩得住、地形）。回傳這一步有沒有落地 */
export function fallStep(e: Enemy, w: World, dt: number, g = 2000): boolean {
  const y0 = e.y;
  e.vy = Math.min(1600, e.vy + g * dt);
  // 空中橫移撞到牆（寨門、崖壁）就停在牆前，不要穿進去
  const nx = e.x + e.vx * dt;
  if (w.groundAt(nx) < e.y - 36) e.vx = 0; else e.x = nx;
  e.y += e.vy * dt;
  if (e.vy < 0) return false;
  const f = w.floorBelow(e.x, y0, e.y);
  if (!f) return false;
  e.y = f.y; e.plat = f.plat; e.vy = 0; e.onGround = true;
  return true;
}

/** 算一條拋物線：從 (x, y) 在 T 秒內落到 (tx, ty)（重力 g） */
export function ballistic(x: number, y: number, tx: number, ty: number, T: number, g: number): { vx: number; vy: number } {
  return { vx: (tx - x) / T, vy: (ty - y - 0.5 * g * T * T) / T };
}

/** 發現球球：頭上冒「！」、嚇一跳往上彈一下，停半拍才開始打（附近的同伴也跟著發現） */
export function notice(e: Enemy, w: World): void {
  if (e.aware) return;
  e.aware = true;
  w.say(e, '！', 0.7);
  if (e.onGround && e.kind !== 'wild_boar') { e.vy = -360; e.onGround = false; }
  if (e.act === 'carry') w.crateDrop(e.x, e.y - ENEMY_DEFS[e.kind].h - 10);
  setState(e, 'surprised');
  w.event('notice', { kind: e.kind });
  for (const o of w.enemies) if (!o.aware && o !== e && Math.abs(o.x - e.x) < 360 && Math.abs(o.y - e.y) < 200) { o.mem.alertIn = rnd(0.15, 0.45); }
}

// ───────────────────────── 每一格 ─────────────────────────

export function updateEnemy(e: Enemy, w: World, dt: number): void {
  e.t += dt;
  e.harm = null;
  if (!ENEMY_DEFS[e.kind].boss) e.bodyHarm = false;
  // 腳下的地面不見了（寨門打爛、走到坑邊外）：開始往下掉
  if (e.onGround && !e.plat && !ENEMY_DEFS[e.kind].fly && w.groundAt(e.x) > e.y + 4) { e.onGround = false; e.vy = Math.max(0, e.vy); }
  const tgt = w.target();
  // 同伴發現了，隔一下自己也發現
  if (!e.aware && e.mem.alertIn !== undefined && (e.mem.alertIn -= dt) <= 0) notice(e, w);
  // 走近就發現（躲在煙玉裡看不到）
  if (!e.aware && tgt && Math.abs(tgt.x - e.x) < (e.act === 'sleep' ? 360 : 540) && Math.abs(tgt.y - e.y) < 260 && w.onScreen(e.x, 60)) notice(e, w);

  // 被打暈（山賊被打會後退）
  if (e.stun > 0) {
    e.stun -= dt;
    e.pose = 'hurt';
    e.vx *= Math.pow(0.02, dt);
    if (e.onGround) { if (!walkOn(e, w, e.vx * dt)) e.vx = 0; } else fallStep(e, w, dt);
    if (e.stun <= 0 && e.state !== 'flee') setState(e, 'walk');
    return;
  }
  // 嚇一跳：在空中彈一下、落地停半拍
  if (e.state === 'surprised') {
    e.pose = 'hurt';
    if (!e.onGround) fallStep(e, w, dt);
    if (tgt) faceTo(e, tgt.x);
    if (e.t > 0.5 && e.onGround) setState(e, 'start');
    return;
  }
  if (e.state === 'flee') { flee(e, w, dt); return; }
  // 發現了球球卻站在畫面外（例如球球在木架上、牠在底下搆不到）：先走回畫面裡，不然鎖畫面的一波打不完
  const d0 = ENEMY_DEFS[e.kind];
  if (e.aware && !d0.fly && !d0.boss && e.kind !== 'wild_boar' && e.kind !== 'dummy' && e.onGround && !w.onScreen(e.x, -50)
    && ['start', 'walk', 'run', 'stand'].includes(e.state)) {
    e.facing = e.x < w.camX + VIEW_W / 2 ? 1 : -1;
    e.pose = 'idle';
    // 在畫面左邊外（從背後來、被鏡頭甩在後面）：跑快一點追上來（球球全速 340，原本 160 永遠追不上）
    walkOn(e, w, e.facing * (e.x < w.camX ? 400 : 160) * dt);
    return;
  }

  switch (e.kind) {
    case 'rat': rat(e, w, dt); break;
    case 'orange_bandit': bandit(e, w, dt); break;
    case 'black_ninja': ninja(e, w, dt); break;
    case 'crow_small': crow(e, w, dt); break;
    case 'wild_boar': boar(e, w, dt); break;
    case 'tanuki_kid': kid(e, w, dt); break;
    case 'drum_tanuki': drumTanuki(e, w, dt); break;
    case 'orange_king': orangeKing(e, w, dt); break;
    case 'dummy': e.pose = e.flash > 0 ? 'hurt' : 'idle'; break;
    default: updateStage2(e, w, dt); break;
  }
}

/** 還沒發現球球時在做的事 */
export function idleActivity(e: Enemy, w: World, dt: number): void {
  e.pose = 'idle';
  if (!e.onGround) { fallStep(e, w, dt); return; }
  const m = e.mem;
  switch (e.act) {
    case 'carry': case 'patrol': {
      // 慢慢來回走（搬箱子的邊走邊聊）
      const spd = e.act === 'carry' ? 45 : 60;
      if (m.dir === undefined) m.dir = Math.random() < 0.5 ? -1 : 1;
      e.facing = m.dir > 0 ? 1 : -1;
      if (!walkOn(e, w, m.dir * spd * dt) || Math.abs(e.x - m.home!) > 90) { m.dir = -m.dir; walkOn(e, w, m.dir * spd * dt * 2); }
      if (e.act === 'carry' && Math.random() < dt * 0.35) w.say(e, pick(['吱吱', '好重…', '搬去哪？', '吱！']), 1.2);
      break;
    }
    case 'camp':
      // 圍著營火：坐著晃、笑
      if (Math.random() < dt * 0.4) w.say(e, pick(['哈哈哈', '魚烤好了沒？', '再來一條！', '好香～']), 1.4);
      break;
    case 'chat':
      if (Math.random() < dt * 0.4) w.say(e, pick(['吱吱吱', '聽說了嗎？', '吱～']), 1.2);
      break;
    case 'sleep':
      if (!e.bubble || e.bubble.t > e.bubble.life - 0.1) w.say(e, pick(['Zzz…', 'zz…', 'Zzz']), 1.6);
      break;
    case 'graze':
      e.lean = Math.sin(e.life * 3) * 0.05 + 0.08;
      break;
    default: break;
  }
}

// ───────────────────────── 小兵 ─────────────────────────

function rat(e: Enemy, w: World, dt: number): void {
  if (!e.aware) { idleActivity(e, w, dt); return; }
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) { fallStep(e, w, dt); e.pose = 'idle'; return; }
  if (m.spd === undefined) m.spd = rnd(230, 290);
  switch (e.state) {
    case 'start': case 'walk': case 'run': {
      e.pose = 'idle'; e.lean = 0;
      if (!tgt) { e.vx = 0; break; }
      if (e.t > 0.25) faceTo(e, tgt.x);
      const dx = tgt.x - e.x;
      if (Math.abs(dx) < 120 && Math.abs(tgt.y - e.y) < 70) { setState(e, 'windup'); e.warn = 0.3; break; }
      if (!walkOn(e, w, e.facing * m.spd * dt)) { if (Math.abs(tgt.y - e.y) > 60 && e.t > 0.4) { e.vy = -620; e.vx = e.facing * 200; e.onGround = false; } }
      break;
    }
    case 'windup':
      e.pose = 'block'; e.lean = -0.15;
      if (e.t > 0.3) { setState(e, 'bite'); w.event('enemyAttack', { kind: e.kind, move: '咬' }); }
      break;
    case 'bite':
      e.pose = 'attack'; e.lean = 0.12; e.bodyHarm = true;
      walkOn(e, w, e.facing * (e.animOn ? 220 : 540) * dt);   // 有逐格動畫時影片自己會往前跳，程式少衝一點
      e.harm = boxAt(e.x + e.facing * 28, e.y, 90, 90);
      if (e.t > 0.22) setState(e, 'recover');
      break;
    case 'recover':
      e.pose = 'idle'; e.lean = 0;
      if (e.t > 0.45) setState(e, 'run');
      break;
    default: setState(e, 'run');
  }
}

function bandit(e: Enemy, w: World, dt: number): void {
  if (!e.aware) { idleActivity(e, w, dt); return; }
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) { fallStep(e, w, dt); return; }
  m.cd = (m.cd ?? 0) - dt;
  switch (e.state) {
    case 'start': case 'walk': {
      e.pose = 'idle'; e.lean = 0;
      if (!tgt) break;
      faceTo(e, tgt.x);
      const dx = Math.abs(tgt.x - e.x);
      if (dx < 175 && Math.abs(tgt.y - e.y) < 90 && m.cd <= 0) { setState(e, 'windup'); e.warn = 0.5; w.say(e, pick(['看棍！', '喝啊！', '別跑！']), 0.8); break; }
      if (dx > 120) walkOn(e, w, e.facing * 115 * dt);
      break;
    }
    case 'windup':
      e.pose = 'block'; e.lean = -0.2;
      if (e.t > 0.5) { setState(e, 'swing'); w.event('enemyAttack', { kind: e.kind, move: '揮木棒' }); }
      break;
    case 'swing':
      e.pose = 'attack'; e.lean = 0.16;
      if (e.t < 0.12) walkOn(e, w, e.facing * 260 * dt);
      e.harm = { x0: Math.min(e.x, e.x + e.facing * 160), x1: Math.max(e.x, e.x + e.facing * 160), y0: e.y - 170, y1: e.y - 20 };
      if (e.t > 0.22) setState(e, 'recover');
      break;
    case 'recover':
      e.pose = 'idle'; e.lean = 0;
      if (e.t > 0.6) { m.cd = 0.4; setState(e, 'walk'); }
      break;
    default: setState(e, 'walk');
  }
}

function ninja(e: Enemy, w: World, dt: number): void {
  if (!e.aware) { idleActivity(e, w, dt); return; }
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) {
    e.pose = 'block';
    if (fallStep(e, w, dt)) { w.dust(e.x, e.y, 4); setState(e, 'stand'); }
    return;
  }
  m.cd = (m.cd ?? 1) - dt; m.hopCd = (m.hopCd ?? 0) - dt; m.leapCd = (m.leapCd ?? rnd(1.5, 3)) - dt;
  switch (e.state) {
    case 'start': case 'stand': case 'walk': {
      e.pose = 'idle'; e.lean = 0;
      if (!tgt) break;
      faceTo(e, tgt.x);
      const dist = Math.abs(tgt.x - e.x);
      if (dist < 280 && m.hopCd <= 0) {
        // 太近了：往後翻開拉距離
        m.hopCd = 2.4; e.vx = -e.facing * 320; e.vy = -640; e.onGround = false; e.plat = null;
        break;
      }
      if (m.leapCd <= 0) {
        m.leapCd = rnd(3, 5);
        const pl = w.platforms.find((p) => p !== e.plat && Math.abs(p.x + p.w / 2 - e.x) < 460 && w.onScreen(p.x + p.w / 2, -40) && Math.abs(p.x + p.w / 2 - tgt.x) > 250);
        if (pl) {
          const tx = pl.x + pl.w / 2, j = ballistic(e.x, e.y, tx, pl.y, 0.75, 2000);
          e.vx = j.vx; e.vy = j.vy; e.onGround = false; e.plat = null;
          w.event('enemyMove', { kind: e.kind, move: '跳上屋頂' });
          break;
        }
      }
      // 在畫面外：先走進畫面（不然鎖畫面的那一波永遠打不完）
      if (!w.onScreen(e.x, -90)) { const c = w.camX + VIEW_W / 2; e.facing = c > e.x ? 1 : -1; walkOn(e, w, e.facing * 170 * dt); break; }
      if (m.cd <= 0 && w.onScreen(e.x, -20)) { setState(e, 'windup'); e.warn = 0.5; break; }
      if (dist > 680) walkOn(e, w, e.facing * 150 * dt);
      break;
    }
    case 'windup':
      e.pose = 'block'; e.lean = -0.1;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.5) {
        setState(e, 'throw');
        const hx = e.x + e.facing * 40, hy = e.y - 112;
        if (tgt && Math.abs(tgt.y - e.y) < 60) {
          // 同一層：水平丟在胸口高度（蹲下躲得過）
          w.addBullet('kunai', hx, hy, e.facing * 520, 0);
        } else if (tgt) {
          // 屋頂上：瞄準球球丟
          const dx = tgt.x - hx, dy = (tgt.y - 80) - hy, L = Math.hypot(dx, dy) || 1;
          w.addBullet('kunai', hx, hy, dx / L * 470, dy / L * 470);
        }
        w.event('enemyAttack', { kind: e.kind, move: '丟苦無' });
      }
      break;
    case 'throw':
      e.pose = 'attack';
      if (e.t > 0.35) { m.cd = rnd(1.4, 2.2); setState(e, 'stand'); }
      break;
    default: setState(e, 'stand');
  }
}

function crow(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = false;
  const hover = (): void => {
    // 盤旋在球球斜上方一點（走到牠底下就能往上丟）
    m.holdT = (m.holdT ?? rnd(1.5, 3)) - dt;
    if (m.holdT < -1.2) m.holdT = rnd(1.8, 3.2);   // 停住 1.2 秒（holdT 在 0～−1.2 之間）後再跟
    if (m.holdT > 0 || m.holdX === undefined) m.holdX = (tgt ? tgt.x : w.camX + VIEW_W / 2) + (m.side ?? 1) * (m.off ?? 140);
    const hx = m.holdX, hy = 290 + Math.sin(e.life * 2 + m.phase!) * 25;
    e.vx += ((hx - e.x) * 2.2 - e.vx) * Math.min(1, dt * 3);
    e.vy += ((hy - e.y) * 2.2 - e.vy) * Math.min(1, dt * 3);
    e.x += e.vx * dt; e.y += e.vy * dt;
    // 飛回盤旋高度時會衝過頭：頭頂不准衝進資訊欄（中 2）
    if (e.y >= 270) m.low = 1; else if (m.low) { e.y = 270; if (e.vy < 0) e.vy = 0; }   // 從天上飛下來那一趟不管
    faceTo(e, tgt ? tgt.x : e.x - 1);
  };
  switch (e.state) {
    case 'start': m.side = Math.random() < 0.7 ? 1 : -1; m.off = rnd(90, 170); m.swoops = 0; setState(e, 'hover'); break;
    case 'hover':
      e.pose = 'idle';
      hover();
      if (e.t > (m.wait ?? 1.2) && tgt && w.fullyVisible(e)) { setState(e, 'windup'); e.warn = 0.45; m.wait = rnd(1.1, 1.8); }
      break;
    case 'windup':
      e.pose = 'block';
      e.x += Math.cos(e.t * 60) * 90 * dt;   // ＝位置 1.5·sin(60t)，跟一秒推幾步無關
      if (e.t > 0.45 && tgt) {
        const dx = tgt.x - e.x, dy = (tgt.y - 70) - e.y, L = Math.hypot(dx, dy) || 1;
        e.vx = dx / L * 600; e.vy = dy / L * 600;
        setState(e, 'swoop');
        w.event('enemyAttack', { kind: e.kind, move: '俯衝' });
      } else if (!tgt) setState(e, 'hover');
      break;
    case 'swoop':
      e.pose = 'attack'; e.bodyHarm = true;
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.y > w.terrain.groundAt(e.x) - 40 || e.t > 1.1) { setState(e, 'rise'); e.vy = -380; m.swoops = (m.swoops ?? 0) + 1; m.side = -(m.side ?? 1); }
      break;
    case 'rise':
      e.pose = 'idle';
      e.vx *= Math.pow(0.3, dt); e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.t > 0.6) setState(e, (m.swoops ?? 0) >= 3 ? 'leave' : 'hover');   // 飛回盤旋高度就停（0.8 秒會衝進資訊欄）
      break;
    case 'leave':
      e.vy = -320; e.y += e.vy * dt; e.x += e.facing * 120 * dt;
      if (e.y < -200) e.dead = true;
      break;
    default: setState(e, 'hover');
  }
}

function boar(e: Enemy, w: World, dt: number): void {
  const m = e.mem;
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround && e.state !== 'charge') { fallStep(e, w, dt); return; }
  switch (e.state) {
    case 'start':
      // 從畫面外走進來，停在畫面邊緣
      e.pose = 'idle';
      if (m.enterDir === undefined) m.enterDir = e.x > w.camX + VIEW_W / 2 ? -1 : 1;
      e.facing = m.enterDir > 0 ? 1 : -1;
      walkOn(e, w, m.enterDir * 260 * dt);
      if (w.onScreen(e.x, 110) || e.t > 2.5) { setState(e, 'windup'); e.warn = 0.9; w.say(e, '哼！哼！', 0.9); }
      break;
    case 'windup':
      // 跺腳冒煙＝預兆
      e.pose = 'idle'; e.lean = Math.sin(e.t * 30) * 0.05 - 0.08;
      if (Math.random() < dt * 14) w.dust(e.x - e.facing * 50, e.y, 1, -e.facing);
      if (e.t > 0.9) { setState(e, 'charge'); w.event('enemyAttack', { kind: e.kind, move: '衝鋒' }); w.shakeIt(0.12); }
      break;
    case 'charge': {
      e.pose = 'attack'; e.bodyHarm = true; e.lean = 0.05;
      if (Math.random() < dt * 20) w.dust(e.x - e.facing * 60, e.y, 1, -e.facing);
      if (!e.onGround) {
        e.vx = e.facing * 640;
        fallStep(e, w, dt);
        if (e.y > 900) { e.dead = true; w.event('fell', { kind: e.kind }); }
        break;
      }
      const nx = e.x + e.facing * 640 * dt, g = w.groundAt(nx);
      if (!Number.isFinite(g) || g > e.y + 70) { e.x = nx; e.onGround = false; e.plat = null; e.vy = 0; break; }   // 衝進坑、衝下斷崖
      if (g < e.y - 36) { setState(e, 'dizzy'); w.shakeIt(0.2); w.say(e, '@_@', 1.2); break; }   // 撞牆
      e.x = nx; e.y = g;
      if (e.x < w.camX - 320 || e.x > w.camX + VIEW_W + 320) e.dead = true;   // 衝出畫面就不見了（跑掉了，沒分數）
      break;
    }
    case 'dizzy':
      e.pose = 'hurt';
      if (e.t > 1.3) { e.facing = e.facing > 0 ? -1 : 1; setState(e, 'windup'); e.warn = 0.9; }
      break;
    default: setState(e, 'start');
  }
}

function kid(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) {
    e.pose = 'attack'; e.bodyHarm = e.vy > -200;
    if (fallStep(e, w, dt)) { w.dust(e.x, e.y, 3); setState(e, 'wait'); }
    return;
  }
  e.pose = 'idle';
  switch (e.state) {
    case 'start': case 'wait':
      e.squash = 0;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > (m.wait ?? 0.5)) { setState(e, 'crouch'); m.wait = rnd(0.4, 0.8); }
      break;
    case 'crouch':
      e.squash = Math.min(1, e.t / 0.22) * 0.18;
      if (e.t > 0.22) {
        e.squash = 0; e.vx = e.facing * rnd(220, 300); e.vy = -rnd(480, 580); e.onGround = false; e.plat = null;
        setState(e, 'hop'); w.event('enemyAttack', { kind: e.kind, move: '撲' });
      }
      break;
    default: setState(e, 'wait');
  }
}

/** 快死了嚇到逃跑（只逃一次），逃一下又回來打 */
function flee(e: Enemy, w: World, dt: number): void {
  const tgt = w.target();
  e.pose = 'hurt';
  if (!e.onGround) { fallStep(e, w, dt); return; }
  if (tgt) e.facing = tgt.x > e.x ? -1 : 1;
  if (!walkOn(e, w, e.facing * 200 * dt) && e.kind === 'black_ninja') { e.vy = -600; e.vx = e.facing * 260; e.onGround = false; e.plat = null; }
  if (Math.random() < dt * 8) w.fx({ kind: 'drop', x: e.x + (Math.random() - 0.5) * 30, y: e.y - ENEMY_DEFS[e.kind].h, vx: (Math.random() - 0.5) * 80, vy: -120, g: 600, life: 0.5, r: 5, color: '#8fd3ff' });
  if (e.t > 1.4) setState(e, 'walk');
}

// ───────────────────────── 中魔王：太鼓狸 ─────────────────────────

function drumTanuki(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  // 身體只有跳起來壓下來時會痛（站著、走路碰到只會被推開）
  e.bodyHarm = e.state === 'hopAir' && e.vy > 0;
  const low = e.hp < e.maxHp * 0.5;
  if (!e.onGround && e.state !== 'hopAir') fallStep(e, w, dt);
  if (e.hp < e.maxHp * 0.3 && Math.random() < dt * 10) w.bossSmoke(e);
  switch (e.state) {
    case 'start':
      // 從右邊走進場
      e.pose = 'idle'; e.facing = -1;
      walkOn(e, w, -180 * dt);
      if (e.x < ar.x1 - 200 || e.t > 4) { setState(e, 'idle'); m.cd = 1; w.say(e, '咚咚！誰敢過來！', 1.4); }
      break;
    case 'idle': {
      e.pose = 'idle'; e.squash = 0;
      if (tgt) faceTo(e, tgt.x);
      m.cd! -= dt;
      if (m.cd! > 0 || !tgt) break;
      const dist = Math.abs(tgt.x - e.x);
      const kids = w.enemies.filter((o) => o.kind === 'tanuki_kid' && !o.dying && !o.dead).length;
      if (dist < 300 && Math.random() < 0.65) { setState(e, 'blastWind'); e.warn = 0.55; }
      else if (kids < 2 && Math.random() < 0.35) { setState(e, 'summonWind'); e.warn = 0.6; w.say(e, '小的們！', 0.9); }
      else if (Math.random() < 0.25) setState(e, 'hopWind');
      else { setState(e, 'waveWind'); e.warn = 0.75; }
      break;
    }
    case 'waveWind':
      // 舉起鼓棒（預兆）
      e.pose = 'block'; e.lean = -0.08;
      if (e.t > 0.75) {
        setState(e, 'wave'); m.second = low ? 1 : 0;
        drumWave(e, w);
      }
      break;
    case 'wave':
      e.pose = 'attack'; e.lean = 0.06;
      if (m.second && e.t > 0.45) { m.second = 0; drumWave(e, w); }
      if (e.t > 0.9) { setState(e, 'idle'); m.cd = low ? 0.6 : 1.0; }
      break;
    case 'summonWind':
      // 連打小鼓（預兆）
      e.pose = Math.floor(e.t * 10) % 2 ? 'attack' : 'idle';
      if (e.t > 0.6) {
        for (const s of [-1, 1]) {
          const k = w.spawn('tanuki_kid', e.x + s * 40, e.y - 120);
          k.vx = s * rnd(160, 260) + (tgt ? Math.sign(tgt.x - e.x) * 120 : 0); k.vy = -620; k.onGround = false; k.group = e.group;
        }
        w.event('enemyAttack', { kind: e.kind, move: '叫小狸' });
        setState(e, 'recover');
      }
      break;
    case 'blastWind':
      e.pose = 'block'; e.lean = -0.12;
      if (e.t > 0.55) {
        setState(e, 'blast'); w.shakeIt(0.25);
        w.addBullet('blast', e.x + e.facing * 150, e.y - 120, e.facing * 60, 0, { w: 200, h: 220, life: 0.3 });
        w.event('enemyAttack', { kind: e.kind, move: '鼓爆' });
      }
      break;
    case 'blast':
      e.pose = 'attack'; e.lean = 0.1;
      if (e.t > 0.5) setState(e, 'recover');
      break;
    case 'hopWind':
      e.squash = Math.min(1, e.t / 0.35) * 0.15; e.pose = 'block';
      if (e.t < dt * 1.5) m.tx = tgt && tgt.x > (ar.x0 + ar.x1) / 2 ? ar.x0 + 220 : ar.x1 - 220;   // 落點：地上紅圈（render.ts）
      if (e.t > 0.35) {
        e.squash = 0;
        const tx = m.tx ?? (tgt && tgt.x > (ar.x0 + ar.x1) / 2 ? ar.x0 + 220 : ar.x1 - 220);
        const j = ballistic(e.x, e.y, tx, w.terrain.groundAt(tx), 0.8, 2000);
        e.vx = j.vx; e.vy = j.vy; e.onGround = false;
        setState(e, 'hopAir');
        w.event('enemyMove', { kind: e.kind, move: '跳' });
      }
      break;
    case 'hopAir':
      e.pose = 'idle';
      if (fallStep(e, w, dt)) {
        w.shakeIt(0.25); w.dust(e.x, e.y, 10);
        if (low) for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 100, e.y, s * 380, 0);
        setState(e, 'recover');
      }
      break;
    case 'recover':
      e.pose = 'idle'; e.lean = 0;
      if (e.t > 0.7) { setState(e, 'idle'); m.cd = low ? 0.5 : 0.9; }
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}

function drumWave(e: Enemy, w: World): void {
  w.shakeIt(0.28);
  w.addBullet('wave', e.x + e.facing * 110, e.y, e.facing * 470, 0);
  w.event('enemyAttack', { kind: e.kind, move: '地面震波' });
}

// ───────────────────────── 魔王：橘皮大王 ─────────────────────────

function orangeKing(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  // 身體會痛：從天上掉下來、肚皮壓、滾、泰山壓頂砸下來；第二階段全身是刺，碰到就痛（被打爛背包、倒下、跳出畫面時不算）
  e.bodyHarm = (e.state === 'enter' && e.t > 0.9) || e.state === 'belly' || e.state === 'roll' || e.state === 'crushFall'
    || (e.p2 && !['die', 'break', 'crushUp', 'crushShadow', 'roar'].includes(e.state));
  if (e.state !== 'die' && e.hp < e.maxHp * 0.3 && e.p2 && Math.random() < dt * 12) w.bossSmoke(e);
  const P2 = e.p2;
  switch (e.state) {
    case 'start':
      // 從天上掉下來（地上先出現影子）
      e.pose = 'idle'; e.facing = -1; e.x = ar.x1 - 300; e.y = -500; e.vy = 0; e.onGround = false;
      setState(e, 'enter'); e.warn = 1;
      break;
    case 'enter':
      if (e.t < 0.9) break;
      if (fallStep(e, w, dt, 2600)) {
        w.shakeIt(0.5); w.dust(e.x, e.y, 16); w.dust(e.x - 100, e.y, 6); w.dust(e.x + 100, e.y, 6);
        setState(e, 'roar'); w.say(e, '喵嗚嗚——！這座山寨是本王的！', 1.8);
      }
      break;
    case 'roar':
      e.pose = 'attack'; e.lean = Math.sin(e.t * 40) * 0.02;
      if (e.t > (P2 ? 0.9 : 1.6)) { setState(e, 'idle'); m.cd = 0.6; }
      break;
    case 'idle': {
      e.pose = 'idle'; e.lean = 0; e.squash = 0; e.rot = 0;
      if (tgt) faceTo(e, tgt.x);
      if (!e.onGround) fallStep(e, w, dt);
      m.cd! -= dt;
      if (m.cd! > 0 || !tgt) break;
      const r = Math.random();
      if (!P2) {
        if (r < 0.35) { setState(e, 'bellyWind'); e.warn = 0.6; }
        else if (r < 0.7) { setState(e, 'fishWind'); e.warn = 0.5; }
        else { setState(e, 'rollWind'); e.warn = 0.7; }
      } else {
        if (r < 0.35) { setState(e, 'crushWind'); e.warn = 0.4; }
        else if (r < 0.65) { setState(e, 'rollWind'); e.warn = 0.55; }
        else if (r < 0.85) { setState(e, 'fishWind'); e.warn = 0.45; }
        else { setState(e, 'bellyWind'); e.warn = 0.5; }
      }
      break;
    }
    // 肚皮壓：蹲低蓄力 → 跳到你頭上
    case 'bellyWind':
      e.pose = 'block'; e.squash = Math.min(1, e.t / 0.55) * 0.16;
      if (e.t > (P2 ? 0.45 : 0.6) && tgt) {
        e.squash = 0;
        m.tx = Math.max(ar.x0 + 150, Math.min(ar.x1 - 150, tgt.x));
        const j = ballistic(e.x, e.y, m.tx, w.terrain.groundAt(m.tx), 0.9, 2600);
        e.vx = j.vx; e.vy = j.vy; e.onGround = false;
        setState(e, 'belly'); w.event('enemyAttack', { kind: e.kind, move: '肚皮壓' });
      }
      break;
    case 'belly':
      e.pose = 'attack'; e.rot = Math.sin(e.t * 3) * 0.1;
      if (fallStep(e, w, dt, 2600)) {
        e.rot = 0; w.shakeIt(0.35); w.dust(e.x, e.y, 14);
        if (P2) for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 120, e.y, s * 400, 0);
        setState(e, 'recover'); m.rec = P2 ? 0.6 : 0.9;
      }
      break;
    // 丟魚骨頭：舉起魚（預兆）→ 拋物線丟一把
    case 'fishWind':
      e.pose = 'attack'; e.lean = -0.12;
      if (e.t > (P2 ? 0.4 : 0.5) && tgt) {
        const offs = P2 ? [-280, -140, 0, 140, 280] : [-150, 0, 150];
        for (const o of offs) {
          const hx = e.x + e.facing * 60, hy = e.y - 300, tx = tgt.x + o, T = rnd(0.9, 1.2);
          const j = ballistic(hx, hy, tx, w.terrain.groundAt(tx) - 20, T, 1300);
          w.addBullet('bone', hx, hy, j.vx, j.vy, { g: 1300 });
        }
        setState(e, 'fishThrow'); w.event('enemyAttack', { kind: e.kind, move: '丟魚骨頭' });
      }
      break;
    case 'fishThrow':
      e.pose = 'idle'; e.lean = 0.08;
      if (e.t > 0.5) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    // 滾過來：縮成一團發抖冒煙（預兆）→ 滾到另一邊再滾回來
    case 'rollWind':
      e.pose = 'block'; e.lean = Math.sin(e.t * 50) * 0.04;
      if (Math.random() < dt * 20) w.dust(e.x + e.facing * 40, e.y, 1, e.facing);
      if (e.t > (P2 ? 0.55 : 0.7)) {
        m.dir = tgt && tgt.x < e.x ? -1 : 1; m.bounces = 0;
        setState(e, 'roll'); w.event('enemyAttack', { kind: e.kind, move: P2 ? '滾更快' : '滾過來' });
      }
      break;
    case 'roll': {
      e.pose = 'block';
      const spd = P2 ? 800 : 540;
      e.x += m.dir! * spd * dt; e.y = w.terrain.groundAt(e.x); e.rot += m.dir! * spd * dt / 75;
      if (Math.random() < dt * 25) w.dust(e.x - m.dir! * 60, e.y, 1, -m.dir!);
      if ((m.dir! < 0 && e.x < ar.x0 + 90) || (m.dir! > 0 && e.x > ar.x1 - 90)) {
        m.dir = -m.dir!; m.bounces! += 1; w.shakeIt(0.18);
        if (m.bounces! >= (P2 ? 2 : 1)) { e.rot = 0; e.facing = m.dir! > 0 ? 1 : -1; setState(e, 'recover'); m.rec = 0.8; }
      }
      break;
    }
    // 泰山壓頂（第二階段）：跳出畫面 → 地上的影子跟著你 → 影子停住閃紅 → 砸下來＋兩邊震波
    case 'crushWind':
      e.pose = 'block'; e.squash = Math.min(1, e.t / 0.4) * 0.18;
      if (e.t > 0.4) { e.squash = 0; e.vy = -1500; e.onGround = false; setState(e, 'crushUp'); w.event('enemyAttack', { kind: e.kind, move: '泰山壓頂' }); }
      break;
    case 'crushUp':
      e.pose = 'attack'; e.y += e.vy * dt;
      if (e.y < -520) { setState(e, 'crushShadow'); m.tx = tgt ? tgt.x : e.x; }
      break;
    case 'crushShadow':
      // 影子先跟著球球 0.7 秒，再停住 0.45 秒（最後的逃命時間）
      if (e.t < 0.7 && tgt) m.tx = Math.max(ar.x0 + 150, Math.min(ar.x1 - 150, tgt.x));
      e.x = m.tx!;
      if (e.t > 1.15) { e.vy = 2200; setState(e, 'crushFall'); }
      break;
    case 'crushFall':
      e.pose = 'attack';
      if (fallStep(e, w, dt, 3000)) {
        w.shakeIt(0.55); w.dust(e.x, e.y, 18);
        for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 130, e.y, s * 430, 0);
        w.explode(e.x, e.y - 30, 90, 0, 'enemy', true);
        setState(e, 'recover'); m.rec = 1.0;
      }
      break;
    case 'recover':
      e.pose = 'idle'; e.lean = 0; e.squash = 0;
      if (!e.onGround) fallStep(e, w, dt, 2600);
      if (e.t > (m.rec ?? 0.8)) { setState(e, 'idle'); m.cd = P2 ? 0.45 : 0.8; }
      break;
    // 背包被打爛：大爆炸、魚乾灑一地 → 站起來全身是刺（第二階段）
    case 'break':
      e.pose = 'hurt'; e.lean = Math.sin(e.t * 45) * 0.05;
      if (!e.onGround) fallStep(e, w, dt, 2600);
      if (Math.random() < dt * 8) { const pb = kingPackBox(e); w.explode(rnd(pb.x0, pb.x1), rnd(pb.y0, pb.y1), 60, 0, 'scene', false); }
      if (e.t > 1.6) {
        e.p2 = true; e.hp = e.maxHp = P2_HP.orange_king ?? e.maxHp; e.invuln = 0.6; e.flash = 0.12;
        w.flashScreen(0.35); w.shakeIt(0.4);
        setState(e, 'roar'); w.say(e, '可惡——！本王生氣了！', 1.6);
        w.banner('全身是刺！', '爪子打不下去：用丟的（靠近按攻擊也會自動改丟）', 'warn', 2.6);
        w.event('bossPhase', { kind: e.kind, phase: 2 });
      }
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}

/** 橘皮大王的背包被打爛：從 world 的傷害計算叫進來 */
export function kingPackBroken(e: Enemy, w: World): void {
  if (!e.part) return;
  e.part.broken = true;
  e.invuln = 1.7;
  const pb = kingPackBox(e);
  const cx = (pb.x0 + pb.x1) / 2, cy = (pb.y0 + pb.y1) / 2;
  w.explode(cx, cy, 150, 0, 'scene', true);
  w.shakeIt(0.5);
  // 炸爛的竹簍掉在地上（留著當場景）
  const gx = Math.max(w.arena().x0 + 80, Math.min(w.arena().x1 - 80, cx - e.facing * 60));
  w.decals.push({ key: 'king_pack_broken', x: gx, y: w.groundAt(gx), flip: e.facing > 0 });
  for (let i = 0; i < 6; i++) w.drop('fish', cx, cy, rnd(-360, 360), rnd(-700, -400));
  for (let i = 0; i < 12; i++) w.fx({ kind: 'fish', x: cx, y: cy, vx: rnd(-500, 500), vy: rnd(-800, -300), g: 1500, life: 1.4, r: 16, color: '#d9c7a0' });
  w.banner('背包炸飛了！', '橘皮大王發怒了', 'warn', 1.6);
  e.vy = 0;
  setState(e, 'break');
  w.event('partBroken', { kind: e.kind, part: '魚乾背包' });
}

/** 魔王倒下：一連串爆炸、冒煙，最後才算打倒（鏡頭解鎖、過關） */
export function bossDie(e: Enemy, w: World, dt: number): void {
  e.pose = 'down'; e.bodyHarm = false; e.harm = null;
  e.lean = Math.sin(e.t * 30) * 0.03 * Math.max(0, 1 - e.t / 2);
  if (!e.onGround) fallStep(e, w, dt, 2600);
  const d = ENEMY_DEFS[e.kind];
  if (Math.random() < dt * (e.t < 1.8 ? 9 : 2)) w.explode(e.x + rnd(-d.w / 2, d.w / 2), e.y - rnd(20, d.h), rnd(50, 90), 0, 'scene', false);
  if (Math.random() < dt * 14) w.bossSmoke(e);
  if (e.t > 2.4 && !e.mem.gone) { e.mem.gone = 1; w.bossDefeated(e); }
}
