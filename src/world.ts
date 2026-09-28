/**
 * 一關的遊戲世界（不碰畫面，測試直接餵）：
 *   出怪表照鏡頭位置觸發、鏡頭只往右（打一波、打魔王時鎖住）、球球的血與命、忍具飛行與命中、
 *   敵人子彈、爆炸、可破壞的場景、被綁的村貓、掉落物、分數與連殺。
 * render.ts 只讀這裡的資料來畫；game.ts 管標題、接關、結算畫面。
 */
import {
  boxAt, GROUND, HUD_BOTTOM, isGate, overlap, VIEW_H, VIEW_W,
  type Aim, type Banner, type Bomb, type Box, type Breakable, type BreakKind, type Bullet, type BulletKind, type Captive,
  type Decal, type DropKind, type Enemy, type EnemyKind, type Explosion, type GameEvent, type Hole, type Particle, type Pickup, type Pop, type Shot, type ShotKind,
} from './entities';
import { ENEMY_DEFS, enemyBox, KING_BODY_CHIP, kingPackBox, kingPackBroken, newEnemy, notice, P2_HP, updateEnemy } from './enemies';
import { animateEnemy } from './enemyAnim';
import { popAllClones, popClone } from './enemies2';
import { arhatBlocks, splitCentipede } from './enemies3';
import type { Frame } from './input';
import type { Platform, World as PhysWorld } from './physics';
import { Player } from './player';
import { Animator, type AnimDefs } from './sprite';
import type { PlatformDef, SpawnDef, StageDef } from './stages/types';
import { Terrain } from './terrain';
import { DEV_WEAPON_KEYS, SUB_ORDER, SUBS, WEAPONS, type SubId, type WeaponId } from './weapons';

export type WorldState = 'intro' | 'play' | 'dying' | 'continue' | 'clear' | 'done';
export const LIVES = 3;
/** 開場「任務一 開始！」畫面停頓幾秒 */
export const INTRO_FREEZE = 0.9;
/** 倒下到重生（或出現接關）幾秒 */
export const DOWN_TIME = 2.0;
/** 過關「任務完成！」之後幾秒進結算 */
export const CLEAR_TIME = 3.6;
/** 蒸氣噴口：噴幾秒、噴之前冒小煙（預兆）幾秒 */
export const VENT_ON = 0.9, VENT_WARN = 0.6;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** 可破壞物的判定大小（照 terrain.json 那批圖畫出來的大小）、血量、打爛給的分數、碎片用哪幾張圖 */
const BREAK_DEFS: Record<BreakKind, { w: number; h: number; hp: number; score: number; debris: string[] }> = {
  crate: { w: 82, h: 68, hp: 20, score: 100, debris: ['plank', 'splinter'] },
  barrel: { w: 74, h: 88, hp: 30, score: 100, debris: ['stave', 'hoop'] },
  powder: { w: 70, h: 98, hp: 10, score: 200, debris: ['stave', 'char'] },
  cage: { w: 150, h: 165, hp: 30, score: 0, debris: ['bamboo', 'straw'] },
  tower: { w: 150, h: 420, hp: 160, score: 1000, debris: ['plank', 'splinter', 'straw'] },
  gate: { w: 200, h: 430, hp: 260, score: 2000, debris: ['plank', 'char', 'splinter'] },
  stall: { w: 200, h: 160, hp: 40, score: 300, debris: ['plank', 'straw'] },
  s2_lantern_stall: { w: 200, h: 160, hp: 40, score: 300, debris: ['plank', 'straw'] },
  s2_crate: { w: 82, h: 68, hp: 20, score: 100, debris: ['plank', 'splinter'] },
  s2_sake_stack: { w: 136, h: 122, hp: 30, score: 200, debris: ['stave', 'hoop'] },
  s2_stone_lantern: { w: 70, h: 142, hp: 40, score: 200, debris: ['stone'] },
  s2_offering_box: { w: 112, h: 58, hp: 20, score: 500, debris: ['plank', 'splinter'] },
  s2_signboard: { w: 190, h: 142, hp: 30, score: 200, debris: ['plank', 'splinter'] },
  s3_oil_drum: { w: 84, h: 92, hp: 20, score: 200, debris: ['hoop', 'char'] },
  s3_gearbox: { w: 130, h: 86, hp: 30, score: 300, debris: ['stone', 'char'] },
  s3_crate: { w: 84, h: 70, hp: 20, score: 100, debris: ['plank', 'splinter'] },
  s3_steam_pipe: { w: 80, h: 116, hp: 30, score: 200, debris: ['hoop', 'stone'] },
  s3_gate: { w: 250, h: 430, hp: 240, score: 3000, debris: ['plank', 'stone', 'char'] },
};

/** 世界裡的平台：輸送帶帶著走（belt）、升降台會上下動（lift） */
type WPlatform = Platform & { belt?: number; lift?: PlatformDef['lift']; y0?: number };
/** 飛彈的落點瞄準圈：時間到飛彈就從天上掉下來 */
export interface Mark { x: number; y: number; age: number; life: number }
/** 瞭望台圖上瞭望平台的地板：離地 235、從中心往左 85 到往右 90（圖 563×842、顯示 0.5 倍，地板在第 372 列） */
const TOWER_DECK = { up: 235, x0: -85, x1: 90 };
const FOOD_SCORE: Record<string, number> = { fish: 500, onigiri: 300 };
/** 全身是刺（第二階段的橘皮大王）：爪子打不下去 */
const spiky = (e: Enemy): boolean => e.kind === 'orange_king' && e.p2 && e.state !== 'die';

interface Queued { t: number; def: SpawnDef; i: number; k: number }

