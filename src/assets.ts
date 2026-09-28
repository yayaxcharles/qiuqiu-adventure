/**
 * 載入所有圖：球球動作圖、art.json 裡的場景／特效／圖示、敵人立繪、背景長卷。
 * 原則：缺什麼都不能讓遊戲開不起來——缺的圖回傳 null，畫的地方自己換替代品（程式畫、別的姿勢、舊背景）。
 */
import { ENEMY_DEFS, P2_HP } from './enemies';

/** 有倒下立繪（public/enemies/<名>_down.webp）的怪 */
const HAS_DOWN = new Set(['drum_tanuki', 'frog_daimyo', 'guardian_statue', 'iron_arhat', 'iron_claw', 'mask_dancer', 'orange_king', 'roomba_king', 'tanuki_lord', 'wild_boar', 'wood_dummy']);
import type { EnemyKind, Pose } from './entities';
import { bytesOf, loadAmbient2, loadCreatures, loadFit, loadFx2, shrinkTo, type AmbLib, type Creature, type FxLib } from './fx2';
import { MON_DIR, TEX_Q } from './quality';
import { framePrio, frameQ, loadSprites, type SpriteLib } from './sprite';
import type { StageDef } from './stages/types';

export interface ArtMeta {
  path: string; w?: number; h?: number;
  center?: [number, number];
  surfaceY?: number; standPx?: number;
  stretchX?: [number, number];
  facing?: 'left' | 'right';
  anchor?: string;
  [k: string]: unknown;
}
export interface ArtImg { img: HTMLImageElement; meta: ArtMeta }

export type LayerName = 'far' | 'midfar' | 'mid' | 'fore';
export const LAYERS: readonly LayerName[] = ['far', 'midfar', 'mid', 'fore'];
export interface Panel { img: HTMLImageElement; w: number; h: number; path: string; /** 最前景：貼畫面頂（top）或底（bottom） */ anchor?: 'top' | 'bottom' }
export interface StagePanels { layers: Record<LayerName, Panel[]>; rates: Partial<Record<LayerName, number>> }

export interface Assets {
  sprites: SpriteLib;
  art: Map<string, ArtImg>;
  /** 關卡代號（s1）→ 四層背景長卷 */
  panels: Map<string, StagePanels>;
  /** 敵人立繪：「rat_idle」「orange_king_p2_attack」… */
  enemies: Map<string, HTMLImageElement>;
  fallback: { bg: HTMLImageElement | null; shuriken: HTMLImageElement | null };
  /** 地面帶最下面幾列的平均色（斜坡、斷崖下面填土用） */
  dirt: Map<string, string>;
  /** 會動的點綴（art.json 的 fx_ambient）：名稱（s1_bamboo_leaf、s1_smoke…）→ 幾張圖（不同樣子或由小到大的動畫格） */
  ambient: Map<string, HTMLImageElement[]>;
  /** 怪物的逐格動作圖（電腦版 public/sprites/monsters/<怪>/、手機版 monsters_m/，見 quality.ts）：standHeight＝站姿在圖裡多高（畫的時候縮成 drawH） */
  monsters: Map<string, { lib: SpriteLib; standHeight: number }>;
  /** 站得上去的東西與道具（art/terrain.json）；沒有這個檔就是 null，畫的地方退回程式畫 */
  terrain: TerrainArt | null;
  /** 背景載入（瀏覽器裡才有；測試用的假資源沒有＝全部都已經在了） */
  loader?: AssetLoader;
  /** 第三批美術（fx2.json：子彈、粒子、爆炸、木牌資訊欄、招牌、魔王特寫、村貓、球球特效）；沒有就畫舊的 */
  fx?: FxLib;
  /** 天氣大場面（ambient2.json）與背景生物，照關卡代號（s1）分：只載正在玩的那一關 */
  amb2?: Map<string, { items: AmbLib; creatures: Map<string, Creature> }>;
}

/** 一張圖＋它在圖上的關鍵線（腳踩的線、實心底線） */
export interface TImg { img: HTMLImageElement; w: number; h: number; standY: number; footY: number }
export interface TerrainArt {
  /** 地面帶：套名（village／bamboo／bandit）→ 圖、腳踩的線、圖底以下補的顏色 */
  ground: Record<string, TImg & { bottomColor: string }>;
  /** 舊的地面鍵名（關卡檔寫的 s1_1_ground）→ 新地面帶套名 */
  zones: Record<string, string>;
  /** 崖壁：套名（stone／earth／log）→ 頂塊（standY 對齊高處站立線）＋壁身（往下重複）；faceX＝壁面在圖上的 x（壁面朝左） */
  wall: Record<string, { top: TImg; body: TImg; faceX: number }>;
  /** 屋子：左端＋中段×n＋右端；ridgeX＝屋脊在左右端的 x；standY＝屋脊線、bottomY＝圖底（檔案 2 倍大） */
  house: { left: TImg; mid: TImg; right: TImg; leftRidgeX: number; rightRidgeX: number; standY: number; bottomY: number } | null;
  /** 竹架、木架：左＋中×n＋右，standY＝腳踩的線；post＝用哪根支柱 */
  rail: Record<string, { left: TImg; mid: TImg; right: TImg; standY: number; scale: number; post: string; midFrames?: TImg[]; fps?: number }>;
  post: Record<string, TImg & { scale: number }>;
  /** 道具：圖、顯示縮放、錨點（bottom-center 用 footY 貼地；center 用 displaySize） */
  props: Record<string, TImg & { scale: number; anchor: string; size?: number }>;
  /** 長條、沒有支柱、底部貼地（木柵、木造矮牆、屋脊）：左＋中×n＋右；standable＝能不能站 */
  deck: Record<string, { left: TImg; mid: TImg; right: TImg; standY: number; scale: number; standable: boolean }>;
  /** 站得上去的長屋（攤位長屋）：格式同 house，中段可以在幾種樣子之間輪流挑 */
  building: Record<string, { left: TImg; mids: TImg[]; right: TImg; leftRidgeX: number; rightRidgeX: number; standY: number; bottomY: number }>;
  /** 石階：一階一塊，格式同崖壁（頂塊 standY 對齊那一階的踏面、壁身往下重複；壁面朝左），顯示縮放 scale */
  stair: Record<string, { top: TImg; body: TImg; faceX: number; scale: number }>;
  /** 單張站台（大鳥居、升降台）：standX0～standX1＝能站的範圍（圖的像素） */
  platform: Record<string, TImg & { standX0: number; standX1: number; scale: number; anchor: string }>;
  /** 會動的水面：幾格輪播；surfaceY＝水面線；圖底以下補 bottomColor */
  water: Record<string, { frames: TImg[]; surfaceY: number; fps: number; scale: number; bottomColor: string }>;
  /** 底座＋動畫格（營火、蒸氣噴口）：底座底部中間貼地，動畫格的 baseX 對齊底座中心 */
  anim: Record<string, { base: TImg & { scale: number }; frames: TImg[]; fps: number; scale: number; baseX: number }>;
  /** 結局圖 */
  ending: Record<string, TImg>;
}

