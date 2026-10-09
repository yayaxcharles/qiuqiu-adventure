/**
 * 角色手感（2026-10-09，使用者：「玩起來很不流暢很卡，關鍵在於角色很死板」）。
 *
 * 動作圖是 AI 影片一格一格轉出來的，節奏照影片走、跟按鍵對不上；這裡在「畫的時候」額外加三件程式做的小變形，
 * 不改動作圖、不改物理、不改判定：
 *   ① 起跳拉長、落地壓扁再彈回來（落得越重壓得越扁；變形中心在腳底，腳不會離地）
 *   ② 跑步依速度往前傾、急停時往後仰一下
 *   ③ 轉身時先把身體壓窄再翻過去（原本整張圖瞬間左右翻面）
 * 幅度刻意壓小（拉長、壓扁一成上下，傾斜三四度）：使用者看過骨架版動作說「不行」，這裡只求「有彈性」，不要變成橡皮糖。
 *
 * 開關：網址加 `?feel=old` 或按 F8 切回改版前（沒有這三件），兩邊比較用。
 */

/** 彈簧：往目標值拉、會稍微過頭再回來（臨界阻尼偏小一點，回彈一下就停） */
interface Spring { v: number; vel: number }
const K = 420, DAMP = 26;
function step(s: Spring, target: number, dt: number): void {
  const a = (target - s.v) * K - s.vel * DAMP;
  s.vel += a * dt;
  s.v += s.vel * dt;
}

export const FEEL = {
  /** 起跳那一下：縱向拉長、橫向變窄 */
  jumpStretch: 0.1,
  /** 落地壓扁的上限（重落地） */
  landSquash: 0.13,
  /** 落地速度到這麼快才壓到上限 */
  landFull: 1400,
  /** 跑到最高速時往前傾幾度 */
  leanDeg: 3.5,
  /** 急停往後仰幾度 */
  brakeDeg: 2.5,
  /** 轉身壓窄到多窄（1＝不壓） */
  turnSquash: 0.55,
} as const;

export interface FeelInput {
  dt: number;
  onGround: boolean;
  vx: number;
  vy: number;
  facing: 1 | -1;
  runSpeed: number;
  /** 按著的左右方向（-1、0、1） */
  dir: number;
  /** 這一格剛起跳／剛落地（落地時的下落速度） */
  jumped: boolean;
  landed: boolean;
  fallSpeed: number;
  /** 這些狀態不加傾斜與轉身壓窄（動作本身就在翻、在爬、在出招） */
  calm: boolean;
}

/** 全域開關（F8、?feel=old）：每一關會重建球球，所以開關放在這裡不放在物件上 */
export const feelSwitch = { on: true };

export class Feel {
  get enabled(): boolean { return feelSwitch.on; }
  private sy: Spring = { v: 1, vel: 0 };
  private sx: Spring = { v: 1, vel: 0 };
  private rot: Spring = { v: 0, vel: 0 };
  private turn = 0;
  private lastFacing: 1 | -1 = 1;
  private lastVx = 0;

  /** 畫的時候用：縱向、橫向倍率，傾斜（弧度，正值＝往面向的前方倒），都以腳底為中心 */
  get scaleY(): number { return this.enabled ? this.sy.v : 1; }
  get scaleX(): number { return this.enabled ? this.sx.v * (1 - this.turn * (1 - FEEL.turnSquash)) : 1; }
  get lean(): number { return this.enabled ? this.rot.v : 0; }

  reset(): void {
    this.sy = { v: 1, vel: 0 }; this.sx = { v: 1, vel: 0 }; this.rot = { v: 0, vel: 0 };
    this.turn = 0; this.lastVx = 0;
  }

  update(i: FeelInput): void {
    const dt = Math.min(i.dt, 1 / 30);
    // ① 起跳、落地：直接給彈簧一個初速，讓它自己彈回 1
    if (i.jumped) { this.sy.vel += FEEL.jumpStretch * 26; this.sx.vel -= FEEL.jumpStretch * 18; }
    if (i.landed) {
      const k = Math.min(1, Math.max(0.25, i.fallSpeed / FEEL.landFull));
      this.sy.vel -= FEEL.landSquash * k * 30; this.sx.vel += FEEL.landSquash * k * 22;
    }
    step(this.sy, 1, dt);
    step(this.sx, 1, dt);
    this.sy.v = Math.min(1.18, Math.max(0.8, this.sy.v));
    this.sx.v = Math.min(1.2, Math.max(0.85, this.sx.v));

    // ② 傾斜：地上跑依速度往前傾；放開方向急停時往後仰；空中與 calm 狀態回正
    let target = 0;
    if (i.onGround && !i.calm) {
      const sp = Math.min(1, Math.abs(i.vx) / Math.max(1, i.runSpeed));
      const braking = i.dir === 0 && Math.abs(i.vx) > 60 && Math.abs(i.vx) < Math.abs(this.lastVx);
      target = braking ? -FEEL.brakeDeg : sp * FEEL.leanDeg;
    }
    step(this.rot, (target * Math.PI) / 180, dt);

    // ③ 轉身：面向一換，壓窄值跳到 1，0.12 秒內放回 0
    if (i.facing !== this.lastFacing) { if (!i.calm) this.turn = 1; this.lastFacing = i.facing; }
    this.turn = Math.max(0, this.turn - dt / 0.12);
    this.lastVx = i.vx;
  }
}

/** 網址 `?feel=old`＝關掉（比較改版前） */
export function feelEnabledFromUrl(search: string): boolean {
  return new URLSearchParams(search).get('feel') !== 'old';
}
