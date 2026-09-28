/**
 * 一格一格播的動作圖（2026-09-26 起取代骨架零件；使用者看過骨架動作說「不行」）。
 *
 * `public/sprites/qiuqiu/anims.json` 的格式：
 *   { "idle": { "fps": 24, "loop": true, "frames": [ { "f": "00.webp", "ax": 118.3, "ay": 231.0 }, ... ] },
 *     "claw": { ..., "hit": 16 }, "throw": { ..., "release": 5 }, "_meta": { "standHeight": 240 } }
 * 每格圖裁到剛好包住角色，(ax, ay)＝基準點（腳底、身體中線）在那張圖裡的像素位置，角色面向右。
 * 動作裡「值是整數」的欄位（hit、release，以後的 takeoff、apex、land……）都當成標記：播到那一格時觸發一次。
 * 底線開頭的（_meta）不是動作。
 */
import { TEX_Q } from './quality';

export interface FrameDef {
  f: string; ax: number; ay: number;
  /** tools/bake_frames.py 預先算好的：[裁切 x0, y0, 寬, 高, 裁切後的 ax, 裁切後的 ay]（有這個就不用在瀏覽器逐像素處理） */
  k?: [number, number, number, number, number, number];
  /** anims.json 原本寫的 ay（載入時會改成實際量到的腳底，這裡留原值對照） */
  ay0?: number;
  /** 載入時縮成幾倍存（手機，src/quality.ts）：ax、ay 已經乘過，畫的時候倍率要除以它 */
  q?: number;
}
export interface AnimDef {
  fps: number;
  loop: boolean;
  frames: FrameDef[];
  /** 標記名 → 第幾格 */
  markers: Record<string, number>;
  /** 從哪支影片轉出來的（有些針對某支影片的修補要靠它認） */
  src?: string;
}
export type AnimDefs = Record<string, AnimDef>;

/** 讀 anims.json 的內容：挑出動作、整理標記；格式不對的動作直接略過（等於「沒有這個動作」） */
export function parseAnims(json: Record<string, unknown>): AnimDefs {
  const out: AnimDefs = {};
  for (const [name, raw] of Object.entries(json)) {
    if (name.startsWith('_') || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const frames = r.frames;
    if (!Array.isArray(frames) || frames.length === 0 || typeof r.fps !== 'number' || r.fps <= 0) continue;
    const markers: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === 'fps' || typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= frames.length) continue;
      markers[k] = v;
    }
    out[name] = {
      fps: r.fps, loop: r.loop === true, frames: frames as FrameDef[], markers,
      ...(typeof r.src === 'string' ? { src: r.src } : {}),
    };
  }
  return out;
}

export interface PlayOpts {
  /** 同一個動作（同一段）正在播：true＝從頭重播；不給＝接著播、不打斷 */
  restart?: boolean;
  /** 播放速度倍率（1＝照影片原速） */
  rate?: number;
  /** 從第幾格開始（預設 0） */
  from?: number;
  /** 播到第幾格為止（含這格）；給了就一定不循環，播完停在這格 */
  to?: number;
  /** 覆寫 anims.json 的 loop */
  loop?: boolean;
  /** 不循環的動作播完（最後一格也播滿）時呼叫一次 */
  onEnd?: () => void;
}

/**
 * 播放器：照「經過的時間」換格，不照畫面幀數——畫面 60 還是 240 Hz、一格切成幾小步，播出來都一樣快。
 * 只管播到第幾格，不碰畫面，測試直接餵。
 */
export class Animator {
  name = '';
  rate = 1;
  /** 每次真的換動作（或重播）加一，給檢查程式認「換動作的那一格」 */
  serial = 0;
  /** 不循環的動作播完了（停在最後一格） */
  done = false;
  private from = 0;
  private to = 0;
  private loop = false;
  /** 這次播放開始以後走了幾格（小數、不折回），目前格由它算 */
  private acc = 0;
  /** 標記已經處理到「第幾次進格」（acc 的整數部分），避免同一格重複觸發 */
  private firedK = -1;
  private onEnd: (() => void) | undefined;

  constructor(readonly defs: AnimDefs) {}

  has(name: string): boolean { return !!this.defs[name]; }

  get def(): AnimDef | undefined { return this.defs[this.name]; }

  /** 這一段有幾格 */
  private get len(): number { return this.to - this.from + 1; }

  /** 目前播到第幾格（anims.json 裡的格號） */
  get frame(): number {
    const k = Math.floor(this.acc);
    return this.loop ? this.from + (k % this.len) : Math.min(this.to, this.from + k);
  }

