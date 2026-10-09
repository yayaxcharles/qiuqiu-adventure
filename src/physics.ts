/**
 * 球球的移動與跳躍（純函式，不碰畫面，測試直接餵）。座標：x 往右、y 往下，(x, y) 是腳底。
 *
 * 讓平台跳躍「手感好」的幾個老技巧都在這裡：
 *   - 按住跳得高、一放開就截斷上升（`jumpCut`）
 *   - 踩出平台邊緣之後的一小段時間還能跳（`coyote`，土狼時間）
 *   - 落地前一小段時間按的跳會先記著，一落地就跳（`buffer`）
 *   - 下落比上升重一點（`fallMul`），跳起來比較俐落、不飄
 *
 * 第二版（規劃 5.2～5.5）加的：
 *   - 二段跳：空中再按跳（落地、蹬牆、抓到藤蔓補回）；快落地時按的跳照舊記著、落地才跳（不會浪費成二段跳）
 *   - 貼牆下滑＋蹬牆跳：空中貼著高牆（地形落差 ≥ 120 或實心方塊的側面）往下掉最快 240；按跳往反方向蹬出去
 *   - 實心方塊（solids）：上面能站、左右是牆、下面撞頭
 *   - 陡坡：上坡變慢、下坡變快（只管比約 21 度陡的坡，舊關卡的坡最陡 20.4 度，手感不變）
 *   - 攀爬（藤蔓、梯子、鐵鍊）：`stepClimb`，沒有重力、上下爬、到頂翻上去、按跳跳開
 */
export interface Params {
  gravity: number; fallMul: number; maxFall: number;
  runSpeed: number; accelGround: number; decelGround: number; accelAir: number;
  jumpVel: number; jumpCut: number; coyote: number; buffer: number;
  /** 二段跳初速、一次落地前能空中跳幾次 */
  airJumpVel: number; airJumps: number;
  /** 貼牆下滑最快多少；蹬牆跳水平、往上初速；蹬完幾秒內按回牆那邊無效；離牆幾秒內按跳還算蹬牆；多高的地形落差算牆 */
  wallSlide: number; wallJumpVx: number; wallJumpVy: number; wallLock: number; wallGrace: number; wallMinH: number;
  /** 陡坡：上坡最高速 ×(1 − slopeUp × 坡度正弦)、下坡 ×slopeDown；坡度（每像素高低差）超過 slopeMin 才算 */
  slopeUp: number; slopeDown: number; slopeMin: number;
  /** 攀爬：往上、往下爬的速度；跳開的水平、往上初速 */
  climbUp: number; climbDown: number; climbJumpVx: number; climbJumpVy: number;
}
export const PARAMS: Params = {
  gravity: 2600, fallMul: 1.35, maxFall: 1500,
  runSpeed: 340, accelGround: 2800, decelGround: 3200, accelAir: 1700,
  jumpVel: 960, jumpCut: 0.45, coyote: 0.1, buffer: 0.12,
  airJumpVel: 820, airJumps: 1,
  wallSlide: 240, wallJumpVx: 560, wallJumpVy: 900, wallLock: 0.15, wallGrace: 0.1, wallMinH: 120,
  // slopeMin 0.38（約 21 度）：舊關卡最陡的坡 20.4 度（第三關 16,670）不受影響，手感、自動玩數字照舊；第二版新的陡坡（實際畫 22～32 度）才算
  slopeUp: 0.35, slopeDown: 1.1, slopeMin: 0.38,
  climbUp: 230, climbDown: 300, climbJumpVx: 360, climbJumpVy: 700,
};

/** 身體（撞實心方塊、貼牆用）：腳底往左右各 BODY_HW、往上 BODY_H */
export const BODY_HW = 22, BODY_H = 150;