export class World {
  readonly stage: StageDef;
  readonly terrain: Terrain;
  player: Player;
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  bullets: Bullet[] = [];
  bombs: Bomb[] = [];
  explosions: Explosion[] = [];
  breakables: Breakable[] = [];
  captives: Captive[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  pops: Pop[] = [];
  banners: Banner[] = [];
  holes: Hole[] = [];
  decals: Decal[] = [];
  platforms: WPlatform[] = [];
  /** 飛彈的落點瞄準圈 */
  marks: Mark[] = [];
  events: GameEvent[] = [];

  state: WorldState = 'intro';
  stateT = 0;
  camX = 0;
  time = 0;
  timeLeft: number;
  lives = LIVES;
  score = 0;
  combo = 0;
  comboT = 0;
  maxCombo = 0;
  kills = 0;
  rescued = 0;
  deaths = 0;
  continues = 0;
  hitstop = 0;
  shake = 0;
  flash = 0;
  freeze = 0;
  /** 開發用：無敵 */
  god = false;
  /** 目前在打的魔王（畫血條） */
  boss: Enemy | null = null;
  /** 鎖住鏡頭的出怪波次（出怪表的第幾筆） */
  locks = new Set<number>();
  lockX: number | null = null;
  /** 鎖畫面的這一波剩下的都在畫面外多久了（保險用） */
  private lockAway = new Map<number, number>();
  zone = -1;

  private nextId = 1;
  private fired: boolean[];
  private queue: Queued[] = [];
  private bossFired: boolean[];
  private bossDone: boolean[];
  /** 每一隻魔王打倒了沒（照 stage.bosses 的順序；圖的背景載入照這個決定先載誰、放掉誰） */
  bossesDone(): readonly boolean[] { return this.bossDone; }

  /** 怪物的逐格動作圖（怪物名 → 動作定義）；沒有的怪照舊畫單張立繪 */
  readonly monsterDefs: Record<string, AnimDefs>;

  constructor(stage: StageDef, defs: AnimDefs, monsterDefs: Record<string, AnimDefs> = {}) {
    this.stage = stage;
    this.monsterDefs = monsterDefs;
    this.terrain = new Terrain(stage.terrain);
    this.timeLeft = stage.timeLimit;
    this.fired = stage.spawns.map(() => false);
    this.bossFired = stage.bosses.map(() => false);
    this.bossDone = stage.bosses.map(() => false);
    this.player = new Player(defs, stage.start, this.groundAt(stage.start));
    this.camX = Math.max(0, stage.start - VIEW_W * 0.3);
    for (const b of stage.breakables) this.addBreakable(b.kind, b.x, b.drop);
    for (const c of stage.captives) {
      const cap: Captive = { id: this.id(), x: c.x, y: this.groundAt(c.x), art: c.art, drop: c.drop, state: 'tied', t: 0, caged: !!c.caged, vx: 0, vy: 0, onGround: true };
      this.captives.push(cap);
      if (c.caged) { const cage = this.addBreakable('cage', c.x); cage.captive = cap; }
    }
    this.rebuildPlatforms();
    this.banner(stage.mission + ' 開始！', stage.name, 'mission', INTRO_FREEZE + 1.6);
    this.freeze = INTRO_FREEZE;
    this.event('missionStart', { stage: stage.id });
  }

  // ───────────────────────── 查詢（敵人、球球、畫面都會用） ─────────────────────────

  private id(): number { return this.nextId++; }

  /** 水坑的水面高度：坑兩邊地面比較低的那邊再往下 34 */
  waterSurface(x: number): number {
    for (const [a, b] of this.terrain.pits) if (x > a && x < b) return Math.max(this.terrain.lineAt(a - 1), this.terrain.lineAt(b + 1)) + 34;
    return this.terrain.lineAt(x) + 34;
  }

  /** 這個坑是水（河童川那一段）嗎 */
  isWaterPit(a: number): boolean {
    let zi = 0;
    this.stage.zones.forEach((z, k) => { if (a >= z.from) zi = k; });
    return !!this.stage.zones[zi]?.water;
  }

  /** 地面高度：地形＋還沒打爛的寨門（當牆） */
  groundAt = (x: number): number => {
    let g = this.terrain.groundAt(x);
    for (const b of this.breakables) if (isGate(b.kind) && !b.broken && Math.abs(x - b.x) < b.w / 2) g = Math.min(g, b.y - b.h);
    return g;
  };

  physWorld(): PhysWorld {
    return { ground: GROUND, minX: this.camX + 36, maxX: Math.min(this.camX + VIEW_W - 36, this.stage.length - 36), platforms: this.platforms, groundAt: this.groundAt };
  }

  onScreen(x: number, margin = 0): boolean { return x > this.camX - margin && x < this.camX + VIEW_W + margin; }
  /** 整隻看得到：左右整隻在畫面裡、頭頂在資訊欄下面（會飛的敵人出招前要先這樣） */
  fullyVisible(e: Enemy): boolean {
    const d = ENEMY_DEFS[e.kind];
    return this.onScreen(e.x, -d.w / 2) && e.y - d.drawH * 0.9 > HUD_BOTTOM && e.y < VIEW_H;
  }
  arena(): { x0: number; x1: number } { return { x0: this.camX + 40, x1: this.camX + VIEW_W - 40 }; }

  /** 敵人要打的目標：球球躲在煙玉裡、倒下、還沒開打的時候看不到 */
  target(): { x: number; y: number } | null {
    const p = this.player;
    if (this.state !== 'play' || !p.alive || p.hidden > 0) return null;
    return { x: p.body.x, y: p.body.y };
  }

  /** 從 y0 掉到 y1 的途中有沒有踩到平台或地面 */
  floorBelow(x: number, y0: number, y1: number): { y: number; plat: Platform | null } | null {
    let best: { y: number; plat: Platform | null } | null = null;
    for (const pl of this.platforms) {
      if (x >= pl.x && x <= pl.x + pl.w && y0 <= pl.y + 0.01 && y1 >= pl.y && (!best || pl.y < best.y)) best = { y: pl.y, plat: pl };
    }
    // 地面：要是從上面掉下來才算落地（在牆裡面、比地面低的不會被瞬移到牆頂上）
    const g = this.groundAt(x);
    if (y1 >= g && y0 <= g + 36 && (!best || g < best.y)) best = { y: g, plat: null };
    return best;
  }

  /** 前面貼著可以揮爪的東西（敵人、木箱、竹籠） */
  meleeTarget(x: number, y: number, facing: number): boolean {
    const zone = { x0: Math.min(x + facing * 10, x + facing * 150), x1: Math.max(x + facing * 10, x + facing * 150), y0: y - 170, y1: y };
    // 全身是刺的橘皮大王（第二階段）不算：靠近按攻擊一律改丟忍具，不會自己出爪去撞刺（09-26 獨立審查 高 3）
    for (const e of this.enemies) if (!e.dying && !e.dead && e.state !== 'enter' && e.invuln < 5 && !spiky(e) && overlap(zone, enemyBox(e))) return true;
    for (const b of this.breakables) if (!b.broken && b.kind !== 'tower' && !isGate(b.kind) && overlap(zone, this.breakBox(b))) return true;
    return false;
  }

  breakBox(b: Breakable): Box { return boxAt(b.x, b.y, b.w, b.h); }

  // ───────────────────────── 產生東西 ─────────────────────────

  event(type: string, data: Record<string, unknown> = {}): void { this.events.push({ type, t: +this.time.toFixed(2), ...data }); }

  spawn(kind: EnemyKind, x: number, y: number): Enemy {
    const e = newEnemy(this.id(), kind, x, y, this.monsterDefs[ENEMY_DEFS[kind].img]);
    e.facing = this.player.body.x > x ? 1 : -1;
    this.enemies.push(e);
    return e;
  }

  addBullet(kind: BulletKind, x: number, y: number, vx: number, vy: number,
    o: { g?: number; w?: number; h?: number; life?: number; owner?: Enemy; homing?: number; hp?: number; push?: number } = {}): Bullet {
    const size: Record<BulletKind, [number, number]> = {
      kunai: [44, 14], bone: [40, 40], wave: [64, 58], blast: [200, 220], spark: [30, 30], pellet: [26, 26], garbage: [44, 40], missile: [26, 60],
      fireball: [40, 34], water: [52, 30], fan: [50, 40], foxfire: [34, 34], leaf: [36, 20], splash: [22, 22], bubble: [56, 56], gust: [500, 200],
    };
    const [w, h] = size[kind];
    const spin: Partial<Record<BulletKind, number>> = { bone: 12, fan: 16, leaf: 18, garbage: 9 };
    const bl: Bullet = {
      id: this.id(), kind, x, y, vx, vy, g: o.g ?? 0, w: o.w ?? w, h: o.h ?? h,
      rot: kind === 'kunai' || kind === 'water' || kind === 'fireball' ? Math.atan2(vy, vx) : 0, spin: (spin[kind] ?? 0) * Math.sign(vx || 1),
      age: 0, life: o.life ?? (kind === 'wave' ? 3.2 : 4), ground: kind === 'wave',
      ...(o.owner ? { owner: o.owner } : {}), ...(o.homing ? { homing: o.homing } : {}), ...(o.hp ? { hp: o.hp } : {}), ...(o.push ? { push: o.push } : {}),
    };
    if (bl.ground) bl.y = this.groundAt(x);
    this.bullets.push(bl);
    return bl;
  }

  addBreakable(kind: BreakKind, x: number, drop?: DropKind): Breakable {
    const d = BREAK_DEFS[kind];
    const b: Breakable = {
      id: this.id(), kind, x, y: this.terrain.groundAt(x), w: d.w, h: d.h, hp: d.hp, maxHp: d.hp, flash: 0, shake: 0,
      broken: false, fall: 0, captive: null, top: null, hitCd: new Map(), ...(drop ? { drop } : {}),
    };
    if (kind === 'tower') b.top = { x: x + TOWER_DECK.x0, y: b.y - TOWER_DECK.up, w: TOWER_DECK.x1 - TOWER_DECK.x0 };
    this.breakables.push(b);
    return b;
  }

  rebuildPlatforms(): void {
    this.stagePlats ??= this.stage.platforms.map((p): WPlatform => ({ x: p.x, y: p.y, w: p.w, ...(p.belt ? { belt: p.belt } : {}), ...(p.lift ? { lift: p.lift, y0: p.y } : {}) }));
    this.platforms = [...this.stagePlats, ...this.breakables.filter((b) => b.top && !b.broken).map((b) => b.top!)];
  }
  /** 關卡檔的平台（升降台的位置每一格會變，所以同一個物件一直用） */
  private stagePlats?: WPlatform[];

  /** 飛彈的落點瞄準圈（鐵爪機關貓）：life 秒後飛彈從天上掉到 x */
  addMark(x: number, life: number): void {
    const g = this.groundAt(x);
    this.marks.push({ x, y: Number.isFinite(g) ? g : GROUND, age: 0, life });
  }

  /** 蒸氣噴口現在的狀態：warn＝冒小煙（預兆，0.6 秒）、on＝正在噴（0.9 秒，k＝噴了幾成） */
  ventState(v: { x: number; period: number; offset: number }): { warn: boolean; on: boolean; k: number } {
    const ph = ((this.time + v.offset) % v.period + v.period) % v.period;
    if (ph < VENT_ON) return { warn: false, on: true, k: ph / VENT_ON };
    return { warn: ph > v.period - VENT_WARN, on: false, k: 0 };
  }
  /** 蒸氣噴口燙人的範圍 */
  ventBox(v: { x: number }): Box {
    const g = this.terrain.groundAt(v.x);
    return { x0: v.x - 36, x1: v.x + 36, y0: g - 230, y1: g };
  }

  drop(kind: DropKind, x: number, y: number, vx = 0, vy = -420): Pickup {
    const p: Pickup = { id: this.id(), kind, x, y, vx, vy, age: 0, onGround: false, taken: false };
    this.pickups.push(p);
    return p;
  }

  fx(p: Partial<Particle> & { kind: Particle['kind']; x: number; y: number }): void {
    if (this.particles.length > 700) return;
    this.particles.push({ vx: 0, vy: 0, g: 0, age: 0, life: 0.5, r: 6, rot: Math.random() * 6, spin: 0, color: '#fff', ...p });
  }

  dust(x: number, y: number, n: number, dir = 0): void {
    for (let i = 0; i < n; i++) this.fx({ kind: 'puff', x: x + rnd(-15, 15), y: y - 4, vx: rnd(-80, 80) + dir * 40, vy: -rnd(0, 60), g: -30, life: rnd(0.35, 0.5), r: rnd(6, 12), color: '#c9a77a' });
  }

  sparks(x: number, y: number, n: number, dir: number, color = '#fff3c4'): void {
    for (let i = 0; i < n; i++) this.fx({ kind: 'spark', x, y, vx: rnd(-130, 130) - dir * 90, vy: rnd(-170, 70), life: 0.22, r: 3, color });
  }

  say(e: Enemy, text: string, life: number): void { e.bubble = { text, t: 0, life }; }
  shakeIt(t: number): void { this.shake = Math.max(this.shake, t); }
  flashScreen(t: number): void { this.flash = Math.max(this.flash, t); }
  banner(text: string, sub: string, style: Banner['style'], life = 1.6): void {
    this.banners = this.banners.filter((b) => b.style !== style);
    this.banners.push({ text, sub, age: 0, life, style });
  }
  pop(x: number, y: number, text: string, color = '#ffe07a', size = 26): void {
    if (this.pops.length > 50) this.pops.shift();
    this.pops.push({ x, y, text, age: 0, color, size });
  }
  addScore(n: number, x?: number, y?: number): void {
    this.score += n;
    if (x !== undefined && y !== undefined && n > 0) this.pop(x, y, `+${n}`, '#9ff0ff', 22);
  }

  /** 鼠兵發現球球時，頭上搬的箱子掉下來摔爛 */
  crateDrop(x: number, y: number): void {
    for (let i = 0; i < 6; i++) this.fx({ kind: 'debris', x, y, vx: rnd(-220, 220), vy: rnd(-380, -120), g: 1500, life: 0.9, r: rnd(8, 14), spin: rnd(-12, 12), color: '#a8743f', sprite: i % 2 ? 'debris_plank' : 'debris_splinter' });
  }

  bossSmoke(e: Enemy): void {
    const d = ENEMY_DEFS[e.kind];
    const x = e.x + rnd(-d.w / 2, d.w / 2), y = e.y - rnd(d.h * 0.3, d.h);
    this.fx({ kind: 'smoke', x, y, vx: rnd(-20, 20), vy: -rnd(60, 120), g: -20, life: rnd(0.8, 1.3), r: rnd(18, 34), color: '#3a3040' });
    if (Math.random() < 0.5) this.fx({ kind: 'fire', x, y, vx: rnd(-30, 30), vy: -rnd(80, 160), life: rnd(0.3, 0.5), r: rnd(10, 18), color: '#ff8a2a' });
  }

  explode(x: number, y: number, r: number, dmg: number, from: Explosion['from'], big: boolean): void {
    this.explosions.push({ x, y, r, age: 0, life: big ? 0.62 : 0.46, dmg, dealt: dmg <= 0 && from !== 'enemy', from });
    this.shakeIt(big ? 0.38 : 0.2);
    const n = big ? 16 : 9;
    for (let i = 0; i < n; i++) this.fx({ kind: 'debris', x, y, vx: rnd(-420, 420), vy: rnd(-620, -160), g: 1600, life: rnd(0.7, 1.1), r: rnd(4, 9), spin: rnd(-14, 14), color: pick(['#5a3b22', '#8a5a33', '#3b2a1c', '#ffb347']), sprite: pick(['debris_stone', 'debris_char', 'debris_stone']) });
    for (let i = 0; i < (big ? 7 : 4); i++) this.fx({ kind: 'smoke', x: x + rnd(-r * 0.4, r * 0.4), y: y + rnd(-r * 0.3, r * 0.2), vx: rnd(-40, 40), vy: -rnd(40, 110), g: -20, life: rnd(0.9, 1.5), r: rnd(r * 0.25, r * 0.45), color: '#4a4048' });
    for (let i = 0; i < (big ? 14 : 8); i++) this.fx({ kind: 'ember', x, y, vx: rnd(-360, 360), vy: rnd(-460, -60), g: 900, life: rnd(0.4, 0.8), r: rnd(2, 4), color: '#ffcf5a' });
    this.event('explode', { big, from });
  }

  // ───────────────────────── 每一格 ─────────────────────────

  update(dt: number, f: Frame): void {
    if (!(dt > 0)) return;   // 負的時間會讓閃白、震動、定格倒著加（09-26：直接開第二關白霧 10 秒）
    this.dev(f);
    this.stepFx(dt);
    this.stateT += dt;
    if (this.state === 'continue' || this.state === 'done') return;
    if (this.freeze > 0) { this.freeze -= dt; return; }
    if (this.state === 'intro') this.setState('play');
    // 打中停頓：整個世界停一拍；無敵時間照真的時間算（說 1.2 秒就是 1.2 秒）
    if (this.hitstop > 0) { this.hitstop -= dt; this.player.invincible = Math.max(0, this.player.invincible - dt); return; }

    this.time += dt;
    if (this.state === 'play') this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.state === 'play' && this.timeLeft <= 0 && !this.god && this.player.alive) {
      this.timeLeft = 60;
      this.banner('時間到！', '少一條命，再給 60 秒', 'warn', 1.8);
      this.event('timeUp', {});
      this.playerDown();
    }
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;

    this.triggerSpawns(dt);
    this.triggerHints();
    this.stepPlatforms(dt);
    const p = this.player;
    const frozen = { ...f, left: false, right: false, up: false, down: false, attackPressed: false, attackHeld: false, subPressed: false, jumpPressed: false, dashPressed: false };
    if (p.held > 0) p.held = Math.max(0, p.held - dt);
    if (p.dropping && p.body.onGround) p.dropping = false;
    const input = (this.state === 'play' || this.state === 'dying') && p.held <= 0 && !p.dropping ? f : frozen;
    p.update(dt, input, this);
    this.stepBelts(dt);
    this.stepMarks(dt);

    for (const e of this.enemies) this.stepEnemy(e, dt);
    this.stepShots(dt);
    this.stepBombs(dt);
    this.stepBullets(dt);
    this.stepExplosions(dt);
    this.stepBreakables(dt);
    this.stepCaptives(dt);
    this.stepPickups(dt);
    this.enemyContacts(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.holes = this.holes.filter((h) => (h.age += dt) < h.life);
    this.updateCamera(dt);
    this.checkPlayer();
    this.checkZone();

    if (this.state === 'dying' && this.stateT > DOWN_TIME) {
      if (this.lives > 0) this.respawn(true); else { this.setState('continue'); this.event('continuePrompt', {}); }
    }
    if (this.state === 'clear' && this.stateT > CLEAR_TIME) { this.setState('done'); this.event('result', {}); }
  }

  private setState(s: WorldState): void { this.state = s; this.stateT = 0; }

  private dev(f: Frame): void {
    const a = this.player.arsenal;
    if (f.devWeapon >= 0) { const id = DEV_WEAPON_KEYS[f.devWeapon]!; a.pick(id); this.banner(WEAPONS[id].name, '（開發用）', 'weapon', 1.0); this.event('pickup', { kind: id, dev: true }); }
    if (f.devSub >= 0) { const s = SUB_ORDER[f.devSub]!; a.pickSub(s); this.banner(SUBS[s].name, '（開發用）', 'weapon', 1.0); }
    if (f.devGod) { this.god = !this.god; this.banner(this.god ? '無敵模式 開' : '無敵模式 關', '（開發用 F2）', 'warn', 1.0); }
  }

  private stepFx(dt: number): void {
    for (const q of this.particles) { q.age += dt; q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.spin * dt; }
    this.particles = this.particles.filter((q) => q.age < q.life);
    for (const q of this.pops) q.age += dt;
    this.pops = this.pops.filter((q) => q.age < 0.9);
    for (const b of this.banners) b.age += dt;
    this.banners = this.banners.filter((b) => b.age < b.life);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
  }

  // ───────────── 出怪表 ─────────────

  private triggerSpawns(dt: number): void {
    const S = this.stage;
    S.spawns.forEach((s, i) => {
      if (this.fired[i] || this.camX < s.at) return;
      this.fired[i] = true;
      const n = s.count ?? 1;
      for (let k = 0; k < n; k++) this.queue.push({ t: (s.gap ?? (s.from === 'place' ? 0 : 0.4)) * k, def: s, i, k });
      if (s.lock) { this.locks.add(i); this.lockX = Math.max(this.camX, s.at); }
      if (s.from === 'hole') this.holes.push({ x: s.x ?? this.camX + VIEW_W * 0.7, y: this.terrain.groundAt(s.x ?? this.camX + VIEW_W * 0.7), age: 0, life: (s.gap ?? 0.4) * n + 2 });
      this.event('spawnWave', { i, kind: s.kind, from: s.from, count: n });
    });
    for (const q of this.queue) q.t -= dt;
    const ready = this.queue.filter((q) => q.t <= 0);
    this.queue = this.queue.filter((q) => q.t > 0);
    for (const q of ready) this.spawnFrom(q.def, q.i, q.k);
    // 魔王
    S.bosses.forEach((bd, i) => {
      if (this.bossFired[i] || this.camX < bd.at - 30) return;
      this.bossFired[i] = true;
      this.lockX = bd.at;
      // 出場點：畫面右邊外 160；那裡是坑就往左找有地面的地方（09-26 蛙大名出場在水坑上、一出來就掉下去，鏡頭永遠鎖著）
      // 不能超過關卡盡頭（09-26 獨立審查 中 1：最後的魔王出生在關卡長度外，走不動、卡在畫面外 4 秒才瞬移進來）
      let sx = Math.min(bd.at + VIEW_W + 160, S.length - 40);
      while (sx > bd.at + VIEW_W - 260 && (!Number.isFinite(this.terrain.groundAt(sx)) || !Number.isFinite(this.terrain.groundAt(sx - 60)))) sx -= 20;
      const e = this.spawn(bd.kind, sx, this.terrain.groundAt(sx));
      e.group = 1000 + i; e.facing = -1;
      this.boss = e;
      const d = ENEMY_DEFS[bd.kind];
      const HINT: Partial<Record<EnemyKind, string>> = {
        drum_tanuki: '跳過地面震波！鼓棒舉起來就退開', orange_king: '跳起來打背後的魚乾背包！',
        frog_daimyo: '舌頭伸出來就蹲下！地上紅圈是牠要砸的地方', tanuki_lord: '石像打不動，等牠裂開！',
        roomba_king: '吸塵的時候往反方向跑！地上紅區是衝撞範圍', iron_claw: '巨爪橫掃要跳！飛彈看地上的紅圈',
      };
      this.banner((bd.final ? '魔王 ' : '中魔王 ') + d.name, HINT[bd.kind] ?? '', 'boss', 2.2);
      this.event('bossEnter', { kind: bd.kind });
    });
  }

  private hintsDone = new Set<number>();
  /** 教學提示：鏡頭走到那裡、開場字幕播完才跳（一句一次） */
  private triggerHints(): void {
    if (this.time < 2.4) return;
    (this.stage.hints ?? []).forEach((h, i) => {
      if (this.hintsDone.has(i) || this.camX < h.at) return;
      this.hintsDone.add(i);
      this.banner(h.text, h.sub ?? '', 'hint', 3.5);
      this.event('hint', { i });
    });
  }

  private spawnFrom(s: SpawnDef, i: number, k: number): void {
    let x: number, y: number;
    const d = ENEMY_DEFS[s.kind];
    let plat: Platform | null = null;
    switch (s.from) {
      case 'right': {
        x = this.camX + VIEW_W + 70 + k * 10;
        // 還沒打爛的門（寨門、機關城城門）後面或門裡：改從門前出來（09-26 獨立審查 中 4：山賊出生在寨門頂上、浮在半空）
        const gate = this.breakables.find((b) => isGate(b.kind) && !b.broken && x > b.x - b.w / 2 - 40 && b.x > this.camX);
        if (gate) x = gate.x - gate.w / 2 - 60 - k * 30;
        y = this.groundAt(x);
        break;
      }
      case 'left': x = this.camX - 70 - k * 10; y = this.groundAt(x); break;
      case 'top': x = this.camX + VIEW_W * rnd(0.5, 0.95); y = -90; break;
      case 'hole': x = s.x ?? this.camX + VIEW_W * 0.7; y = this.terrain.groundAt(x) + 20; break;
      case 'water': x = s.x ?? this.camX + VIEW_W * 0.7; y = this.waterSurface(x) + 200; break;
      default: {
        x = (s.x ?? this.camX + VIEW_W + 100) + k * (s.spread ?? 90);
        y = this.groundAt(x);
        if (s.plat) {
          plat = this.platforms.filter((p) => x >= p.x && x <= p.x + p.w).sort((a, b) => a.y - b.y)[0] ?? null;
          if (plat) y = plat.y;
        }
      }
    }
    if (d.fly && (s.from === 'right' || s.from === 'left' || s.from === 'place') && s.y === undefined) y -= rnd(140, 240);
    if (s.y !== undefined) y = s.y;
    if (!Number.isFinite(y) && s.from !== 'water') {
      // 剛好在坑上：往前後找地面
      for (let dx = 20; dx < 600 && !Number.isFinite(y); dx += 20) { const g = this.groundAt(x - dx); if (Number.isFinite(g)) { x -= dx; y = g; } }
    }
    const e = this.spawn(s.kind, x, y);
    e.group = i;
    e.plat = plat;
    e.act = s.act ?? 'none';
    e.aware = e.act === 'none';
    if (d.fly) e.onGround = false;
    if (s.from === 'water') { e.mem.water = 1; e.mem.surf = this.waterSurface(x); e.aware = true; e.onGround = true; }
    if (s.from === 'hole') {
      e.vy = -rnd(640, 760); e.vx = rnd(-60, 60); e.onGround = false;
      this.dust(x, this.terrain.groundAt(x), 6);
    }
    if (s.from === 'right' || s.from === 'left') e.facing = s.from === 'right' ? -1 : 1;
    if (s.y !== undefined) { e.mem.mount = 1; e.onGround = false; }
  }

  // ───────────── 升降台、輸送帶、飛彈瞄準圈 ─────────────

  /** 升降台：照時間算出這一格的高度，站在上面的（球球、敵人）跟著一起上下 */
  private stepPlatforms(_dt: number): void {
    for (const pl of this.platforms) {
      const L = pl.lift;
      if (!L) continue;
      const cyc = 2 * (L.travel + L.stop);
      const t = ((this.time / cyc + (L.phase ?? 0)) % 1) * cyc;
      const y0 = pl.y0!, y1 = L.y1;
      const ease = (k: number): number => k * k * (3 - 2 * k);
      const ny = t < L.stop ? y0 : t < L.stop + L.travel ? y0 + (y1 - y0) * ease((t - L.stop) / L.travel)
        : t < 2 * L.stop + L.travel ? y1 : y1 + (y0 - y1) * ease((t - 2 * L.stop - L.travel) / L.travel);
      const dy = ny - pl.y;
      if (Math.abs(dy) < 1e-6) continue;
      const b = this.player.body;
      if (b.onGround && Math.abs(b.y - pl.y) < 1 && b.x >= pl.x && b.x <= pl.x + pl.w) b.y += dy;
      for (const e of this.enemies) if (e.plat === pl) e.y += dy;
      for (const k of this.pickups) if (k.onGround && Math.abs(k.y - pl.y) < 1 && k.x >= pl.x && k.x <= pl.x + pl.w) k.y += dy;
      pl.y = ny;
    }
  }

  /** 輸送帶：站在上面的被帶著走 */
  private stepBelts(dt: number): void {
    const b = this.player.body;
    for (const pl of this.platforms) {
      if (!pl.belt) continue;
      if (b.onGround && Math.abs(b.y - pl.y) < 1 && b.x >= pl.x && b.x <= pl.x + pl.w) {
        const pw = this.physWorld();
        b.x = Math.max(pw.minX, Math.min(pw.maxX, b.x + pl.belt * dt));
      }
      for (const e of this.enemies) if (e.plat === pl && e.dying <= 0) e.x = Math.max(pl.x + 6, Math.min(pl.x + pl.w - 6, e.x + pl.belt * dt));
    }
  }

  private stepMarks(dt: number): void {
    for (const k of this.marks) {
      k.age += dt;
      if (k.age >= k.life) this.addBullet('missile', k.x, -60, 0, 1500, { life: 2 });
    }
    this.marks = this.marks.filter((k) => k.age < k.life);
  }

  // ───────────── 敵人 ─────────────

  private stepEnemy(e: Enemy, dt: number): void {
    e.life += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.warn = Math.max(0, e.warn - dt);
    e.invuln = Math.max(0, e.invuln - dt);
    if (e.part) e.part.flash = Math.max(0, e.part.flash - dt);
    for (const [k, v] of e.hitCd) { if (v - dt <= 0) e.hitCd.delete(k); else e.hitCd.set(k, v - dt); }
    if (e.bubble && (e.bubble.t += dt) > e.bubble.life) e.bubble = null;
    if (e.dying > 0) {
      e.dying += dt;
      if (e.mem.ko) {
        // 被打倒（有倒下動作）：往後滑一小段、倒在地上，演完一閃一閃消失
        e.vx *= Math.pow(0.03, dt);
        const nx = e.x + e.vx * dt, g = this.groundAt(nx);
        if (Number.isFinite(g) && Math.abs(g - e.y) < 60) { e.x = nx; e.y = g; }
        if (e.dying > (e.mem.koTime ?? 1.5) + 0.6) e.dead = true;
      } else {
        e.vy += 1800 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.spin * dt;
        if (e.dying > 2.4 || e.y > VIEW_H + 300) e.dead = true;
      }
      animateEnemy(e, this.monsterDefs[ENEMY_DEFS[e.kind].img], dt);
      return;
    }
    // 延燒、中毒：每 0.25 秒扣一點
    if (e.burn > 0 || e.poison > 0) {
      e.burn = Math.max(0, e.burn - dt); e.poison = Math.max(0, e.poison - dt);
      e.dotT -= dt;
      if (e.dotT <= 0) {
        e.dotT = 0.25;
        const dmg = (e.burn > 0 ? 4 : 0) + (e.poison > 0 ? 3 : 0);
        if (dmg > 0) this.damageEnemy(e, dmg, { x: e.x, y: e.y - ENEMY_DEFS[e.kind].h * 0.6, dir: 0, kind: 'dot' });
        if (e.burn > 0) this.fx({ kind: 'fire', x: e.x + rnd(-20, 20), y: e.y - rnd(20, ENEMY_DEFS[e.kind].h), vy: -120, life: 0.35, r: 12, color: '#ff8a2a' });
        if (e.poison > 0) this.fx({ kind: 'drop', x: e.x + rnd(-15, 15), y: e.y - ENEMY_DEFS[e.kind].h, vy: -60, g: -20, life: 0.5, r: 7, color: '#b06cff' });
      }
    }
    if (e.dead || e.dying > 0) return;
    // 動作圖比這隻怪晚載好（魔王的圖在背景照進度載，玩家跑太快時）：載好了就接上
    if (!e.anim) { const d = this.monsterDefs[ENEMY_DEFS[e.kind].img]; if (d) e.anim = new Animator(d); }
    updateEnemy(e, this, dt);
    animateEnemy(e, this.monsterDefs[ENEMY_DEFS[e.kind].img], dt);
    // 掉進坑、被留在畫面後面太遠就不見了
    if (e.y > VIEW_H + 200 && e.boss) { const x = this.camX + VIEW_W * 0.7; e.x = x; e.y = -200; e.vy = 0; e.onGround = false; e.plat = null; this.event('bossFellBack', { kind: e.kind }); }
    if (e.y > VIEW_H + 200 && !ENEMY_DEFS[e.kind].fly) { e.dead = true; this.kills++; this.addScore(ENEMY_DEFS[e.kind].score); this.event('fell', { kind: e.kind }); }
    if (!e.boss && e.x < this.camX - 480) e.dead = true;
  }

  damageEnemy(e: Enemy, dmg: number, src: { x: number; y: number; dir: number; kind: string }): boolean {
    if (e.dying > 0 || e.dead) return false;
    if (e.invuln > 0) { if (src.kind !== 'dot') this.sparks(src.x, src.y, 3, src.dir, '#cfd8ff'); return false; }
    // 打到真的狸大人：分身一起散掉
    if (e.kind === 'tanuki_lord' && src.kind !== 'dot' && this.enemies.some((o) => o.kind === 'tanuki_clone' && !o.dead)) popAllClones(this);
    if (!e.aware) notice(e, this);
    // 打中的聲音（音效那邊有對照表與節流）；持續傷害（延燒這類，kind＝dot）不發，不然一直響
    if (src.kind !== 'dot') this.event('hit', { kind: e.kind });
    // 打中火花（畫面用，第三批美術）：揮爪＝爪痕、爆炸／風魔大手裏劍＝鈍擊、其他忍具＝手裏劍火花
    if (src.kind !== 'dot') {
      const blunt = src.kind === 'blast' || src.kind === 'fuma';
      this.fx({ kind: 'hit', x: src.x, y: src.y, life: 0.16, r: src.kind === 'claw' ? 58 : blunt ? 48 : 36, rot: src.kind === 'claw' ? 0 : rnd(-0.6, 0.6), sprite: src.kind === 'claw' ? 'hit_claw' : blunt ? 'hit_blunt' : 'hit_shuriken', flip: src.dir < 0 });
    }
    const d = ENEMY_DEFS[e.kind];
    // 橘皮大王第一階段：打的是背包（打在身上只算一半）
    if (e.part && !e.part.broken) {
      const pb = kingPackBox(e);
      const onPack = src.kind === 'blast' || (src.x > pb.x0 - 20 && src.x < pb.x1 + 20 && src.y > pb.y0 - 20 && src.y < pb.y1 + 20);
      const dd = onPack ? dmg : dmg * KING_BODY_CHIP;
      e.part.hp -= dd; e.part.flash = 0.1; e.flash = 0.1;
      if (e.part.hp <= 0) kingPackBroken(e, this);
      return true;
    }
    e.hp -= dmg;
    e.flash = e.boss ? 0.12 : 0.09;
    if (e.hp <= 0) { this.killEnemy(e, src.dir || (this.player.body.x < e.x ? 1 : -1), src.kind); return true; }
    if (e.kind === 'dummy') return true;
    if (!e.boss && src.kind !== 'dot') e.mem.hurtT = 0.3;   // 受傷動作（走路、待機時插 0.3 秒）
    // 被打的反應：山賊後退踉蹌（揮棒途中不會被打斷）、小隻的被推一下
    if (!d.heavy && !d.fly && src.kind !== 'dot') {
      if (e.kind === 'orange_bandit' && e.state !== 'swing') { e.stun = 0.25; e.vx = (src.dir || 1) * 230; }
      else if (e.onGround) e.x += (src.dir || 0) * 5;
    }
    // 快死了嚇到逃跑（山賊、忍者，一次）
    if (!e.boss && !e.fled && e.hp <= e.maxHp * 0.35 && (e.kind === 'orange_bandit' || e.kind === 'black_ninja') && Math.random() < 0.6) {
      e.fled = true; e.state = 'flee'; e.t = 0; this.say(e, '哇啊啊！', 1.0);
    }
    return true;
  }

  private killEnemy(e: Enemy, dir: number, how: string): void {
    const d = ENEMY_DEFS[e.kind];
    if (e.kind === 'dummy') { e.hp = e.maxHp; return; }
    if (e.kind === 'tanuki_clone') { popClone(e, this); return; }
    if (e.boss && !e.p2 && !e.part && P2_HP[e.kind] && e.state !== 'change') {
      // 靠血量換階段的魔王（蛙大名、狸大人）：第一階段打完先演換階段（無敵），再換第二階段的血
      e.hp = 1; e.state = 'change'; e.t = 0; e.invuln = 99; e.harm = null; e.warn = 0; e.bodyHarm = false; e.squash = 0; e.mem.giant = 1;
      this.hitstop = 0.12; this.shakeIt(0.4); this.flashScreen(0.2);
      this.bullets = this.bullets.filter((b) => b.kind === 'wave' || b.kind === 'blast');
      popAllClones(this);
      this.banner('第二階段！', `${d.name}發怒了`, 'warn', 1.6);
      this.event('bossPhaseStart', { kind: e.kind });
      return;
    }
    if (e.boss) {
      e.state = 'die'; e.t = 0; e.invuln = 99; e.bodyHarm = false; e.harm = null; e.warn = 0;
      this.hitstop = 0.15; this.shakeIt(0.6); this.flashScreen(0.25);
      this.event('bossDown', { kind: e.kind });
      return;
    }
    const k = how === 'blast' ? 1.35 : 1;
    if (e.kind === 'broom_centipede') splitCentipede(e, this);
    const downDef = this.monsterDefs[d.img]?.down;
    e.harm = null; e.bodyHarm = false; e.bubble = null; e.pose = 'down'; e.dying = 1e-4;
    if (downDef && how !== 'blast' && e.onGround) {
      // 有倒下動作：在地上播完倒下（往後滑一點）；被炸到的照舊轉圈飛出去
      e.mem.ko = 1; e.mem.koTime = downDef.frames.length / downDef.fps / 1.7;
      e.vx = dir * 160; e.vy = 0; e.spin = 0; e.rot = 0;
    } else {
      e.onGround = false; e.plat = null;
      e.vx = dir * rnd(260, 460) * k; e.vy = -rnd(560, 760) * k; e.spin = dir * rnd(9, 15);
    }
    this.kills++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 2.0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const bonus = this.combo >= 2 ? 50 * (this.combo - 1) : 0;
    this.addScore(d.score + bonus, e.x, e.y - d.h - 30);
    if (this.combo >= 2) {
      // 連殺字只留最新的一個（一顆爆裂符炸死一排時才不會疊成一團）
      this.pops = this.pops.filter((q) => !q.text.endsWith('連殺！'));
      this.pop(e.x, e.y - d.h - 62, `${this.combo} 連殺！`, '#ff9ad5', 26 + Math.min(14, this.combo * 2));
    }
    this.hitstop = Math.max(this.hitstop, 0.035);
    for (let i = 0; i < 5; i++) this.fx({ kind: 'star', x: e.x, y: e.y - d.h * 0.6, vx: rnd(-200, 200), vy: rnd(-300, -80), g: 600, life: 0.6, r: 7, color: '#fff3a0' });
    this.event('kill', { kind: e.kind, how });
  }

  // ───────────── 球球丟出去的東西 ─────────────

  fireWeapon(id: WeaponId, x: number, y: number, aim: Aim, facing: 1 | -1, pvx: number): void {
    const d = WEAPONS[id];
    const dx = aim === 'up' ? 0 : aim === 'down' ? 0 : facing, dy = aim === 'up' ? -1 : aim === 'down' ? 1 : 0;
    const carry = aim === 'fwd' || aim === 'low' ? pvx * 0.3 : 0;
    const shot = (kind: ShotKind, speed: number, o: Partial<Shot> = {}): Shot => {
      const s: Shot = {
        id: this.id(), kind, x, y, vx: dx * speed + carry, vy: dy * speed, rot: Math.atan2(dy, dx), spin: 0, age: 0, life: 1,
        dmg: d.dmg, r: 20, pierce: false, rehit: 0, phase: 0, target: null, bounces: 0, aim, facing, ...o,
      };
      this.shots.push(s);
      return s;
    };
    switch (id) {
      case 'shuriken': shot('shuriken', 1150, { life: 0.8, r: 22, spin: 26 * facing }); break;
      case 'H': shot('bo', 1450, { life: 0.7, r: 18, y: y + rnd(-7, 7), x: x + rnd(-6, 6) }); break;
      case 'R': shot('fuma', 920, { life: 3.2, r: 56, pierce: true, rehit: 0.22, spin: 16 * facing }); break;
      case 'F': shot('flame', 0, { life: 0.38, r: 44, pierce: true, rehit: 0.08, vx: 0, vy: 0 }); break;
      case 'S': {
        const base = Math.atan2(dy, dx) + (aim === 'fwd' || aim === 'low' ? -0.14 * facing : 0);
        for (const a of [-0.36, -0.18, 0, 0.18, 0.36]) {
          const sp = rnd(820, 940), ang = base + a * facing;
          shot('caltrop', 0, { vx: Math.cos(ang) * sp + carry, vy: Math.sin(ang) * sp, life: 5, r: 16, spin: rnd(12, 20) });
        }
        break;
      }
      case 'L': shot('chain', 0, { life: 0.34, r: 26, pierce: true, rehit: 1, vx: 0, vy: 0 }); break;
      case 'C': shot('crane', 620, { life: 2.4, r: 26 }); break;
      case 'I': shot('mouse', 0, { vx: facing * 540, vy: aim === 'up' ? -500 : -120, life: 2.0, r: 30 }); break;
      case 'D': shot('yarn', 640, { vy: dy * 640 - (aim === 'fwd' ? 240 : 0), life: 2.8, r: 20 }); break;
      case 'B': shot('dart', 1950, { life: 0.6, r: 14, pierce: true, rehit: 99 }); break;
    }
    this.event('fire', { weapon: id, aim });
  }

  throwSub(kind: SubId, x: number, y: number, facing: 1 | -1, pvx: number, up: boolean): void {
    const b: Bomb = { id: this.id(), kind, x, y, vx: facing * (kind === 'smoke' ? 120 : up ? 220 : 430) + pvx * 0.35, vy: kind === 'smoke' ? -220 : up ? -820 : -560, rot: 0, age: 0 };
    this.bombs.push(b);
    this.event('sub', { kind });
  }

  private stepShots(dt: number): void {
    const p = this.player, pb = p.body;
    for (const s of this.shots) {
      s.age += dt;
      s.rot += s.spin * dt;
      switch (s.kind) {
        case 'flame': case 'chain': {
          // 黏在球球手上
          const h = handOf(p);
          s.x = h.x; s.y = h.y; s.facing = pb.facing;
          if (s.kind === 'chain') {
            const L = 560, a = s.age;
            s.phase = a < 0.12 ? L * a / 0.12 : a < 0.18 ? L : L * Math.max(0, 1 - (a - 0.18) / 0.16);
          } else s.phase = Math.min(1, s.age / 0.1) * 400;
          break;
        }
        case 'fuma': {
          const sp = Math.hypot(s.vx, s.vy);
          if (s.phase === 0) {
            const k = Math.max(0, sp - 1250 * dt) / (sp || 1);
            s.vx *= k; s.vy *= k;
            if (sp < 60) s.phase = 1;
          } else {
            const tx = pb.x, ty = pb.y - 100, ddx = tx - s.x, ddy = ty - s.y, L = Math.hypot(ddx, ddy) || 1;
            const v = Math.min(1000, 300 + s.age * 400);
            s.vx = ddx / L * v; s.vy = ddy / L * v;
            if (L < 50) s.age = s.life;
          }
          s.x += s.vx * dt; s.y += s.vy * dt;
          break;
        }
        case 'crane': {
          if (!s.target || s.target.dying > 0 || s.target.dead) s.target = this.nearestEnemy(s.x, s.y, s.facing);
          let ang = Math.atan2(s.vy, s.vx);
          if (s.target) {
            const b = enemyBox(s.target), want = Math.atan2((b.y0 + b.y1) / 2 - s.y, s.target.x - s.x);
            let da = want - ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            ang += Math.max(-5.5 * dt, Math.min(5.5 * dt, da));
          }
          s.vx = Math.cos(ang) * 620; s.vy = Math.sin(ang) * 620; s.rot = ang;
          s.x += s.vx * dt; s.y += s.vy * dt;
          break;
        }
        case 'caltrop': {
          if (s.phase === 0) {
            s.vy += 1400 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
            const f = this.floorBelow(s.x, s.y - s.vy * dt, s.y);
            if (f) { s.y = f.y - 6; s.vx = 0; s.vy = 0; s.phase = 1; s.spin = 0; s.life = s.age + 4; s.dmg = 5; s.pierce = true; s.rehit = 0.5; }
          }
          break;
        }
        case 'mouse': {
          const g = this.groundAt(s.x);
          if (s.phase === 0) {
            s.vy += 1800 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
            if (s.y >= g) { s.y = g; s.vy = 0; s.phase = 1; }
          } else {
            const nx = s.x + s.vx * dt, ng = this.groundAt(nx);
            if (!Number.isFinite(ng) || ng > s.y + 60) { s.phase = 0; s.x = nx; }
            else if (ng < s.y - 36) { s.age = s.life; }
            else { s.x = nx; s.y = ng; }
            if (Math.random() < dt * 30) this.fx({ kind: 'ember', x: s.x - s.facing * 20, y: s.y - 20, vx: -s.facing * rnd(40, 120), vy: -rnd(40, 160), g: 600, life: 0.3, r: 2.5, color: '#ffcf5a' });
          }
          if (s.age >= s.life) this.explode(s.x, s.y - 30, 95, s.dmg, 'player', false);
          break;
        }
        case 'yarn': {
          s.vy += 1500 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
          const g = this.groundAt(s.x);
          if (s.y >= g - s.r * 0.5 && s.vy > 0) { s.y = g - s.r * 0.5; s.vy = -Math.max(420, Math.abs(s.vy) * 0.72); s.bounces++; }
          if (this.groundAt(s.x + Math.sign(s.vx) * s.r) < s.y - 40) { s.vx = -s.vx; s.bounces++; }
          s.spin = s.vx / 20;
          if (s.bounces > 6) s.age = s.life;
          break;
        }
        default:
          s.x += s.vx * dt; s.y += s.vy * dt;
          if (s.kind === 'bo' || s.kind === 'dart') s.rot = Math.atan2(s.vy, s.vx);
      }
      // 直線飛的撞到地面就停
      if ((s.kind === 'shuriken' || s.kind === 'bo' || s.kind === 'dart' || s.kind === 'crane' || s.kind === 'fuma') && s.y > this.terrain.groundAt(s.x) + 6) {
        if (s.kind !== 'fuma') { s.age = s.life; this.sparks(s.x, s.y - 6, 4, 0); }
      }
      this.shotHits(s);
      if (s.x < this.camX - 250 || s.x > this.camX + VIEW_W + 250 || s.y < -400 || s.y > VIEW_H + 200) s.age = s.life;
    }
    this.shots = this.shots.filter((s) => s.age < s.life);
  }

  private nearestEnemy(x: number, y: number, facing: number): Enemy | null {
    let best: Enemy | null = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.dying > 0 || e.dead || !this.onScreen(e.x, -10) || e.invuln > 5) continue;
      const dd = Math.hypot(e.x - x, e.y - 60 - y) + ((e.x - x) * facing < 0 ? 500 : 0);
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }

  /** 忍具打中判定：圓（直線飛的）、長條（火焰、鎖鏈） */
  private shotHits(s: Shot): void {
    if (s.age >= s.life || s.sucked) return;
    const areas: Box[] = [];
    if (s.kind === 'flame' || s.kind === 'chain') {
      const len = s.phase, th = s.kind === 'flame' ? 44 : 22;
      if (len <= 1) return;
      if (s.aim === 'up') areas.push({ x0: s.x - th, x1: s.x + th, y0: s.y - len, y1: s.y });
      else if (s.aim === 'down') areas.push({ x0: s.x - th, x1: s.x + th, y0: s.y, y1: s.y + len });
      else areas.push({ x0: Math.min(s.x, s.x + s.facing * len), x1: Math.max(s.x, s.x + s.facing * len), y0: s.y - th, y1: s.y + th });
    } else areas.push({ x0: s.x - s.r, x1: s.x + s.r, y0: s.y - s.r, y1: s.y + s.r });
    const hitArea = (b: Box): boolean => areas.some((a) => overlap(a, b));
    const dir = Math.sign(s.vx) || s.facing;
    // 打得掉的敵人子彈（狐火、泡泡）：打中扣一下，扣光就散掉；直線飛的忍具打掉一顆就消失
    for (const bl of this.bullets) {
      if (bl.hp === undefined || bl.age >= bl.life || !hitArea(this.bulletBox(bl))) continue;
      bl.hp -= 1;
      this.sparks(bl.x, bl.y, 5, dir, bl.kind === 'foxfire' ? '#9fe0ff' : '#dff4ff');
      if (bl.hp <= 0) { bl.age = bl.life; this.addScore(50, bl.x, bl.y - 20); this.event('bulletShot', { kind: bl.kind }); }
      if (!s.pierce && s.kind !== 'yarn') { s.age = s.life; return; }
    }
    for (const e of this.enemies) {
      if (e.dying > 0 || e.dead) continue;
      if (s.kind === 'caltrop' && s.phase === 1 && (ENEMY_DEFS[e.kind].fly || !e.onGround)) continue;
      let box = enemyBox(e);
      if (e.part && !e.part.broken) { const pb = kingPackBox(e); box = { x0: Math.min(box.x0, pb.x0), x1: Math.max(box.x1, pb.x1), y0: Math.min(box.y0, pb.y0), y1: box.y1 }; }
      if (!hitArea(box)) continue;
      if (arhatBlocks(e, s)) {
        // 鐵羅漢正面擋掉：噹一聲火花、忍具彈開
        this.sparks(s.x, s.y, 6, -(Math.sign(s.vx) || s.facing), '#cfe0ff');
        if (this.time - (e.mem.blockPop ?? -9) > 1.2) { e.mem.blockPop = this.time; this.pop(e.x, e.y - ENEMY_DEFS[e.kind].h - 20, '擋！', '#cfe0ff', 26); }
        this.event('blocked', { kind: e.kind });
        s.age = s.life; return;
      }
      if (s.pierce) { if (e.hitCd.has(s.id)) continue; e.hitCd.set(s.id, s.rehit); }
      const hy = s.kind === 'flame' || s.kind === 'chain' ? Math.max(box.y0 + 20, Math.min(box.y1 - 20, s.y)) : s.y;
      const hx = s.kind === 'flame' || s.kind === 'chain' ? e.x - s.facing * 20 : s.x;
      if (s.kind === 'mouse') { s.age = s.life; this.explode(s.x, s.y - 30, 95, s.dmg, 'player', false); return; }
      this.damageEnemy(e, s.dmg, { x: hx, y: hy, dir, kind: s.kind });
      this.sparks(hx, hy, s.kind === 'fuma' ? 7 : 4, dir);
      if (s.kind === 'flame') e.burn = 1.6;
      if (s.kind === 'dart') e.poison = 3;
      if (s.kind === 'fuma' || s.kind === 'chain') this.shakeIt(0.06);
      if (s.kind === 'yarn') { s.vx = -s.vx * 0.8; s.vy = -420; s.bounces++; }
      else if (!s.pierce) { s.age = s.life; return; }
    }
    for (const b of this.breakables) {
      if (b.broken || !hitArea(this.breakBox(b))) continue;
      if (s.pierce) { if (b.hitCd.has(s.id)) continue; b.hitCd.set(s.id, s.rehit); }
      this.damageBreakable(b, s.dmg, s.x, s.y, dir);
      if (s.kind === 'mouse') { s.age = s.life; this.explode(s.x, s.y - 30, 95, s.dmg, 'player', false); return; }
      if (!s.pierce && s.kind !== 'yarn') { s.age = s.life; return; }
      if (s.kind === 'yarn') { s.vx = -s.vx * 0.8; s.vy = -420; }
    }
    for (const c of this.captives) if (c.state === 'tied' && !c.caged && hitArea(boxAt(c.x, c.y, 80, 140))) this.freeCaptive(c);
  }