  /** 目前位置（格號＋小數），給需要算「還剩幾格」的地方用 */
  get pos(): number {
    return this.loop ? this.from + (this.acc % this.len) : Math.min(this.to + 1, this.from + this.acc);
  }

  /** 目前這格的資料 */
  current(): FrameDef | undefined { return this.def?.frames[this.frame]; }

  /** 這個動作照 rate 倍速播完要幾秒 */
  duration(name: string, rate = 1): number {
    const d = this.defs[name];
    return d ? d.frames.length / d.fps / rate : 0;
  }

  /**
   * 播某個動作；沒有這個動作就回傳 false、原本的照播。
   * 同一個動作而且同一段（from、to、loop 都一樣）又沒要求重播：接著播，只更新速度與播完回呼。
   * 換成新動作時一定從起始格開始，這一格就能畫出來（不會空一格）。
   */
  play(name: string, opts: PlayOpts = {}): boolean {
    const d = this.defs[name];
    if (!d) return false;
    const n = d.frames.length;
    const from = Math.max(0, Math.min(n - 1, opts.from ?? 0));
    const to = Math.max(from, Math.min(n - 1, opts.to ?? n - 1));
    const loop = opts.to !== undefined ? false : (opts.loop ?? d.loop);
    if (opts.rate !== undefined) this.rate = Math.max(0, opts.rate);
    if (name === this.name && !opts.restart && from === this.from && to === this.to && loop === this.loop) {
      if (opts.onEnd) this.onEnd = opts.onEnd;
      return true;
    }
    this.name = name; this.serial++;
    this.from = from; this.to = to; this.loop = loop;
    this.acc = 0; this.firedK = -1; this.done = false;
    if (opts.rate === undefined) this.rate = 1;
    this.onEnd = opts.onEnd;
    return true;
  }

  /** 往前播 dt 秒；回傳這段時間裡播到的標記（每個標記每次播放只觸發一次，循環動作每一圈一次） */
  update(dt: number): string[] {
    const d = this.def;
    const events: string[] = [];
    if (!d) return events;
    if (!this.done) this.acc += Math.max(0, dt) * d.fps * this.rate;
    let k = Math.floor(this.acc);
    if (!this.loop) k = Math.min(k, this.len - 1);
    // 從上次處理到的那格之後、一直到現在這格，每格檢查一次標記（一次跳好幾格也不會漏）；最多檢查一整圈
    const start = Math.max(this.firedK + 1, k - this.len + 1);
    for (let i = start; i <= k; i++) {
      const f = this.loop ? this.from + (i % this.len) : this.from + i;
      for (const [m, at] of Object.entries(d.markers)) if (at === f) events.push(m);
    }
    this.firedK = Math.max(this.firedK, k);
    if (!this.loop && !this.done && this.acc >= this.len) {
      this.done = true;
      const cb = this.onEnd;
      this.onEnd = undefined;
      cb?.();
    }
    return events;
  }
}

/** 載入好的動作圖：定義＋每格的圖（跟 frames 一一對應） */
/** shrink＝圖存成原本的幾倍大（tools/shrink_frames.py 縮成遊戲裡畫的大小；球球 240 → 190＝0.79），畫的時候倍率要除以它 */
export interface SpriteLib { defs: AnimDefs; images: Record<string, CanvasImageSource[]>; shrink?: number }

/**
 * 讀 anims.json 與所有格的圖。某個動作只要有一格載不到，整個動作就當作沒有（遊戲會退回別的動作），不會播到一半空一格。
 * 每格都先解碼成 ImageBitmap：第一次畫到才解碼會卡一下，換動作那一格就可能慢半拍。
 * 注意：載入時會清淡霧、裁空白邊，frames 裡的 ax、ay 會改成「裁過之後」的位置。
 */
