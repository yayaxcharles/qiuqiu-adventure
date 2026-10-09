/**
 * 第三關　鐵爪機關城（城下 → 工廠 → 天守閣頂）的敵人與魔王（照 docs/2026-09-26_三大關設計.md）。
 * 規矩跟前兩關一樣：每一招出手前都有預兆（身上紅色邊光＋頭上「！」、蓄力、地上的紅色警告），出手那一刻對上動作圖的出手格（enemyAnim.ts）。
 *
 *   吸塵機器：地上滑來滑去；眼睛一閃（預兆）→ 把前面飛過來的手裏劍吸進去，吸到了就吐回來（打得掉）
 *   小掃把：一蹦一跳撞過來（掃把蜈蚣分裂出來、鐵爪放出來的）
 *   掃把蜈蚣：長長一條爬過來，頭抬起來（預兆）→ 往前竄；打倒會分裂成三隻小掃把
 *   鐵羅漢：重甲，正面擋子彈（穿透的忍具、從上面往下丟、爆炸、揮爪擋不住）；拳頭往後拉（預兆）→ 直拳（打在頭的高度，蹲下躲）
 *   空鎧武者：槍往後收（預兆）→ 往前突刺（胸口高度，蹲下躲）
 *   甲蟲砲台：固定在牆上，角發亮（預兆）→ 射一顆瞄準的光彈（打得掉）
 *   怨靈武士：半透明，化成紫煙（預兆）→ 出現在球球旁邊 → 壓低（預兆）→ 貼地橫斬（跳起來躲、往後退）
 *   守門石獅：只在城門口，符文變亮（預兆）→ 石爪橫掃；石獅沒打爛，城門的封印打不動
 *   中魔王 掃地機王：吸塵（把人往吸口拉，往反方向跑）、噴垃圾彈（拋物線、落地小爆炸）、倒車（預兆＋地上紅區）→ 往前衝撞
 *                    （衝撞壓低車身，只有下面 130 撞得到人：站上鐵走道、或抓準時機跳過去）
 *   魔王 鐵爪機關貓：一階 巨爪橫掃（跳）、背後飛彈（地上有落點瞄準圈）、放小掃把；
 *                    二階 裝甲剝落、雷射（紅線預告高度：低的躲上屋脊、高的蹲下）、暴走衝撞（身體壓低，躲上屋脊）
 */
import { ballistic, bossDie, ENEMY_DEFS, enemyBox, faceTo, fallStep, idleActivity, pick, rnd, setState, walkOn } from './enemies';
import { phaseUp } from './enemies2';
import type { Box, Enemy, Shot, ShotKind } from './entities';
import type { World } from './world';

export function updateStage3(e: Enemy, w: World, dt: number): void {
  if (e.boss && e.state !== 'start' && e.state !== 'die') keepInArena(e, w);
  switch (e.kind) {
    case 'vacuum': vacuum(e, w, dt); break;
    case 'mini_broom': miniBroom(e, w, dt); break;
    case 'broom_centipede': centipede(e, w, dt); break;
    case 'iron_arhat': arhat(e, w, dt); break;
    case 'armor_ghost': armor(e, w, dt); break;
    case 'plated_beetle': beetle(e, w, dt); break;
    case 'wraith_samurai': wraith(e, w, dt); break;
    case 'guardian_statue': statue(e, w, dt); break;
    case 'roomba_king': roomba(e, w, dt); break;
    case 'iron_claw': claw(e, w, dt); break;
    default: break;
  }
}

/**
 * 魔王不出場地：往後退拉開距離的時候不能退到畫面外（09-26 實機：鐵爪一直退到畫面右邊外面，雷射從畫面外射過來）。
 * 身體至少一半留在畫面裡。
 */
function keepInArena(e: Enemy, w: World): void {
  const ar = w.arena(), half = ENEMY_DEFS[e.kind].w / 2;
  e.x = Math.max(ar.x0 + half, Math.min(ar.x1 - half, e.x));
}

/** 在 e 前面 a～b 像素、高度 y0～y1（離腳底往上算）的範圍 */
function front(e: Enemy, a: number, b: number, up0: number, up1: number): Box {
  const x0 = e.x + e.facing * a, x1 = e.x + e.facing * b;
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: e.y - up1, y1: e.y - up0 };
}

