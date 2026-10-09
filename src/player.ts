/**
 * 球球：動作狀態機（從動作測試場的 game.ts 搬過來）＋越南大戰的攻擊規則。
 *   - 一顆攻擊鍵：前面貼著敵人（或木箱、竹籠）就自動揮爪，遠一點就丟身上的忍具（越南大戰的近身自動用刀）。
 *   - 方向：平常朝前丟；按住 ↑ 朝上丟；空中按住 ↓ 朝下丟；蹲著朝前低丟。邊跑邊丟不停下來（跑步動作照播、忍具照飛）。
 *   - 手感參數（physics.ts 的 PARAMS）一個都沒動；地形起伏由 physics 的 groundAt 處理。
 * 動作圖 anims.json 有什麼就用什麼，沒有就退回（沒有蹲就不能蹲、沒有朝上丟就用朝前丟的動作朝上丟）。
 */
import type { Aim, Box } from './entities';
import type { Frame } from './input';
import { findClimb, grabClimb, PARAMS, newBody, releaseClimb, stepBody, stepClimb, type Body, type Ctrl, type Params } from './physics';
import { Feel } from './feel';
import { Animator, type AnimDefs } from './sprite';
import { Arsenal, WEAPONS } from './weapons';
import type { World } from './world';

/** 動作圖 → 畫面：站直的球球在圖裡 240 像素高，畫面上約 190 像素 */
export const SCALE = 190 / 240;
export const MAX_HP = 3;
/** 被打之後無敵幾秒（一閃一閃） */
export const HURT_IFRAMES = 1.2;
/** 重生（接關、掉命）後無敵幾秒 */
export const RESPAWN_IFRAMES = 2.4;

/*
 * 跑步播放速度跟著實際速度走，腳才不會在地上滑：
 * 影片裡著地那隻腳每格往後退約 22 像素（2026-09-26 量 run），倍率 = vx ÷ (22 × SCALE × 24)。換了跑步影片要重量。
 * 走路、蹲走沒量過：先用「最快速度時播 1 倍」。
 */
const TREAD_PX: Record<string, number> = { run: 22, runthrow: 22 };   // 跑丟是同一個跑姿，先照跑步的步幅
const WALK: Params = { ...PARAMS, runSpeed: 150 };
const CROUCH: Params = { ...PARAMS, runSpeed: 110 };
/** 衝刺：固定速度往前衝，時間夾在 0.22～0.4 秒，前 0.25 秒無敵 */
const DASH_SPEED = 760, DASH_MIN = 0.22, DASH_MAX = 0.4, DASH_IFRAMES = 0.25, DASH_COOLDOWN = 0.3;
const DASH: Params = { ...PARAMS, runSpeed: DASH_SPEED, accelGround: 1e6, accelAir: 1e6 };
/**
 * 揮爪（第二版規劃第 4 節，09-28 使用者：揮爪時常被碰到扣血）：從第 6 格開始播、打中前 2.4 倍速（出手到打中約 0.17 秒）；
 * 打中後第 8 格起 2.6 倍；打中後第 10 格起可以取消；打中判定 hit 前 2 格到後 4 格、身體前方 0～210、高 190。
 * 出爪護身：出爪開始到打中後第 4 格，被敵人「身體」碰到不扣血（子彈、敵人出招的判定照扣）。
 */
