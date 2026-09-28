/**
 * 球球的移動與跳躍（純函式，不碰畫面，測試直接餵）。座標：x 往右、y 往下，(x, y) 是腳底。
 *
 * 讓平台跳躍「手感好」的幾個老技巧都在這裡：
 *   - 按住跳得高、一放開就截斷上升（`jumpCut`）
 *   - 踩出平台邊緣之後的一小段時間還能跳（`coyote`，土狼時間）
 *   - 落地前一小段時間按的跳會先記著，一落地就跳（`buffer`）
 *   - 下落比上升重一點（`fallMul`），跳起來比較俐落、不飄
 */
export interface Params {
  gravity: number; fallMul: number; maxFall: number;
  runSpeed: number; accelGround: number; decelGround: number; accelAir: number;
  jumpVel: number; jumpCut: number; coyote: number; buffer: number;
}
export const PARAMS: Params = {
  gravity: 2600, fallMul: 1.35, maxFall: 1500,
  runSpeed: 340, accelGround: 2800, decelGround: 3200, accelAir: 1700,
  jumpVel: 960, jumpCut: 0.45, coyote: 0.1, buffer: 0.12,
};

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
}
export interface Ctrl { left: boolean; right: boolean; jumpHeld: boolean; jumpPressed: boolean }
/** 單向平台：只從上面踩得上去，從下面跳得穿過 */
export interface Platform { x: number; y: number; w: number }
export interface World {
  ground: number; minX: number; maxX: number; platforms: readonly Platform[];
  /**
   * 有高低的地形（2026-09-26 使用者：「場景可以有高低，參照越南大戰」）：傳回 x 這一點的地面高度，坑＝Infinity。
   * 沒給就是一整條平線 `ground`（原本的手感測試走這條，行為一模一樣）。
   */
  groundAt?: (x: number) => number;
}

/** 台階：前面的地面比腳高 STEP_UP 以內就直接踩上去（樓梯、小坎）；再高就是牆，要跳上去 */
export const STEP_UP = 34;
/** 下坡：地面比腳低這麼多以內就貼著地走（不會變成一小段一小段往下掉、動作一直切成空中） */
export const SNAP_DOWN = 10;

export function newBody(x: number, y: number): Body {
  return { x, y, vx: 0, vy: 0, onGround: true, coyote: 0, buffer: 0, rising: false, facing: 1 };
}

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

/** 走一步；回傳這一步有沒有起跳、落地 */
export function stepBody(b: Body, c: Ctrl, dt: number, w: World, p: Params = PARAMS): { jumped: boolean; landed: boolean } {
  let jumped = false, landed = false;
  const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  if (dir !== 0) b.facing = dir > 0 ? 1 : -1;
  const accel = b.onGround ? (dir !== 0 ? p.accelGround : p.decelGround) : p.accelAir;
  b.vx = approach(b.vx, dir * p.runSpeed, accel * dt);

  b.coyote = b.onGround ? p.coyote : Math.max(0, b.coyote - dt);
  b.buffer = c.jumpPressed ? p.buffer : Math.max(0, b.buffer - dt);
  if (b.buffer > 0 && b.coyote > 0) {
    b.vy = -p.jumpVel;
    b.onGround = false; b.coyote = 0; b.buffer = 0; b.rising = true;
    jumped = true;
  }
  if (b.rising && !c.jumpHeld && b.vy < 0) { b.vy *= p.jumpCut; b.rising = false; }
  if (b.vy >= 0) b.rising = false;

  b.vy = Math.min(p.maxFall, b.vy + p.gravity * (b.vy > 0 ? p.fallMul : 1) * dt);
  const prevY = b.y;
  let nx = Math.min(w.maxX, Math.max(w.minX, b.x + b.vx * dt));
  // 牆（斷崖的崖壁、坑的側壁）：前面的地面比腳高出 STEP_UP 以上就擋在牆前面
  if (w.groundAt && nx !== b.x && w.groundAt(nx) < b.y - STEP_UP) {
    nx = wallStop(w.groundAt, b.x, nx, b.y);
    b.vx = 0;
  }
  b.x = nx;
  b.y += b.vy * dt;

  // 落地：地面，或從上方穿過單向平台的頂面
  let floor: number | null = null;
  const g = w.groundAt ? w.groundAt(b.x) : w.ground;
  if (b.y >= g) floor = g;
  // 下坡、下樓梯貼地：本來站在地上、地面只比腳低 STEP_UP 以內就直接踩下去（跟上樓梯對稱，跑步動作不會一階一階切成空中）
  else if (w.groundAt && b.onGround && b.vy >= 0 && g - b.y <= Math.max(STEP_UP, SNAP_DOWN + Math.abs(b.vx) * dt)) floor = g;
  if (b.vy >= 0) {
    for (const pl of w.platforms) {
      if (b.x >= pl.x && b.x <= pl.x + pl.w && prevY <= pl.y + 0.01 && b.y >= pl.y && (floor === null || pl.y < floor)) floor = pl.y;
    }
  }
  if (floor !== null) {
    b.y = floor;
    if (!b.onGround) landed = true;
    b.onGround = true; b.vy = 0;
  } else if (b.onGround) {
    // 走出平台邊緣：開始掉（土狼時間從下一步開始倒數）
    const standing = b.y >= g - 0.01 || w.platforms.some((pl) => Math.abs(b.y - pl.y) < 0.01 && b.x >= pl.x && b.x <= pl.x + pl.w);
    if (!standing) b.onGround = false;
  }
  return { jumped, landed };
}

/** 從 x0 往 x1 走，找到撞牆的位置（地面突然比腳高出 STEP_UP 的那一點），停在牆前 */
function wallStop(groundAt: (x: number) => number, x0: number, x1: number, feet: number): number {
  let ok = x0, bad = x1;
  for (let i = 0; i < 14; i++) {
    const mid = (ok + bad) / 2;
    if (groundAt(mid) < feet - STEP_UP) bad = mid; else ok = mid;
  }
  return ok;
}