// ───────────────────────── 吸（吸塵機器、掃地機王）─────────────────────────

/** 吸得進去的忍具（火焰、鎖鏈黏在手上；撒菱、鼠火在地上跑；毛球彈會彈） */
const SUCKABLE = new Set<ShotKind>(['shuriken', 'bo', 'fuma', 'dart', 'crane']);

/** 吸口的位置 */
export function mouthOf(e: Enemy): { x: number; y: number } {
  const d = ENEMY_DEFS[e.kind];
  return { x: e.x + e.facing * d.w * 0.45, y: e.y - (e.kind === 'roomba_king' ? 90 : 48) };
}

/**
 * 吸：吸口前面 range 以內、上下 170 以內的忍具被吸過去（吸進去就不見，這一路上不會打到牠）；
 * 球球在吸口前面、跟牠差不多高就被往吸口拉（每秒 pull 像素，越近越強）。回傳這一格吃掉幾發
 */
function suck(e: Enemy, w: World, dt: number, range: number, pull: number): number {
  const m = mouthOf(e);
  let eaten = 0;
  for (const s of w.shots) {
    if (s.age >= s.life || !SUCKABLE.has(s.kind)) continue;
    const ahead = (s.x - m.x) * e.facing;
    if (!s.sucked && (ahead < -30 || ahead > range || Math.abs(s.y - m.y) > 170)) continue;
    s.sucked = true;
    const L = Math.hypot(m.x - s.x, m.y - s.y) || 1;
    s.vx = (m.x - s.x) / L * 950; s.vy = (m.y - s.y) / L * 950; s.phase = 5;
    if (L < 48) { s.age = s.life; eaten++; w.fx({ kind: 'puff', x: m.x, y: m.y, vx: -e.facing * 60, vy: -40, life: 0.3, r: 10, color: '#dfe6ee' }); }
  }
  const p = w.player, b = p.body;
  const pd = (b.x - m.x) * e.facing;
  if (pull > 0 && p.alive && w.state === 'play' && pd > -20 && pd < range && Math.abs(b.y - e.y) < 220) {
    const k = pull * (1.15 - 0.5 * pd / range);
    b.x = Math.max(w.camX + 36, Math.min(w.camX + 1280 - 36, b.x - e.facing * k * dt));
  }
  // 風線、灰塵往吸口飛
  if (Math.random() < dt * 40) {
    const dx = rnd(40, range * 0.8), y = m.y + rnd(-120, 60);
    w.fx({ kind: 'spark', x: m.x + e.facing * dx, y, vx: -e.facing * rnd(500, 800), vy: (m.y - y) * 2, life: dx / 700, r: 2.5, color: '#e8f0ff' });
  }
  return eaten;
}

// ───────────────────────── 吸塵機器 ─────────────────────────

function vacuum(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround) { fallStep(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'glide': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      e.bodyHarm = true;
      if (d > 240) walkOn(e, w, e.facing * 140 * dt);
      else if (d < 140) walkOn(e, w, -e.facing * 80 * dt);
      m.cd = (m.cd ?? 1) - dt;
      if (m.cd <= 0 && d < 560 && w.onScreen(e.x, -20)) { setState(e, 'windup'); e.warn = 0.55; }
      break;
    }
    // 眼睛一閃、往前傾（預兆）
    case 'windup':
      if (e.t > 0.55) { setState(e, 'suck'); m.eaten = 0; w.event('enemyAttack', { kind: e.kind, move: '吸手裏劍' }); }
      break;
    case 'suck':
      m.eaten = (m.eaten ?? 0) + suck(e, w, dt, 440, 55);
      if (e.t > 1.0) { if (m.eaten > 0) setState(e, 'spit'); else { setState(e, 'glide'); m.cd = rnd(1.6, 2.4); } }
      break;
    // 吸到了：吐回來（最多三顆，貼地飛，打得掉）
    case 'spit':
      if (e.t > 0.25 && !m.spat) {
        m.spat = 1;
        const mo = mouthOf(e), n = Math.min(3, m.eaten ?? 1);
        for (let i = 0; i < n; i++) w.addBullet('pellet', mo.x, mo.y, e.facing * 380, (i - (n - 1) / 2) * 60, { hp: 1, life: 3 });
        w.event('enemyAttack', { kind: e.kind, move: '吐回來' });
      }
      if (e.t > 0.6) { m.spat = 0; setState(e, 'glide'); m.cd = rnd(1.6, 2.4); }
      break;
    default: setState(e, 'glide');
  }
}

