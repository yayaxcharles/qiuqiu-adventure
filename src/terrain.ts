/**
 * 地形：一條地面折線＋坑（2026-09-26 使用者：「場景可以有高低，總之參照越南大戰做」）。
 * 座標跟物理一樣：x 往右、y 往下，數字越小地面越高。畫面地面平常在 y 596。
 *
 *   line：[x, y] 依 x 排好；同一個 x 連寫兩點＝垂直落差（斷崖、台階、坑壁）。
 *   pits：[起, 迄] 這段沒有地面，掉下去扣血。
 *
 * 關卡檔用下面的 `TerrainBuilder` 一段一段接（平地、斜坡、斷崖、樓梯、坑），比直接寫座標好讀。
 */
export type Pt = readonly [number, number];
export interface TerrainDef { line: readonly Pt[]; pits?: readonly (readonly [number, number])[] }

/** 一段斜的（或平的）地面，畫地面用 */
export interface Span { x0: number; y0: number; x1: number; y1: number }
/** 一道垂直落差（崖壁、坑壁、台階的立面）：x 處從 top 到 bottom */
export interface Wall { x: number; top: number; bottom: number }

export class Terrain {
  private readonly xs: number[];
  private readonly ys: number[];
  readonly pits: (readonly [number, number])[];

  constructor(def: TerrainDef) {
    if (def.line.length === 0) throw new Error('地形至少要一個點');
    this.xs = def.line.map((p) => p[0]);
    this.ys = def.line.map((p) => p[1]);
    for (let i = 1; i < this.xs.length; i++) {
      if (this.xs[i]! < this.xs[i - 1]!) throw new Error(`地形的點要照 x 由小到大排（第 ${i} 點 x=${this.xs[i]} 比前一點小）`);
    }
    this.pits = [...(def.pits ?? [])].sort((a, b) => a[0] - b[0]);
  }

  get startX(): number { return this.xs[0]!; }
  get endX(): number { return this.xs[this.xs.length - 1]!; }

  inPit(x: number): boolean {
    for (const [a, b] of this.pits) if (x > a && x < b) return true;
    return false;
  }

  /** x 處的地面高度；坑裡＝Infinity。垂直落差剛好在 x 上時算右邊那一側 */
  groundAt = (x: number): number => {
    if (this.inPit(x)) return Infinity;
    return this.lineAt(x);
  };

