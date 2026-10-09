/**
 * 第二關　妖怪祭典燈籠街 → 河童川 → 山頂神社（夜）的敵人與魔王（照 docs/2026-09-26_三大關設計.md）。
 * 規矩跟第一關一樣：每一招出手前都有預兆（身上閃紅＋頭上「！」、蓄力、冒泡泡），出手那一刻對上動作圖的出手格（enemyAnim.ts）。
 *
 *   燈籠鬼：飄在半空，鼓起臉頰（預兆）→ 吐一顆瞄準的火球
 *   傘妖：收傘蹲低（預兆）→ 撐開傘一跳一跳前進，落地震一下（小震波）
 *   紙鶴群：一整排從畫面邊緣閃一下（預兆）再排成波浪飛過來
 *   河童：水面冒泡（預兆）→ 從水裡冒出來 → 鼓頰（預兆）→ 噴水柱＋水彈 → 潛回水裡（上岸的會走路）
 *   面具舞者：轉一圈（預兆）→ 丟扇子，扇子飛到底會轉回來
 *   白狐巫女：舉杖、尾巴張開（預兆）→ 三團慢慢追人的狐火（打得掉）；太近了會瞬移拉開距離
 *   天狗：在半空揮羽扇蓄力（預兆）→ 一陣風把球球往後吹（不傷人，但會把你吹進坑、吹到敵人身上）
 *   蝌蚪兵：蛙大名叫出來的，舉著矛游過來
 *   中魔王 蛙大名：舌頭抓人（蹲下躲）、跳起來砸水花、叫蝌蚪；二階鼓頰吹泡泡
 *   魔王 狸大人：變石像（無敵、要等）、葉子手裏劍扇形、腹鼓震波；二階分身三隻只有一隻是真的、巨大化踩踏
 */
import { ballistic, bossDie, faceTo, fallStep, idleActivity, P2_HP, pick, rnd, setState, walkOn } from './enemies';
import { updateStage3 } from './enemies3';
import { overlap, VIEW_W, type Box, type Enemy } from './entities';
import type { World } from './world';

export function updateStage2(e: Enemy, w: World, dt: number): void {
  switch (e.kind) {
    case 'lantern_ghost': lantern(e, w, dt); break;
    case 'kasa_obake': kasa(e, w, dt); break;
    case 'paper_crane': crane(e, w, dt); break;
    case 'kappa': kappa(e, w, dt); break;
    case 'mask_dancer': dancer(e, w, dt); break;
    case 'fox_miko': fox(e, w, dt); break;
    case 'tengu': tengu(e, w, dt); break;
    case 'tadpole': tadpole(e, w, dt); break;
    case 'frog_daimyo': frog(e, w, dt); break;
    case 'tanuki_lord': tanukiLord(e, w, dt); break;
    case 'tanuki_clone': tanukiClone(e, w, dt); break;
    default: updateStage3(e, w, dt); break;
  }
}

/** 地面高度（坑上的就找旁邊的地面，飛行的怪才有高度可以參考） */
function groundNear(w: World, x: number): number {
  for (let d = 0; d < 600; d += 40) {
    const a = w.groundAt(x - d); if (Number.isFinite(a)) return a;
    const b = w.groundAt(x + d); if (Number.isFinite(b)) return b;
  }
  return 596;
}

/** 飛的怪：朝 (tx, ty) 平滑地飛過去 */
function flyTo(e: Enemy, tx: number, ty: number, dt: number, k = 2.2): void {
  e.vx += ((tx - e.x) * k - e.vx) * Math.min(1, dt * 3);
  e.vy += ((ty - e.y) * k - e.vy) * Math.min(1, dt * 3);
  e.x += e.vx * dt; e.y += e.vy * dt;
}

/** 在畫面外的飛行怪：先飛進畫面 */
function enterScreen(e: Enemy, w: World, dt: number): boolean {
  if (w.onScreen(e.x, -60)) return false;
  const c = w.camX + VIEW_W / 2;
  flyTo(e, e.x < c ? w.camX + 120 : w.camX + VIEW_W - 120, e.y, dt, 1.2);
  return true;
}

// ───────────────────────── 燈籠鬼 ─────────────────────────