export const CLAW = { from: 6, rate: 2.4, recoverAfter: 8, recoverRate: 2.6, cancelAfter: 10, win: [-2, 4], reach: [0, 210], height: 190, guardUntil: 4 } as const;
/** 翻滾（第二版 5.1）：地上按衝刺鍵。0.4 秒、速度 700（約 280 像素）、0.04～0.34 秒碰到什麼都不扣血、身體矮到 84、滾完 0.25 秒才能再滾、最後 0.08 秒可以接跳或丟 */
export const ROLL = { time: 0.4, speed: 700, safe: [0.04, 0.34], height: 84, cooldown: 0.25, cancel: 0.08 } as const;
const ROLL_P: Params = { ...PARAMS, runSpeed: ROLL.speed, accelGround: 1e6, accelAir: 1e6 };
/** 手裏劍同時在畫面上最多幾枚（第 4 枚按了不出手；第二版第 3 節） */
export const SHURIKEN_MAX = 3;
/** 丟：1.6 倍速，從出手前一格開始播（越南大戰按下去就飛出去，不等前搖）；出手後第 2 格起可以取消 */
const THROW = { rate: 1.6, cancelAfter: 2 } as const;
/** 手的位置（相對腳底、面向右，畫面像素）：朝前、朝上、空中朝下、蹲著 */
export const HAND: Record<Aim, { x: number; y: number }> = {
  fwd: { x: 120, y: -112 }, up: { x: 28, y: -190 }, down: { x: 36, y: -60 }, low: { x: 104, y: -62 },
  // 斜上：朝前和朝上中間（斜丟動作圖還沒生，等圖出來用 release 那一格重量）
  diag: { x: 92, y: -168 },
};
/** 沒有跳躍動作時，空中定格在跑步的這一格 */
const AIR_FALLBACK = { anim: 'run', frame: 11 };
const JUMP_SPLIT = { takeoff: 0.1, apex: 0.4, land: 0.75 };
const LAND_RATE = 1.3;
const BUFFER = 0.15;
const HURT_RATE = 2.2, HURT_MAX = 0.55;
const DOWN_RATE = 1.3;
const STILL: Ctrl = { left: false, right: false, jumpHeld: false, jumpPressed: false };

type Act = 'move' | 'land' | 'claw' | 'throw' | 'dash' | 'roll' | 'hurt' | 'down' | 'climb';

/**
 * 第二版階段二的新動作（2026-10-09 起改用 09-28 Flow 生好的專屬動作，anims.json 沒有時才退回下面的暫代）：
 *   二段跳、蹬牆跳：空翻（airflip），翻完接下落循環（fall）；蹬牆跳另有 wallkick（10-09 Vids 新生）
 *   貼牆下滑：wallslide 循環（暫代：跳躍的下落段停在 WALL_FRAME 那一格）
 *   攀爬：climb 循環，停著就停在當格（暫代：朝上丟 throwup 手舉直的那幾格來回播）
 *   長距離下落：跳躍的下落段播完還在掉，就接 fall 循環（原本停在下落段最後一格不動）
 */
const WALL_FRAME = 40;
const CLIMB_FRAMES = [4, 11] as const;
/** 空翻一圈要幾秒（影片 14 格約 0.58 秒，遊戲裡二段跳要快） */
const AIRFLIP_TIME = 0.32;
/** 蹬牆跳：蹲低蹬出去到身體拉直要幾秒（10-09 Vids 新生的 wallkick） */
const WALLKICK_TIME = 0.3;
/** 落下速度超過這個算重落地（音效用） */
const HEAVY_LAND = 1150;

export class Player {
  body: Body;
  anim: Animator;
  act: Act = 'move';
  arsenal = new Arsenal();
  hp = MAX_HP;
  invincible = 0;
  /** 煙玉隱身還剩幾秒（敵人看不到你） */
  hidden = 0;
  /** 被抓住（蛙大名的舌頭）還剩幾秒：這段時間按什麼都沒用 */
  held = 0;
  /** 重生從天上掉下來中：落地前不能左右移動（不然一路按著方向會飄進坑裡） */
  dropping = false;
  airThrow = false;
  crouching = false;
  /** 這一爪已經打過的東西（一爪只打一次） */
  clawHit = new Set<object>();
  queued: { kind: 'claw' | 'dash'; t: number } | null = null;
  actT = 0;
  dashCd = 0;
  airDashUsed = false;
  fireCd = 0;
  /** 跑步中丟：還要播「跑丟」幾秒（之後回到一般的跑步） */
  runThrowT = 0;
  subCd = 0;
  /** 二段跳（air）、蹬牆跳（wall）剛發生：下一次挑空中動作時換成空翻／蹬牆 */
  relaunch: false | 'air' | 'wall' = false;
  /** 上一次站在安全地面的位置（掉坑後從這裡重來） */
  safeX: number;
  /** 最後一次朝哪個方向丟（畫面用） */
  lastAim: Aim = 'fwd';
  /** 倒下動作沒有圖時，程式把站姿慢慢放倒（0～1） */
  downT = 0;
  /** 畫的時候加的彈性（起跳拉長、落地壓扁、跑步前傾、轉身壓窄），見 feel.ts */
  feel = new Feel();

  constructor(defs: AnimDefs, x: number, y: number) {
    this.body = newBody(x, y);
    this.safeX = x;
    this.anim = new Animator(defs);
    this.anim.play('idle');
  }

  get alive(): boolean { return this.act !== 'down'; }