// ───────────────────────── 小掃把、掃把蜈蚣 ─────────────────────────

function miniBroom(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.bodyHarm = true;
  if (!e.onGround) {
    if (fallStep(e, w, dt)) {
      setState(e, 'wait'); w.dust(e.x, e.y, 2);
      if (e.aware && w.onScreen(e.x, 0)) w.addBullet('wave', e.x + e.facing * 30, e.y, e.facing * 320, 0, { w: 40, h: 30, life: 0.35, src: 'mini_broom:dust' });
    }
    if (e.y > 900) e.dead = true;
    return;
  }
  if (!e.aware) { e.bodyHarm = false; idleActivity(e, w, dt); return; }
  if (tgt) faceTo(e, tgt.x);
  if (e.t > (m.wait ??= rnd(0.25, 0.5))) {
    e.vx = e.facing * rnd(170, 230); e.vy = -rnd(380, 460); e.onGround = false; e.plat = null;
    m.wait = rnd(0.25, 0.5); setState(e, 'hop');
  }
}

function centipede(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) { fallStep(e, w, dt); return; }
  if (!e.aware) { idleActivity(e, w, dt); return; }
  e.bodyHarm = true;
  switch (e.state) {
    case 'start': case 'crawl': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      walkOn(e, w, e.facing * 85 * dt);
      m.cd = (m.cd ?? 1.5) - dt;
      if (m.cd <= 0 && Math.abs(tgt.x - e.x) < 400 && w.onScreen(e.x, -40)) { setState(e, 'rear'); e.warn = 0.5; }
      break;
    }
    // 頭抬起來、停住（預兆）→ 往前竄
    case 'rear':
      if (e.t > 0.5) {
        setState(e, 'lunge'); w.event('enemyAttack', { kind: e.kind, move: '往前竄' });
        w.addBullet('wave', e.x + e.facing * 100, e.y, e.facing * 620, 0, { w: 56, h: 44, life: 0.6, src: 'broom_centipede:dust' });
      }
      break;
    case 'lunge':
      walkOn(e, w, e.facing * 470 * dt);
      if (e.t > 0.4) { setState(e, 'crawl'); m.cd = rnd(1.8, 2.6); }
      break;
    default: setState(e, 'crawl');
  }
}

/** 掃把蜈蚣打倒：分裂成三隻小掃把跳出來（算同一波，鎖畫面的要一起打完） */
export function splitCentipede(e: Enemy, w: World): void {
  for (let i = 0; i < 3; i++) {
    const b = w.spawn('mini_broom', e.x + (i - 1) * 90, e.y - 10);
    b.vx = (i - 1) * 170; b.vy = -rnd(420, 560); b.onGround = false; b.aware = true; b.group = e.group;
  }
  w.pop(e.x, e.y - 170, '分裂了！', '#ffd23a', 28);
  w.event('split', { kind: e.kind });
}

// ───────────────────────── 鐵羅漢 ─────────────────────────

/** 出拳的時候（蓄力、出拳、收拳）護甲打開，正面也打得進去 */
const ARHAT_OPEN = new Set(['windup', 'punch', 'recover']);
/** 穿得過護甲的忍具：風魔大手裏劍、火焰、鎖鏈、吹箭 */
const PIERCE = new Set<ShotKind>(['fuma', 'flame', 'chain', 'dart']);

/** 這一發被鐵羅漢正面擋掉嗎（從背後、從上面往下丟、穿透的都擋不住） */
export function arhatBlocks(e: Enemy, s: Shot): boolean {
  if (e.kind !== 'iron_arhat' || e.dying > 0 || ARHAT_OPEN.has(e.state)) return false;
  if (PIERCE.has(s.kind) || s.aim === 'down') return false;
  const dir = Math.sign(s.vx) || s.facing;
  return dir === -e.facing;
}