export interface Body {
  x: number; y: number; vx: number; vy: number;
  onGround: boolean;
  /** 還剩多少土狼時間（離地後倒數） */
  coyote: number;
  /** 還記著多久的跳（按下後倒數） */
  buffer: number;
  /** 這次跳躍還沒被放開截斷過 */
  rising: boolean;
  facing: 1 | -1;
  /** 還剩幾次空中跳（二段跳） */
  airJumps: number;
  /** 現在貼著哪一邊的牆（-1 左、1 右、0 沒有；只在空中算） */
  wall: -1 | 0 | 1;
  /** 正在貼牆下滑（空中、往下掉、按著朝牆的方向） */
  sliding: boolean;
  /** 離牆寬限還剩幾秒、最後貼的是哪一邊 */
  wallT: number; wallSide: -1 | 0 | 1;
  /** 蹬牆後鎖方向還剩幾秒（這段時間按回 lockDir 那邊無效） */
  lockT: number; lockDir: -1 | 0 | 1;
  /** 抓著第幾條攀爬物（-1＝沒抓）；跳開後幾秒內不會馬上又抓回去 */
  climb: number; regrab: number;
}
export interface Ctrl { left: boolean; right: boolean; jumpHeld: boolean; jumpPressed: boolean }
/** 單向平台：只從上面踩得上去，從下面跳得穿過 */
export interface Platform { x: number; y: number; w: number }
/** 實心方塊：上面能站、左右是牆、下面撞頭（x, y＝左上角） */
export interface Solid { x: number; y: number; w: number; h: number }
/** 攀爬物（藤蔓、梯子、鐵鍊）：中心 x，腳能到的範圍 top～bottom（top 通常就是上面那層地面／平台的高度） */
export interface Climb { x: number; top: number; bottom: number }
export interface World {
  ground: number; minX: number; maxX: number; platforms: readonly Platform[];
  /**
   * 有高低的地形（2026-09-26 使用者：「場景可以有高低，參照越南大戰」）：傳回 x 這一點的地面高度，坑＝Infinity。
   * 沒給就是一整條平線 `ground`（原本的手感測試走這條，行為一模一樣）。
   */
  groundAt?: (x: number) => number;
  solids?: readonly Solid[];
  climbs?: readonly Climb[];
}

/** 台階：前面的地面比腳高 STEP_UP 以內就直接踩上去（樓梯、小坎）；再高就是牆，要跳上去 */
export const STEP_UP = 34;
/** 下坡：地面比腳低這麼多以內就貼著地走（不會變成一小段一小段往下掉、動作一直切成空中） */
export const SNAP_DOWN = 10;
/** 攀爬物左右抓得到的範圍（身體中心離攀爬物中心） */
export const CLIMB_REACH = 34;

export function newBody(x: number, y: number): Body {
  return {
    x, y, vx: 0, vy: 0, onGround: true, coyote: 0, buffer: 0, rising: false, facing: 1,
    airJumps: PARAMS.airJumps, wall: 0, sliding: false, wallT: 0, wallSide: 0, lockT: 0, lockDir: 0, climb: -1, regrab: 0,
  };
}

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

const groundOf = (w: World, x: number): number => (w.groundAt ? w.groundAt(x) : w.ground);

/** x 處地面的坡度（每往右 1 像素，地面往下幾像素；上坡往右＝負）；坑邊、落差、台階、坡頂坡底轉折處回傳 0 */
export function slopeAt(w: World, x: number): number {
  if (!w.groundAt) return 0;
  const a = w.groundAt(x - 6), m = w.groundAt(x), b = w.groundAt(x + 6);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(m)) return 0;
  // 兩半的斜率要差不多：台階、落差（一邊平一邊垂直）不算坡
  const k1 = (m - a) / 6, k2 = (b - m) / 6;
  if (Math.abs(k1 - k2) > 0.15) return 0;
  return (k1 + k2) / 2;
}

/** 腳底往下最近的地面、平台、方塊頂離多遠（找不到＝Infinity） */
function floorDist(b: Body, w: World): number {
  let d = groundOf(w, b.x) - b.y;
  if (d < -0.5) d = Infinity;
  for (const pl of w.platforms) if (b.x >= pl.x && b.x <= pl.x + pl.w && pl.y >= b.y - 0.5) d = Math.min(d, pl.y - b.y);
  for (const s of w.solids ?? []) if (b.x + BODY_HW > s.x && b.x - BODY_HW < s.x + s.w && s.y >= b.y - 0.5) d = Math.min(d, s.y - b.y);
  return d;
}

