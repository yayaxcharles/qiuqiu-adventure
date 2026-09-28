/**
 * 第三批美術（art/fx2.json：子彈、粒子、爆炸、木牌資訊欄、書法招牌、魔王特寫、九色村貓、球球特效）
 * 與天氣大場面（art/ambient2.json）的載入與畫法。
 *
 * 省記憶體（09-27 手機）：圖存成建議顯示大小的 2 倍，載進來時直接縮成「畫面上最大會畫多大」再解碼存著
 * （createImageBitmap 縮圖），一張 1285×1319 的大爆炸格從 6.8 MB 變 2.4 MB。
 * 所以畫的時候一律用「檔案像素 × 倍率」算目的大小，不能用圖本身的寬高（圖已經縮過）。
 */
import { TEX_Q } from './quality';

const base = import.meta.env.BASE_URL;

export interface FxSet {
  /** 一格或多格（子彈動畫、爆炸 8 格…）；單張圖就一格 */
  frames: CanvasImageSource[];
  /** json 寫的檔案寬高（檔案像素） */
  w: number; h: number;
  /** 錨點（檔案像素）：畫的時候對到指定座標 */
  ax: number; ay: number;
  fps: number; loop: boolean;
  /** 圖上朝哪邊（反方向要水平翻轉） */
  facing: 'left' | 'right' | null;
  /** 建議顯示倍率（檔案像素 → 畫面像素） */
  ds: number;
  meta: Record<string, unknown>;
}
export type FxLib = Map<string, FxSet>;

/**
 * 載一張圖並縮成 k 倍（k ≥ 1 不縮）：縮不了（舊瀏覽器不支援縮圖參數）就原尺寸，畫的時候照樣用目的大小，只是多佔記憶體。
 * 回傳的圖上掛著原檔的 naturalWidth、naturalHeight（照原檔算大小的舊程式照樣能用；要畫的時候一定給目的寬高）。
 */
export async function loadFit(src: string, k: number): Promise<CanvasImageSource | null> {
  try {
    const r = await fetch(base + src);
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    const bm = await createImageBitmap(blob);
    const nat = { naturalWidth: bm.width, naturalHeight: bm.height, src: base + src };
    if (!(k < 0.98)) return Object.assign(bm, nat);
    const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
    try {
      const small = await createImageBitmap(bm, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      bm.close();
      return Object.assign(small, nat);
    } catch {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bm, 0, 0, w, h);
      bm.close();
      return Object.assign(c, nat);
    }
  } catch (e) {
    console.warn('圖載不到，改用程式畫：', src, e);
    return null;
  }
}

/** 已經載好的圖再縮成 k 倍（原本那張放掉）；naturalWidth、naturalHeight、src 照原檔掛在上面 */
export async function shrinkTo(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; src?: string }, k: number): Promise<CanvasImageSource> {
  const src = img as { width: number; height: number; naturalWidth?: number; naturalHeight?: number; src?: string; close?: () => void };
  const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
  if (!(k < 0.98)) return img;
  try {
    const small = await createImageBitmap(img as ImageBitmapSource, { resizeWidth: Math.max(1, Math.round(nw * k)), resizeHeight: Math.max(1, Math.round(nh * k)), resizeQuality: 'high' });
    src.close?.();
    return Object.assign(small, { naturalWidth: nw, naturalHeight: nh, src: src.src ?? '' });
  } catch { return img; }
}

/** 解碼後佔多少位元組（寬×高×4）：記憶體統計用 */
export function bytesOf(img: CanvasImageSource | null | undefined): number {
  const m = img as { width?: number; height?: number } | null | undefined;
  return (m?.width ?? 0) * (m?.height ?? 0) * 4;
}

const anchorOf = (a: unknown, w: number, h: number): [number, number] => {
  if (Array.isArray(a) && a.length >= 2) return [Number(a[0]), Number(a[1])];
  if (a === 'bottom-center' || a === 'bottom') return [w / 2, h];
  if (a === 'center') return [w / 2, h / 2];
  return [0, 0];
};

/**
 * 每一組圖要存多大（檔案像素的幾倍）：原則是「畫面上最大會畫多大」（畫布固定 1280×720，手機也一樣）。
 * 粒子、球球特效很小，存原檔；爆炸會照半徑放大，存大一點；魔王特寫整張畫 1280 寬，存原檔。
 */
function keepScale(section: string, key: string, ds: number): number {
  if (section === 'bosses') return 1;
  if (section === 'particles') return 1;
  if (section === 'qiuqiu') return key === 'respawn_pillar' ? 0.5 : 1;
  if (key === 'explosion_small') return 0.75;
  if (key === 'explosion_medium') return 0.8;
  if (key === 'explosion_large') return 0.5;   // 魔王倒下 r＝200 → 畫 640 寬，剛好
  return Math.min(1, ds * 1.25);
}