function lantern(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = false;
  m.alt ??= rnd(200, 250);
  const baseY = groundNear(w, e.x) - m.alt + Math.sin(e.life * 2.4 + (m.phase ?? 0)) * 18;
  if (!e.aware) { e.x = m.home! + Math.sin(e.life * 0.8) * 40; e.y += (baseY - e.y) * Math.min(1, dt * 3); return; }
  switch (e.state) {
    case 'start': case 'float': {
      if (enterScreen(e, w, dt)) break;
      if (!tgt) { flyTo(e, e.x, baseY, dt); break; }
      m.side ??= e.x > tgt.x ? 1 : -1;
      // 飄得慢（最快每秒 110）：跑得過去、繞到牠底下往上丟
      flyTo(e, tgt.x + m.side * (m.dist ??= rnd(320, 420)), baseY, dt, 0.7);
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 110) { e.vx *= 110 / sp; e.vy *= 110 / sp; }
      faceTo(e, tgt.x);
      m.cd = (m.cd ?? 1.2) - dt;
      if (m.cd <= 0 && w.fullyVisible(e)) { setState(e, 'windup'); e.warn = 0.6; }
      break;
    }
    case 'windup':
      // 鼓起臉頰
      e.vx *= Math.pow(0.05, dt); e.x += e.vx * dt;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.6) {
        setState(e, 'spit');
        const mx = e.x + e.facing * 48, my = e.y - 88;
        const ty = tgt ? tgt.y - 90 : my, tx = tgt ? tgt.x : mx + e.facing * 300;
        const L = Math.hypot(tx - mx, ty - my) || 1;
        w.addBullet('fireball', mx, my, (tx - mx) / L * 290, (ty - my) / L * 290);
        w.event('enemyAttack', { kind: e.kind, move: '吐火球' });
      }
      break;
    case 'spit':
      if (e.t > 0.6) { m.cd = rnd(2.4, 3.4); m.side = (m.side ?? 1) * (Math.random() < 0.8 ? 1 : -1); setState(e, 'float'); }
      break;
    default: setState(e, 'float');
  }
}

// ───────────────────────── 傘妖 ─────────────────────────

function kasa(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround) {
    e.bodyHarm = e.vy > 0;
    if (fallStep(e, w, dt)) {
      // 落地震一下：兩邊各一道短短的小震波
      w.shakeIt(0.08); w.dust(e.x, e.y, 5);
      for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 50, e.y, s * 360, 0, { w: 46, h: 36, life: 0.4, src: 'kasa_obake:wave' });
      w.event('enemyAttack', { kind: e.kind, move: '落地小震' });
      setState(e, 'wait');
    }
    if (e.y > 900) e.dead = true;
    return;
  }
  switch (e.state) {
    case 'start': case 'wait':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > (m.wait ?? 0.35)) { setState(e, 'crouch'); e.warn = 0.3; m.wait = rnd(0.25, 0.5); }
      break;
    case 'crouch':
      // 收傘蹲低（預兆）
      e.squash = Math.min(1, e.t / 0.3) * 0.16;
      if (e.t > 0.3) {
        e.squash = 0;
        const far = tgt ? Math.min(1, Math.abs(tgt.x - e.x) / 400) : 1;
        e.vx = e.facing * rnd(160, 230) * (0.6 + 0.4 * far); e.vy = -rnd(560, 660); e.onGround = false; e.plat = null;
        setState(e, 'hop');
      }
      break;
    default: setState(e, 'wait');
  }
}

// ───────────────────────── 紙鶴群 ─────────────────────────

function crane(e: Enemy, w: World, dt: number): void {
  const m = e.mem;
  e.onGround = false; e.bodyHarm = e.state === 'glide';
  switch (e.state) {
    case 'start': {
      // 從畫面邊緣閃一下（預兆），再排成波浪飛過來
      m.dir ??= e.x > w.camX + VIEW_W / 2 ? -1 : 1;
      e.facing = m.dir > 0 ? 1 : -1;
      m.baseY ??= groundNear(w, e.x) - rnd(120, 150);
      const edge = m.dir < 0 ? w.camX + VIEW_W - 30 : w.camX + 30;
      e.x += (edge - e.x) * Math.min(1, dt * 5); e.y = m.baseY;
      if (e.t < 0.05) e.warn = 0.45;
      if (e.t > 0.45) setState(e, 'glide');
      break;
    }
    case 'glide': {
      const p = w.player.body;
      if (!m.dropped && Math.abs(p.x - e.x) < 180 && e.y < p.y - 120 && w.onScreen(e.x, 0)) {
        m.dropped = 1;
        w.addBullet('leaf', e.x, e.y + 20, m.dir! * 140, 260, { g: 500, life: 2, src: 'paper_crane:paper' });
        w.event('enemyAttack', { kind: e.kind, move: '丟摺紙' });
      }
      e.x += m.dir! * 280 * dt;
      e.y = m.baseY! + Math.sin(e.life * 4 + (m.phase ?? 0)) * 48;
      if (e.x < w.camX - 160 || e.x > w.camX + VIEW_W + 160) e.dead = true;
      break;
    }
    default: setState(e, 'start');
  }
}

// ───────────────────────── 河童 ─────────────────────────