  /** 揮爪打中（player 叫）：一爪打前面所有東西一次；第二階段的橘皮大王全身是刺，爪子被刺彈開（打不到牠、也不扣球球的血） */
  clawHits(zone: Box, facing: 1 | -1, done: Set<object>): void {
    let any = false;
    for (const e of this.enemies) {
      if (e.dying > 0 || e.dead || done.has(e) || !overlap(zone, enemyBox(e))) continue;
      done.add(e); any = true;
      if (spiky(e)) {
        // 爪子（打旁邊的小兵時順便碰到）被刺彈開：叮一聲、跳「刺！爪子沒用」，不扣任何人的血
        this.sparks(e.x - facing * 60, this.player.body.y - 110, 8, facing, '#ffd0c0');
        this.pop(this.player.body.x, this.player.body.y - 190, '刺！爪子沒用', '#ff8a7a', 26);
        this.event('thorns', {});
        continue;
      }
      this.damageEnemy(e, 40, { x: e.x - facing * 25, y: this.player.body.y - 110, dir: facing, kind: 'claw' });
      for (let i = 0; i < 6; i++) this.fx({ kind: 'spark', x: e.x - facing * 25, y: this.player.body.y - 110, vx: rnd(-260, 260) - facing * 80, vy: rnd(-240, 60), life: 0.22, r: 3, color: '#fff3c4' });
    }
    for (const b of this.breakables) {
      if (b.broken || done.has(b) || !overlap(zone, this.breakBox(b))) continue;
      done.add(b); any = true;
      this.damageBreakable(b, 40, b.x - facing * 20, this.player.body.y - 90, facing);
    }
    for (const c of this.captives) if (c.state === 'tied' && !c.caged && overlap(zone, boxAt(c.x, c.y, 80, 140))) this.freeCaptive(c);
    if (any) { this.hitstop = Math.max(this.hitstop, 0.07); this.shakeIt(0.1); this.event('claw', {}); }
  }