/** 空中貼著哪一邊的牆：實心方塊的側面、或夠高的地形落差（崖壁、坑壁） */
export function wallContact(b: Body, w: World, p: Params = PARAMS): -1 | 0 | 1 {
  for (const d of [1, -1] as const) {
    for (const s of w.solids ?? []) {
      if (!(b.y - BODY_H < s.y + s.h && b.y > s.y + 20)) continue;
      const gap = d > 0 ? s.x - (b.x + BODY_HW) : (b.x - BODY_HW) - (s.x + s.w);
      if (gap >= -1 && gap <= 4) return d;
    }
    if (w.groundAt) {
      const g2 = w.groundAt(b.x + d * 6), g0 = w.groundAt(b.x);
      if (Number.isFinite(g2) && g2 < b.y - 60 && g2 <= g0 - p.wallMinH) return d;
    }
  }
  return 0;
}

/**
 * 貼著的那面牆的牆面在哪（x）：給畫面用（2026-10-09 貼牆下滑時手掌插進牆裡）。d＝牆在哪一邊。
 * 實心方塊取側面；地形落差從身體往牆那邊一像素一像素找，第一個「地面高過腰」的位置。找不到回 null。
 */
export function wallFaceX(b: Body, w: World, d: -1 | 1): number | null {
  for (const s of w.solids ?? []) {
    if (!(b.y - BODY_H < s.y + s.h && b.y > s.y + 20)) continue;
    const face = d > 0 ? s.x : s.x + s.w;
    const gap = d > 0 ? face - (b.x + BODY_HW) : (b.x - BODY_HW) - face;
    if (gap >= -1 && gap <= 4) return face;
  }
  if (w.groundAt) {
    for (let k = 0; k <= 40; k++) {
      const g = w.groundAt(b.x + d * k);
      if (Number.isFinite(g) && g < b.y - 60) return b.x + d * k;
    }
  }
  return null;
}

export interface StepResult { jumped: boolean; landed: boolean; airJumped: boolean; wallJumped: boolean; bumped: boolean; fallSpeed: number }