function arhat(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) { fallStep(e, w, dt); return; }
  if (!e.aware) { idleActivity(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'walk': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d > 150) walkOn(e, w, e.facing * 70 * dt);
      m.cd = (m.cd ?? 0.6) - dt;
      if (m.cd <= 0 && d < 240 && Math.abs(tgt.y - e.y) < 90) { setState(e, 'windup'); e.warn = 0.6; }
      break;
    }
    // 拳頭往後拉（預兆，這時候護甲打開）
    case 'windup':
      if (e.t > 0.6) {
        setState(e, 'punch'); w.shakeIt(0.08); w.event('enemyAttack', { kind: e.kind, move: '鐵拳' });
        w.addBullet('pellet', e.x + e.facing * 90, e.y - 150, e.facing * 700, 0, { w: 60, h: 50, life: 0.55, src: 'iron_arhat:fist' });
      }
      break;
    // 直拳：打在頭的高度（蹲下躲得過）
    case 'punch':
      if (e.t < 0.1) walkOn(e, w, e.facing * 450 * dt);
      if (e.t > 0.3) setState(e, 'recover');
      break;
    case 'recover':
      if (e.t > 0.7) { setState(e, 'walk'); m.cd = rnd(0.8, 1.4); }
      break;
    default: setState(e, 'walk');
  }
}

// ───────────────────────── 空鎧武者 ─────────────────────────

function armor(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.onGround) { fallStep(e, w, dt); return; }
  if (!e.aware) { idleActivity(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'walk': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d > 250) walkOn(e, w, e.facing * 80 * dt);
      m.cd = (m.cd ?? 0.8) - dt;
      if (m.cd <= 0 && d < 330 && Math.abs(tgt.y - e.y) < 90 && w.onScreen(e.x, -20)) { setState(e, 'windup'); e.warn = 0.6; }
      break;
    }
    // 槍往後收（預兆）→ 往前突刺：槍在胸口高度，蹲下躲得過
    case 'windup':
      if (e.t > 0.6) {
        setState(e, 'thrust'); w.event('enemyAttack', { kind: e.kind, move: '突刺' });
        w.addBullet('kunai', e.x + e.facing * 80, e.y - 130, e.facing * 760, 0, { w: 70, h: 18, life: 0.55, src: 'armor_ghost:spear' });
      }
      break;
    case 'thrust':
      if (e.t < 0.15) walkOn(e, w, e.facing * 600 * dt);
      if (e.t > 0.35) setState(e, 'recover');
      break;
    case 'recover':
      if (e.t > 0.6) { setState(e, 'walk'); m.cd = rnd(1.2, 2.0); }
      break;
    default: setState(e, 'walk');
  }
}

// ───────────────────────── 甲蟲砲台 ─────────────────────────

function beetle(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = false; e.vx = 0; e.vy = 0; e.aware = true;
  if (tgt) faceTo(e, tgt.x);
  switch (e.state) {
    case 'start': case 'idle':
      m.cd = (m.cd ?? rnd(0.8, 1.6)) - dt;
      if (m.cd <= 0 && tgt && w.fullyVisible(e)) { setState(e, 'windup'); e.warn = 0.7; }
      break;
    // 角尖發亮（預兆）→ 射一顆瞄準的光彈
    case 'windup':
      if (e.t > 0.7) {
        const hx = e.x + e.facing * 52, hy = e.y - 78;
        const tx = tgt ? tgt.x : hx + e.facing * 300, ty = tgt ? tgt.y - 90 : hy;
        const L = Math.hypot(tx - hx, ty - hy) || 1;
        w.addBullet('pellet', hx, hy, (tx - hx) / L * 320, (ty - hy) / L * 320, { hp: 1, life: 4 });
        setState(e, 'shoot'); w.event('enemyAttack', { kind: e.kind, move: '射光彈' });
      }
      break;
    case 'shoot':
      if (e.t > 0.5) { setState(e, 'idle'); m.cd = rnd(2.2, 3.0); }
      break;
    default: setState(e, 'idle');
  }
}

// ───────────────────────── 怨靈武士 ─────────────────────────