  private stepBombs(dt: number): void {
    for (const b of this.bombs) {
      b.age += dt;
      const y0 = b.y;
      b.vy += 1500 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += 10 * dt * Math.sign(b.vx || 1);
      let boom = b.age > 3 || !!this.floorBelow(b.x, y0, b.y);
      if (!boom && b.kind !== 'smoke') {
        const bx = { x0: b.x - 14, x1: b.x + 14, y0: b.y - 14, y1: b.y + 14 };
        boom = this.enemies.some((e) => e.dying <= 0 && !e.dead && overlap(bx, enemyBox(e))) || this.breakables.some((k) => !k.broken && overlap(bx, this.breakBox(k)));
      }
      if (!boom) continue;
      b.age = 99;
      if (b.kind === 'smoke') {
        this.player.hidden = 4.5;
        for (let i = 0; i < 10; i++) this.fx({ kind: 'smoke', x: b.x + rnd(-80, 80), y: b.y - rnd(0, 120), vx: rnd(-40, 40), vy: -rnd(10, 50), g: -10, life: rnd(1.6, 2.4), r: rnd(40, 70), color: '#d8d0e0' });
        this.banner('隱身！', '敵人看不到你 4 秒', 'weapon', 1.2);
        this.event('smoke', {});
      } else if (b.kind === 'bigbomb') this.explode(b.x, b.y - 20, 240, 130, 'player', true);
      else this.explode(b.x, b.y - 20, 135, 60, 'player', true);
    }
    this.bombs = this.bombs.filter((b) => b.age < 99);
  }