const base = import.meta.env.BASE_URL;

/**
 * 載一張圖，解碼好之後轉成 ImageBitmap（09-26 量到：<img> 解碼好的像素瀏覽器過一陣子會丟掉，之後第一次畫又要當場重新解碼，
 * 一張 1500×720 的長卷在主執行緒卡 100～160 毫秒；ImageBitmap 會一直留著解碼好的像素）。
 * 其他程式讀的 naturalWidth、naturalHeight、src 照樣掛在上面，型別照舊當 <img> 用。
 */
function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      img.decode()
        .then(() => createImageBitmap(img))
        .then((bm) => { Object.assign(bm, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, src: img.src }); ok(bm as unknown as HTMLImageElement); })
        .catch(() => ok(img));
    };
    img.onerror = () => { console.warn('圖載不到，改用替代品：', src); ok(null); };
    img.src = base + src;
  });
}

/** art.json 裡所有背景長卷：不管 panels 寫成什麼形狀，只要路徑是 bg/s1/mid_03.webp 這種就認得（關卡、圖層、順序都從檔名讀） */
const PANEL_RE = /^bg\/([a-z0-9]+)\/(far|midfar|mid|fore)_(\d+)\.(webp|png|jpg)$/i;

interface PanelRef { stage: string; layer: LayerName; order: number; path: string; w?: number; h?: number; anchor?: 'top' | 'bottom' }

export function findPanels(json: unknown): { refs: PanelRef[]; rates: Map<string, number> } {
  const refs = new Map<string, PanelRef>();
  const rates = new Map<string, number>();
  const walk = (v: unknown, keys: string[]): void => {
    if (typeof v === 'string') {
      const m = PANEL_RE.exec(v.replace(/^\.?\//, '').replace(/^art\//, ''));
      if (m && !refs.has(v)) refs.set(v, { stage: m[1]!, layer: m[2] as LayerName, order: Number(m[3]), path: m[0] });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...keys, String(i)])); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const p = typeof o.path === 'string' ? o.path : typeof o.file === 'string' ? o.file : null;
    if (p) {
      const m = PANEL_RE.exec(p.replace(/^\.?\//, '').replace(/^art\//, ''));
      if (m) {
        refs.set(m[0], {
          stage: m[1]!, layer: m[2] as LayerName, order: typeof o.order === 'number' ? o.order : Number(m[3]), path: m[0],
          ...(typeof o.w === 'number' ? { w: o.w } : typeof o.width === 'number' ? { w: o.width } : {}),
          ...(typeof o.h === 'number' ? { h: o.h } : typeof o.height === 'number' ? { h: o.height } : {}),
          ...(o.anchor === 'top' || o.anchor === 'bottom' ? { anchor: o.anchor } : {}),
        });
      }
    }
    // 捲動速率：{ rate / scroll / parallax: 0.55 }，圖層從自己的 layer 欄位或上一層的 key 判斷，關卡從 key（s1）判斷
    const rate = [o.rate, o.scroll, o.parallax, o.scrollRate].find((x) => typeof x === 'number') as number | undefined;
    if (rate !== undefined) {
      const layer = (typeof o.layer === 'string' ? o.layer : [...keys].reverse().find((k) => ['far', 'midfar', 'mid', 'fore'].includes(k))) as string | undefined;
      const stage = [...keys].reverse().find((k) => /^s\d+$/.test(k));
      if (layer && stage) rates.set(`${stage}:${layer}`, rate);
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === 'rate' || k === 'scroll' || k === 'parallax') continue;
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        // { far: 0.12, mid: 0.55 } 這種寫法
        for (const [lk, lv] of Object.entries(x as Record<string, unknown>)) {
          if (['far', 'midfar', 'mid', 'fore'].includes(lk) && typeof lv === 'number') {
            const stage = [...keys, k].reverse().find((kk) => /^s\d+$/.test(kk));
            if (stage) rates.set(`${stage}:${lk}`, lv);
          }
        }
      }
      walk(x, [...keys, k]);
    }
  };
  walk(json, []);
  return { refs: [...refs.values()], rates };
}

/**
 * 開遊戲只載「標題畫面要的」（art.json 的介面、圖示、特效、點綴，約 5 MB）——標題 3 秒內出來就能按 Enter；
 * 其他的交給 AssetLoader 在背景一包一包載：共用包（球球動作圖、地形、敵人單張立繪）→ 第一關 → 第二關 → 第三關。
 * 09-26 量到：原本開頭全部載完（6,593 個檔、207 MB）要 22 秒才看到標題。
 */
