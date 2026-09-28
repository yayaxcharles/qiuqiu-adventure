/**
 * 切件綁骨（2026-09-25，沿用元素法師塔防火龍那套：整張插畫拆件、每件繞關節轉，不用逐格畫）。
 * 每個零件的「本地座標」原點在它自己的關節點（pivot，零件圖上的像素位置）；
 * 子零件的 `at`＝它的關節在父零件本地座標裡的位置。根零件是身體，關節在腰（兩腿接處）。
 */
export interface PartDef {
  name: string;
  /** 零件圖上的關節點（像素） */
  pivot: readonly [number, number];
  parent?: string;
  /** 這個關節在父零件本地座標的位置（父零件圖像素減掉父的 pivot） */
  at?: readonly [number, number];
  /** 畫的順序：小的先畫（在後面） */
  z: number;
}
export interface PartPose { rot?: number; dx?: number; dy?: number; sx?: number; sy?: number }
export type Pose = Record<string, PartPose>;

export interface Rig {
  parts: readonly PartDef[];
  /** 腰（根零件的關節）到腳底的距離（零件圖像素） */
  hipHeight: number;
}

/** 2D 仿射矩陣 [a, b, c, d, e, f]，跟 canvas 的 setTransform 同一個排法 */
export type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const T = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const R = (a: number): M => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const S = (x: number, y: number): M => [x, 0, 0, y, 0, 0];
export const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 算每個零件在畫面上的矩陣（原點在它的關節）。(x, y)＝腳底，facing 1 面右、-1 面左 */
export function solve(rig: Rig, pose: Pose, x: number, y: number, scale: number, facing: 1 | -1): Map<string, M> {
  const out = new Map<string, M>();
  const byName = new Map(rig.parts.map((p) => [p.name, p]));
  const get = (name: string): M => {
    const done = out.get(name);
    if (done) return done;
    const def = byName.get(name);
    if (!def) throw new Error(`沒有零件 ${name}`);
    const ps = pose[name] ?? {};
    const local = mul(mul(T(ps.dx ?? 0, ps.dy ?? 0), R(ps.rot ?? 0)), S(ps.sx ?? 1, ps.sy ?? 1));
    const base: M = def.parent
      ? mul(get(def.parent), T(def.at?.[0] ?? 0, def.at?.[1] ?? 0))
      : mul(mul(T(x, y), S(scale * facing, scale)), T(0, -rig.hipHeight));
    const m = mul(base, local);
    out.set(name, m);
    return m;
  };
  for (const p of rig.parts) get(p.name);
  return out;
}

export function drawRig(ctx: CanvasRenderingContext2D, rig: Rig, imgs: Record<string, CanvasImageSource>, mats: Map<string, M>, skip: ReadonlySet<string> = new Set()): void {
  const order = [...rig.parts].sort((a, b) => a.z - b.z);
  for (const p of order) {
    if (skip.has(p.name)) continue;
    const m = mats.get(p.name);
    const img = imgs[p.name];
    if (!m || !img) continue;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, -p.pivot[0], -p.pivot[1]);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** 零件圖上某一點在畫面上的位置（丟手裡劍要從前爪出去） */
export function partPoint(rig: Rig, mats: Map<string, M>, name: string, px: number, py: number): [number, number] {
  const def = rig.parts.find((p) => p.name === name)!;
  return apply(mats.get(name)!, px - def.pivot[0], py - def.pivot[1]);
}