export async function loadSprites(dirUrl: string): Promise<SpriteLib> {
  const res = await fetch(dirUrl + 'anims.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`載不到 ${dirUrl}anims.json（${res.status}）`);
  const json = await res.json() as Record<string, unknown>;
  const defs = parseAnims(json);
  const shrink = Number((json._meta as { shrink?: number } | undefined)?.shrink ?? 1) || 1;
  const images: Record<string, CanvasImageSource[]> = {};
  await Promise.all(Object.entries(defs).map(async ([name, d]) => {
    try {
      images[name] = await Promise.all(d.frames.map((fr) => loadFrame(`${dirUrl}${name}/${fr.f}`, fr)));
    } catch (e) {
      console.warn(`動作「${name}」有圖載不到，先當作沒有這個動作：`, e);
      delete defs[name];
    }
  }));
  return { defs, images, shrink };
}

/**
 * 去綠底留下的淡霧：idle、run 整張圖（549×309）大半像素有 5～8% 的暗霧，畫面上看得到角色外面一個淡淡的框（2026-09-26 實機截圖發現）。
 * 載入時把透明度 HAZE 以下歸零、以上拉回 0～255，再把空白邊裁掉，基準點跟著移。原圖不動；根本解要改轉檔腳本的去綠底。
 * 09-26 下午轉檔那邊已經在來源修掉淡霧（去背門檻改了），門檻從 22 降到 8：只清肉眼看不到的雜點，
 * 不再吃掉邊緣的半透明像素（每張約 5% 的像素是 1～22 的邊緣抗鋸齒，歸零會讓輪廓變硬）。
 */
const HAZE = 8;
/** 算「腳底」用的實心門檻（去霧拉回之後的透明度）與一列至少幾個實心像素才算 */
export const FOOT_SOLID = 128, FOOT_MIN = 3;

/**
 * 找腳底：最下面一列「至少 minCount 個像素透明度 ≥ solid」的下緣（回傳列號＋1＝腳踩的那條線），整張沒有實心就回傳 -1。
 *
 * 2026-09-26 使用者：「球球浮在空中了」。量出來的根因：
 *   轉檔腳本（tools/export_sprites.py）的 'feet' 基準（跳躍、空中丟）用「透明度 > 8」的外框底當腳底，
 *   可是每格腳下都有一條去綠底剩下的淡影（透明度 8～128），往下拖 17～30 畫面像素，跳躍有一格拖到 107——腳就被畫得浮起來。
 *   'fixed' 基準（待機、跑步、揮爪…）用第一格的實心腳底，其他格影片裡角色上下飄，差到 3～10 像素（跑步騰空那幾格）。
 * 所以載入時每一格都重新量「實心的腳底」，當成基準點的 y：畫的時候腳底一律踩在身體的 y（地面）上。
 */
export function footRow(alpha: ArrayLike<number>, w: number, h: number, solid = FOOT_SOLID, minCount = FOOT_MIN, stride = 4, offset = 3): number {
  for (let y = h - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0, i = y * w * stride + offset; x < w; x++, i += stride) if (alpha[i]! >= solid && ++n >= minCount) return y + 1;
  }
  return -1;
}

/** 載入花的時間（量「載入太久」用；tools/boot_check.mjs 讀）：解碼、逐像素處理各累加幾毫秒、幾格 */
export const bootStats = { decodeMs: 0, processMs: 0, frames: 0 };
/** 解碼（含下載）進行中的圖有幾張；decodeMs 記「至少有一張在解碼」的實際經過時間（很多張同時解碼不重複算） */
let decoding = 0, decodeFrom = 0;

/**
 * 載入一格：anims.json 有預先算好的 k（tools/bake_frames.py）就只「下載＋解碼＋裁切」，交給瀏覽器的背景執行緒做，主執行緒不讀像素；
 * 沒有 k（還沒跑過 bake 的）才走舊的逐像素處理（09-26 量到：全部 6,056 格逐像素處理要 17 秒，開遊戲要等 22 秒）。
 */
/**
 * 同時最多下載幾格：一次丟幾千個請求，瀏覽器會回「資源不足」（ERR_INSUFFICIENT_RESOURCES）讓一些格載不到（09-26 實測）。
 * 排隊時先做優先度高的資料夾（framePrio：玩家已經按了開始的那一關、球球），其他照順序。
 */
const MAX_INFLIGHT = 16;
let inflight = 0;
/** 排隊中的格，照資料夾分（每個資料夾先進先出；挑優先度最高、最早排進來的資料夾） */
const waiting = new Map<string, (() => void)[]>();
export const framePrio = new Map<string, number>();
/** 某個資料夾的圖要縮成幾倍存（沒寫就用 TEX_Q）：手機上魔王的圖再縮一點（又大張、格數又多） */
export const frameQ = new Map<string, number>();
function schedule<T>(dir: string, job: () => Promise<T>): Promise<T> {
  return new Promise<T>((ok, bad) => {
    let q = waiting.get(dir);
    if (!q) { q = []; waiting.set(dir, q); }
    q.push(() => { inflight++; job().then(ok, bad).finally(() => { inflight--; pump(); }); });
    pump();
  });
}
function pump(): void {
  while (inflight < MAX_INFLIGHT && waiting.size) {
    let best: string | null = null, bp = -Infinity;
    for (const d of waiting.keys()) { const p = framePrio.get(d) ?? 0; if (p > bp) { bp = p; best = d; } }
    const q = waiting.get(best!)!;
    const run = q.shift()!;
    if (!q.length) waiting.delete(best!);
    run();
  }
}