export async function loadAssets(onProgress?: (msg: string) => void): Promise<Assets> {
  onProgress?.('載入中…');
  let artJson: Record<string, unknown> = {};
  try {
    const r = await fetch(base + 'art/art.json', { cache: 'no-cache' });
    if (r.ok) artJson = await r.json() as Record<string, unknown>;
    else console.warn('沒有 art/art.json，場景與特效全部用替代品');
  } catch (e) { console.warn('art.json 讀不到：', e); }

  const art = new Map<string, ArtImg>();
  const artJobs = Object.entries(artJson)
    .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && typeof (v as ArtMeta).path === 'string')
    .map(async ([k, v]) => {
      const meta = v as ArtMeta;
      if (PANEL_RE.test(meta.path)) return;   // 背景長卷另外載（每關自己的包）
      if (/^s\d_\d_far$/.test(k)) return;   // 舊的每段遠景：只有背景長卷缺圖時才用（長卷都有了），不載（省 35 MB）
      // 被救村貓（舊三色）：畫出來只有 175 高，縮成 30% 存（一張 1.8 MB → 0.2 MB）；
      // 手機其他的也縮成 TEX_Q（地面帶那種要量底色的 surfaceY 圖除外）；畫的地方都照 naturalWidth 給目的大小
      const q = k.startsWith('npc_') ? 0.3 : typeof meta.surfaceY === 'number' ? 1 : TEX_Q;
      const img = q < 0.98 ? await loadFit('art/' + meta.path, q) as HTMLImageElement | null : await loadImg('art/' + meta.path);
      if (img) art.set(k, { img, meta });
    });

  // 會動的點綴：{ s1: [ { name, frames: [ { path } ] } ] }（小，開頭就載）
  const ambient = new Map<string, HTMLImageElement[]>();
  const ambJobs: Promise<void>[] = [];
  const amb = artJson.fx_ambient;
  if (amb && typeof amb === 'object') {
    for (const [k, list] of Object.entries(amb as Record<string, unknown>)) {
      if (k.startsWith('_') || !Array.isArray(list)) continue;
      for (const it of list as { name?: unknown; frames?: unknown }[]) {
        if (typeof it?.name !== 'string' || !Array.isArray(it.frames)) continue;
        const name = it.name, paths = (it.frames as { path?: unknown }[]).map((f) => f?.path).filter((x): x is string => typeof x === 'string');
        ambJobs.push(Promise.all(paths.map((pth) => (TEX_Q < 0.98 ? loadFit('art/' + pth, TEX_Q) as Promise<HTMLImageElement | null> : loadImg('art/' + pth)))).then((imgs) => {
          const ok = imgs.filter((x): x is HTMLImageElement => !!x);
          if (ok.length) ambient.set(name, ok);
        }));
      }
    }
  }
  const [bg, shuriken] = await Promise.all([loadImg('bg/village.webp'), loadImg('rig/qiuqiu/shuriken.webp'), Promise.all(artJobs), Promise.all(ambJobs)]);
  const dirt = new Map<string, string>();
  for (const [k, a] of art) if (typeof a.meta.surfaceY === 'number') dirt.set(k, bottomColor(a.img));
  const assets: Assets = {
    sprites: { defs: {}, images: {} }, art, panels: new Map(), enemies: new Map(), fallback: { bg, shuriken }, dirt, ambient,
    monsters: new Map(), terrain: null,
  };
  assets.loader = new AssetLoader(assets, artJson);
  return assets;
}

/** 這一關會出現哪些怪（出怪表、魔王，加上魔王叫出來的小兵）→ 怪物動作圖的資料夾名 */
const SUMMONS: Partial<Record<EnemyKind, EnemyKind[]>> = {
  drum_tanuki: ['tanuki_kid'], frog_daimyo: ['tadpole'], broom_centipede: ['mini_broom'], iron_claw: ['mini_broom'],
};
export function monstersOf(stage: StageDef): string[] {
  const kinds = new Set<EnemyKind>();
  for (const s of stage.spawns) kinds.add(s.kind);
  for (const b of stage.bosses) kinds.add(b.kind);
  for (const k of [...kinds]) for (const x of SUMMONS[k] ?? []) kinds.add(x);
  return [...new Set([...kinds].map((k) => ENEMY_DEFS[k].img))];
}

type Job = { total: number; done: number; promise: Promise<void> };
/** 要預熱的圖（剪影這種要現做的，給一個「到時候再做」的函式） */
type WarmItem = CanvasImageSource | (() => CanvasImageSource);

/**
 * 背景載入：一包一包載，進某一關前確定那一關的包載好、也預熱好（第一次畫一張大圖會卡一下，先在「準備中」時畫過）。
 *   base：球球動作圖、地形與道具（terrain.json）、敵人單張立繪
 *   stage:<panels>：那一關的背景長卷＋那一關會出現的怪物動作圖
 * 預熱（warmStep）只在標題、準備中、結算畫面做，打的時候不做（不要在戰鬥中卡）。
 */
export class AssetLoader {
  private jobs = new Map<string, Job>();
  private monsterList: Promise<string[]>;
  private panelInfo: ReturnType<typeof findPanels>;
  /** 還沒預熱的圖（照包分）；預熱完的包 */
  private warmQ = new Map<string, WarmItem[]>();
  private warmedPacks = new Set<string>();
  /** 量卡頓用：預熱時畫一張花超過 8 毫秒的 */
  slowWarm: { id: string; ms: number; kind: string; w: number; h: number; src: string }[] = [];