/** 走一步；回傳這一步有沒有起跳、落地、二段跳、蹬牆跳、撞頭（fallSpeed＝落地那一下的下落速度） */
export function stepBody(b: Body, c: Ctrl, dt: number, w: World, p: Params = PARAMS): StepResult {
  let jumped = false, landed = false, airJumped = false, wallJumped = false, bumped = false, fallSpeed = 0;
  let dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  b.regrab = Math.max(0, b.regrab - dt);
  // 蹬牆後一小段時間：按回牆那邊無效（不然會馬上黏回牆），也不減速（保住蹬出去的水平速度）
  let locked = false;
  if (b.lockT > 0) {
    b.lockT = Math.max(0, b.lockT - dt);
    if (b.onGround) b.lockT = 0;
    else if (dir === b.lockDir || dir === 0) { dir = 0; locked = true; }
  }
  if (dir !== 0) b.facing = dir > 0 ? 1 : -1;
  let top = p.runSpeed;
  // 陡坡：上坡變慢、下坡變快（在平台、方塊上不算）
  if (b.onGround && dir !== 0 && Math.abs(b.y - groundOf(w, b.x)) < 1) {
    const k = slopeAt(w, b.x);
    if (Math.abs(k) > p.slopeMin) top *= k * dir < 0 ? 1 - p.slopeUp * Math.abs(k) / Math.hypot(1, k) : p.slopeDown;
  }
  const accel = b.onGround ? (dir !== 0 ? p.accelGround : p.decelGround) : p.accelAir;
  if (!locked) b.vx = approach(b.vx, dir * top, accel * dt);

  b.coyote = b.onGround ? p.coyote : Math.max(0, b.coyote - dt);
  b.buffer = c.jumpPressed ? p.buffer : Math.max(0, b.buffer - dt);
  if (b.onGround) { b.airJumps = p.airJumps; b.wallT = 0; }
  b.wall = b.onGround ? 0 : wallContact(b, w, p);
  if (b.wall !== 0) { b.wallT = p.wallGrace; b.wallSide = b.wall; } else b.wallT = Math.max(0, b.wallT - dt);

  if (b.buffer > 0 && b.coyote > 0) {
    b.vy = -p.jumpVel;
    b.onGround = false; b.coyote = 0; b.buffer = 0; b.rising = true;
    jumped = true;
  } else if (b.buffer > 0 && !b.onGround && b.wallT > 0 && b.wallSide !== 0) {
    // 蹬牆跳：往離開牆的方向蹬出去、往上；二段跳補回
    const away = -b.wallSide as -1 | 1;
    b.vx = away * p.wallJumpVx; b.vy = -p.wallJumpVy;
    b.facing = away; b.lockT = p.wallLock; b.lockDir = b.wallSide;
    b.buffer = 0; b.wallT = 0; b.wall = 0; b.rising = true; b.airJumps = p.airJumps;
    wallJumped = true;
  } else if (c.jumpPressed && !b.onGround && b.airJumps > 0 && !(b.vy > 0 && floorDist(b, w) <= b.vy * p.buffer + 2)) {
    // 二段跳（快落地時按的不算：留給落地那一下的一般跳，見 buffer）
    b.vy = -p.airJumpVel; b.airJumps--; b.buffer = 0; b.rising = true;
    airJumped = true;
  }
  if (b.rising && !c.jumpHeld && b.vy < 0) { b.vy *= p.jumpCut; b.rising = false; }
  if (b.vy >= 0) b.rising = false;

  b.vy = Math.min(p.maxFall, b.vy + p.gravity * (b.vy > 0 ? p.fallMul : 1) * dt);
  // 貼牆下滑：往下掉、按著朝牆的方向
  b.sliding = !b.onGround && b.wall !== 0 && dir === b.wall && b.vy > 0;
  if (b.sliding && b.vy > p.wallSlide) b.vy = p.wallSlide;

  const prevY = b.y;
  let nx = Math.min(w.maxX, Math.max(w.minX, b.x + b.vx * dt));
  // 牆（斷崖的崖壁、坑的側壁）：前面的地面比腳高出 STEP_UP 以上就擋在牆前面
  if (w.groundAt && nx !== b.x && w.groundAt(nx) < b.y - STEP_UP) {
    nx = wallStop(w.groundAt, b.x, nx, b.y);
    b.vx = 0;
  }
  // 實心方塊的側面：身體撞上去就停在面前；站在地上、方塊頂只比腳高一點點（台階）就直接踩上去
  for (const s of w.solids ?? []) {
    if (!(b.y > s.y + 0.5 && b.y - BODY_H < s.y + s.h)) continue;
    const into = nx > b.x ? (b.x + BODY_HW <= s.x + 0.5 && nx + BODY_HW > s.x) : nx < b.x ? (b.x - BODY_HW >= s.x + s.w - 0.5 && nx - BODY_HW < s.x + s.w) : false;
    if (!into) continue;
    if (b.onGround && s.y >= b.y - STEP_UP) { b.y = s.y; continue; }
    nx = nx > b.x ? s.x - BODY_HW : s.x + s.w + BODY_HW;
    b.vx = 0;
  }
  b.x = nx;
  b.y += b.vy * dt;
  // 撞頭：往上時頭頂穿過方塊底面
  if (b.vy < 0) {
    for (const s of w.solids ?? []) {
      if (b.x + BODY_HW > s.x && b.x - BODY_HW < s.x + s.w && prevY - BODY_H >= s.y + s.h - 0.5 && b.y - BODY_H < s.y + s.h) {
        b.y = s.y + s.h + BODY_H; b.vy = 0; b.rising = false; bumped = true;
      }
    }
  }

  // 落地：地面，或從上方穿過單向平台、方塊的頂面
  let floor: number | null = null;
  const g = groundOf(w, b.x);
  if (b.y >= g) floor = g;
  // 下坡、下樓梯貼地：本來站在地上、地面只比腳低 STEP_UP 以內就直接踩下去（跟上樓梯對稱，跑步動作不會一階一階切成空中）
  else if (w.groundAt && b.onGround && b.vy >= 0 && g - b.y <= Math.max(STEP_UP, SNAP_DOWN + Math.abs(b.vx) * dt)) floor = g;
  if (b.vy >= 0) {
    for (const pl of w.platforms) {
      if (b.x >= pl.x && b.x <= pl.x + pl.w && prevY <= pl.y + 0.01 && b.y >= pl.y && (floor === null || pl.y < floor)) floor = pl.y;
    }
    for (const s of w.solids ?? []) {
      if (b.x + BODY_HW > s.x && b.x - BODY_HW < s.x + s.w && prevY <= s.y + 0.01 && b.y >= s.y && (floor === null || s.y < floor)) floor = s.y;
    }
  }
  if (floor !== null) {
    if (!b.onGround) { landed = true; fallSpeed = b.vy; }
    b.y = floor;
    b.onGround = true; b.vy = 0; b.airJumps = p.airJumps; b.sliding = false; b.wall = 0; b.lockT = 0;
  } else if (b.onGround) {
    // 走出平台邊緣：開始掉（土狼時間從下一步開始倒數）
    const standing = b.y >= g - 0.01 || w.platforms.some((pl) => Math.abs(b.y - pl.y) < 0.01 && b.x >= pl.x && b.x <= pl.x + pl.w)
      || (w.solids ?? []).some((s) => Math.abs(b.y - s.y) < 0.01 && b.x + BODY_HW > s.x && b.x - BODY_HW < s.x + s.w);
    if (!standing) b.onGround = false;
  }
  return { jumped, landed, airJumped, wallJumped, bumped, fallSpeed };
}

