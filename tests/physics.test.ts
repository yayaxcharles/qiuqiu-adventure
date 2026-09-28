import { describe, expect, it } from 'vitest';
import { PARAMS, newBody, stepBody, type Ctrl, type World } from '../src/physics';

const DT = 1 / 120;
const W: World = { ground: 600, minX: 0, maxX: 5000, platforms: [{ x: 300, y: 450, w: 200 }] };
const idle: Ctrl = { left: false, right: false, jumpHeld: false, jumpPressed: false };

/** 跑 n 步，回傳最高點離起跳點多高 */
function jumpHeight(holdSteps: number): number {
  const b = newBody(100, W.ground);
  let top = b.y;
  for (let i = 0; i < 240; i++) {
    stepBody(b, { ...idle, jumpPressed: i === 0, jumpHeld: i < holdSteps }, DT, W);
    top = Math.min(top, b.y);
  }
  return W.ground - top;
}

describe('跳躍', () => {
  it('按住跳到接近理論高度（v²/2g），大約一個半角色高', () => {
    const h = jumpHeight(999);
    expect(h).toBeGreaterThan(PARAMS.jumpVel ** 2 / (2 * PARAMS.gravity) * 0.95);
    expect(h).toBeLessThan(PARAMS.jumpVel ** 2 / (2 * PARAMS.gravity) * 1.02);
  });
  it('點一下只跳到一半以下（放開截斷上升）', () => {
    expect(jumpHeight(3)).toBeLessThan(jumpHeight(999) * 0.5);
  });
  it('落地前 0.08 秒按的跳會記著，一落地就跳', () => {
    const b = newBody(100, W.ground - 40);
    b.onGround = false;
    let jumped = false;
    for (let i = 0; i < 120 && !jumped; i++) {
      const press = b.vy > 0 && W.ground - b.y < b.vy * 0.08 && W.ground - b.y > 0 && i < 60;
      jumped = stepBody(b, { ...idle, jumpPressed: press && !jumped, jumpHeld: true }, DT, W).jumped || jumped;
    }
    expect(jumped).toBe(true);
  });
});

describe('土狼時間', () => {
  /** 走出平台邊緣後隔幾步按跳：回傳有沒有「在半空中」跳起來（落地時才跳的是預按，不算土狼時間） */
  function walkOffThenJump(delaySteps: number): boolean {
    const b = newBody(480, 450);   // 站在平台右緣附近
    b.onGround = true;
    let leftAt = -1;
    for (let i = 0; i < 200; i++) {
      if (leftAt < 0 && !b.onGround) leftAt = i;
      const press = leftAt >= 0 && i === leftAt + delaySteps;
      const before = b.y;
      if (stepBody(b, { ...idle, right: true, jumpPressed: press, jumpHeld: press }, DT, W).jumped) return before < W.ground - 1;
    }
    return false;
  }
  it('踩出邊緣 0.05 秒內按跳還跳得起來', () => { expect(walkOffThenJump(6)).toBe(true); });
  it('0.2 秒後就跳不起來了', () => { expect(walkOffThenJump(24)).toBe(false); });
});

describe('跑與平台', () => {
  it('大約 0.15 秒內加速到全速', () => {
    const b = newBody(100, W.ground);
    for (let i = 0; i < 18; i++) stepBody(b, { ...idle, right: true }, DT, W);
    expect(b.vx).toBe(PARAMS.runSpeed);
  });
  it('單向平台：從下面跳得穿過、從上面踩得住', () => {
    const b = newBody(400, W.ground);
    let stoodOnPlatform = false;
    for (let i = 0; i < 240; i++) {
      stepBody(b, { ...idle, jumpPressed: i === 0, jumpHeld: true }, DT, W);
      if (b.onGround && b.y === 450) stoodOnPlatform = true;
    }
    expect(stoodOnPlatform).toBe(true);
  });
});