function wraith(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.onGround && e.state !== 'vanish') { fallStep(e, w, dt); return; }
  if (!e.aware) { idleActivity(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'walk': {
      m.alpha = 0.82;
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d > 200) walkOn(e, w, e.facing * 60 * dt);
      m.cd = (m.cd ?? 1.2) - dt;
      if (m.cd <= 0 && d < 720 && w.onScreen(e.x, -20)) setState(e, 'vanish');
      break;
    }
    // 化成紫煙（預兆）：煙快散掉時打不到，然後出現在球球旁邊
    case 'vanish':
      m.alpha = Math.max(0, 0.82 * (1 - e.t / 0.5));
      if (e.t > 0.25) e.invuln = 0.1;
      if (Math.random() < dt * 30) w.fx({ kind: 'smoke', x: e.x + rnd(-40, 40), y: e.y - rnd(20, 180), vx: rnd(-30, 30), vy: -rnd(30, 70), life: 0.6, r: rnd(16, 28), color: '#8a5ac8' });
      if (e.t > 0.55 && tgt) {
        const side = tgt.x < w.camX + 320 ? 1 : tgt.x > w.camX + 960 ? -1 : pick([-1, 1]);
        let nx = tgt.x + side * 190;
        if (!Number.isFinite(w.groundAt(nx)) || Math.abs(w.groundAt(nx) - tgt.y) > 40) nx = tgt.x - side * 190;
        const g = w.groundAt(nx);
        if (Number.isFinite(g)) { e.x = nx; e.y = g; e.plat = null; e.onGround = true; }
        faceTo(e, tgt.x);
        for (let i = 0; i < 8; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-50, 50), y: e.y - rnd(20, 180), vx: rnd(-40, 40), vy: -rnd(20, 60), life: 0.5, r: rnd(16, 30), color: '#8a5ac8' });
        setState(e, 'appear'); e.warn = 0.45;
      }
      break;
    // 出現、壓低（預兆）→ 貼地橫斬（跳起來躲）
    case 'appear':
      m.alpha = Math.min(0.82, e.t / 0.2);
      if (e.t > 0.45) {
        setState(e, 'slash'); w.event('enemyAttack', { kind: e.kind, move: '瞬移斬' });
        w.addBullet('wave', e.x + e.facing * 60, e.y, e.facing * 520, 0, { w: 70, h: 60, life: 0.55, src: 'wraith_samurai:slash' });
      }
      break;
    case 'slash':
      if (e.t > 0.35) setState(e, 'recover');
      break;
    case 'recover':
      if (e.t > 0.8) { setState(e, 'walk'); m.cd = rnd(2.6, 3.4); }
      break;
    default: setState(e, 'walk');
  }
}

// ───────────────────────── 守門石獅 ─────────────────────────

function statue(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.aware = true; e.facing = -1;
  switch (e.state) {
    case 'start': case 'idle': {
      m.cd = (m.cd ?? 0.4) - dt;
      if (tgt && m.cd <= 0 && Math.abs(tgt.x - e.x) < 340 && Math.abs(tgt.y - e.y) < 120) { setState(e, 'windup'); e.warn = 0.8; }
      break;
    }
    // 符文變亮、站起來（預兆）→ 石爪橫掃（貼地，跳起來躲、退後）
    case 'windup':
      if (e.t > 0.8) {
        setState(e, 'swipe'); w.shakeIt(0.12); w.event('enemyAttack', { kind: e.kind, move: '石爪橫掃' });
        w.addBullet('wave', e.x + e.facing * 70, e.y, e.facing * 480, 0, { w: 80, h: 70, life: 0.65, src: 'guardian_statue:swipe' });
      }
      break;
    case 'swipe':
      if (e.t > 0.4) setState(e, 'recover');
      break;
    case 'recover':
      if (e.t > 1.0) { setState(e, 'idle'); m.cd = 0.6; }
      break;
    default: setState(e, 'idle');
  }
}

// ───────────────────────── 中魔王：掃地機王 ─────────────────────────

/** 衝撞會衝多遠；衝撞時撞得到人的高度（車身壓低） */
export const RAM_DIST = 460, RAM_H = 130;