// ───────────── 攀爬 ─────────────

export interface ClimbCtrl { up: boolean; down: boolean; left: boolean; right: boolean; jumpPressed: boolean }

/** 身體在哪一條攀爬物的範圍裡、按 ↑ 抓得住（站在頂端按 ↓ 也抓得住，往下爬）；沒有＝-1 */
export function findClimb(b: Body, w: World, c: ClimbCtrl): number {
  if (b.regrab > 0 || !w.climbs) return -1;
  for (let i = 0; i < w.climbs.length; i++) {
    const cl = w.climbs[i]!;
    if (Math.abs(b.x - cl.x) > CLIMB_REACH) continue;
    if (c.up && b.y > cl.top + 4 && b.y <= cl.bottom + 2) return i;
    if (c.down && b.onGround && Math.abs(b.y - cl.top) < 6) return i;
  }
  return -1;
}

/** 開始抓：身體對齊攀爬物、停住、二段跳補回 */
export function grabClimb(b: Body, i: number, w: World, p: Params = PARAMS): void {
  const cl = w.climbs![i]!;
  b.climb = i; b.x = cl.x; b.vx = 0; b.vy = 0; b.onGround = false; b.airJumps = p.airJumps;
  b.sliding = false; b.wall = 0; b.lockT = 0; b.coyote = 0; b.buffer = 0;
  if (b.y < cl.top + 6) b.y = cl.top + 6;
  if (b.y > cl.bottom) b.y = cl.bottom;
}

/** 放開攀爬物（被打、跳開、爬到底） */
export function releaseClimb(b: Body, regrab = 0.25): void { b.climb = -1; b.regrab = regrab; }

/**
 * 抓著的時候走一步：沒有重力，↑↓ 上下爬；按跳往旁邊跳開；爬到頂端那層有地方站就翻上去；爬到底有地就落地、沒地就放手掉下去。
 * 回傳：這一步 jumped（跳開）、topped（翻上去）、dropped（從底下放手）、moving（有在爬）
 */
