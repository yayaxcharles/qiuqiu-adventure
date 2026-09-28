import { loadAssets, tintOf, type Assets } from './assets';
import { createBot } from './autopilot';
import { VIEW_H, VIEW_W } from './entities';
import { Game } from './game';
import { darkOf, HIT_RIM, NINJA_RIM, SIL_FILTER, WARN_RIM } from './render';
import { attachInput, consume, heldOnly, NO_INPUT, setDevKeys, type Frame } from './input';
import { attachTouch, isTouchDevice } from './touch';
import { SCALE } from './player';
import { bootStats, drawFrame, loadFrameSlow } from './sprite';
import { PRACTICE, STAGES } from './stages';

function fit(canvas: HTMLCanvasElement): void {
  const k = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = `${Math.floor(VIEW_W * k)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * k)}px`;
}

/**
 * （舊）開局前把每張圖畫一次。09-26 起改成 AssetLoader.warmStep：一包一包、在標題／準備中畫面分幾格做（見 assets.ts）。
 * 留著給沒有背景載入的情況（目前沒用到）。
 */
export function warmUp(a: Assets, g: CanvasRenderingContext2D): void {
  // 畫在主畫布上（幾乎透明、縮成 8×8）：圖要上傳到主畫布用的顯示記憶體才算預熱到，畫在別張畫布上沒用（09-26 實機量過）
  g.save(); g.globalAlpha = 0.01;
  const draw = (img: CanvasImageSource): void => { try { g.drawImage(img, 0, 0, 8, 8); } catch { /* 畫不了就算了 */ } };
  for (const x of a.art.values()) draw(x.img);
  for (const sp of a.panels.values()) for (const layer of Object.values(sp.layers)) for (const p of layer) draw(p.img);
  for (const list of a.ambient.values()) for (const img of list) draw(img);
  for (const [k, img] of a.enemies) {
    draw(img); draw(tintOf(img, '#ffffff')); draw(tintOf(img, '#ff2a2a'));
    if (/drum_tanuki|orange_king|frog_daimyo|tanuki_lord|roomba_king|iron_claw/.test(k)) draw(tintOf(img, '#ff5a4a'));   // 魔王受傷閃紅
  }
  // 地形、道具、平台、蒸氣、結局圖（terrain.json）：第一次畫到才上傳會卡一下（09-26 第三關實機量到進工廠那格 109 毫秒）
  const walk = (o: unknown, depth = 0): void => {
    if (!o || typeof o !== 'object' || depth > 5) return;
    if (o instanceof HTMLImageElement || o instanceof HTMLCanvasElement || o instanceof ImageBitmap) { draw(o); return; }
    for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(a.terrain);
  const bamboo = a.terrain?.props.s1_bamboo_fore;
  if (bamboo) draw(darkOf(bamboo.img, 0.55));   // 前景竹叢的壓暗版（第一次用要先做出來）
  for (const frames of Object.values(a.sprites.images)) for (const img of frames) draw(img);
  for (const m of a.monsters.values()) for (const frames of Object.values(m.lib.images)) for (const img of frames) draw(img);
  g.restore();
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  fit(canvas);
  window.addEventListener('resize', () => fit(canvas));
  const say = (msg: string): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16121c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#f3e9d8'; ctx.font = '28px "Microsoft JhengHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, VIEW_W / 2, VIEW_H / 2);
  };
  say('載入中…');
  const boot: Record<string, number> = { start: performance.now() };
  (window as unknown as { __boot: typeof boot; __bootStats: typeof bootStats }).__boot = boot;
  (window as unknown as { __bootStats: typeof bootStats }).__bootStats = bootStats;
  const assets = await loadAssets(say);
  boot.assetsDone = performance.now();
  // 邊光濾鏡第一次用要編譯（實機量到第一次看到忍者那格卡 103 毫秒）：開局前先在主畫布上用一次（隨便一張圖就行）
  const anyImg = [...assets.art.values()][0]?.img;
  if (anyImg) {
    for (const f of [NINJA_RIM, WARN_RIM, HIT_RIM, `${NINJA_RIM} ${WARN_RIM}`, SIL_FILTER]) { ctx.save(); ctx.filter = f; ctx.globalAlpha = 0.02; ctx.drawImage(anyImg, 0, 0, 8, 8); ctx.restore(); }
  }
  const game = new Game(assets);
  const loader = assets.loader!;
  game.loader = loader;
  const q = new URLSearchParams(location.search);
  if (q.has('god')) game.startGod = true;
  if (q.has('dev')) { setDevKeys(true); game.devKeys = true; }   // 開發用按鍵（數字鍵換忍具、F2 無敵…）只在網址帶 ?dev 時有效
  if (q.has('bot')) game.bot = createBot();
  if (q.has('boxes')) game.renderer.debugBoxes = true;
  if (q.has('pick')) game.pickStage = Math.max(0, Math.min(STAGES.length - 1, Number(q.get('pick')) - 1));   // 標題畫面先選好第幾關（自動玩從標題開始用）
  game.touch = isTouchDevice();
  game.renderer.touch = game.touch;
  // 背景載入：共用包＋網址指定（或標題選到）的那一關就好（09-27 手機記憶體：不再一開始就把三關全載進來；
  // 標題換關停 1 秒才載那一關、結算畫面先載下一關，見 game.ts）
  const first = q.get('stage') === 'practice' ? PRACTICE : q.has('stage') ? (STAGES[Math.max(0, Number(q.get('stage')) - 1)] ?? STAGES[0]!) : null;
  void loader.background([first ?? STAGES[game.pickStage] ?? STAGES[0]!]);
  if (first) game.start(first);

  /** 給自動檢查用：paused 時主迴圈只畫不推，由檢查程式自己一步一步推 */
  const debug = {
    game, ctx, paused: false, assets,
    step: (dt: number, f: Frame = NO_INPUT) => game.update(dt, f),
    render: () => game.render(ctx),
    createBot, drawFrame, SCALE, PRACTICE, STAGES, loadFrameSlow, NO_INPUT,
    /** 工具用：全部載完、預熱完（截圖檢查會直接開各關、生各種怪） */
    loadAll: () => loader.all([...STAGES, PRACTICE], ctx),
    /** 工具用：現在留著的圖解碼後佔多少 MB（照類別分） */
    memStats: () => loader.memStats(),
    /** 工具用：用指定的時間（秒）畫一格（截圖工具自己推時間：天氣、背景生物、特效跟著這個時間走） */
    drawAt: (t: number) => { if (game.world) game.renderer.draw(ctx, game.world, t); },
    /** 每個畫面格花多久（毫秒），檢查卡頓用 */
    frameMs: [] as number[],
    /** 每一格當時是哪個畫面（跟 frameMs 一一對應；分得出卡頓是在進關的「準備中」還是打的時候） */
    frameScr: [] as string[],
    /** 每一格遊戲自己花的時間（推＋畫＋預熱，毫秒；跟 frameMs 一一對應）：「99% 的格在 8 毫秒內」量這個 */
    workMs: [] as number[],
    /** 超過 33 毫秒的格：這一格之前那次（推＋畫＋預熱）自己花了多久、當時在做什麼（查卡頓是遊戲自己還是瀏覽器） */
    longInfo: [] as { i: number; raw: number; prevWork: number; prevUpd: number; prevDraw: number; events: string[] }[],
  };
  (window as unknown as { __qq: typeof debug; __game: Game }).__qq = debug;
  (window as unknown as { __game: Game }).__game = game;
  attachInput();
  attachTouch(canvas, () => game.screen);   // 手機：觸控按鈕（只在觸控裝置出現）
  /*
   * 每一格畫面都照「實際經過的時間」往前推，切成不超過 1/120 秒的小步（2026-09-25 使用者：「動作不流暢」）。
   * 原本固定每步 1/120 秒、時間不夠一步就不推：240 Hz 下量到每格移動「2.8、0、2.8、0」——隔一格就停一格。
   * 現在每格一定都有推、而且推的量跟時間成正比。
   */
  const MAX_STEP = 1 / 120;
  let last = performance.now();
  let prevWork = 0, prevUpd = 0, prevDraw = 0;
  const frame = (now: number): void => {
    const w0 = performance.now();
    const raw = now - last;
    // 第一格的時間戳可能比「開始計時」還早（載入、預熱圖很久時，量到負 3 秒）→ 負的時間不能推：
    // 負的 dt 會讓閃白、震動、開場定格都「倒著加」，網址直接開第二關時整個畫面白霧＋抖 10 秒、時間不走（09-26）
    const dt = Math.min(0.05, Math.max(0, raw / 1000));
    last = now;
    if (!debug.paused && debug.frameMs.length < 200000) {
      debug.frameMs.push(+raw.toFixed(2)); debug.frameScr.push(game.screen);
      if (raw > 33.4 && debug.longInfo.length < 200) debug.longInfo.push({ i: debug.frameMs.length - 1, raw: +raw.toFixed(1), prevWork: +prevWork.toFixed(1), prevUpd: +prevUpd.toFixed(1), prevDraw: +prevDraw.toFixed(1), events: game.eventLog.slice(-5).map((e) => e.type) });
    }
    const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
    const f = consume();
    if (!debug.paused) {
      for (let i = 0; i < n; i++) game.update(dt / n, i === 0 ? f : heldOnly(f));
    }
    const w1 = performance.now();
    game.render(ctx);
    prevUpd = w1 - w0; prevDraw = performance.now() - w1;
    // 預熱：只在標題、準備中、結算這些不用打的畫面做；準備中那一關優先、每格多花一點時間
    const sc = game.screen;
    if (sc === 'play' && game.world) { loader.playTick(game.world); loader.warmStep(ctx, 1, undefined, 2e5); }   // 魔王圖照進度載、每格預熱一點點
    else if (sc === 'loading') loader.warmStep(ctx, 12, game.stage ?? undefined, 4e6);
    else if (sc === 'title' || sc === 'result' || sc === 'ending' || sc === 'gameover') loader.warmStep(ctx, 4, sc === 'title' ? STAGES[game.pickStage] : undefined, 6e5);
    if (sc === 'title' && !boot.titleShown) boot.titleShown = performance.now();
    prevWork = performance.now() - w0;
    if (!debug.paused && debug.workMs.length < debug.frameMs.length) debug.workMs.push(+prevWork.toFixed(2));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main().catch((e: unknown) => {
  console.error(e);
  const c = document.getElementById('game') as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.fillStyle = '#300'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle = '#fff'; g.font = '22px sans-serif'; g.fillText('載入失敗：' + String(e), 40, 60);
});