async function loadFrame(url: string, fr: FrameDef): Promise<CanvasImageSource> {
  if (fr.k) {
    const dir = url.slice(0, url.lastIndexOf('/', url.lastIndexOf('/') - 1) + 1);
    return schedule(dir, () => loadBaked(url, fr, frameQ.get(dir) ?? TEX_Q));
  }
  return loadFrameSlow(url, fr);
}

/** 有預先算好的 k：下載、解碼＋裁切交給瀏覽器（背景執行緒），主執行緒不讀像素；下載失敗重試兩次 */
async function loadBaked(url: string, fr: FrameDef, texQ = TEX_Q): Promise<CanvasImageSource> {
  const [x0, y0, w, h, ax, ay] = fr.k!;
  if (decoding++ === 0) decodeFrom = performance.now();
  try {
    let blob: Blob | null = null;
    for (let tries = 0; !blob; tries++) {
      try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); blob = await r.blob(); } catch (e) { if (tries >= 2) throw e; await new Promise((ok) => setTimeout(ok, 200)); }
    }
    // 手機：裁切的同時縮成螢幕看得到的大小（TEX_Q，見 quality.ts），基準點跟著縮
    const q = texQ < 0.98 ? texQ : 1;
    const bm = q < 1
      ? await createImageBitmap(blob, x0, y0, w, h, { resizeWidth: Math.max(1, Math.round(w * q)), resizeHeight: Math.max(1, Math.round(h * q)), resizeQuality: 'high' })
      : await createImageBitmap(blob, x0, y0, w, h);
    const rq = q < 1 ? (bm.width / w) : 1;   // 瀏覽器不支援縮圖參數時 bm 是原尺寸 → 倍率照實際的算
    fr.ay0 = fr.ay - y0; fr.ax = ax * rq; fr.ay = ay * rq; fr.q = rq;
    bootStats.frames++;
    return bm;
  } finally { if (--decoding === 0) bootStats.decodeMs += performance.now() - decodeFrom; }
}

/** 舊的載入：逐像素去淡霧、量裁切框與實心腳底（沒有 k 的時候；也給 tools/boot_check.mjs 對照 bake 算得對不對） */
export async function loadFrameSlow(url: string, fr: FrameDef): Promise<CanvasImageSource> {
  const img = new Image();
  img.src = url;
  if (decoding++ === 0) decodeFrom = performance.now();
  try { await img.decode(); } finally { if (--decoding === 0) bootStats.decodeMs += performance.now() - decodeFrom; }
  const t1 = performance.now();
  bootStats.frames++;
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h), px = data.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) {
      const a0 = px[i]!;
      const a = a0 <= HAZE ? 0 : Math.round((a0 - HAZE) * 255 / (255 - HAZE));
      px[i] = a;
      if (a > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  g.putImageData(data, 0, 0);
  const foot = footRow(px, w, h);
  fr.ay0 = fr.ay - y0;
  fr.ax -= x0;
  fr.ay = (foot > 0 ? foot : fr.ay) - y0;   // 見 footRow 的說明：基準點的 y＝這一格實際量到的腳底
  const bm = createImageBitmap(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  bootStats.processMs += performance.now() - t1;
  return bm;
}

/**
 * 畫一格：基準點對到 (x, y)（角色腳底），面向左（facing = -1）就水平翻轉，scale＝圖的像素 → 畫面像素。
 */
export function drawFrame(ctx: CanvasRenderingContext2D, img: CanvasImageSource, fr: FrameDef, x: number, y: number, facing: 1 | -1, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  const s = scale / (fr.q ?? 1);   // 手機載入時縮過的圖：倍率除回來，畫出來一樣大
  ctx.scale(facing * s, s);
  ctx.drawImage(img, -fr.ax, -fr.ay);
  ctx.restore();
}

/**
 * 把某格圖「基準點前方 cutX 像素以外」擦掉（邊緣 feather 像素淡出），回傳新的圖。
 * 用途：影片裡把飛出去的道具畫死在動作裡，程式另外發射的道具會變兩個——擦掉畫死的那個，讓程式的接手。
 */
export function eraseAhead(img: CanvasImageSource, fr: FrameDef, cutX: number, feather = 10): HTMLCanvasElement {
  const w = (img as { width: number }).width, h = (img as { height: number }).height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const x0 = fr.ax + cutX - feather;
  const grad = g.createLinearGradient(x0, 0, x0 + feather, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = grad;
  g.fillRect(x0, 0, w - x0, h);
  return c;
}
