/**
 * 球球的骨架資料與動作（零件圖在 public/rig/qiuqiu，由 tools/cut_parts.py 從 Codex 的零件圖拆出來）。
 * 關節點是看拆好的零件圖估的，實機截圖調過；零件尺寸見 public/rig/qiuqiu/sizes.json。
 * 角度：畫面座標 y 往下，正的角度＝順時針。面向右時，手臂正角度＝往後甩、負角度＝往前舉。
 */
import type { Pose, Rig } from './rig';

export const QIUQIU: Rig = {
  // 腰關節（身體零件 y≈140）到腳底：腿長 149、關節在腿圖 y≈22，腳底再往下約 127；身體關節跟腿關節約同高
  hipHeight: 124,
  parts: [
    { name: 'torso', pivot: [86, 138], z: 4 },
    { name: 'leg_back', pivot: [46, 24], parent: 'torso', at: [-18, -6], z: 1 },
    { name: 'leg_front', pivot: [46, 24], parent: 'torso', at: [16, -6], z: 3 },
    { name: 'tail', pivot: [128, 98], parent: 'torso', at: [-66, -20], z: 2 },
    { name: 'arm_back', pivot: [40, 26], parent: 'torso', at: [-34, -96], z: 0 },
    { name: 'head', pivot: [104, 184], parent: 'torso', at: [4, -118], z: 6 },
    { name: 'ribbons', pivot: [164, 38], parent: 'head', at: [-84, -92], z: 5 },
    { name: 'arm_front', pivot: [40, 26], parent: 'torso', at: [36, -96], z: 7 },
  ],
};

const deg = (d: number): number => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => 1 - (1 - t) * (1 - t);

export type Move = 'idle' | 'run' | 'jump' | 'fall';
export interface AnimState {
  move: Move;
  /** 秒 */
  t: number;
  /** 跑步相位（弧度），跟著移動距離走，腳才不會在地上滑 */
  runPhase: number;
  /** 0～1：現在速度佔全速多少 */
  speed: number;
  vy: number;
  /** 丟手裡劍動作進行到第幾秒（沒在丟＝-1） */
  throwT: number;
  /** 剛落地的壓縮（0～1，會慢慢彈回） */
  squash: number;
  /** 剛起跳的拉長（0～1）：跳起來那一下身體拉長一點，落地壓扁一點，動作才有彈性 */
  stretch: number;
}
/** 丟手裡劍：往後拉 0.07 秒、甩出去 0.06 秒（第 0.09 秒放手）、收回 0.15 秒 */
export const THROW_RELEASE = 0.09;
export const THROW_TOTAL = 0.28;

export function pose(a: AnimState): Pose {
  const p: Pose = {};
  const breathe = Math.sin(a.t * Math.PI * 1.6);
  const wave = (f: number, amp: number, off = 0): number => deg(Math.sin(a.t * Math.PI * 2 * f + off) * amp);
  switch (a.move) {
    case 'idle':
      p.torso = { dy: breathe * 2.5, sy: 1 + breathe * 0.012 };
      p.head = { rot: deg(breathe * 1.5), dy: breathe * 1 };
      p.arm_front = { rot: deg(-6 + breathe * 3) };
      p.arm_back = { rot: deg(6 - breathe * 3) };
      p.leg_front = { rot: deg(-4) };
      p.leg_back = { rot: deg(5) };
      p.tail = { rot: wave(0.5, 9) };
      p.ribbons = { rot: wave(0.7, 6) + deg(-8) };
      break;
    case 'run': {
      const s = Math.sin(a.runPhase), c = Math.cos(a.runPhase), k = Math.max(0.35, a.speed);
      p.torso = { rot: deg(8 * k + s * 2 * k), dy: -Math.abs(c) * 9 * k };
      p.head = { rot: deg(-6 * k + s * 2) };
      // 往前擺的那條腿抬起來一點（假裝膝蓋彎）：前腿在 cos>0 時往前擺、後腿在 cos<0 時往前擺
      p.leg_front = { rot: deg(-s * 42 * k), dy: -Math.max(0, c) * 12 * k };
      p.leg_back = { rot: deg(s * 42 * k), dy: -Math.max(0, -c) * 12 * k };
      p.arm_front = { rot: deg(s * 45 * k) };
      p.arm_back = { rot: deg(-s * 45 * k) };
      p.tail = { rot: deg(-18 * k) + wave(2.2, 8) };
      p.ribbons = { rot: deg(-4 - 14 * k) + wave(3, 8) };
      break;
    }
    case 'jump':
    case 'fall': {
      // 上升：前腳收、後腳往後伸、雙手往上；下落：兩腳往下伸、雙手張開保持平衡。中間照垂直速度漸變
      const up = Math.max(0, Math.min(1, (-a.vy + 200) / 900));
      p.torso = { rot: deg(lerp(6, -2, up)) };
      p.head = { rot: deg(lerp(4, -6, up)) };
      p.leg_front = { rot: deg(lerp(-18, -48, up)) };
      p.leg_back = { rot: deg(lerp(14, 38, up)) };
      p.arm_front = { rot: deg(lerp(-70, -120, up)) };
      p.arm_back = { rot: deg(lerp(-40, 60, up)) };
      p.tail = { rot: deg(lerp(20, -25, up)) + wave(2, 5) };
      p.ribbons = { rot: deg(lerp(28, -30, up)) + wave(3.5, 6) };
      break;
    }
  }
  // 落地壓縮：身體往下一沉再彈回（腳還踩在地上）
  if (a.squash > 0 && a.move !== 'jump') {
    const q = a.squash;
    const t = p.torso ?? {};
    p.torso = { ...t, dy: (t.dy ?? 0) + q * 10, sy: (t.sy ?? 1) * (1 - q * 0.08), sx: 1 + q * 0.06 };
    p.leg_front = { rot: (p.leg_front?.rot ?? 0) - deg(q * 16) };
    p.leg_back = { rot: (p.leg_back?.rot ?? 0) + deg(q * 16) };
  }
  if (a.stretch > 0) {
    const t = p.torso ?? {};
    p.torso = { ...t, sy: (t.sy ?? 1) * (1 + a.stretch * 0.08), sx: (t.sx ?? 1) * (1 - a.stretch * 0.05) };
  }
  // 丟手裡劍蓋在任何移動上面：只動前手臂（跟一點身體扭轉）
  if (a.throwT >= 0) {
    const t = a.throwT;
    let arm: number;
    // 往後拉從手臂「本來在的角度」開始（跑步中手正擺到前面也接得上，不會先跳回垂直）
    if (t < 0.07) arm = lerp((p.arm_front?.rot ?? 0) * 180 / Math.PI, 70, ease(t / 0.07));   // 往後拉
    else if (t < 0.13) arm = lerp(70, -105, ease((t - 0.07) / 0.06));         // 甩出去
    else arm = lerp(-105, (p.arm_front?.rot ?? 0) * 180 / Math.PI, ease(Math.min(1, (t - 0.13) / 0.15)));   // 收回
    p.arm_front = { rot: deg(arm) };
    const twist = t < 0.07 ? -ease(t / 0.07) : t < 0.2 ? lerp(-1, 1, (t - 0.07) / 0.13) : lerp(1, 0, (t - 0.2) / 0.08);
    p.torso = { ...(p.torso ?? {}), rot: (p.torso?.rot ?? 0) + deg(twist * 6) };
  }
  return p;
}

/** 前爪在前手臂零件圖上的位置（手裡劍從這裡出去） */
export const PAW_ON_ARM: [number, number] = [42, 124];