/** 讀 art/fx2.json：沒有這個檔回傳空的（畫的地方退回程式畫） */
export async function loadFx2(): Promise<FxLib> {
  const lib: FxLib = new Map();
  let J: Record<string, Record<string, Record<string, unknown>>>;
  try {
    const r = await fetch(base + 'art/fx2.json', { cache: 'no-cache' });
    if (!r.ok) return lib;
    J = await r.json() as typeof J;
  } catch { return lib; }
  const jobs: Promise<void>[] = [];
  for (const [section, items] of Object.entries(J)) {
    if (section.startsWith('_') || !items || typeof items !== 'object') continue;
    for (const [key, m] of Object.entries(items)) {
      if (!m || typeof m !== 'object' || m.same) continue;
      const paths = Array.isArray(m.frames) ? (m.frames as string[]) : typeof m.path === 'string' ? [m.path] : [];
      if (!paths.length) continue;
      const w = Number(m.w) || 0, h = Number(m.h) || 0;
      const ds = typeof m.displayScale === 'number' && section !== 'npc' && section !== 'signs' ? m.displayScale
        : typeof m.displayW === 'number' && w ? m.displayW / w : typeof m.displayH === 'number' && h ? m.displayH / h : typeof m.displayScale === 'number' ? m.displayScale : 1;
      const k = keepScale(section, key, ds) * TEX_Q;   // 手機再乘上 TEX_Q（見 quality.ts）
      const [ax, ay] = anchorOf(m.anchor, w, h);
      jobs.push(Promise.all(paths.map((p) => loadFit('art/' + p, k))).then((imgs) => {
        const ok = imgs.filter((x): x is CanvasImageSource => !!x);
        if (ok.length !== paths.length) return;   // 缺格就整組不用（退回程式畫），不要播到一半跳格
        lib.set(key, {
          frames: ok, w, h, ax, ay, fps: typeof m.fps === 'number' ? m.fps : 10, loop: m.loop !== false,
          facing: m.facing === 'left' || m.facing === 'right' ? m.facing : null, ds, meta: m,
        });
      }));
    }
  }
  await Promise.all(jobs);
  return lib;
}

/**
 * 畫一格：錨點對到 (x, y)，s＝檔案像素 → 畫面像素的倍率。
 * flip＝水平翻轉（以錨點為軸）、rot＝轉（以錨點為軸）。
 */
export function fxDraw(ctx: CanvasRenderingContext2D, f: FxSet, i: number, x: number, y: number, s: number, o: { flip?: boolean; rot?: number; alpha?: number } = {}): void {
  const img = f.frames[Math.max(0, Math.min(f.frames.length - 1, i))];
  if (!img) return;
  const a0 = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = a0 * o.alpha;
  if (!o.flip && !o.rot) ctx.drawImage(img, x - f.ax * s, y - f.ay * s, f.w * s, f.h * s);
  else {
    ctx.save(); ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -f.ax * s, -f.ay * s, f.w * s, f.h * s);
    ctx.restore();
  }
  ctx.globalAlpha = a0;
}

/** 循環動畫這一刻是第幾格 */
export const loopFrame = (f: FxSet, t: number): number => Math.floor(t * f.fps) % f.frames.length;

// ───────────── 天氣大場面（ambient2.json）─────────────

export interface AmbItem {
  frames: CanvasImageSource[];
  /** 每一張的檔案寬高 */
  sizes: [number, number][];
  meta: Record<string, unknown>;
}
export type AmbLib = Map<string, AmbItem>;

/** 讀 art/ambient2.json 裡這一關（s1／s2／s3）與共用（all）的項目 */
export async function loadAmbient2(stage: string): Promise<AmbLib> {
  const lib: AmbLib = new Map();
  let J: { items?: Record<string, Record<string, unknown>> };
  try {
    const r = await fetch(base + 'art/ambient2.json', { cache: 'no-cache' });
    if (!r.ok) return lib;
    J = await r.json() as typeof J;
  } catch { return lib; }
  const jobs: Promise<void>[] = [];
  for (const [key, m] of Object.entries(J.items ?? {})) {
    if (m.stage !== stage && m.stage !== 'all') continue;
    const fr = (m.frames as { path: string; w: number; h: number }[] | undefined) ?? [];
    if (!fr.length || key === 'heat_haze') continue;   // 熱浪位移貼圖：canvas 做不到位移，改用程式畫的熱浪
    // 大張的光束、雨幕、霧照原尺寸（本來就是畫面大小）；飛艇、大隕石、鍛爐爆炸這種會縮小畫的，存一半
    const k = (/^(airship|big_meteor|forge_blast|kite|meteors|fire_arrow_stuck|strike)$/.test(key) ? 0.6 : 1) * TEX_Q;
    jobs.push(Promise.all(fr.map((f) => loadFit('art/' + f.path, k))).then((imgs) => {
      if (imgs.some((x) => !x)) return;
      lib.set(key, { frames: imgs as CanvasImageSource[], sizes: fr.map((f) => [f.w, f.h]), meta: m });
    }));
  }
  await Promise.all(jobs);
  return lib;
}

/** 背景生物的逐格圖（public/sprites/ambient/<名>/：tools/export_ambient.py 從 Vids 片段、透明原圖做的） */
export interface Creature { frames: CanvasImageSource[]; w: number; h: number; fps: number; facing: 'left' | 'right' }
export async function loadCreatures(stage: string): Promise<Map<string, Creature>> {
  const out = new Map<string, Creature>();
  let J: { creatures?: Record<string, { stage: string; frames: string[]; w: number; h: number; fps: number; facing?: string }> };
  try {
    const r = await fetch(base + 'sprites/ambient/index.json', { cache: 'no-cache' });
    if (!r.ok) return out;
    J = await r.json() as typeof J;
  } catch { return out; }
  await Promise.all(Object.entries(J.creatures ?? {}).filter(([, c]) => c.stage === stage).map(async ([k, c]) => {
    const imgs = await Promise.all(c.frames.map((f) => loadFit(`sprites/ambient/${k}/${f}`, TEX_Q)));
    if (imgs.some((x) => !x)) return;
    out.set(k, { frames: imgs as CanvasImageSource[], w: c.w, h: c.h, fps: c.fps, facing: c.facing === 'right' ? 'right' : 'left' });
  }));
  return out;
}