export function stepClimb(b: Body, c: ClimbCtrl, dt: number, w: World, p: Params = PARAMS): { jumped: boolean; topped: boolean; dropped: boolean; moving: boolean } {
  const cl = w.climbs?.[b.climb];
  if (!cl) { b.climb = -1; return { jumped: false, topped: false, dropped: false, moving: false }; }
  const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  if (dir !== 0) b.facing = dir > 0 ? 1 : -1;
  if (c.jumpPressed) {
    const d = dir !== 0 ? dir : b.facing;
    b.vx = d * p.climbJumpVx; b.vy = -p.climbJumpVy; b.rising = true; b.facing = d > 0 ? 1 : -1;
    releaseClimb(b);
    return { jumped: true, topped: false, dropped: false, moving: false };
  }
  const v = c.up && !c.down ? -p.climbUp : c.down && !c.up ? p.climbDown : 0;
  b.vx = 0; b.vy = 0; b.x = cl.x;
  b.y += v * dt;
  if (b.y <= cl.top) {
    // 到頂：旁邊（面向那邊優先）有地面、平台、方塊頂在 top 附近就站上去
    const floorNear = (x: number): number | null => {
      const g = groundOf(w, x);
      if (Math.abs(g - cl.top) < 20) return g;
      for (const pl of w.platforms) if (x >= pl.x && x <= pl.x + pl.w && Math.abs(pl.y - cl.top) < 20) return pl.y;
      for (const s of w.solids ?? []) if (x + BODY_HW > s.x && x - BODY_HW < s.x + s.w && Math.abs(s.y - cl.top) < 20) return s.y;
      return null;
    };
    for (const dx of [0, b.facing * 40, -b.facing * 40]) {
      const f = floorNear(cl.x + dx);
      if (f !== null) {
        b.x = cl.x + dx; b.y = f; b.onGround = true; releaseClimb(b, 0.35);
        return { jumped: false, topped: true, dropped: false, moving: false };
      }
    }
    b.y = cl.top;
  }
  if (b.y >= cl.bottom && v > 0) {
    b.y = cl.bottom;
    const g = floorDist(b, w);
    releaseClimb(b, 0.35);
    if (g < 3) { b.y += g; b.onGround = true; }
    return { jumped: false, topped: false, dropped: !(g < 3), moving: false };
  }
  return { jumped: false, topped: false, dropped: false, moving: v !== 0 };
}

/** 從 x0 往 x1 走，找到撞牆的位置（地面突然比腳高出 STEP_UP 的那一點），停在牆前 */
/**
 * 從旁邊把身體推到 nx（被敵人撞開、被風吹、被吸過去）：碰到地形的牆、方塊的側面就停在面前，不會被推進去。
 * 2026-10-10：撞開改成直接設位置之後，球球被老鼠推進第一關瀑布段的岩塊裡（手裏劍一丟就打到岩塊，卡關）
 */
export function shoveTo(b: Body, nx: number, w: World): number {
  if (nx === b.x) return nx;
  let x = nx;
  if (groundOf(w, x) < b.y - STEP_UP) x = wallStop((gx) => groundOf(w, gx), b.x, x, b.y);
  for (const s of w.solids ?? []) {
    if (!(b.y > s.y + 0.5 && b.y - BODY_H < s.y + s.h)) continue;
    if (x > b.x && b.x + BODY_HW <= s.x + 0.5 && x + BODY_HW > s.x) x = s.x - BODY_HW;
    else if (x < b.x && b.x - BODY_HW >= s.x + s.w - 0.5 && x - BODY_HW < s.x + s.w) x = s.x + s.w + BODY_HW;
  }
  return x;
}

function wallStop(groundAt: (x: number) => number, x0: number, x1: number, feet: number): number {
  let ok = x0, bad = x1;
  for (let i = 0; i < 14; i++) {
    const mid = (ok + bad) / 2;
    if (groundAt(mid) < feet - STEP_UP) bad = mid; else ok = mid;
  }
  return ok;
}