  constructor(private readonly a: Assets, artJson: Record<string, unknown>) {
    this.panelInfo = findPanels(artJson);
    for (const [k, r] of this.panelInfo.rates) {
      const [stage, layer] = k.split(':') as [string, LayerName];
      let sp = a.panels.get(stage);
      if (!sp) { sp = { layers: { far: [], midfar: [], mid: [], fore: [] }, rates: {} }; a.panels.set(stage, sp); }
      sp.rates[layer] = r;
    }
    this.monsterList = fetch(`${base}sprites/${MON_DIR}/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { monsters: [] }) as Promise<{ monsters?: string[] }>)
      .then((j) => j.monsters ?? [], () => []);
  }

  private job(id: string, make: (count: () => void, add: (n: number) => void) => Promise<void>): Promise<void> {
    const j = this.jobs.get(id);
    if (j) return j.promise;
    const jj: Job = { total: 1, done: 0, promise: Promise.resolve() };
    this.jobs.set(id, jj);
    jj.promise = make(() => { jj.done++; }, (n) => { jj.total += n; }).then(() => { jj.done = jj.total; });
    return jj.promise;
  }

  /** 玩家按了開始、這一關還沒好：這一關的圖插隊先載 */
  want(st: StageDef): void {
    framePrio.set(base + 'sprites/qiuqiu/', 30);
    for (const m of monstersOf(st)) framePrio.set(`${base}sprites/${MON_DIR}/${m}/`, 20);
    void this.stage(st).catch((e) => console.warn(e));
  }

  /** 共用包：球球動作圖、地形與道具、敵人單張立繪 */
  base(): Promise<void> {
    return this.job('base', async (count, add) => {
      const a = this.a;
      if (!framePrio.has(base + 'sprites/qiuqiu/')) framePrio.set(base + 'sprites/qiuqiu/', 10);
      const sprites = loadSprites(base + 'sprites/qiuqiu/').then((lib) => {
        for (const need of ['idle', 'run', 'throw']) if (!lib.defs[need]) throw new Error(`anims.json 裡少了「${need}」動作（或它的圖載不到），這個一定要有`);
        Object.assign(a.sprites.defs, lib.defs); Object.assign(a.sprites.images, lib.images); a.sprites.shrink = lib.shrink;
        count();
      });
      add(2);
      const terrain = loadTerrainArt().then((t) => { a.terrain = t; count(); });
      add(1);
      const fx2 = loadFx2().then((lib) => { a.fx = lib; count(); });
      // 敵人單張立繪改成每一關自己載（09-27 手機記憶體：全部 69 MB，一關只用得到三分之一）；這裡只留村貓的退路圖
      const stills: Promise<void>[] = [];
      for (const p of ['idle', 'attack']) stills.push(loadImg(`enemies/dozing_tabby_${p}.webp`).then((img) => { if (img) a.enemies.set(`dozing_tabby_${p}`, img); }));
      await Promise.all([sprites, terrain, fx2, ...stills]);
      // 預熱清單：介面與特效、點綴、地形、球球、敵人立繪（含被打閃白、預兆閃紅的剪影）
      const q: WarmItem[] = [];
      for (const x of a.art.values()) q.push(x.img);
      for (const list of a.ambient.values()) q.push(...list);
      const walk = (o: unknown, depth = 0): void => {
        if (!o || typeof o !== 'object' || depth > 5) return;
        if (o instanceof HTMLImageElement || o instanceof HTMLCanvasElement || o instanceof ImageBitmap) { q.push(o); return; }
        for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
      };
      walk(a.terrain);
      for (const frames of Object.values(a.sprites.images)) q.push(...frames);
      for (const f of a.fx?.values() ?? []) q.push(...f.frames);
      this.warmQ.set('base', q);
    });
  }

  /** 某一關的包：背景長卷＋會出現的怪物動作圖（先等共用包） */
  private stageDefs = new Map<string, StageDef>();
  stage(st: StageDef): Promise<void> {
    const id = 'stage:' + st.id;
    this.stageDefs.set(id, st);
    return this.job(id, async (count, add) => {
      await this.base();
      const a = this.a;
      const q: WarmItem[] = [];
      // 背景長卷
      const refs = this.panelInfo.refs.filter((r) => r.stage === st.panels);
      add(refs.length);
      const panelJobs = refs.map(async (ref) => {
        // 手機：長卷載進來就縮成螢幕看得到的大小（畫的時候照 json 寫的寬高畫，大小不變）
        const img = TEX_Q < 0.98 ? await loadFit('art/' + ref.path, TEX_Q) as HTMLImageElement | null : await loadImg('art/' + ref.path);
        count();
        if (!img) return;
        let sp = a.panels.get(ref.stage);
        if (!sp) { sp = { layers: { far: [], midfar: [], mid: [], fore: [] }, rates: {} }; a.panels.set(ref.stage, sp); }
        const list = sp.layers[ref.layer] as (Panel & { order: number })[];
        if (list.some((p) => p.path === ref.path)) return;
        list.push({ img, w: ref.w ?? img.naturalWidth, h: ref.h ?? img.naturalHeight, path: ref.path, order: ref.order, ...(ref.anchor ? { anchor: ref.anchor } : {}) });
        list.sort((x, y) => x.order - y.order);
        q.push(img);
      });
      // 怪物動作圖：魔王的（又大又要到後面才出場）不在這裡等，進關後在背景照進度載（playTick）；
      // 下載量、記憶體都少一大截（09-27 手機：進第一關前要下載的從 41 MB 降到 33 MB）
      const have = await this.monsterList;
      const bossImgs = new Set(st.bosses.map((b) => ENEMY_DEFS[b.kind].img));
      const minions = new Set(monstersOf({ ...st, bosses: [] }));
      const want = monstersOf(st).filter((m) => have.includes(m) && (this.keepAll || !bossImgs.has(m) || minions.has(m)));
      add(want.length);
      const monJobs = want.map((m) => this.monster(m).then((lib) => {
        count();
        if (lib) for (const frames of Object.values(lib.images)) q.push(...frames);
      }));
      // 這一關敵人的單張立繪（逐格動作圖沒有的姿勢、動作圖載不到時的退路）
      const stillJobs = this.stills(st, add, count);
      // 這一關的天氣、背景生物（ambient2）
      add(1);
      const ambJob = (a.amb2?.get(st.panels) ? Promise.resolve() : Promise.all([loadAmbient2(st.panels), loadCreatures(st.panels)]).then(([items, creatures]) => {
        if (!a.amb2) a.amb2 = new Map();
        a.amb2.set(st.panels, { items, creatures });
        for (const it of items.values()) q.push(...it.frames);
        for (const c of creatures.values()) q.push(...c.frames);
      })).then(() => count());
      await Promise.all([...panelJobs, ...monJobs, ambJob, ...stillJobs]);
      // 這一關怪物的單張立繪剪影（被打閃白、預兆閃紅、魔王閃紅）
      for (const kind of new Set([...st.spawns.map((s) => s.kind), ...st.bosses.map((b) => b.kind)])) {
        const d = ENEMY_DEFS[kind];
        for (const [k, img] of a.enemies) if (k.startsWith(d.img + '_')) {
          q.push(img);
          if (d.boss) q.push(() => tintOf(img, '#ff5a4a'));
          else { q.push(() => tintOf(img, '#ffffff')); q.push(() => tintOf(img, '#ff2a2a')); }
        }
      }
      this.warmQ.set(id, q);
    });
  }

  /** 這一關會出現的怪的單張立繪（idle／attack／hurt／block／down；魔王加二階） */
  private kindsOf(st: StageDef): EnemyKind[] {
    const kinds = new Set<EnemyKind>();
    for (const s of st.spawns) kinds.add(s.kind);
    for (const b of st.bosses) kinds.add(b.kind);
    for (const k of [...kinds]) for (const x of SUMMONS[k] ?? []) kinds.add(x);
    if (kinds.has('tanuki_lord')) kinds.add('tanuki_clone');
    return [...kinds];
  }
  private stills(st: StageDef, add: (n: number) => void, count: () => void): Promise<void>[] {
    const a = this.a, out: Promise<void>[] = [];
    const poses: Pose[] = ['idle', 'attack', 'hurt', 'block', 'down'];
    for (const kind of this.kindsOf(st)) {
      const d = ENEMY_DEFS[kind];
      const variants = d.boss && P2_HP[kind] ? [d.img, d.img + '_p2'] : [d.img];
      const dir = kind === 'dummy' ? 'enemy/' : 'enemies/';
      for (const v of variants) for (const p of poses) {
        if (kind === 'dummy' && p !== 'idle' && p !== 'hurt') continue;
        if (p === 'down' && !HAS_DOWN.has(d.img)) continue;   // 沒有倒下圖的不去要（倒下改畫受傷圖）
        if (a.enemies.has(`${v}_${p}`)) continue;
        add(1);
        const load = TEX_Q < 0.98 ? loadFit(`${dir}${v}_${p}.webp`, TEX_Q) as Promise<HTMLImageElement | null> : loadImg(`${dir}${v}_${p}.webp`);
        out.push(load.then((img) => { if (img) a.enemies.set(`${v}_${p}`, img); count(); }));
      }
    }
    return out;
  }

  /** 一隻怪的動作圖（同一隻只載一次） */
  private monsterJobs = new Map<string, Promise<SpriteLib | null>>();
  private monster(m: string): Promise<SpriteLib | null> {
    let p = this.monsterJobs.get(m);
    if (!p) {
      p = (async () => {
        try {
          const dir = `${base}sprites/${MON_DIR}/${m}/`;
          const lib = await loadSprites(dir);
          const meta = ((await (await fetch(dir + 'anims.json')).json()) as { _meta?: { standHeight?: number } })._meta;
          this.a.monsters.set(m, { lib, standHeight: meta?.standHeight ?? 200 });
          return lib;
        } catch (e) { console.warn(`怪物「${m}」的動作圖載不到，改用單張立繪：`, e); return null; }
      })();
      this.monsterJobs.set(m, p);
    }
    return p;
  }

  /**
   * 只留這一關：別關的背景長卷、怪物動作圖、天氣圖放掉（09-27 手機記憶體：三關全留著解碼後超過 1 GB）。
   * 正在載的包不動（載完下次再放）；這一關還沒載就開始載。進關、標題選關時叫。
   */
  focus(st: StageDef): void {
    if (this.keepAll) { void this.stage(st).catch((e) => console.warn(e)); return; }
    const a = this.a;
    const keepM = new Set(monstersOf(st));
    for (const [id, other] of this.stageDefs) {
      if (other.id === st.id) continue;
      const j = this.jobs.get(id);
      if (!j || j.done < j.total) continue;
      if (other.panels !== st.panels) {
        const sp = a.panels.get(other.panels);
        if (sp) for (const l of LAYERS) { for (const p of sp.layers[l]) closeImg(p.img); sp.layers[l] = []; }
        const amb = a.amb2?.get(other.panels);
        if (amb) { for (const it of amb.items.values()) it.frames.forEach(closeImg); for (const c of amb.creatures.values()) c.frames.forEach(closeImg); a.amb2!.delete(other.panels); }
      }
      // 別關的敵人單張立繪
      const keepImg = new Set(this.kindsOf(st).map((k) => ENEMY_DEFS[k].img));
      for (const k of this.kindsOf(other)) {
        const img = ENEMY_DEFS[k].img;
        if (keepImg.has(img)) continue;
        for (const key of [...a.enemies.keys()]) if (key.startsWith(img + '_')) { closeImg(a.enemies.get(key)); a.enemies.delete(key); }
      }
      for (const m of monstersOf(other)) {
        if (keepM.has(m)) continue;
        const mon = a.monsters.get(m);
        if (mon) for (const fr of Object.values(mon.lib.images)) fr.forEach(closeImg);
        a.monsters.delete(m); this.monsterJobs.delete(m);
      }
      this.jobs.delete(id); this.warmQ.delete(id); this.warmedPacks.delete(id); this.stageDefs.delete(id);
    }
    void this.stage(st).catch((e) => console.warn(e));
  }

  /** 下一關先在背景載（結算畫面時叫；上一關等進下一關時 focus 再放掉） */
  prefetch(st: StageDef): void { void this.stage(st).catch((e) => console.warn(e)); }

  /** 量記憶體用：現在留著的圖解碼後共佔多少 MB（寬×高×4 加總），照類別分 */
  memStats(): Record<string, number> {
    const a = this.a, out: Record<string, number> = {};
    const add = (k: string, img: unknown): void => { out[k] = (out[k] ?? 0) + bytesOf(img as CanvasImageSource); };
    for (const x of a.art.values()) add('art', x.img);
    for (const l of a.ambient.values()) l.forEach((i) => add('fxAmbient', i));
    for (const l of Object.values(a.sprites.images)) l.forEach((i) => add('qiuqiu', i));
    for (const [m, x] of a.monsters) for (const l of Object.values(x.lib.images)) l.forEach((i) => add('monster:' + m, i));
    for (const [k, sp] of a.panels) for (const l of LAYERS) sp.layers[l].forEach((p) => add('panels:' + k, p.img));
    for (const i of a.enemies.values()) add('enemyStills', i);
    for (const f of a.fx?.values() ?? []) f.frames.forEach((i) => add('fx2', i));
    for (const [k, x] of a.amb2 ?? []) { for (const it of x.items.values()) it.frames.forEach((i) => add('ambient2:' + k, i)); for (const c of x.creatures.values()) c.frames.forEach((i) => add('ambient2:' + k, i)); }
    const seen = new Set<unknown>();
    const walk = (o: unknown, d = 0): void => {
      if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return;
      seen.add(o);
      if (typeof ImageBitmap !== 'undefined' && (o instanceof ImageBitmap || o instanceof HTMLCanvasElement || o instanceof HTMLImageElement)) { add('terrain', o); return; }
      for (const v of Object.values(o as Record<string, unknown>)) walk(v, d + 1);
    };
    walk(a.terrain);
    const mb: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(out)) { mb[k] = +(v / 1048576).toFixed(1); total += v; }
    mb.total = +(total / 1048576).toFixed(1);
    return mb;
  }

  /**
   * 打的時候每一格叫：魔王的動作圖照進度載、放。
   *   第一隻魔王：進關後馬上在背景載；後面的魔王：前一隻打倒了（或鏡頭離牠 6000 像素內）才載；
   *   打倒的中魔王（後面不會再出現）放掉。重新開這一關（新的世界）時照新的進度重來。
   * 剛載好的魔王圖每格預熱一點點（main.ts 叫 warmStep，打的時候只給 1 毫秒）。
   */
  playTick(w: { stage: StageDef; camX: number; bossesDone(): readonly boolean[] }): void {
    if (this.keepAll) return;
    const st = w.stage, done = w.bossesDone();
    const minions = new Set(monstersOf({ ...st, bosses: [] }));
    st.bosses.forEach((b, i) => {
      const m = ENEMY_DEFS[b.kind].img;
      const needLater = st.bosses.some((o, j) => j !== i && ENEMY_DEFS[o.kind].img === m && !done[j]);
      if (done[i]) {
        if (!b.final && !needLater && !minions.has(m) && this.a.monsters.has(m)) {
          const mon = this.a.monsters.get(m)!;
          for (const fr of Object.values(mon.lib.images)) fr.forEach(closeImg);
          this.a.monsters.delete(m); this.monsterJobs.delete(m); this.warmQ.delete('boss:' + m);
        }
        return;
      }
      const wantNow = i === 0 || done[i - 1] || w.camX > b.at - 4000;
      if (!wantNow || this.monsterJobs.has(m)) return;
      void this.monsterList.then((have) => {
        if (!have.includes(m) || this.monsterJobs.has(m)) return;
        if (TEX_Q < 0.98) frameQ.set(`${base}sprites/${MON_DIR}/${m}/`, TEX_Q * 0.88);   // 手機：魔王的圖再縮一成多（最後的魔王 105 → 81 MB）
        void this.monster(m).then((lib) => { if (lib) { const q: WarmItem[] = []; for (const fr of Object.values(lib.images)) q.push(...fr); this.warmQ.set('boss:' + m, q); } });
      });
    });
  }

  /** 背景依序載：共用包 → 每一關（前一包載完才開始下一包，不要跟正在玩的那一關搶頻寬） */
  async background(stages: readonly StageDef[]): Promise<void> {
    await this.base().catch((e) => console.warn(e));
    for (const st of stages) await this.stage(st).catch((e) => console.warn(e));
  }

  /** 這一關可以開始了嗎（載好也預熱好） */
  ready(st: StageDef): boolean {
    const id = 'stage:' + st.id, j = this.jobs.get(id), b = this.jobs.get('base');
    return !!j && !!b && j.done >= j.total && b.done >= b.total && this.warmedPacks.has('base') && this.warmedPacks.has(id);
  }

  /** 這一關準備了幾成（0～1；載入佔九成、預熱佔一成） */
  progress(st: StageDef): number {
    const ids = ['base', 'stage:' + st.id];
    let t = 0, d = 0;
    for (const id of ids) { const j = this.jobs.get(id); t += j?.total ?? 1; d += j?.done ?? 0; }
    const w = ids.filter((id) => this.warmedPacks.has(id)).length / ids.length;
    return Math.min(1, (d / Math.max(1, t)) * 0.9 + w * 0.1);
  }

  /**
   * 預熱：把載好的包裡的圖在主畫布上畫一次（幾乎透明、縮成 8×8），圖才會上傳到顯示記憶體，第一次出現時不會卡。
   * 每次最多花 budgetMs 毫秒；first＝先做這一關的（進關前）。回傳還剩幾張沒預熱
   */
  warmStep(g: CanvasRenderingContext2D, budgetMs: number, first?: StageDef, maxPx = Infinity): number {
    // 預熱的真正成本（上傳到顯示記憶體）常常算在這一格畫完送出去的時候，量不到：另外照「這一格畫了多少像素」限量
    // （09-26：只限時間，標題畫面會連續幾格 40～90 毫秒）
    const t0 = performance.now();
    let px = 0;
    const order = [...this.warmQ.keys()].sort((x, y) => (x === 'base' ? -1 : y === 'base' ? 1 : first && x === 'stage:' + first.id ? -1 : first && y === 'stage:' + first.id ? 1 : 0));
    let left = 0;
    g.save(); g.globalAlpha = 0.01;
    for (const id of order) {
      const q = this.warmQ.get(id)!;
      while (q.length && performance.now() - t0 < budgetMs && px < maxPx) {
        const x = q.pop()!;
        const t1 = performance.now();
        let im: CanvasImageSource | null = null;
        try { im = typeof x === 'function' ? x() : x; g.drawImage(im, 0, 0, 8, 8); } catch { /* 畫不了就算了 */ }
        const dt = performance.now() - t1;
        px += ((im as { width?: number } | null)?.width ?? 0) * ((im as { height?: number } | null)?.height ?? 0);
        if (dt > 8 && this.slowWarm.length < 200) { const m = im as { width?: number; height?: number; src?: string } | null; this.slowWarm.push({ id, ms: +dt.toFixed(1), kind: typeof x === 'function' ? 'tint' : (im?.constructor?.name ?? '?'), w: m?.width ?? 0, h: m?.height ?? 0, src: (m?.src ?? '').split('/').slice(-3).join('/') }); }
      }
      if (!q.length) { this.warmQ.delete(id); this.warmedPacks.add(id); }
      left += q.length;
    }
    g.restore();
    return left;
  }

  /** 工具用（截圖檢查）：全部載完、全部預熱完 */
  /** 工具（截圖檢查）全部載完之後不再放掉別關 */
  private keepAll = false;
  async all(stages: readonly StageDef[], g: CanvasRenderingContext2D): Promise<void> {
    this.keepAll = true;
    await this.background(stages);
    const have = await this.monsterList;
    await Promise.all(have.map((m) => this.monster(m)));
    while (this.warmStep(g, 1e9) > 0) { /* 一次預熱完 */ }
  }
}

/** 放掉一張圖的解碼記憶體（ImageBitmap 才有 close；放掉之後就不能再畫，呼叫的地方要先把參照拿掉） */
function closeImg(img: unknown): void { (img as { close?: () => void } | null)?.close?.(); }

/** 圖的實心底線：最下面一列「至少 3 個像素透明度 ≥128」的下緣（圖的像素）。道具貼地用它，圖底有透明留白也不會浮起來 */
function solidFoot(img: HTMLImageElement): number {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, w = c.width;
  for (let y = c.height - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) if (d[i]! >= 128 && ++n >= 3) return y + 1;
  }
  return c.height;
}

/**
 * 讀 art/terrain.json（美術代理 09-26 用 Codex 重畫的地面帶、崖壁、屋子、竹架木架、支柱、道具）。
 * 缺檔或缺圖：那一項就沒有，畫的地方退回程式畫。
 */
async function loadTerrainArt(): Promise<TerrainArt | null> {
  let J: Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const r = await fetch(base + 'art/terrain.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    J = await r.json();
  } catch { return null; }
  const one = async (m: { path?: string; standY?: number } | undefined, foot = false): Promise<TImg | null> => {
    if (!m?.path) return null;
    const full = await loadImg('art/' + m.path);
    if (!full) return null;
    // 實心底線用原尺寸量；手機再縮成 TEX_Q 存（寬高、底線都還是原檔的像素，畫的地方都給目的大小）
    const w = full.naturalWidth, h = full.naturalHeight, footY = foot ? solidFoot(full) : h;
    const img = TEX_Q < 0.98 ? await shrinkTo(full, TEX_Q) as HTMLImageElement : full;
    return { img, w, h, standY: m.standY ?? 0, footY };
  };
  const out: TerrainArt = { ground: {}, zones: {}, wall: {}, house: null, rail: {}, post: {}, props: {}, deck: {}, building: {}, stair: {}, platform: {}, water: {}, anim: {}, ending: {} };
  const jobs: Promise<void>[] = [];
  for (const [k, g] of Object.entries(J.ground ?? {})) {
    if (k === '_zones') { out.zones = g as Record<string, string>; continue; }
    jobs.push(one(g as { path: string; standY: number }).then((t) => { if (t) out.ground[k] = { ...t, bottomColor: (g as { bottomColor?: string }).bottomColor ?? '#130b04' }; }));
  }
  for (const [k, wv] of Object.entries(J.wall ?? {})) {
    const W = wv as { top: { path: string; standY: number }; body: { path: string }; faceX: number };
    jobs.push(Promise.all([one(W.top), one(W.body)]).then(([top, body]) => { if (top && body) out.wall[k] = { top, body, faceX: W.faceX }; }));
  }
  if (J.house) {
    const H = J.house;
    jobs.push(Promise.all([one(H.left), one(H.mid), one(H.right)]).then(([left, mid, right]) => {
      if (left && mid && right) out.house = { left, mid, right, leftRidgeX: H.left.ridgeX, rightRidgeX: H.right.ridgeX, standY: H.standY, bottomY: H.bottomY };
    }));
  }
  for (const [k, rv] of Object.entries(J.rail ?? {})) {
    const R = rv as { left: { path: string }; mid: { path: string }; right: { path: string }; standY: number; displayScale?: number; post: string; midFrames?: { path: string }[]; fps?: number };
    jobs.push(Promise.all([one(R.left), one(R.mid), one(R.right), ...(R.midFrames ?? []).map((f) => one(f))]).then(([left, mid, right, ...mf]) => {
      const frames = mf.filter((f): f is TImg => !!f);
      if (left && mid && right) out.rail[k] = { left, mid, right, standY: R.standY, scale: R.displayScale ?? 0.5, post: R.post, ...(frames.length ? { midFrames: frames, fps: R.fps ?? 12 } : {}) };
    }));
  }
  for (const [k, pv] of Object.entries(J.post ?? {})) {
    if (k.startsWith('_')) continue;
    const P = pv as { path: string; displayScale?: number };
    jobs.push(one(P).then((t) => { if (t) out.post[k] = { ...t, scale: P.displayScale ?? 0.5 }; }));
  }
  for (const [k, pv] of Object.entries(J.props ?? {})) {
    if (k.startsWith('_')) continue;
    const P = pv as { path: string; displayScale?: number; anchor?: string; displaySize?: number; displayW?: number };
    const bottom = (P.anchor ?? '') === 'bottom-center';
    jobs.push(one(P, bottom).then((t) => {
      if (t) out.props[k] = { ...t, scale: P.displayScale ?? 1, anchor: P.anchor ?? 'center', ...(P.displaySize ?? P.displayW ? { size: (P.displaySize ?? P.displayW)! } : {}) };
    }));
  }
  // ── 第二批（09-26）：木柵／矮牆、攤位長屋、石階、大鳥居、河面、營火、結局圖 ──
  type Piece = { path: string; standY?: number };
  for (const [k, dv] of Object.entries(J.deck ?? {})) {
    const D = dv as { left: Piece; mid: Piece; right: Piece; standY: number; displayScale?: number; standable?: boolean };
    jobs.push(Promise.all([one(D.left), one(D.mid), one(D.right)]).then(([left, mid, right]) => {
      if (left && mid && right) out.deck[k] = { left, mid, right, standY: D.standY, scale: D.displayScale ?? 0.5, standable: !!D.standable };
    }));
  }
  for (const [k, bv] of Object.entries(J.building ?? {})) {
    const B = bv as { left: Piece & { ridgeX: number }; mid: Piece; midVariants?: Piece[]; right: Piece & { ridgeX: number }; standY: number; bottomY: number };
    jobs.push(Promise.all([one(B.left), one(B.right), one(B.mid), ...(B.midVariants ?? []).map((m) => one(m))]).then(([left, right, ...mids]) => {
      const ok = mids.filter((m): m is TImg => !!m);
      if (left && right && ok.length) out.building[k] = { left, right, mids: ok, leftRidgeX: B.left.ridgeX, rightRidgeX: B.right.ridgeX, standY: B.standY, bottomY: B.bottomY };
    }));
  }
  for (const [k, sv] of Object.entries(J.stair ?? {})) {
    const S = sv as { top: Piece; body: Piece; faceX: number; displayScale?: number };
    jobs.push(Promise.all([one(S.top), one(S.body)]).then(([top, body]) => { if (top && body) out.stair[k] = { top, body, faceX: S.faceX, scale: S.displayScale ?? 0.5 }; }));
  }
  for (const [k, pv] of Object.entries(J.platform ?? {})) {
    const P = pv as Piece & { standX0: number; standX1: number; displayScale?: number; anchor?: string };
    const bottom = (P.anchor ?? '') === 'bottom-center';
    jobs.push(one(P, bottom).then((t) => { if (t) out.platform[k] = { ...t, standX0: P.standX0, standX1: P.standX1, scale: P.displayScale ?? 0.5, anchor: P.anchor ?? 'stand-line' }; }));
  }
  for (const [k, wv] of Object.entries(J.water ?? {})) {
    const Wt = wv as { frames: Piece[]; surfaceY: number; fps?: number; displayScale?: number; bottomColor?: string };
    jobs.push(Promise.all(Wt.frames.map((f) => one(f))).then((fs) => {
      const ok = fs.filter((f): f is TImg => !!f);
      if (ok.length) out.water[k] = { frames: ok, surfaceY: Wt.surfaceY, fps: Wt.fps ?? 6, scale: Wt.displayScale ?? 1, bottomColor: Wt.bottomColor ?? '#000307' };
    }));
  }
  for (const [k, av] of Object.entries(J.anim ?? {})) {
    const A = av as { base: Piece & { displayScale?: number }; frames: Piece[]; fps?: number; displayScale?: number; baseX?: number };
    jobs.push(Promise.all([one(A.base, true), ...A.frames.map((f) => one(f))]).then(([base, ...fs]) => {
      const ok = fs.filter((f): f is TImg => !!f);
      if (base && ok.length) out.anim[k] = { base: { ...base, scale: A.base.displayScale ?? 0.5 }, frames: ok, fps: A.fps ?? 8, scale: A.displayScale ?? 0.5, baseX: A.baseX ?? ok[0]!.w / 2 };
    }));
  }
  for (const [k, ev] of Object.entries(J.ending ?? {})) jobs.push(one(ev as Piece).then((t) => { if (t) out.ending[k] = t; }));
  await Promise.all(jobs);
  // 寨門：完好版與打爛版的柱子是同一個位置，共用完好版的底線（打爛版多出來的碎木埋進地面帶），換圖時柱子才不會跳
  if (out.props.gate && out.props.gate_broken) out.props.gate_broken.footY = out.props.gate.footY;
  if (out.props.s3_gate && out.props.s3_gate_broken) out.props.s3_gate_broken.footY = out.props.s3_gate.footY;
  return out;
}

/** 地面帶最下面 12 列的平均顏色（不透明的像素） */
function bottomColor(img: HTMLImageElement): string {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = 12;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, img.naturalHeight - 12, img.naturalWidth, 12, 0, 0, img.naturalWidth, 12);
  const d = g.getImageData(0, 0, c.width, 12).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200) { r += d[i]!; gg += d[i + 1]!; b += d[i + 2]!; n++; }
  if (!n) return '#4a2e1c';
  return `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`;
}

/** 把圖變成單色剪影（打中閃白、魔王受傷閃紅、出招預兆閃紅），做一次存起來；單張立繪、逐格動作圖（ImageBitmap）都可以 */
const tintCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();
export function tintOf(img: CanvasImageSource, color: string): HTMLCanvasElement {
  let m = tintCache.get(img as object);
  if (!m) { m = new Map(); tintCache.set(img as object, m); }
  let c = m.get(color);
  if (!c) {
    c = document.createElement('canvas');
    // 剪影照圖「實際存的大小」做（手機載入時縮過的圖比 naturalWidth 小）；畫的地方都有給目的寬高
    const im = img as { width: number; height: number };
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    m.set(color, c);
  }
  return c;
}