  /** 不管坑、只看折線的高度（畫坑壁、找坑邊用） */
  lineAt(x: number): number {
    const xs = this.xs, ys = this.ys, n = xs.length;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    // 找最後一個 xs[i] <= x（同一個 x 有兩點時取後面那點＝落差的右側）
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid]! <= x) lo = mid; else hi = mid - 1;
    }
    const i = lo, j = Math.min(n - 1, i + 1);
    const x0 = xs[i]!, x1 = xs[j]!;
    if (x1 <= x0) return ys[i]!;
    return ys[i]! + (ys[j]! - ys[i]!) * (x - x0) / (x1 - x0);
  }

  /** 從 x 往 dir 方向看，這一小段是不是能走（沒有坑、沒有比 maxRise 高的牆、沒有比 maxDrop 深的落差） */
  walkable(x: number, dir: number, ahead: number, maxRise: number, maxDrop: number): boolean {
    const here = this.groundAt(x), there = this.groundAt(x + dir * ahead);
    if (!Number.isFinite(there)) return false;
    return there >= here - maxRise && there <= here + maxDrop;
  }

  /** [x0, x1] 裡的地面斜段（已扣掉坑、不含垂直段），畫地面用 */
  spans(x0: number, x1: number): Span[] {
    const out: Span[] = [];
    const xs = this.xs, ys = this.ys;
    const push = (a: number, b: number): void => {
      // 把 [a, b] 再照坑切開
      let segs: [number, number][] = [[a, b]];
      for (const [p0, p1] of this.pits) {
        const next: [number, number][] = [];
        for (const [s0, s1] of segs) {
          if (p1 <= s0 || p0 >= s1) { next.push([s0, s1]); continue; }
          if (p0 > s0) next.push([s0, p0]);
          if (p1 < s1) next.push([p1, s1]);
        }
        segs = next;
      }
      for (const [s0, s1] of segs) if (s1 - s0 > 0.01) out.push({ x0: s0, y0: this.lineAt(s0 + 1e-6), x1: s1, y1: this.lineAt(s1 - 1e-6) });
    };
    // 折線前後當作一直延伸出去
    const first = xs[0]!, last = xs[xs.length - 1]!;
    if (x0 < first) push(x0, Math.min(first, x1));
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i]!, b = xs[i + 1]!;
      if (b <= a || b < x0 || a > x1) continue;
      push(Math.max(a, x0), Math.min(b, x1));
    }
    if (x1 > last) push(Math.max(last, x0), x1);
    void ys;
    return out;
  }

  /** [x0, x1] 裡的垂直落差（含坑的兩側壁），畫崖壁用 */
  walls(x0: number, x1: number): Wall[] {
    const out: Wall[] = [];
    const xs = this.xs, ys = this.ys;
    for (let i = 0; i + 1 < xs.length; i++) {
      if (xs[i + 1] !== xs[i] || xs[i]! < x0 - 5 || xs[i]! > x1 + 5 || this.inPit(xs[i]!)) continue;
      out.push({ x: xs[i]!, top: Math.min(ys[i]!, ys[i + 1]!), bottom: Math.max(ys[i]!, ys[i + 1]!) });
    }
    for (const [p0, p1] of this.pits) {
      if (p0 >= x0 - 5 && p0 <= x1 + 5) out.push({ x: p0, top: this.lineAt(p0 - 1e-6), bottom: Infinity });
      if (p1 >= x0 - 5 && p1 <= x1 + 5) out.push({ x: p1, top: this.lineAt(p1 + 1e-6), bottom: Infinity });
    }
    return out;
  }
}

/**
 * 一段一段接地形：
 *   new TerrainBuilder(596).flat(1400).slope(500, -80).cliff(+140).stairs(3, 60, -26).pit(180).build()
 * dy 是往下為正（-80＝上坡 80 像素）。`x`、`y` 隨時可以讀，關卡檔用來記「這裡是高台起點」之類的位置。
 */
export class TerrainBuilder {
  private readonly pts: [number, number][];
  private readonly pits: [number, number][] = [];
  x: number;
  y: number;

  constructor(y0: number, x0 = 0) {
    this.x = x0; this.y = y0;
    this.pts = [[x0, y0]];
  }

  flat(len: number): this { this.x += len; this.pts.push([this.x, this.y]); return this; }
  /** 斜坡：往右 len、高度變 dy（負＝上坡） */
  slope(len: number, dy: number): this { this.x += len; this.y += dy; this.pts.push([this.x, this.y]); return this; }
  /** 垂直落差：原地高度變 dy（正＝往下跳的斷崖，負＝要跳上去的高台） */
  cliff(dy: number): this { this.y += dy; this.pts.push([this.x, this.y]); return this; }
  /** 樓梯：n 階、每階寬 w、每階高度變 dh（每階不超過物理的 STEP_UP 才走得上去） */
  stairs(n: number, w: number, dh: number): this {
    for (let i = 0; i < n; i++) { this.cliff(dh); this.flat(w); }
    return this;
  }
  /** 坑：寬 len，掉下去扣血；過了坑地面高度照舊 */
  pit(len: number): this {
    this.pits.push([this.x, this.x + len]);
    this.x += len; this.pts.push([this.x, this.y]);
    return this;
  }
  build(): TerrainDef { return { line: this.pts.map((p) => [p[0], p[1]] as const), pits: this.pits.map((p) => [p[0], p[1]] as const) }; }
}