function kappa(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (m.water) { kappaWater(e, w, dt); return; }
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround) { fallStep(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'walk': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      m.cd = (m.cd ?? 0.8) - dt;
      if (d > 360) walkOn(e, w, e.facing * 90 * dt);
      if (m.cd <= 0 && d < 560 && Math.abs(tgt.y - e.y) < 60 && w.onScreen(e.x, -20)) { setState(e, 'aim'); e.warn = 0.5; }
      break;
    }
    case 'aim': if (e.t > 0.5) kappaSpit(e, w); break;
    case 'spit':
      e.harm = kappaJet(e);
      if (e.t > 0.7) { m.cd = rnd(1.6, 2.4); setState(e, 'walk'); }
      break;
    default: setState(e, 'walk');
  }
}

/** 水柱（嘴巴前面 230 像素，出手後 0.4 秒內會傷人） */
function kappaJet(e: Enemy): Box | null {
  if (e.t > 0.4) return null;
  const my = e.y - 118, len = Math.min(230, 60 + e.t * 800);
  return { x0: Math.min(e.x + e.facing * 40, e.x + e.facing * (40 + len)), x1: Math.max(e.x + e.facing * 40, e.x + e.facing * (40 + len)), y0: my - 26, y1: my + 26 };
}

function kappaSpit(e: Enemy, w: World): void {
  setState(e, 'spit');
  w.addBullet('water', e.x + e.facing * 250, e.y - 118, e.facing * 420, 0);
  w.event('enemyAttack', { kind: e.kind, move: '噴水' });
}

/** 水裡的河童：泡泡（預兆）→ 冒出來 → 噴水 → 潛回去。水面下無敵、看不到 */
function kappaWater(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = true;
  const surf = m.surf!;
  m.clipY = surf + 6;   // 畫的時候只畫水面以上
  const up = surf + 28, down = surf + 200;
  switch (e.state) {
    case 'start': case 'under':
      e.invuln = 99; e.y = down;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > (m.wait ?? 0.6) && tgt && Math.abs(tgt.x - e.x) < 760) { setState(e, 'bubble'); e.warn = 0.6; }
      break;
    case 'bubble':
      // 水面冒泡（預兆）
      e.invuln = 99; e.y = down;
      if (Math.random() < dt * 22) w.fx({ kind: 'drop', x: e.x + rnd(-40, 40), y: surf, vx: rnd(-20, 20), vy: -rnd(60, 140), g: 500, life: 0.4, r: 5, color: '#bfe6ff' });
      if (e.t > 0.6) { setState(e, 'rise'); w.fx({ kind: 'puff', x: e.x, y: surf, vy: -80, life: 0.5, r: 16, color: '#dff4ff' }); }
      break;
    case 'rise':
      e.invuln = e.t < 0.2 ? 99 : 0;
      e.y += (up - e.y) * Math.min(1, dt * 10);
      if (e.t > 0.35) { e.y = up; setState(e, 'aim'); e.warn = 0.5; if (tgt) faceTo(e, tgt.x); }
      break;
    case 'aim': if (e.t > 0.5) kappaSpit(e, w); break;
    case 'spit':
      e.harm = kappaJet(e);
      if (e.t > 0.8) setState(e, 'dive');
      break;
    case 'dive':
      e.y += (down - e.y) * Math.min(1, dt * 7);
      if (e.t > 0.45) { m.wait = rnd(1.2, 2.2); setState(e, 'under'); w.fx({ kind: 'puff', x: e.x, y: surf, vy: -60, life: 0.4, r: 14, color: '#dff4ff' }); }
      break;
    default: setState(e, 'under');
  }
}

// ───────────────────────── 面具舞者 ─────────────────────────

function dancer(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround) { fallStep(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'walk': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      const d = Math.abs(tgt.x - e.x);
      if (d > 460) walkOn(e, w, e.facing * 120 * dt);
      else if (d < 300) walkOn(e, w, -e.facing * 100 * dt);
      m.cd = (m.cd ?? 1) - dt;
      if (m.cd <= 0 && w.onScreen(e.x, -20) && !w.bullets.some((b) => b.owner === e)) { setState(e, 'windup'); e.warn = 0.6; }
      break;
    }
    case 'windup':
      // 轉一圈（預兆）
      if (e.t > 0.6) {
        setState(e, 'throw');
        w.addBullet('fan', e.x + e.facing * 40, e.y - 128, e.facing * 640, 0, { owner: e, life: 3.2 });
        w.event('enemyAttack', { kind: e.kind, move: '丟扇子' });
      }
      break;
    case 'throw':
      if (e.t > 0.7) { m.cd = rnd(1.4, 2.0); setState(e, 'walk'); }
      break;
    default: setState(e, 'walk');
  }
}

// ───────────────────────── 白狐巫女 ─────────────────────────