function roomba(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  const fast = e.hp < e.maxHp * 0.4;
  e.bodyHarm = e.state === 'suck';
  if (!e.onGround) fallStep(e, w, dt, 2600);
  if (fast && Math.random() < dt * 8) w.bossSmoke(e);
  switch (e.state) {
    case 'start':
      e.facing = -1;
      walkOn(e, w, -170 * dt);
      if (e.x < ar.x1 - 260 || e.t > 4) { setState(e, 'idle'); m.cd = 1; w.say(e, '清掃開始！全部吸進來！', 1.6); }
      break;
    case 'idle': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d < 360) walkOn(e, w, -e.facing * 120 * dt); else if (d > 700) walkOn(e, w, e.facing * 120 * dt);
      m.cd = (m.cd ?? 1) - dt;
      if (m.cd > 0) break;
      const r = Math.random();
      if (r < 0.36) { setState(e, 'suckWind'); e.warn = 0.7; w.say(e, '吸——！', 0.8); }
      else if (r < 0.68) { setState(e, 'garbageWind'); e.warn = 0.5; }
      else { setState(e, 'ramWind'); e.warn = 0.7; }
      break;
    }
    // 吸塵：眼睛睜大（預兆）→ 把球球往吸口拉、把手裏劍吸走（往反方向跑得掉）
    case 'suckWind':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.7) { setState(e, 'suck'); w.event('enemyAttack', { kind: e.kind, move: '吸塵' }); }
      break;
    case 'suck':
      suck(e, w, dt, 780, fast ? 190 : 160);
      if (e.t > 1.8) {
        const mo = mouthOf(e), pb = w.player.body;
        if (w.player.alive && Math.abs(pb.x - mo.x) < 260 && Math.abs(pb.y - e.y) < 200) {
          w.addBullet('garbage', mo.x, mo.y - 30, e.facing * 520, -180, { g: 1500, life: 2, src: 'roomba_king:spit' });
          w.event('enemyAttack', { kind: e.kind, move: '吐垃圾' });
        }
        setState(e, 'recover'); m.rec = 0.6;
      }
      break;
    // 噴垃圾彈：抖一抖（預兆）→ 三顆（快死了四顆）拋物線，落地小爆炸
    case 'garbageWind':
      e.squash = Math.sin(e.t * 40) * 0.04;
      if (e.t > 0.5 && tgt) {
        e.squash = 0;
        // 三顆：一顆瞄準球球、兩顆在左右 260（中間留得出躲的空隙）；快死了四顆：左右各兩顆、正中間反而是空的
        const n = fast ? 4 : 3, mo = mouthOf(e);
        const offs = fast ? [-390, -130, 130, 390] : [-260, 0, 260];
        for (let i = 0; i < n; i++) {
          const tx = Math.max(ar.x0 + 40, Math.min(ar.x1 - 40, tgt.x + offs[i]!));
          const g = w.groundAt(tx);
          const v = ballistic(mo.x, mo.y - 90, tx, Number.isFinite(g) ? g : 596, 0.95, 1500);
          w.addBullet('garbage', mo.x, mo.y - 90, v.vx, v.vy, { g: 1500, life: 3 });
        }
        setState(e, 'garbage'); w.event('enemyAttack', { kind: e.kind, move: '噴垃圾彈' });
      }
      break;
    case 'garbage':
      if (e.t > 0.5) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    // 倒車（預兆，地上有紅色的衝撞範圍）→ 往前衝一段
    case 'ramWind':
      walkOn(e, w, -e.facing * 50 * dt);
      if (e.t > 0.7) { setState(e, 'ram'); m.rx = e.x; w.event('enemyAttack', { kind: e.kind, move: '衝撞' }); }
      break;
    case 'ram': {
      const ok = walkOn(e, w, e.facing * 1100 * dt);
      const edge = e.x < ar.x0 + 150 || e.x > ar.x1 - 150;
      if (!ok || edge || Math.abs(e.x - (m.rx ?? e.x)) > RAM_DIST || e.t > 0.6) { w.shakeIt(0.2); w.dust(e.x + e.facing * 140, e.y, 8); setState(e, 'ramBack'); }
      break;
    }
    case 'ramBack':
      walkOn(e, w, -e.facing * 200 * dt);
      if (e.t > 0.6) { setState(e, 'recover'); m.rec = 0.4; }
      break;
    case 'recover':
      e.squash = 0;
      if (e.t > (m.rec ?? 0.6)) { setState(e, 'idle'); m.cd = fast ? 0.5 : 0.9; }
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}

// ───────────────────────── 魔王：鐵爪機關貓 ─────────────────────────

/** 雷射的高度（離地面往上）：low＝貼地（躲上屋脊）、high＝頭的高度（蹲下躲） */
export const LASER_BAND = { low: [15, 85], high: [110, 210] } as const;