  private stepBullets(dt: number): void {
    const pb = this.player.body;
    for (const b of this.bullets) {
      b.age += dt;
      if (b.kind === 'gust') continue;   // 風：原地不動，時間到就散
      if (b.homing) {
        // 狐火：慢慢轉向球球（每秒最多轉 homing 弧度），速度不變
        const sp = Math.hypot(b.vx, b.vy) || 1, want = Math.atan2(pb.y - 90 - b.y, pb.x - b.x);
        let a = Math.atan2(b.vy, b.vx), da = want - a;
        while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        a += Math.max(-b.homing * dt, Math.min(b.homing * dt, da));
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
      }
      if (b.kind === 'fan' && b.owner) {
        // 扇子：往前飛、越飛越慢，0.8 秒後轉回丟的人手上
        const o = b.owner;
        if (b.age < 0.8) { b.vx *= Math.pow(0.35, dt); }
        else {
          const tx = o.x + o.facing * 40, ty = o.y - 128, L = Math.hypot(tx - b.x, ty - b.y) || 1;
          b.vx = (tx - b.x) / L * 560; b.vy = (ty - b.y) / L * 560;
          if (L < 40 || o.dead || o.dying > 0) b.age = b.life;
        }
      }
      if (b.kind === 'bubble') b.vy = Math.sin(b.age * 4 + b.id) * 40 - 10;   // 泡泡：上下飄
      b.vy += b.g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.spin * dt;
      if (b.kind === 'kunai' || b.kind === 'water' || b.kind === 'fireball' || b.kind === 'missile') b.rot = Math.atan2(b.vy, b.vx);
      if (b.kind === 'missile' && b.vy > 0 && Math.random() < dt * 40) this.fx({ kind: 'smoke', x: b.x, y: b.y - 30, vx: rnd(-20, 20), vy: -60, life: 0.4, r: rnd(8, 12), color: '#cfc8d0' });
      if (b.ground) {
        const g = this.groundAt(b.x);
        if (!Number.isFinite(g) || g < b.y - 40) b.age = b.life;   // 震波碰到坑、牆就散掉
        else b.y = g;
        if (Math.random() < dt * 30) this.dust(b.x, b.y, 1, -Math.sign(b.vx));
      } else if (b.kind !== 'blast' && b.kind !== 'fan' && b.y > this.groundAt(b.x)) {
        b.age = b.life;
        if (b.kind === 'missile' && b.vy > 0) { this.explode(b.x, this.groundAt(b.x) - 20, 105, 0, 'enemy', true); continue; }
        if (b.kind === 'garbage') { this.explode(b.x, this.groundAt(b.x) - 16, 72, 0, 'enemy', false); continue; }
        const col: Partial<Record<BulletKind, string>> = { pellet: '#ffb347', bone: '#f4ecd8', water: '#bfe6ff', splash: '#bfe6ff', bubble: '#dff4ff', fireball: '#ffb347', foxfire: '#9fe0ff', leaf: '#8fbf4a' };
        this.sparks(b.x, b.y - 8, 5, 0, col[b.kind] ?? '#ddd');
      }
      if (b.x < this.camX - 300 || b.x > this.camX + VIEW_W + 300 || b.y > VIEW_H + 100) b.age = b.life;
    }
    this.bullets = this.bullets.filter((b) => b.age < b.life);
  }