function fox(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  if (!e.aware) { idleActivity(e, w, dt); return; }
  if (!e.onGround) { fallStep(e, w, dt); return; }
  switch (e.state) {
    case 'start': case 'stand': {
      if (!tgt) break;
      faceTo(e, tgt.x);
      if (!w.onScreen(e.x, -40)) { walkOn(e, w, e.facing * 120 * dt); break; }
      const d = Math.abs(tgt.x - e.x);
      m.blinkCd = (m.blinkCd ?? 0) - dt;
      if (d < 250 && m.blinkCd <= 0) { setState(e, 'blink'); break; }
      m.cd = (m.cd ?? 1.2) - dt;
      if (m.cd <= 0) { setState(e, 'windup'); e.warn = 0.7; }
      break;
    }
    case 'blink':
      // 太近了：一陣煙瞬移到另一邊（煙＝預兆），拉開距離
      if (e.t < dt * 1.5) for (let i = 0; i < 6; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-40, 40), y: e.y - rnd(20, 160), vy: -40, life: 0.6, r: rnd(20, 34), color: '#e8e0f0' });
      if (e.t > 0.3 && tgt) {
        const ar = w.arena();
        const nx = tgt.x < (ar.x0 + ar.x1) / 2 ? Math.min(ar.x1 - 80, tgt.x + 480) : Math.max(ar.x0 + 80, tgt.x - 480);
        if (Number.isFinite(w.groundAt(nx))) { e.x = nx; e.y = w.groundAt(nx); e.plat = null; }
        for (let i = 0; i < 6; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-40, 40), y: e.y - rnd(20, 160), vy: -40, life: 0.6, r: rnd(20, 34), color: '#e8e0f0' });
        m.blinkCd = 3; m.cd = Math.max(m.cd ?? 0, 0.6);
        setState(e, 'stand');
      }
      break;
    case 'windup':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.7) {
        setState(e, 'cast');
        for (let i = 0; i < 3; i++) {
          const b = w.addBullet('foxfire', e.x + e.facing * 70, e.y - 150 + i * 42, e.facing * 150, (i - 1) * 40, { homing: 1.3, hp: 1, life: 4.5 });
          b.rot = i;
        }
        w.event('enemyAttack', { kind: e.kind, move: '狐火' });
      }
      break;
    case 'cast':
      if (e.t > 0.9) { m.cd = rnd(2.4, 3.2); setState(e, 'stand'); }
      break;
    default: setState(e, 'stand');
  }
}

// ───────────────────────── 天狗 ─────────────────────────

function tengu(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = false;
  m.alt ??= rnd(200, 250);
  const baseY = groundNear(w, e.x) - m.alt + Math.sin(e.life * 2 + (m.phase ?? 0)) * 14;
  if (!e.aware) { e.y += (baseY - e.y) * Math.min(1, dt * 3); return; }
  switch (e.state) {
    case 'start': case 'hover': {
      if (enterScreen(e, w, dt)) break;
      if (!tgt) break;
      m.side ??= e.x > tgt.x ? 1 : -1;
      flyTo(e, tgt.x + m.side * 340, baseY, dt, 1.2);
      faceTo(e, tgt.x);
      m.cd = (m.cd ?? 1.2) - dt;
      if (m.cd <= 0 && w.fullyVisible(e)) { setState(e, 'windup'); e.warn = 0.6; }
      break;
    }
    case 'windup':
      // 羽扇往後拉（預兆）
      e.vx *= Math.pow(0.05, dt); e.vy *= Math.pow(0.05, dt); e.x += e.vx * dt; e.y += e.vy * dt;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.6) {
        setState(e, 'gust');
        // 風：從扇子往前 560、斜斜往下吹到地面，0.9 秒；不傷人，把人往後吹
        const g = groundNear(w, e.x + e.facing * 300);
        const b = w.addBullet('gust', e.x + e.facing * 320, (e.y - 120 + g) / 2, e.facing * 1, 0, { w: 560, h: g - (e.y - 160), life: 0.9, push: 420 });
        b.g = 0;
        w.event('enemyAttack', { kind: e.kind, move: '刮風' });
      }
      break;
    case 'gust':
      if (e.t > 0.9) { m.cd = rnd(2.2, 3.0); m.side = -(m.side ?? 1) * (Math.random() < 0.4 ? -1 : 1); setState(e, 'hover'); }
      break;
    default: setState(e, 'hover');
  }
}

// ───────────────────────── 蝌蚪兵 ─────────────────────────