  /** 翻滾開始後幾秒（沒在滾＝-1） */
  rollT = -1;

  /** 翻滾中、碰到什麼都不扣血的那段 */
  rollSafe(): boolean { return this.act === 'roll' && this.rollT >= ROLL.safe[0] && this.rollT <= ROLL.safe[1]; }

  /** 出爪護身：揮爪開始到打中後第 4 格，敵人身體碰到不扣血 */
  clawGuard(): boolean {
    const an = this.anim;
    return this.act === 'claw' && an.name === 'claw' && an.frame <= (an.def?.markers.hit ?? 0) + CLAW.guardUntil;
  }

  /** 身體判定：蹲著矮一截（苦無從頭上飛過去）；翻滾更矮 */
  box(): Box {
    const b = this.body, h = this.act === 'roll' ? ROLL.height : this.crouching ? 92 : 150;
    return { x0: b.x - 26, y0: b.y - h, x1: b.x + 26, y1: b.y };
  }

  update(dt: number, f: Frame, w: World): void {
    const b = this.body, an = this.anim;
    const dir = (f.right ? 1 : 0) - (f.left ? 1 : 0);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invincible = Math.max(0, this.invincible - dt);
    this.hidden = Math.max(0, this.hidden - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.runThrowT = Math.max(0, this.runThrowT - dt);
    this.subCd = Math.max(0, this.subCd - dt);

    // 1. 先把上一格畫的那個動作往前播（打中判定在這裡發生）
    an.update(dt);
    this.actStep(dt, w);

    if (this.act === 'down') {
      this.downT = Math.min(1, this.downT + dt * 2.5);
      stepBody(b, STILL, dt, w.physWorld());
      this.feelStep(dt, 0, false, false, 0);
      return;
    }

    // 攀爬中：只管上下爬、跳開（不能出招）；被打由 hurt() 放手
    if (this.act === 'climb') { this.climbStep(dt, f, w); this.feelStep(dt, 0, false, false, 0); return; }

    // 2. 按鍵：攻擊（近身揮爪／丟忍具）、副武器、衝刺；收招可以取消的時候，按方向或跳就回到移動
    const canAct = this.act === 'move' || this.act === 'land' || this.cancellable();
    if (f.attackPressed || (f.attackHeld && this.arsenal.def.auto)) this.attack(f, w, f.attackPressed, canAct);
    if (f.subPressed && canAct && this.act !== 'hurt') this.throwSub(f, w);
    if (f.subSwitchPressed) this.arsenal.cycleSub();
    if (f.dashPressed) this.queued = { kind: 'dash', t: BUFFER };
    else if (this.queued && (this.queued.t -= dt) <= 0) this.queued = null;
    const free = this.act === 'move' || this.act === 'land' || this.cancellable();
    // 抓藤蔓、梯子：在範圍裡按 ↑（空中按著 ↑ 碰到也抓得住）；站在頂端按 ↓ 往下爬
    if (free && !this.dropping && (f.up || f.down) && this.act !== 'roll') {
      const pw = w.physWorld(), i = findClimb(b, pw, { up: f.up, down: f.down, left: f.left, right: f.right, jumpPressed: false });
      if (i >= 0) { grabClimb(b, i, pw); this.act = 'climb'; this.queued = null; this.climbAnim(false); w.event('climbGrab', {}); return; }
    }
    if (free && this.queued && this.tryStart(this.queued.kind, w)) this.queued = null;
    else if ((this.act === 'land' || this.cancellable()) && (dir !== 0 || f.jumpPressed || (this.act === 'land' && f.down))) this.act = 'move';

    // 3. 物理：揮爪、受傷、地上丟的時候站定（空中照常飄），蹲著、走路換比較慢的最高速
    let ctrl: Ctrl = f, p = PARAMS;
    this.crouching = false;
    if (this.act === 'claw' || this.act === 'hurt' || (this.act === 'throw' && b.onGround)) ctrl = { ...STILL, jumpHeld: f.jumpHeld };
    else if (this.act === 'dash') { ctrl = { left: b.facing < 0, right: b.facing > 0, jumpHeld: f.jumpHeld, jumpPressed: false }; p = DASH; }
    else if (this.act === 'roll') { ctrl = { left: b.facing < 0, right: b.facing > 0, jumpHeld: f.jumpHeld, jumpPressed: false }; p = ROLL_P; }
    else if (b.onGround && f.down && an.has('crouch')) {
      p = CROUCH; this.crouching = true;
      if (!an.has('crouchwalk')) {
        if (dir !== 0) b.facing = dir > 0 ? 1 : -1;
        ctrl = { ...f, left: false, right: false };
      }
    } else if (b.onGround && f.walk && an.has('walk')) p = WALK;
    // ↓＋跳：從平台（屋頂、木架）上跳下去（越南大戰的下跳）；站在地面上照常蹲著跳
    if (b.onGround && f.down && f.jumpPressed && this.onPlatform(w)) {
      b.y += 2; b.onGround = false; b.coyote = 0;
      ctrl = { ...ctrl, jumpPressed: false };
      this.crouching = false;
    }
    if (this.act === 'throw' && an.name === 'crouchthrow') this.crouching = true;
    const x0 = b.x;
    const { jumped, landed, airJumped, wallJumped, fallSpeed } = stepBody(b, ctrl, dt, w.physWorld(), p);
    if (airJumped || wallJumped) {
      if (this.act === 'land' || (this.act === 'throw' && this.cancellable())) this.act = 'move';
      w.dust(b.x + (wallJumped ? -b.facing * 24 : 0), b.y - (wallJumped ? 60 : 0), 5, wallJumped ? b.facing : 0);
      w.event(wallJumped ? 'wallKick' : 'airJump', {});
      this.relaunch = wallJumped ? 'wall' : 'air';
    }
    if (this.act === 'roll') {
      // 滾出平台邊緣：照速度飛出去、變成往下掉；撞到牆：停在牆前、提早結束
      if (!b.onGround || Math.abs(b.x - x0) < ROLL.speed * dt * 0.3) this.endRoll();
    }
    if (jumped) { w.dust(b.x, b.y, 5, -1); if (this.act === 'land') this.act = 'move'; w.event('jump'); }
    if (landed) {
      w.dust(b.x, b.y, 7, 0);
      w.event(fallSpeed > HEAVY_LAND ? 'landHeavy' : 'land', {});
      this.airDashUsed = false;
      if (this.act === 'throw' && this.airThrow) this.act = 'move';
      else if (this.act === 'move' && dir === 0 && an.has('jump')) this.startLand();
    }
    // 站在地形上、前後 200 像素內都沒有坑＝安全點（掉坑後從這裡重來，前面留得出助跑的距離）
    if (b.onGround && Math.abs(b.y - w.terrain.groundAt(b.x)) < 1 && this.solidAround(w, b.x, 200)) this.safeX = b.x;

    // 4. 沒在出招：照按鍵與物理挑動作
    if (this.act === 'move') this.pickMove(dir, f);
    this.feelStep(dt, dir, jumped || airJumped || wallJumped, landed, fallSpeed);
  }

  /** 手感變形往前推一格（feel.ts）；翻滾、空翻、攀爬、貼牆、出招、被打的時候不加傾斜與轉身壓窄 */
  private feelStep(dt: number, dir: number, jumped: boolean, landed: boolean, fallSpeed: number): void {
    const b = this.body, n = this.anim.name;
    const calm = (this.act !== 'move' && this.act !== 'land') || b.sliding || n === 'airflip' || n === 'wallkick' || n === 'roll' || n === 'climb' || n === 'wallslide';
    this.feel.update({ dt, onGround: b.onGround, vx: b.vx, vy: b.vy, facing: b.facing, runSpeed: PARAMS.runSpeed, dir, jumped, landed, fallSpeed, calm });
  }

  /** x 前後 r 像素內每 20 像素都有地面（沒有坑） */
  private solidAround(w: World, x: number, r: number): boolean {
    for (let d = -r; d <= r; d += 20) if (!Number.isFinite(w.terrain.groundAt(x + d))) return false;
    return true;
  }

  /** 站在平台上（不是地形上） */
  onPlatform(w: World): boolean {
    const b = this.body;
    return Math.abs(b.y - w.groundAt(b.x)) > 1 && w.platforms.some((pl) => Math.abs(b.y - pl.y) < 0.5 && b.x >= pl.x && b.x <= pl.x + pl.w);
  }

  // ───────────── 攻擊 ─────────────

  private attack(f: Frame, w: World, pressed: boolean, canAct: boolean): void {
    const b = this.body, an = this.anim;
    if (this.act === 'hurt' || this.act === 'dash' || this.act === 'claw' || (this.act === 'roll' && !this.cancellable())) {
      if (pressed && this.act === 'claw') this.queued = { kind: 'claw', t: BUFFER };
      return;
    }
    // 近身自動揮爪（地上、前面貼著東西）
    if (pressed && b.onGround && an.has('claw') && !f.up && w.meleeTarget(b.x, b.y, b.facing)) {
      if (canAct) this.startClaw(); else this.queued = { kind: 'claw', t: BUFFER };
      return;
    }
    if (this.fireCd > 0 || (!canAct && this.act !== 'throw')) return;
    if (this.arsenal.weapon === 'shuriken' && w.shots.filter((s) => s.kind === 'shuriken').length >= SHURIKEN_MAX) return;
    if (this.act === 'roll') this.endRoll();
    const dirNow = (f.right ? 1 : 0) - (f.left ? 1 : 0);
    // 斜上：按著的方向跟面向不同就先轉過去（↑＋← 一定朝左上丟）
    if (f.up && dirNow !== 0 && dirNow !== b.facing) b.facing = dirNow > 0 ? 1 : -1;
    const aim: Aim = f.up && dirNow !== 0 ? 'diag' : f.up ? 'up' : (!b.onGround && f.down) ? 'down' : this.crouching || (b.onGround && f.down && an.has('crouch')) ? 'low' : 'fwd';
    const weapon = this.arsenal.use();
    this.fireCd = WEAPONS[weapon].cooldown;
    this.lastAim = aim;
    const h = HAND[aim];
    w.fireWeapon(weapon, b.x + b.facing * h.x, b.y + h.y, aim, b.facing, b.vx);
    // 動作：邊跑邊丟播「跑丟」（腳照跑、手甩出去；越南大戰跑著照樣開槍），蹲著丟播「蹲丟」，站著或空中播丟的動作。
    // 忍具按下就飛出去（手感），動作從出手格的前一格開始播，畫面上甩手那一格剛好對上
    const dir = (f.right ? 1 : 0) - (f.left ? 1 : 0);
    if (b.onGround && dir !== 0 && this.act !== 'throw' && aim !== 'low') {
      if (an.has('runthrow')) {
        const d = an.defs.runthrow!, rel = d.markers.release ?? 0;
        if (an.name !== 'runthrow' || this.runThrowT < 0.25) {
          an.play('runthrow', { restart: true, rate: this.strideRate('runthrow', Math.abs(b.vx), PARAMS.runSpeed) });
          an.update(Math.max(0, rel - 1) / d.fps / Math.max(0.35, an.rate));
        }
        this.runThrowT = 0.45;
      }
      return;
    }
    if (aim === 'low') {
      if (!an.has('crouchthrow') || !b.onGround) return;
      const d = an.defs.crouchthrow!, rel = d.markers.release ?? 0;
      this.act = 'throw'; this.airThrow = false;
      an.play('crouchthrow', { restart: true, from: Math.max(0, rel - 1), rate: THROW.rate, onEnd: () => { if (this.act === 'throw') this.act = 'move'; } });
      return;
    }
    // 斜上：有斜上投（throwdiag，10-09 接上）就用它，站著與空中共用；沒有就退回朝上丟
    const name = aim === 'diag' && an.has('throwdiag') ? 'throwdiag'
      : (aim === 'up' || aim === 'diag') && an.has('throwup') ? 'throwup' : !b.onGround && an.has('airthrow') ? 'airthrow' : 'throw';
    if (!an.has(name)) return;
    const d = an.defs[name]!, rel = d.markers.release ?? 0;
    this.act = 'throw'; this.airThrow = !b.onGround;
    const to = name === 'airthrow' && d.markers.land !== undefined ? d.markers.land - 1 : undefined;
    an.play(name, { restart: true, from: Math.max(0, rel - 1), ...(to !== undefined ? { to } : {}), rate: THROW.rate, onEnd: () => { if (this.act === 'throw' && b.onGround) this.act = 'move'; } });
  }

  private throwSub(f: Frame, w: World): void {
    if (this.subCd > 0) return;
    const kind = this.arsenal.useSub();
    if (!kind) return;
    this.subCd = 0.35;
    const b = this.body;
    const dir = (f.right ? 1 : 0) - (f.left ? 1 : 0);
    w.throwSub(kind, b.x + b.facing * 60, b.y - 130, b.facing, b.vx, f.up ? (dir !== 0 ? 'diag' : 'up') : 'fwd');
  }

  private startClaw(): void {
    this.act = 'claw'; this.clawHit.clear();
    this.anim.play('claw', { restart: true, from: CLAW.from, rate: CLAW.rate, onEnd: () => { this.act = 'move'; } });
  }

  private actStep(dt: number, w: World): void {
    const an = this.anim;
    if (this.act === 'claw') {
      const hit = an.def?.markers.hit ?? 0;
      an.rate = an.frame >= hit + CLAW.recoverAfter ? CLAW.recoverRate : CLAW.rate;
      if (an.frame >= hit + CLAW.win[0] && an.frame <= hit + CLAW.win[1]) {
        const b = this.body;
        const x0 = b.x + b.facing * CLAW.reach[0], x1 = b.x + b.facing * CLAW.reach[1];
        w.clawHits({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: b.y - CLAW.height, y1: b.y }, b.facing, this.clawHit);
      }
    } else if (this.act === 'roll') {
      this.rollT += dt;
      if (this.rollT >= ROLL.time) this.endRoll();
    } else if (this.act === 'dash' || this.act === 'hurt') {
      this.actT -= dt;
      if (this.actT <= 0) {
        this.act = 'move';
        this.body.vx = Math.sign(this.body.vx) * Math.min(Math.abs(this.body.vx), PARAMS.runSpeed);
      }
    }
  }

  private cancellable(): boolean {
    const an = this.anim, m = an.def?.markers;
    if (this.act === 'claw') return an.frame >= (m?.hit ?? 0) + CLAW.cancelAfter;
    if (this.act === 'throw') return an.frame >= (m?.release ?? 0) + THROW.cancelAfter;
    if (this.act === 'roll') return this.rollT >= ROLL.time - ROLL.cancel;
    return false;
  }

  private tryStart(kind: 'claw' | 'dash', w: World): boolean {
    const b = this.body, an = this.anim;
    if (kind === 'claw') {
      if (!b.onGround || !an.has('claw') || !w.meleeTarget(b.x, b.y, b.facing)) return false;
      this.startClaw();
      return true;
    }
    if (!an.has('dash') || this.dashCd > 0 || (!b.onGround && this.airDashUsed)) return false;
    if (b.onGround) { this.startRoll(w); return true; }
    const d = an.defs.dash!, go = d.markers.go ?? 0, stop = d.markers.stop ?? d.frames.length - 1;
    this.act = 'dash';
    this.actT = Math.min(DASH_MAX, Math.max(DASH_MIN, (stop - go) / d.fps));
    this.invincible = Math.max(this.invincible, DASH_IFRAMES);
    this.dashCd = this.actT + DASH_COOLDOWN;
    if (!b.onGround) this.airDashUsed = true;
    b.vx = b.facing * DASH_SPEED;
    an.play('dash', { restart: true, from: go, to: stop, rate: (stop - go) / d.fps / this.actT });
    w.dust(b.x, b.y, 6, -b.facing);
    return true;
  }

  /**
   * 翻滾：翻滾動作圖還沒生，暫用衝刺（dash）動作的衝出去那段代替（docs/2026-09-28_待生Vids片段.md）。
   * 無敵不用 invincible（那會連出招判定、抓人都擋掉、還會一閃一閃），由 world 看 rollSafe()。
   */
  private startRoll(w: World): void {
    const b = this.body, an = this.anim;
    this.act = 'roll'; this.rollT = 0;
    this.dashCd = ROLL.time + ROLL.cooldown;
    b.vx = b.facing * ROLL.speed;
    if (an.has('roll')) {
      // 專屬翻滾動作（10-09 接上）：整段照翻滾時間播完
      const r = an.defs.roll!;
      an.play('roll', { restart: true, rate: r.frames.length / r.fps / ROLL.time });
    } else {
      const d = an.defs.dash!, go = d.markers.go ?? 0, stop = d.markers.stop ?? d.frames.length - 1;
      an.play('dash', { restart: true, from: go, to: stop, rate: (stop - go) / d.fps / ROLL.time });
    }
    w.dust(b.x, b.y, 6, -b.facing);
    w.event('roll', {});
  }

  private endRoll(): void {
    if (this.act !== 'roll') return;
    this.act = 'move'; this.rollT = -1;
    const b = this.body;
    if (b.onGround) b.vx = Math.sign(b.vx) * Math.min(Math.abs(b.vx), PARAMS.runSpeed);
  }

  /** 攀爬中的一步：上下爬、跳開、翻上頂、爬到底 */
  private climbStep(dt: number, f: Frame, w: World): void {
    const b = this.body;
    const r = stepClimb(b, { up: f.up, down: f.down, left: f.left, right: f.right, jumpPressed: f.jumpPressed }, dt, w.physWorld());
    if (r.jumped) { this.act = 'move'; this.relaunch = 'air'; w.event('jump', { from: 'climb' }); w.dust(b.x, b.y - 40, 4, -b.facing); this.pickMove(0, f); return; }
    if (r.topped) { this.act = 'move'; w.event('climbTop', {}); this.pickMove(0, f); return; }
    if (b.climb < 0) { this.act = 'move'; this.pickMove(0, f); return; }
    this.climbAnim(r.moving);
    if (r.moving && Math.floor((b.y) / 70) !== Math.floor((b.y - (f.up ? -1 : 1) * 230 * dt) / 70)) w.event('climbStep', {});
  }

  /** 攀爬暫代動作：朝上丟手舉直那幾格（沒有朝上丟就用跳躍最高點那格） */
  private climbAnim(moving: boolean): void {
    const an = this.anim;
    if (an.has('climb')) {
      an.play('climb');
      an.rate = moving ? 1 : 0;
      return;
    }
    if (an.has('throwup')) {
      const rel = an.defs.throwup!.markers.release ?? 15, a = rel + CLIMB_FRAMES[0], z = rel + CLIMB_FRAMES[1];
      if (an.name !== 'throwup' || an.pos < a || an.pos > z) an.play('throwup', { from: a, to: z, restart: true, rate: 0.8 });
      an.rate = moving ? 0.8 : 0;
      if (an.pos >= z - 0.05 && moving) an.play('throwup', { from: a, to: z, restart: true, rate: 0.8 });
      return;
    }
    const k = this.jumpMarks().apex;
    an.play('jump', { from: k, to: k });
  }

  private startLand(): void {
    this.act = 'land';
    this.anim.play('jump', { from: this.jumpMarks().land, rate: LAND_RATE, restart: true, onEnd: () => { if (this.act === 'land') this.act = 'move'; } });
  }

  private pickMove(dir: number, f: Frame): void {
    const b = this.body, an = this.anim;
    if (!b.onGround) { this.pickAir(); return; }
    const speed = Math.abs(b.vx);
    if (f.down && an.has('crouch')) {
      if (dir !== 0 && an.has('crouchwalk')) { an.play('crouchwalk', { rate: this.strideRate('crouchwalk', speed, CROUCH.runSpeed) }); return; }
      if (an.name !== 'crouch') an.play('crouch', { from: an.name === 'crouchwalk' ? an.defs.crouch!.frames.length - 1 : 0 });
      return;
    }
    if (dir !== 0 && f.walk && an.has('walk')) { an.play('walk', { rate: this.strideRate('walk', speed, WALK.runSpeed) }); return; }
    if ((dir !== 0 || speed > 60) && this.runThrowT > 0 && an.name === 'runthrow') { an.play('runthrow', { rate: this.strideRate('runthrow', speed, PARAMS.runSpeed) }); return; }
    if (dir !== 0 || speed > 60) { an.play('run', { rate: this.strideRate('run', speed, PARAMS.runSpeed) }); return; }
    an.play('idle', { rate: 1 });
  }

  private pickAir(): void {
    const b = this.body, an = this.anim;
    if (!an.has('jump')) { an.play(AIR_FALLBACK.anim, { from: AIR_FALLBACK.frame, to: AIR_FALLBACK.frame }); return; }
    const { takeoff, apex, land } = this.jumpMarks();
    // 二段跳、蹬牆跳：空翻一圈（沒有空翻就把上升段從頭再播一次，見檔頭 WALL_FRAME 那段）
    if (this.relaunch) {
      const kind = this.relaunch === 'wall' && an.has('wallkick') ? 'wallkick' : an.has('airflip') ? 'airflip' : '';
      this.relaunch = false;
      if (kind) { const d = an.defs[kind]!; an.play(kind, { restart: true, rate: d.frames.length / d.fps / (kind === 'wallkick' ? WALLKICK_TIME : AIRFLIP_TIME) }); }
      else an.play('jump', { from: takeoff, to: apex - 1, restart: true });
    }
    // 貼牆下滑：有循環就播循環，沒有就停在下落段的一格
    if (b.sliding) {
      if (an.has('wallslide')) { an.play('wallslide', { rate: 1 }); return; }
      const k = Math.min(land - 1, Math.max(apex, WALL_FRAME)); an.play('jump', { from: k, to: k, rate: 1 }); return;
    }
    // 空翻還沒翻完：翻完為止；翻完了還在往上，就停在最後一格（張開的姿勢）等開始掉
    if ((an.name === 'airflip' || an.name === 'wallkick') && (!an.done || b.vy < 0)) return;
    // 往下掉：空翻接下落循環（同一支影片翻完的姿勢，接得上）；跳躍的下落段播完還在掉，也接下落循環
    if (b.vy >= 0 && an.has('fall')) {
      if (an.name === 'fall') return;
      if (an.name === 'airflip' || an.name === 'wallkick' || an.name === 'wallslide' || an.name === 'climb') { an.play('fall', { rate: 1 }); return; }
      if (an.name === 'jump' && an.pos >= apex) { if (an.done) an.play('fall', { rate: 1 }); return; }
      an.play('jump', { from: apex, to: land - 1, rate: 1 });
      return;
    }
    if (b.vy < 0) {
      // 上升段剛好在最高點播完：剩幾格 ÷ 還要升幾秒
      an.play('jump', { from: takeoff, to: apex - 1 });
      const left = apex - an.pos, t = -b.vy / PARAMS.gravity;
      an.rate = Math.min(4, Math.max(0.3, left / Math.max(t, 1e-3) / an.defs.jump!.fps));
    } else {
      an.play('jump', { from: apex, to: land - 1, rate: 1 });
    }
  }

  /** 跳躍影片切段：anims.json 的 air（離地）、land（落地）標記；沒有最高點標記就取兩者中間 */
  private jumpMarks(): { takeoff: number; apex: number; land: number } {
    const d = this.anim.defs.jump!, n = d.frames.length, m = d.markers;
    const takeoff = Math.max(0, Math.min(n - 3, m.takeoff ?? m.air ?? Math.round(n * JUMP_SPLIT.takeoff)));
    const land = Math.min(n - 1, Math.max(takeoff + 2, m.land ?? Math.round(n * JUMP_SPLIT.land)));
    const apex = Math.min(land - 1, Math.max(takeoff + 1, m.apex ?? Math.round((takeoff + land) / 2)));
    return { takeoff, apex, land };
  }

  private strideRate(name: string, speed: number, max: number): number {
    const px = TREAD_PX[name], d = this.anim.defs[name];
    const r = px && d ? speed / (px * SCALE * d.fps) : speed / max;
    return Math.max(0.35, r);
  }

  // ───────────── 被打、倒下、重生（world 叫） ─────────────

  /** 被打：往 pushDir 彈開、小跳一下；有 hurt 動作就播（加速），沒有就定格 */
  hurt(pushDir: 1 | -1): void {
    const an = this.anim;
    if (this.body.climb >= 0) releaseClimb(this.body, 0.6);
    this.act = 'hurt'; this.queued = null;
    this.actT = an.has('hurt') ? Math.min(HURT_MAX, an.duration('hurt', HURT_RATE)) : 0.4;
    this.invincible = HURT_IFRAMES;
    this.body.vx = pushDir * 300;
    if (this.body.onGround) { this.body.vy = -320; this.body.onGround = false; }
    this.body.facing = pushDir > 0 ? -1 : 1;
    if (!an.play('hurt', { restart: true, rate: HURT_RATE })) an.rate = 0;
  }

  /** 倒下：有 down 動作就播到最後一格停住；沒有就把目前這格慢慢放倒（render 看 downT） */
  knockDown(): void {
    this.act = 'down'; this.queued = null; this.downT = 0;
    this.body.vx = 0;
    if (!this.anim.play('down', { restart: true, rate: DOWN_RATE })) this.anim.rate = 0;
  }

  /** 重生：從畫面上方掉下來，血補滿、無敵一陣子 */
  respawn(x: number, y: number): void {
    this.body = newBody(x, y);
    this.body.onGround = false;
    this.hp = MAX_HP;
    this.act = 'move'; this.queued = null; this.downT = 0;
    this.invincible = RESPAWN_IFRAMES;
    this.dropping = true;
    this.feel.reset();
    this.anim.play('idle', { restart: true });
  }
}