  bulletBox(b: Bullet): Box {
    if (b.ground) return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h, y1: b.y };
    return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2 };
  }

  private stepExplosions(dt: number): void {
    for (const x of this.explosions) {
      x.age += dt;
      if (x.dealt) continue;
      x.dealt = true;
      const near = (b: Box, r: number): boolean => {
        const cx = Math.max(b.x0, Math.min(x.x, b.x1)), cy = Math.max(b.y0, Math.min(x.y, b.y1));
        return Math.hypot(cx - x.x, cy - x.y) < r;
      };
      if (x.from !== 'enemy' && x.dmg > 0) {
        for (const e of this.enemies) if (e.dying <= 0 && !e.dead && near(enemyBox(e), x.r)) this.damageEnemy(e, x.dmg, { x: e.x, y: e.y - ENEMY_DEFS[e.kind].h / 2, dir: Math.sign(e.x - x.x) || 1, kind: 'blast' });
        for (const b of this.breakables) if (!b.broken && near(this.breakBox(b), x.r)) this.damageBreakable(b, x.dmg, b.x, b.y - b.h / 2, Math.sign(b.x - x.x) || 1);
        for (const c of this.captives) if (c.state === 'tied' && !c.caged && near(boxAt(c.x, c.y, 80, 140), x.r)) this.freeCaptive(c);
      }
      if (x.from !== 'player' && near(this.player.box(), x.r * 0.7)) this.hurtPlayer(this.player.body.x < x.x ? -1 : 1, 'explosion:' + x.from);
    }
    this.explosions = this.explosions.filter((x) => x.age < x.life);
  }

  // ───────────── 可破壞的場景 ─────────────

  damageBreakable(b: Breakable, dmg: number, x: number, y: number, dir: number): void {
    if (b.broken) return;
    // 機關城城門：守門石獅還在，封印打不動
    if (b.kind === 's3_gate' && this.enemies.some((e) => e.kind === 'guardian_statue' && !e.dead && e.dying <= 0 && Math.abs(e.x - b.x) < 900)) {
      this.sparks(x, y, 4, dir, '#c9a4ff');
      if (this.time - (b.sealPop ?? -9) > 1.4) { b.sealPop = this.time; this.pop(b.x, b.y - b.h * 0.6, '石獅守著！先打石獅', '#d8b8ff', 26); this.event('sealed', {}); }
      return;
    }
    b.hp -= dmg; b.flash = 0.08; b.shake = 0.12;
    this.sparks(x, y, 3, dir, '#e8c89a');
    if (b.hp <= 0) this.breakIt(b, dir);
  }

  private breakIt(b: Breakable, dir: number): void {
    b.broken = true;
    const cy = b.y - b.h / 2;
    const big = b.kind === 'tower' || isGate(b.kind);
    const n = big ? 26 : 12;
    const color = b.kind === 'cage' ? '#9bbf5a' : b.kind === 'powder' ? '#8a2b22' : b.kind === 's2_stone_lantern' ? '#7d8288' : '#9a6a3a';
    const pieces = BREAK_DEFS[b.kind].debris;
    for (let i = 0; i < n; i++) this.fx({ kind: 'debris', x: b.x + rnd(-b.w / 2, b.w / 2), y: cy + rnd(-b.h / 3, b.h / 3), vx: rnd(-320, 320) + dir * 120, vy: rnd(-700, -200), g: 1600, life: rnd(0.9, 1.4), r: rnd(8, big ? 20 : 14), spin: rnd(-14, 14), color, sprite: 'debris_' + pieces[i % pieces.length] });
    this.dust(b.x, b.y, 8);
    this.addScore(BREAK_DEFS[b.kind].score, b.x, b.y - b.h - 20);
    this.shakeIt(big ? 0.45 : 0.12);
    switch (b.kind) {
      case 'powder': this.explode(b.x, b.y - 40, 150, 60, 'scene', true); break;
      case 'tower': case 'gate': case 's3_gate': this.explode(b.x, b.y - b.h * 0.4, 130, 0, 'scene', true); break;
      // 油桶：小爆炸（敵人、球球都會被炸到）；蒸氣管段：噴一陣蒸氣
      case 's3_oil_drum': this.explode(b.x, b.y - 40, 120, 50, 'scene', false); break;
      case 's3_steam_pipe': for (let i = 0; i < 10; i++) this.fx({ kind: 'smoke', x: b.x + rnd(-20, 20), y: b.y - rnd(40, 110), vx: rnd(-60, 60), vy: -rnd(80, 200), life: rnd(0.6, 1.0), r: rnd(14, 26), color: '#eef2f6' }); break;
      case 'barrel': case 's2_sake_stack': for (let i = 0; i < 10; i++) this.fx({ kind: 'drop', x: b.x, y: cy, vx: rnd(-240, 240), vy: rnd(-420, -120), g: 1400, life: 0.7, r: 5, color: '#e8f4ff' }); break;
      case 'stall': this.drop('onigiri', b.x - 30, cy, -120, -500); this.drop('fish', b.x + 30, cy, 120, -520); break;
      case 's2_lantern_stall': this.drop('onigiri', b.x, cy, 60, -500); break;
      // 賽錢箱：撒出一把金幣（亮晶晶的小點）
      case 's2_offering_box': for (let i = 0; i < 14; i++) this.fx({ kind: 'drop', x: b.x, y: cy, vx: rnd(-260, 260), vy: rnd(-560, -220), g: 1500, life: 0.9, r: 5, color: '#ffd23a' }); break;
      default: break;
    }
    if (b.drop) this.drop(b.drop, b.x, cy, dir * 60, -520);
    if (b.captive) { b.captive.caged = false; this.freeCaptive(b.captive); }
    if (b.top) {
      // 瞭望台垮了：站在上面的敵人一起摔下來
      for (const e of this.enemies) if (e.plat === b.top) { e.plat = null; e.onGround = false; e.vy = -200; this.damageEnemy(e, 30, { x: e.x, y: e.y - 60, dir, kind: 'blast' }); }
      this.rebuildPlatforms();
    }
    this.event('break', { kind: b.kind });
  }

  private stepBreakables(dt: number): void {
    for (const b of this.breakables) {
      b.flash = Math.max(0, b.flash - dt); b.shake = Math.max(0, b.shake - dt);
      for (const [k, v] of b.hitCd) { if (v - dt <= 0) b.hitCd.delete(k); else b.hitCd.set(k, v - dt); }
      if (b.broken && (b.kind === 'tower' || isGate(b.kind)) && b.fall < 1) {
        b.fall = Math.min(1, b.fall + dt / 0.9);
        if (Math.random() < dt * 12) this.dust(b.x + rnd(-60, 60), b.y, 2);
        if (b.fall >= 1) { this.shakeIt(0.3); this.dust(b.x, b.y, 14); }
      }
    }
  }

  // ───────────── 被綁的村貓 ─────────────

  freeCaptive(c: Captive): void {
    if (c.state !== 'tied' || c.caged) return;
    c.state = 'thank'; c.t = 0;
    this.rescued++;
    this.addScore(1000, c.x, c.y - 200);
    this.event('captiveFreed', { art: c.art, drop: c.drop });
  }

  private stepCaptives(dt: number): void {
    for (const c of this.captives) {
      c.t += dt;
      if (c.state === 'thank' && c.t > 1.0) { c.state = 'give'; c.t = 0; }
      else if (c.state === 'give' && c.t > 0.55) {
        // 從懷裡掏出道具丟給球球
        const dir = this.player.body.x < c.x ? -1 : 1;
        this.drop(c.drop, c.x + dir * 20, c.y - 150, dir * 170, -560);
        c.state = 'run'; c.t = 0;
      } else if (c.state === 'run') {
        if (c.t < 0.4) continue;
        c.vx = -330;
        const y0 = c.y;
        c.vy += 1800 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
        const f = this.floorBelow(c.x, y0, c.y);
        if (f) { c.y = f.y; c.vy = -300; }   // 一蹦一跳地跑
        if (c.y > VIEW_H + 100) c.y = this.groundAt(c.x) || GROUND;
        if (c.x < this.camX - 160) c.state = 'gone';
      }
    }
  }

  // ───────────── 掉落物 ─────────────

  private stepPickups(dt: number): void {
    const pbox = this.player.box();
    const reach = { x0: pbox.x0 - 22, x1: pbox.x1 + 22, y0: pbox.y0 - 10, y1: pbox.y1 + 6 };
    for (const k of this.pickups) {
      k.age += dt;
      if (!k.onGround) {
        const y0 = k.y;
        k.vy += 1600 * dt; k.x += k.vx * dt; k.y += k.vy * dt;
        const f = this.floorBelow(k.x, y0, k.y);
        if (f) { k.y = f.y; k.onGround = true; k.vx = 0; k.vy = 0; }
        if (k.y > VIEW_H + 100) { k.taken = true; continue; }
      }
      if (k.age > 0.35 && this.player.alive && overlap(reach, boxAt(k.x, k.y, 60, 60))) this.collect(k);
      if (k.x < this.camX - 200) k.taken = true;
    }
    this.pickups = this.pickups.filter((k) => !k.taken);
  }

  private collect(k: Pickup): void {
    k.taken = true;
    const a = this.player.arsenal;
    if (k.kind === 'fish' || k.kind === 'onigiri') {
      const n = FOOD_SCORE[k.kind] ?? 100;
      this.addScore(n);
      this.pop(k.x, k.y - 70, `${k.kind === 'fish' ? '魚乾' : '飯糰'} +${n}`, '#b6ff8a', 26);
    } else if (k.kind === 'bomb' || k.kind === 'bigbomb' || k.kind === 'smoke') {
      a.pickSub(k.kind);
      this.banner(SUBS[k.kind].name.replace('！', '') + ` ＋${SUBS[k.kind].pickup}！`, '', 'weapon', 1.4);
    } else {
      a.pick(k.kind);
      this.banner(WEAPONS[k.kind].name, `剩 ${a.ammo} 發`, 'weapon', 1.5);
    }
    this.event('pickup', { kind: k.kind });
  }

  // ───────────── 球球被打 ─────────────

  private enemyContacts(dt: number): void {
    const p = this.player;
    if (!p.alive || this.state !== 'play') return;
    const pb = p.box();
    for (const v of this.stage.vents ?? []) {
      if (!this.onScreen(v.x, 60) || !this.ventState(v).on) continue;
      if (overlap(pb, this.ventBox(v))) this.hurtPlayer(p.body.x < v.x ? -1 : 1, 'steam');
    }
    for (const b of this.bullets) {
      if (b.kind === 'spark' || (b.kind === 'missile' && b.vy < 0) || !overlap(pb, this.bulletBox(b))) continue;
      if (b.push) {
        // 天狗的風：不傷人，把球球往風吹的方向推（跑步 340，風 420：頂著風跑會慢慢往後退）
        const dir = Math.sign(b.vx) || 1;
        p.body.x = Math.max(this.camX + 36, Math.min(this.camX + VIEW_W - 36, p.body.x + dir * b.push * dt));
        if (Math.random() < dt * 36) this.fx({ kind: 'puff', x: p.body.x - dir * 30, y: p.body.y - 20, vx: dir * 200, vy: -30, life: 0.3, r: 6, color: '#e8f4ff' });
        continue;
      }
      if (this.hurtPlayer(b.x < p.body.x ? 1 : -1, b.kind)) { if (b.kind !== 'wave' && b.kind !== 'blast') b.age = b.life; }
    }
    for (const e of this.enemies) {
      if (e.dying > 0 || e.dead) continue;
      if (e.harm && overlap(pb, e.harm)) this.hurtPlayer(e.x < p.body.x ? 1 : -1, `${e.kind}:${e.state}`);
      else if (e.bodyHarm && overlap(pb, enemyBox(e))) this.hurtPlayer(e.x < p.body.x ? 1 : -1, `${e.kind}:${e.state}`);
      else if (e.boss && e.state !== 'die' && p.body.y > e.y - 100 && overlap(pb, enemyBox(e))) {
        // 魔王站著、走路：碰到只會被推開（不扣血）
        const eb = enemyBox(e), side = p.body.x < e.x ? -1 : 1;
        const depth = side < 0 ? pb.x1 - eb.x0 : eb.x1 - pb.x0;
        p.body.x = Math.max(this.camX + 36, Math.min(this.camX + VIEW_W - 36, p.body.x + side * Math.min(depth, 960 * dt)));
      }
    }
    // 碰到被綁的村貓就放了牠
    for (const c of this.captives) if (c.state === 'tied' && !c.caged && overlap(pb, boxAt(c.x, c.y, 80, 140))) this.freeCaptive(c);
  }

  /** 現在抓得到球球嗎（蛙大名的舌頭）：無敵、倒下、開發用無敵都抓不到 */
  canGrab(): boolean {
    const p = this.player;
    return !this.god && this.state === 'play' && p.alive && p.invincible <= 0 && p.held <= 0;
  }

  /** 扣一滴血；無敵中、開發用無敵、倒下中不算。回傳有沒有真的扣到 */
  hurtPlayer(dir: 1 | -1, src = ''): boolean {
    const p = this.player;
    if (this.god || this.state !== 'play' || !p.alive || p.invincible > 0) return false;
    p.hp -= 1;
    this.event('playerHurt', { hp: p.hp, src });
    this.hitstop = Math.max(this.hitstop, 0.08);
    this.shakeIt(0.2);
    if (p.hp <= 0) this.playerDown();
    else p.hurt(dir);
    return true;
  }

  private playerDown(): void {
    const p = this.player;
    p.hp = 0;
    p.knockDown();
    this.lives -= 1;
    this.deaths++;
    this.setState('dying');
    this.shakeIt(0.3);
    this.event('playerDown', { lives: this.lives });
  }

  /** 重生：從畫面上方掉下來（倒下的地方；在坑上就退回最後的安全點） */
  private respawn(fullHp: boolean): void {
    const p = this.player;
    let x = Math.max(this.camX + 120, Math.min(this.camX + VIEW_W - 200, p.body.x));
    if (!Number.isFinite(this.terrain.groundAt(x)) || !this.terrain.walkable(x, 1, 40, 60, 90)) x = Math.max(this.camX + 80, p.safeX);
    const hp = p.hp;
    p.respawn(x, -80);
    if (!fullHp) p.hp = Math.max(1, hp);
    this.bullets = this.bullets.filter((b) => Math.abs(b.x - x) > 500);
    this.setState('play');
    this.event('respawn', { x: Math.round(x) });
  }

  /** 接關（game 叫）：命補滿，從倒下的地方繼續 */
  continueGame(): void {
    if (this.state !== 'continue') return;
    this.lives = LIVES;
    this.continues++;
    const a = this.player.arsenal;
    a.subs.bomb = Math.max(a.subs.bomb, SUBS.bomb.start);
    this.respawn(true);
  }

  private checkPlayer(): void {
    const p = this.player;
    // 掉進坑：扣一滴血，從最後的安全點重來
    if (this.state === 'play' && p.body.y > VIEW_H + 90) {
      this.event('fellInPit', {});
      if (this.god) { this.respawn(false); return; }
      p.hp -= 1;
      if (p.hp <= 0) { this.playerDown(); p.body.y = VIEW_H + 90; p.body.vy = 0; }
      else { p.invincible = 0; this.respawn(false); p.invincible = 1.5; this.event('playerHurt', { hp: p.hp, pit: true }); }
    }
  }

  // ───────────── 鏡頭 ─────────────

  private updateCamera(dt: number): void {
    const S = this.stage;
    // 鎖畫面的一波打完就解鎖
    for (const i of [...this.locks]) {
      // 保險：這一波剩下的全都在畫面外待了 6 秒（卡在搆不到的地方）就算牠們跑掉了，不要讓鏡頭永遠鎖住
      const rest = this.enemies.filter((e) => e.group === i && !e.dead && e.dying <= 0);
      if (rest.length && rest.every((e) => !this.onScreen(e.x, -20))) {
        this.lockAway.set(i, (this.lockAway.get(i) ?? 0) + dt);
        if (this.lockAway.get(i)! > 6) { for (const e of rest) e.dead = true; this.lockAway.delete(i); this.event('waveEscaped', { i }); }
      } else this.lockAway.delete(i);
      const alive = this.enemies.some((e) => e.group === i && !e.dead && e.dying <= 0) || this.queue.some((q) => q.i === i);
      if (!alive) { this.locks.delete(i); this.event('waveCleared', { i }); if (this.locks.size === 0) { this.lockX = null; this.banner('前進！', '', 'warn', 1.0); } }
    }
    let maxCam = S.length - VIEW_W;
    if (this.lockX !== null) maxCam = Math.min(maxCam, this.lockX);
    S.bosses.forEach((bd, i) => { if (!this.bossDone[i]) maxCam = Math.min(maxCam, bd.at); });
    for (const b of this.breakables) if (isGate(b.kind) && !b.broken) maxCam = Math.min(maxCam, b.x - VIEW_W + 300);
    // 鏡頭只往右（越南大戰規則）：跟著球球，但不超過鎖住的位置；永遠不往回捲
    const want = Math.min(this.player.body.x - VIEW_W * 0.42, maxCam);
    if (want > this.camX) this.camX += Math.max(Math.min(want - this.camX, 1.5), (want - this.camX) * Math.min(1, dt * 7));
  }

  private checkZone(): void {
    const mid = this.camX + VIEW_W / 2;
    let z = 0;
    this.stage.zones.forEach((zd, i) => { if (mid >= zd.from) z = i; });
    if (z !== this.zone) { this.zone = z; this.event('zone', { zone: this.stage.zones[z]!.name }); }
  }

  /** 魔王打倒了（enemies.ts 的倒下演完叫）：中魔王解鎖鏡頭、最後的魔王就過關 */
  bossDefeated(e: Enemy): void {
    e.dead = true;
    const i = e.group - 1000;
    if (i >= 0) this.bossDone[i] = true;
    if (this.locks.size === 0) this.lockX = null;
    if (this.boss === e) this.boss = null;
    this.addScore(ENEMY_DEFS[e.kind].score, e.x, e.y - 200);
    this.kills++;
    this.explode(e.x, e.y - 120, 200, 0, 'scene', true);
    this.explosions[this.explosions.length - 1]!.boss = true;   // 魔王倒下：畫大爆炸
    const final = this.stage.bosses[i]?.final;
    if (final) {
      // 任務完成：剩下的小兵一起炸飛
      for (const o of this.enemies) if (o !== e && o.dying <= 0 && !o.dead) this.killEnemy(o, Math.sign(o.x - e.x) || 1, 'blast');
      this.bullets = [];
      this.setState('clear');
      this.freeze = 0.8;
      this.banner('任務完成！', this.stage.name, 'mission', CLEAR_TIME + 1);
      this.event('missionComplete', {});
    } else {
      this.banner('前進！', '', 'warn', 1.4);
    }
  }

  /** 結算（game 的結算畫面用）：一行一行跳出來加總 */
  resultRows(): { label: string; value: string; points: number }[] {
    const timeBonus = Math.floor(this.timeLeft) * 10;
    return [
      { label: '解救村貓', value: `${this.rescued} / ${this.captives.length}`, points: this.rescued * 2000 },
      { label: '擊倒敵人', value: `${this.kills}`, points: 0 },
      { label: '最高連殺', value: `${this.maxCombo}`, points: this.maxCombo * 100 },
      { label: '剩餘時間', value: `${Math.floor(this.timeLeft)} 秒`, points: timeBonus },
      { label: '接關次數', value: `${this.continues}`, points: 0 },
    ];
  }

  /** 開發、測試用：直接跳到世界 x（之前的出怪表當作已經出過） */
  skipTo(x: number): void {
    this.camX = Math.max(0, x - VIEW_W * 0.42);
    this.stage.spawns.forEach((s, i) => { if (s.at < this.camX - 50) this.fired[i] = true; });
    this.stage.bosses.forEach((bd, i) => { if (bd.at < this.camX - 50) { this.bossFired[i] = true; this.bossDone[i] = true; } });
    const b = this.player.body;
    b.x = x; b.y = this.groundAt(x); b.vx = 0; b.vy = 0; b.onGround = true;
    this.player.safeX = x;
  }
}

function pick<T>(xs: readonly T[]): T { return xs[Math.floor(Math.random() * xs.length)]!; }

/** 球球手的位置（火焰、鎖鏈黏在手上） */
export function handOf(p: Player): { x: number; y: number } {
  const b = p.body, aim = p.lastAim;
  const H: Record<Aim, [number, number]> = { fwd: [120, -112], up: [28, -190], down: [36, -60], low: [104, -62] };
  const [hx, hy] = H[aim];
  return { x: b.x + b.facing * hx, y: b.y + hy };
}