function tadpole(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.onGround = false; e.bodyHarm = e.t > 0.4;
  m.lvl ??= rnd(90, 150);
  const ty = (tgt ? tgt.y : groundNear(w, e.x)) - m.lvl + Math.sin(e.life * 5) * 20;
  if (tgt) { faceTo(e, tgt.x); flyTo(e, tgt.x, ty, dt, 0.9); } else e.x += e.facing * 100 * dt;
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > 170) { e.vx *= 170 / sp; e.vy *= 170 / sp; }
  m.spit = (m.spit ?? rnd(1.0, 1.8)) - dt;
  if (m.spit <= 0 && tgt && w.onScreen(e.x, 0)) {
    m.spit = rnd(1.6, 2.4);
    const dx = tgt.x - e.x, dy = (tgt.y - 80) - e.y, L = Math.hypot(dx, dy) || 1;
    w.addBullet('splash', e.x + e.facing * 20, e.y, dx / L * 380, dy / L * 380, { w: 26, h: 26, life: 2, src: 'tadpole:spit' });
  }
}

// ───────────────────────── 中魔王：蛙大名 ─────────────────────────

/** 舌頭的傷害範圍：嘴巴往前伸（高度在球球的頭，蹲下躲得過） */
function tongueBox(e: Enemy, len: number): Box {
  const my = e.y - 158;
  const x0 = e.x + e.facing * 90, x1 = e.x + e.facing * (90 + len);
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: my - 22, y1: my + 22 };
}

function frog(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  const P2 = e.p2;
  e.bodyHarm = ['jumpAir', 'splash'].includes(e.state);
  if (!e.onGround && e.state !== 'jumpAir') fallStep(e, w, dt);
  if (e.hp < e.maxHp * 0.3 && P2 && Math.random() < dt * 10) w.bossSmoke(e);
  switch (e.state) {
    case 'start':
      e.facing = -1;
      walkOn(e, w, -150 * dt);
      if (e.x < ar.x1 - 220 || e.t > 4) { setState(e, 'idle'); m.cd = 1; w.say(e, '呱！誰敢在本大名的沼澤撒野！', 1.6); }
      break;
    case 'idle': {
      e.squash = 0;
      if (tgt) faceTo(e, tgt.x);
      m.cd! -= dt;
      if (m.cd! > 0 || !tgt) break;
      const d = Math.abs(tgt.x - e.x), r = Math.random();
      const pads = w.enemies.filter((o) => o.kind === 'tadpole' && !o.dying && !o.dead).length;
      if (d < 520 && r < 0.45) { setState(e, 'tongueWind'); e.warn = P2 ? 0.45 : 0.6; }
      else if (pads < 3 && r < 0.65) { setState(e, 'summonWind'); e.warn = 0.6; w.say(e, '蝌蚪們，上！', 0.9); }
      else if (P2 && r < 0.85) { setState(e, 'cheekWind'); e.warn = 0.7; }
      else { setState(e, 'jumpWind'); e.warn = 0.4; }
      break;
    }
    // 黏液彈（10-10 改：原本舌頭抓人咬一口）：張嘴（預兆）→ 舌頭一甩，一團黏液沿頭的高度飛出去（蹲下躲得過）；
    // 打中扣血、跑步變慢 2 秒。第二階段再補一團低的（晚 0.35 秒：先蹲過高的、再跳過低的；同時到就只能翻滾）
    case 'tongueWind':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > (P2 ? 0.45 : 0.6)) {
        setState(e, 'tongue'); w.event('enemyAttack', { kind: e.kind, move: '黏液彈' });
        const my = tongueBox(e, 0).y0 + 22;
        w.addBullet('water', e.x + e.facing * 120, my, e.facing * 620, 0, { w: 60, h: 36, life: 1.6, src: 'frog_daimyo:slime', slow: 2 });
      }
      break;
    case 'tongue':
      if (P2 && e.t > 0.35 && !m.low2) { m.low2 = 1; w.addBullet('water', e.x + e.facing * 120, e.y - 40, e.facing * 560, 0, { w: 60, h: 36, life: 1.8, src: 'frog_daimyo:slime', slow: 2 }); }
      if (e.t > 0.75) { setState(e, 'recover'); m.rec = 0.5; m.low2 = 0; }
      break;
    // 跳起來砸水花：蹲低（預兆）→ 跳到你那裡 → 落地濺起水花（往兩邊的拋物線水滴＋地面震波）
    case 'jumpWind':
      e.squash = Math.min(1, e.t / 0.55) * 0.14;
      if (e.t < dt * 1.5 && tgt) m.tx = Math.max(ar.x0 + 150, Math.min(ar.x1 - 150, tgt.x));   // 落點：地上紅圈（render.ts）
      if (e.t > 0.55 && tgt) {
        e.squash = 0;
        m.tx ??= Math.max(ar.x0 + 150, Math.min(ar.x1 - 150, tgt.x));
        const g = w.groundAt(m.tx);
        const j = ballistic(e.x, e.y, m.tx, Number.isFinite(g) ? g : e.y, 0.8, 2400);
        e.vx = j.vx; e.vy = j.vy; e.onGround = false; e.plat = null;
        setState(e, 'jumpAir'); w.event('enemyAttack', { kind: e.kind, move: '跳起來砸水花' });
      }
      break;
    case 'jumpAir':
      if (fallStep(e, w, dt, 2400)) {
        w.shakeIt(0.35); w.dust(e.x, e.y, 10);
        for (let i = 0; i < 8; i++) {
          const s = i % 2 ? 1 : -1, sp = rnd(200, 420);
          w.addBullet('splash', e.x + s * 80, e.y - 40, s * sp, -rnd(520, 760), { g: 1500 });
        }
        for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 110, e.y, s * 400, 0, { src: 'frog_daimyo:wave' });
        setState(e, 'splash');
      }
      break;
    case 'splash':
      if (e.t > 0.6) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    // 叫蝌蚪：跺腳（預兆）→ 三隻蝌蚪兵從水裡跳出來
    case 'summonWind':
      if (e.t > 0.6) {
        for (let i = 0; i < 3; i++) {
          const k = w.spawn('tadpole', e.x + e.facing * 60 + (i - 1) * 50, e.y - 160);
          k.vx = e.facing * rnd(80, 180); k.vy = -rnd(200, 360); k.group = e.group; k.aware = true;
        }
        w.event('enemyAttack', { kind: e.kind, move: '叫蝌蚪' });
        setState(e, 'recover'); m.rec = 0.6;
      }
      break;
    // 二階：鼓頰（預兆，臉頰越鼓越大）→ 吹出五顆大泡泡（慢、打得掉），再一陣風
    case 'cheekWind':
      e.squash = -Math.min(1, e.t / 0.7) * 0.08;
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.7) {
        e.squash = 0;
        for (let i = 0; i < 5; i++) {
          const a = (i - 2) * 0.22;
          w.addBullet('bubble', e.x + e.facing * 120, e.y - 170, e.facing * Math.cos(a) * 230, Math.sin(a) * 230 - 30, { hp: 2, life: 4, w: 58, h: 58 });
        }
        w.event('enemyAttack', { kind: e.kind, move: '鼓頰吹泡泡' });
        setState(e, 'cheek');
      }
      break;
    case 'cheek':
      if (e.t > 0.6) { setState(e, 'recover'); m.rec = 0.6; }
      break;
    case 'recover':
      e.squash = 0;
      if (e.t > (m.rec ?? 0.6)) { setState(e, 'idle'); m.cd = P2 ? 0.5 : 0.9; }
      break;
    // 換階段：跺腳、臉頰鼓成兩顆大氣球（無敵）
    case 'change':
      e.invuln = 99; e.bodyHarm = false;
      if (e.t > 2.4) phaseUp(e, w, '呱呱呱——！本大名要認真了！');
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}