/** 雷射這一刻打得到的範圍（沒在射就 null）；畫面跟判定用同一個 */
export function laserBox(e: Enemy, w: World): Box | null {
  if (e.kind !== 'iron_claw' || (e.state !== 'laser' && e.state !== 'laserWind')) return null;
  const ar = w.arena(), g = e.y;
  const band = e.mem.low ? LASER_BAND.low : LASER_BAND.high;
  const x0 = e.x + e.facing * 190, x1 = e.facing > 0 ? ar.x1 + 120 : ar.x0 - 120;
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: g - band[1], y1: g - band[0] };
}

function claw(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  const P2 = e.p2;
  e.bodyHarm = false;
  if (!e.onGround) fallStep(e, w, dt, 2600);
  if (P2 && e.hp < e.maxHp * 0.35 && Math.random() < dt * 10) w.bossSmoke(e);
  if (P2 && Math.random() < dt * 6) w.fx({ kind: 'ember', x: e.x + rnd(-80, 80), y: e.y - rnd(80, 220), vx: rnd(-60, 60), vy: -rnd(60, 160), g: 400, life: 0.5, r: 2.5, color: '#ffb347' });
  switch (e.state) {
    case 'start':
      e.facing = -1;
      walkOn(e, w, -150 * dt);
      if (e.x < ar.x1 - 300 || e.t > 4) { setState(e, 'roar'); w.say(e, '喀嚓……入侵者，排除！', 1.8); }
      break;
    case 'roar':
      if (e.t > 1.2) { setState(e, 'idle'); m.cd = 0.6; }
      break;
    case 'idle': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d < 300) walkOn(e, w, -e.facing * 100 * dt); else if (d > 650) walkOn(e, w, e.facing * 100 * dt);
      m.cd = (m.cd ?? 0.8) - dt;
      if (m.cd > 0) break;
      const r = Math.random();
      const brooms = w.enemies.filter((o) => o.kind === 'mini_broom' && !o.dead && o.dying <= 0).length;
      if (!P2) {
        if (r < 0.4) { setState(e, 'swipeWind'); e.warn = 0.7; }
        else if (r < 0.72) { setState(e, 'missileWind'); e.warn = 0.6; }
        else if (brooms < 3) { setState(e, 'broomWind'); e.warn = 0.6; w.say(e, '出動！', 0.8); }
        else { setState(e, 'swipeWind'); e.warn = 0.7; }
      } else {
        if (r < 0.3) { setState(e, 'laserWind'); e.warn = 1.0; m.low = Math.random() < 0.5 ? 1 : 0; }
        else if (r < 0.55) { setState(e, 'rampageWind'); e.warn = 0.8; w.say(e, '暴走——！', 0.9); }
        else if (r < 0.8) { setState(e, 'missileWind'); e.warn = 0.5; }
        else { setState(e, 'swipeWind'); e.warn = 0.5; }
      }
      break;
    }
    // 巨爪橫掃：站起來、爪子冒火花（預兆）→ 貼地往前一大掃（跳起來躲）
    case 'swipeWind':
      if (tgt && e.t < 0.2) faceTo(e, tgt.x);
      if (e.t > (P2 ? 0.5 : 0.7)) {
        setState(e, 'swipe'); w.shakeIt(0.15); w.event('enemyAttack', { kind: e.kind, move: '巨爪火焰刃' });
        w.addBullet('fireball', e.x + e.facing * 140, e.y - 45, e.facing * 640, 0, { w: 90, h: 70, life: 1.4, src: 'iron_claw:fireblade' });
      }
      break;
    case 'swipe':
      if (e.t < 0.1) walkOn(e, w, e.facing * 380 * dt);
      if (e.t > 0.5) { setState(e, 'recover'); m.rec = 0.6; }
      break;
    // 背後飛彈：艙門打開（預兆）→ 往上飛出畫面 → 地上出現瞄準圈 → 掉下來爆炸
    case 'missileWind':
      if (e.t > 0.6) {
        const n = P2 ? 5 : 3;
        for (let i = 0; i < n; i++) w.addBullet('missile', e.x - e.facing * 40 + (i - (n - 1) / 2) * 16, e.y - 300, rnd(-50, 50), -1100, { life: 0.6 });
        const px = tgt ? tgt.x : (ar.x0 + ar.x1) / 2;
        const xs = [px];
        for (let i = 1; i < n; i++) xs.push(px + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * rnd(210, 260));
        xs.forEach((x, i) => w.addMark(Math.max(ar.x0 + 30, Math.min(ar.x1 - 30, x)), 1.15 + i * 0.12));
        setState(e, 'missile'); w.event('enemyAttack', { kind: e.kind, move: '背後飛彈' });
      }
      break;
    case 'missile':
      if (e.t > 0.8) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    // 放出小掃把
    case 'broomWind':
      if (e.t > 0.6) {
        for (let i = 0; i < 3; i++) {
          const b = w.spawn('mini_broom', e.x - e.facing * 60, e.y - 220);
          b.vx = e.facing * rnd(120, 300); b.vy = -rnd(300, 520); b.onGround = false; b.aware = true; b.group = e.group;
        }
        setState(e, 'recover'); m.rec = 0.6; w.event('enemyAttack', { kind: e.kind, move: '放出小掃把' });
      }
      break;
    // 二階：雷射。爐心越來越亮、地上一條紅線告訴你會射多高（預兆 1 秒）→ 射 1.2 秒
    case 'laserWind':
      if (tgt && e.t < 0.1) faceTo(e, tgt.x);
      if (e.t > 1.0) { setState(e, 'laser'); w.shakeIt(0.2); w.event('enemyAttack', { kind: e.kind, move: m.low ? '雷射（低）' : '雷射（高）' }); }
      break;
    case 'laser':
      if (e.t > 0.05 && e.t < 1.25) e.harm = laserBox(e, w);
      if (e.t > 1.4) { setState(e, 'recover'); m.rec = 0.8; }
      break;
    // 二階：暴走衝撞。噴蒸氣、身體壓低（預兆）→ 衝到場地另一頭（身體壓得很低：站上屋脊就躲得過）
    case 'rampageWind':
      if (tgt && e.t < 0.1) faceTo(e, tgt.x);
      e.squash = Math.min(1, e.t / 0.8) * 0.2;
      if (Math.random() < dt * 30) w.fx({ kind: 'smoke', x: e.x - e.facing * 120, y: e.y - rnd(60, 160), vx: -e.facing * rnd(60, 140), vy: -rnd(40, 90), life: 0.6, r: rnd(14, 26), color: '#e8e8f0' });
      if (e.t > 0.8) {
        setState(e, 'rampage'); m.dir = e.facing; w.event('enemyAttack', { kind: e.kind, move: '暴走衝撞' });
        w.addBullet('wave', e.x + e.facing * 160, e.y, e.facing * 980, 0, { w: 90, h: 80, life: 1.2, src: 'iron_claw:rampage' });
      }
      break;
    case 'rampage': {
      e.squash = 0.2;
      const ok = walkOn(e, w, (m.dir ?? e.facing) * 760 * dt);
      if (Math.random() < dt * 30) w.dust(e.x - e.facing * 120, e.y, 2);
      const edge = (m.dir ?? e.facing) < 0 ? e.x < ar.x0 + 190 : e.x > ar.x1 - 190;
      if (!ok || edge || e.t > 1.8) { w.shakeIt(0.35); setState(e, 'recover'); m.rec = 0.9; }
      break;
    }
    case 'recover':
      e.squash = 0;
      if (e.t > (m.rec ?? 0.6)) { setState(e, 'idle'); m.cd = P2 ? 0.5 : 0.8; }
      break;
    // 換階段：抖、裝甲一片片彈掉、露出爐心（無敵）
    case 'change':
      e.invuln = 99; e.bodyHarm = false; e.squash = 0;
      if (e.t > 1.4 && e.t < 2.2 && Math.random() < dt * 14) {
        w.fx({ kind: 'debris', x: e.x + rnd(-120, 120), y: e.y - rnd(80, 300), vx: rnd(-420, 420), vy: -rnd(300, 700), g: 1600, life: 1.1, r: rnd(10, 18), spin: rnd(-12, 12), color: '#3a3438', sprite: 'debris_stone' });
      }
      if (e.t > 2.6) phaseUp(e, w, '裝甲……脫落！全力運轉——！');
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}