/** 換到第二階段（蛙大名、狸大人、鐵爪機關貓共用） */
export function phaseUp(e: Enemy, w: World, line: string): void {
  e.p2 = true;
  e.hp = e.maxHp = pickP2(e);
  e.invuln = 0.6; e.flash = 0.12;
  w.flashScreen(0.3); w.shakeIt(0.35);
  setState(e, 'roar'); w.say(e, line, 1.6);
  // 第二版：攻略字幕拿掉（09-28 使用者：不要教學，讓玩家自己發現），地上的紅線本身就是提示
  w.event('bossPhase', { kind: e.kind, phase: 2 });
}
function pickP2(e: Enemy): number { return P2_HP[e.kind] ?? e.maxHp; }

// ───────────────────────── 魔王：狸大人 ─────────────────────────

function tanukiLord(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem, ar = w.arena();
  const P2 = e.p2;
  e.bodyHarm = e.state === 'giant' || e.state === 'giantWind';
  if (!e.onGround) fallStep(e, w, dt, 2600);
  if (e.hp < e.maxHp * 0.3 && P2 && Math.random() < dt * 10) w.bossSmoke(e);
  // 巨大化慢慢縮回來
  if (e.state !== 'giant' && e.state !== 'giantWind' && (m.giant ?? 1) > 1) m.giant = Math.max(1, m.giant! - dt * 0.8);
  switch (e.state) {
    case 'start':
      // 一陣煙出場
      e.facing = -1; e.x = ar.x1 - 300; e.y = w.groundAt(e.x); e.onGround = true;
      for (let i = 0; i < 12; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-120, 120), y: e.y - rnd(0, 300), vx: rnd(-40, 40), vy: -rnd(20, 60), life: rnd(0.8, 1.3), r: rnd(30, 60), color: '#eae4f0' });
      setState(e, 'roar'); w.say(e, '哼哼，想上山？先過本大人這關！', 1.8);
      break;
    case 'roar':
      if (e.t > 1.4) { setState(e, 'idle'); m.cd = 0.6; }
      break;
    case 'idle': {
      e.squash = 0;
      if (tgt) faceTo(e, tgt.x);
      // 走位：保持在畫面中間偏遠
      if (tgt && Math.abs(tgt.x - e.x) < 260) walkOn(e, w, -e.facing * 90 * dt);
      m.cd! -= dt;
      if (m.cd! > 0 || !tgt) break;
      const r = Math.random();
      if (!P2) {
        if (r < 0.38) { setState(e, 'leafWind'); e.warn = 0.8; }
        else if (r < 0.72) { setState(e, 'drumWind'); e.warn = 0.5; }
        else { setState(e, 'stone'); w.say(e, '變！', 0.8); }
      } else {
        const clones = w.enemies.some((o) => o.kind === 'tanuki_clone' && !o.dead && o.dying <= 0);
        if (!clones && r < 0.3) { setState(e, 'cloneWind'); e.warn = 0.6; w.say(e, '分身術！', 0.9); }
        else if (r < 0.62) { setState(e, 'giantWind'); e.warn = 0.6; w.say(e, '巨大化！', 0.8); }
        else { setState(e, 'leafWind'); e.warn = 0.6; }
      }
      break;
    }
    // 葉子手裏劍：轉一圈（預兆）→ 扇形丟出一把葉子
    case 'leafWind':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > (P2 ? 0.6 : 0.8)) {
        leafFan(e, w, P2 ? 7 : 5);
        setState(e, 'leaf'); w.event('enemyAttack', { kind: e.kind, move: '葉子手裏劍' });
      }
      break;
    case 'leaf':
      if (e.t > 0.5) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    // 腹鼓震波：拍肚子三下，每下一道地面震波（最後一下兩邊都有）
    case 'drumWind':
      if (tgt) faceTo(e, tgt.x);
      if (e.t > 0.5) { setState(e, 'drum'); m.beat = 0; w.event('enemyAttack', { kind: e.kind, move: '腹鼓震波' }); }
      break;
    case 'drum': {
      const beats = [0, 0.4, 0.8];   // 對上 tanuki_drum 片段的三下（出手格 hit、hit2、hit3）
      while ((m.beat ?? 0) < beats.length && e.t >= beats[m.beat!]!) {
        w.shakeIt(0.2);
        w.addBullet('wave', e.x + e.facing * 120, e.y, e.facing * 430, 0);
        if (m.beat === 2) w.addBullet('wave', e.x - e.facing * 120, e.y, -e.facing * 430, 0);
        m.beat = (m.beat ?? 0) + 1;
      }
      if (e.t > 1.3) { setState(e, 'recover'); m.rec = 0.5; }
      break;
    }
    // 變石像：一陣煙變成石頭（無敵，要等），裂開之後頭暈一下（這時候打最痛）
    case 'stone':
      e.invuln = e.t > 1.0 && e.t < 2.05 ? 99 : 0;
      if (e.t > 1.0 && e.t < 1.05) w.event('enemyAttack', { kind: e.kind, move: '變石像' });
      if (e.t > 2.05 && !m.cracked) { m.cracked = 1; w.shakeIt(0.15); for (let i = 0; i < 8; i++) w.fx({ kind: 'debris', x: e.x + rnd(-80, 80), y: e.y - rnd(40, 280), vx: rnd(-260, 260), vy: -rnd(200, 500), g: 1500, life: 0.9, r: rnd(6, 12), spin: rnd(-10, 10), color: '#8a8a90', sprite: 'debris_stone' }); }
      if (e.t > 2.9) { m.cracked = 0; e.invuln = 0; setState(e, 'dizzy'); w.say(e, '頭好暈…', 1.0); }
      break;
    case 'dizzy':
      e.lean = Math.sin(e.t * 12) * 0.05;
      if (e.t > 1.2) { e.lean = 0; setState(e, 'idle'); m.cd = 0.4; }
      break;
    // 二階：分身三隻（煙＝預兆），只有一隻是真的；打到真的，假的就一起散掉
    case 'cloneWind':
      if (e.t < dt * 1.5) for (let i = 0; i < 14; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-140, 140), y: e.y - rnd(0, 320), vx: rnd(-60, 60), vy: -rnd(20, 60), life: rnd(0.8, 1.2), r: rnd(30, 60), color: '#eae4f0' });
      if (e.t > 0.6) {
        const spots = [ar.x0 + 220, (ar.x0 + ar.x1) / 2, ar.x1 - 220].sort(() => Math.random() - 0.5);
        e.x = spots[0]!; e.y = w.groundAt(e.x);
        for (const x of spots.slice(1)) {
          const c = w.spawn('tanuki_clone', x, w.groundAt(x));
          c.p2 = true; c.group = e.group; c.aware = true; c.mem.cd = rnd(0.8, 1.6); c.mem.life = 8;
          for (let i = 0; i < 8; i++) w.fx({ kind: 'smoke', x: x + rnd(-100, 100), y: c.y - rnd(0, 300), vy: -40, life: 0.8, r: rnd(30, 50), color: '#eae4f0' });
        }
        w.event('enemyAttack', { kind: e.kind, move: '分身三隻' });
        setState(e, 'recover'); m.rec = 0.6;
      }
      break;
    // 二階：巨大化（慢慢變大＝預兆）→ 抬腳踩兩下，每一下兩邊都有大震波
    case 'giantWind':
      m.giant = 1 + Math.min(1, e.t / 0.6) * 0.25;
      if (e.t > 0.6) { setState(e, 'giant'); m.beat = 0; w.event('enemyAttack', { kind: e.kind, move: '巨大化踩踏' }); }
      break;
    case 'giant': {
      const beats = [0.3, 1.61];   // 對上 tanuki2_stomp 片段兩腳落地那兩格
      while ((m.beat ?? 0) < beats.length && e.t >= beats[m.beat!]!) {
        w.shakeIt(0.45); w.dust(e.x - 60, e.y, 10); w.dust(e.x + 60, e.y, 10);
        for (const s of [-1, 1]) w.addBullet('wave', e.x + s * 150, e.y, s * 460, 0, { w: 80, h: 76, src: 'tanuki_lord:giantwave' });
        m.beat = (m.beat ?? 0) + 1;
      }
      if (e.t > 2.4) { setState(e, 'recover'); m.rec = 0.6; }
      break;
    }
    case 'recover':
      e.squash = 0;
      if (e.t > (m.rec ?? 0.6)) { setState(e, 'idle'); m.cd = P2 ? 0.5 : 0.8; }
      break;
    // 換階段：帽子掉了、葉子落在頭上、一陣煙（無敵）
    case 'change':
      e.invuln = 99; e.bodyHarm = false;
      if (e.t > 2.8) phaseUp(e, w, '可惡——！本大人要動真格了！');
      break;
    case 'die': bossDie(e, w, dt); break;
    default: setState(e, 'idle');
  }
}

/** 扇形丟出一把葉子手裏劍（朝球球的方向為中心） */
function leafFan(e: Enemy, w: World, n: number): void {
  const tgt = w.target();
  const hx = e.x + e.facing * 90, hy = e.y - 190;
  const base = tgt ? Math.atan2((tgt.y - 90) - hy, tgt.x - hx) : (e.facing > 0 ? 0 : Math.PI);
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.16;
    w.addBullet('leaf', hx, hy, Math.cos(a) * 420, Math.sin(a) * 420);
  }
}

/** 狸大人的分身：跟真的一樣走來走去、偶爾丟一片葉子；打一下就「砰」一聲散掉；8 秒後自己散掉 */
function tanukiClone(e: Enemy, w: World, dt: number): void {
  const tgt = w.target(), m = e.mem;
  e.p2 = true;
  if (!e.onGround) fallStep(e, w, dt, 2600);
  if (tgt) faceTo(e, tgt.x);
  m.life = (m.life ?? 8) - dt;
  if (m.life <= 0 || !w.boss || w.boss.dead || w.boss.state === 'die') { popClone(e, w); return; }
  m.cd = (m.cd ?? 1) - dt;
  if (e.state === 'windup') {
    if (e.t > 0.6) { leafFan(e, w, 3); setState(e, 'walk'); m.cd = rnd(1.8, 2.8); }
  } else if (m.cd <= 0 && tgt) { setState(e, 'windup'); e.warn = 0.6; }
}

/** 分身散掉：一陣煙＋一片葉子飄走 */
export function popClone(e: Enemy, w: World): void {
  if (e.dead) return;
  e.dead = true;
  for (let i = 0; i < 10; i++) w.fx({ kind: 'smoke', x: e.x + rnd(-80, 80), y: e.y - rnd(20, 300), vx: rnd(-60, 60), vy: -rnd(30, 80), life: rnd(0.6, 1.0), r: rnd(24, 46), color: '#eae4f0' });
  w.fx({ kind: 'drop', x: e.x, y: e.y - 300, vx: rnd(-40, 40), vy: -60, g: 60, life: 1.4, r: 10, color: '#7fa446' });
  w.say(w.boss ?? e, pick(['那是假的啦！', '嘿嘿，猜錯了～']), 1.0);
  w.event('cloneGone', {});
}

/** 分身全部散掉（打到真的狸大人時） */
export function popAllClones(w: World): void {
  for (const o of w.enemies) if (o.kind === 'tanuki_clone' && !o.dead) popClone(o, w);
}

