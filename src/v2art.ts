/**
 * 第二版地形美術（public/art/v2/v2_terrain.json＋v2.json 的 climbUp）：用到才載（練習場、之後加長的關卡），不進開場的載入清單。
 * 圖還沒載好的那幾格，畫的地方退回程式畫（方塊畫成色塊、藤蔓畫成線），不會卡住遊戲。
 *
 * 畫法照美術代理的模擬程式 tools/sim_v2.py（同一套 json 欄位），09-28 接進遊戲時處理的美術問題：
 *   - 坡的角度：生出來的坡帶實際量到的角度（drawnDeg）跟名目（20°／30°）差到 2～8 度；挑圖照「這段坡實際的角度」找最接近的 drawnDeg，
 *     關卡用 `TerrainBuilder.slopeDeg()` 照 drawnDeg 拉坡，碰撞線就是畫出來的坡面
 *   - 第三關鐵方塊跟背景太像：BLOCK_TUNE 給它提亮＋外緣暖色描邊
 *   - 往上捲的背景跟長卷硬接：接縫那條蓋一層漸層霧（CLIMB_SEAM）
 */
const base = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';

type J = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let terrainJ: J | null = null, v2J: J | null = null, asked = false;
const imgs = new Map<string, HTMLImageElement | null>();

function ask(): void {
  if (asked || typeof fetch === 'undefined') return;
  asked = true;
  fetch(base + 'art/v2/v2_terrain.json').then((r) => r.json()).then((j) => { terrainJ = j; }).catch(() => { /* 沒有就全部程式畫 */ });
  fetch(base + 'art/v2/v2.json').then((r) => r.json()).then((j) => { v2J = j; }).catch(() => {});
}

/** 取一張圖（載好了才回傳；第一次叫的時候開始載） */
function img(path: string | undefined): HTMLImageElement | null {
  if (!path || typeof Image === 'undefined') return null;
  if (!imgs.has(path)) {
    imgs.set(path, null);
    const im = new Image();
    im.onload = () => { imgs.set(path, im); };
    im.src = base + 'art/' + path;
  }
  return imgs.get(path) ?? null;
}

export function v2Ready(): boolean { ask(); return !!terrainJ; }

/** 方塊的調整（美術問題修正） */
const BLOCK_TUNE: Record<string, { filter?: string; rim?: string }> = {
  // 第三關鐵方塊顏色跟背景的鐵牆太像（09-28 美術檢查）：提亮一點＋外緣暖色描邊，看得出「這是能站能蹬的東西」
  s3_iron: { filter: 'brightness(1.22) contrast(1.08)', rim: 'rgba(255,196,120,.75)' },
};

/** 實心方塊（九宮格）；回傳有沒有用圖畫 */
export function drawBlock(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number): boolean {
  ask();
  const B = terrainJ?.block?.[key];
  if (!B) return fallbackBlock(ctx, x, y, w, h);
  const P: Record<string, HTMLImageElement | null> = {};
  for (const [k, v] of Object.entries(B.pieces as Record<string, { path: string }>)) P[k] = img(v.path);
  if (Object.values(P).some((p) => !p)) return fallbackBlock(ctx, x, y, w, h);
  const pl = B.place, C = P.center!, tune = BLOCK_TUNE[key];
  ctx.save();
  if (tune?.filter) ctx.filter = tune.filter;
  const cw = C.naturalWidth, ch = C.naturalHeight;
  for (let yy = y; yy < y + h; yy += ch) for (let xx = x; xx < x + w; xx += cw) {
    const dw = Math.min(cw, x + w - xx), dh = Math.min(ch, y + h - yy);
    ctx.drawImage(C, 0, 0, dw, dh, xx, yy, dw, dh);
  }
  const T = P.top!, Bo = P.bottom!, L = P.left!, R = P.right!;
  for (let xx = x; xx < x + w; xx += T.naturalWidth) {
    const wc = Math.min(T.naturalWidth, x + w - xx);
    ctx.drawImage(T, 0, 0, wc, T.naturalHeight, xx, y - pl.top.oy, wc, T.naturalHeight);
    ctx.drawImage(Bo, 0, 0, wc, Bo.naturalHeight, xx, y + h - pl.bottom.oy, wc, Bo.naturalHeight);
  }
  for (let yy = y; yy < y + h; yy += L.naturalHeight) {
    const hc = Math.min(L.naturalHeight, y + h - yy);
    ctx.drawImage(L, 0, 0, L.naturalWidth, hc, x - pl.left.ox, yy, L.naturalWidth, hc);
    ctx.drawImage(R, 0, 0, R.naturalWidth, hc, x + w - pl.right.ox, yy, R.naturalWidth, hc);
  }
  ctx.drawImage(P.tl!, x - pl.tl.ox, y - pl.tl.oy);
  ctx.drawImage(P.tr!, x + w - pl.tr.ox, y - pl.tr.oy);
  ctx.drawImage(P.bl!, x - pl.bl.ox, y + h - pl.bl.oy);
  ctx.drawImage(P.br!, x + w - pl.br.ox, y + h - pl.br.oy);
  ctx.filter = 'none';
  if (tune?.rim) {
    ctx.strokeStyle = tune.rim; ctx.lineWidth = 3;
    ctx.shadowColor = tune.rim; ctx.shadowBlur = 8;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
  ctx.restore();
  return true;
}

function fallbackBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): boolean {
  ctx.fillStyle = '#4b3d3a'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1e1512'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = '#7f6a4a'; ctx.fillRect(x, y, w, 10);
  return false;
}

/** 岩棚（單向平台）：左端＋中段×n＋右端，第 standY 列＝站的線 */
export function drawLedge(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number): boolean {
  ask();
  const R = terrainJ?.ledge?.[key];
  const L = img(R?.left?.path), M = img(R?.mid?.path), Rr = img(R?.right?.path);
  if (!R || !L || !M || !Rr) {
    ctx.fillStyle = '#5a4a3a'; ctx.fillRect(x, y, w, 26);
    ctx.fillStyle = '#8a7a52'; ctx.fillRect(x, y, w, 6);
    return false;
  }
  const sc = R.displayScale as number;
  const n = Math.max(0, Math.round((w / sc - L.naturalWidth - Rr.naturalWidth) / M.naturalWidth));
  const total = L.naturalWidth + n * M.naturalWidth + Rr.naturalWidth, kx = w / total, hh = L.naturalHeight * sc;
  const top = y - R.standY * sc;
  let xx = x;
  ctx.drawImage(L, xx, top, L.naturalWidth * kx, hh); xx += L.naturalWidth * kx;
  for (let i = 0; i < n; i++) { ctx.drawImage(M, xx - 0.5, top, M.naturalWidth * kx + 1, hh); xx += M.naturalWidth * kx; }
  ctx.drawImage(Rr, xx - 0.5, top, Rr.naturalWidth * kx + 0.5, hh);
  return true;
}

/** 攀爬物：body 上下重複鋪滿、頂端與底端蓋上去；畫的範圍＝腳能到的 top 往上多畫一截（手抓得到的地方）到 bottom */
export function drawClimb(ctx: CanvasRenderingContext2D, key: string, x: number, top: number, bottom: number): boolean {
  ask();
  const C = terrainJ?.climb?.[key];
  const T = img(C?.top?.path), Bd = img(C?.body?.path), Bt = img(C?.bottom?.path);
  const y0 = top - 150;
  if (!C || !T || !Bd || !Bt) {
    ctx.strokeStyle = '#3f6b2a'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, bottom); ctx.stroke();
    return false;
  }
  const sc = C.displayScale as number;
  const bw = Bd.naturalWidth * sc, bh = Bd.naturalHeight * sc, th = T.naturalHeight * sc, eh = Bt.naturalHeight * sc;
  for (let y = y0 + th * 0.5; y < bottom - eh * 0.5; y += bh - 1) {
    const dh = Math.min(bh, bottom - y);
    ctx.drawImage(Bd, 0, 0, Bd.naturalWidth, dh / sc, x - bw / 2, y, bw, dh);
  }
  ctx.drawImage(Bt, x - Bt.naturalWidth * sc / 2, bottom - eh, Bt.naturalWidth * sc, eh);
  ctx.drawImage(T, x - T.naturalWidth * sc / 2, y0, T.naturalWidth * sc, th);
  return true;
}

/** 陡坡帶：照這段坡的方向與實際角度，挑 drawnDeg 最接近的那張（差 6 度以上不用）；flat＝這一段平地帶的名字（village、s1_rock…） */
export function slopeArt(flat: string, k: number): { img: HTMLImageElement; w: number; h: number; standY: number; bottomColor: string; drawnDeg: number } | null {
  ask();
  if (!terrainJ?.slope || Math.abs(k) < 0.25) return null;
  const deg = Math.atan(Math.abs(k)) * 180 / Math.PI, dir = k < 0 ? 'up' : 'down';
  let best: J | null = null, bd = 6;
  for (const S of Object.values(terrainJ.slope as Record<string, J>)) {
    const f = /ground_([a-z0-9_]+)\.webp$/.exec(String(S.flat ?? S.path))?.[1];
    if (f !== flat && f !== flat.replace(/^s\d_/, '')) continue;
    if (S.slope.dir !== dir) continue;
    const d = Math.abs(S.slope.drawnDeg - deg);
    if (d < bd) { bd = d; best = S; }
  }
  const im = img(best?.path);
  if (!best || !im) return null;
  return { img: im, w: best.w, h: best.h, standY: best.standY, bottomColor: best.bottomColor, drawnDeg: best.slope.drawnDeg };
}

/** 第二版平地帶（s1_rock、s3_wet…；舊的 village／bamboo 在 terrain.json） */
export function v2Ground(key: string): { img: HTMLImageElement; w: number; h: number; standY: number; bottomColor: string } | null {
  ask();
  const G = terrainJ?.ground?.[key];
  const im = img(G?.path);
  return G && im ? { img: im, w: G.w, h: G.h, standY: G.standY, bottomColor: G.bottomColor } : null;
}

/** 往上捲背景接縫的霧（長卷頂端硬接上往上延伸的那一塊） */
export const CLIMB_SEAM = 90;

/**
 * 往上捲的背景：中景（climbUp[bg]）一塊一塊往上接在長卷頂上；最遠景（climbUp[<關>_far]）接在最遠景長卷頂上。
 * midY／farY＝長卷頂在畫面上的 y（往上捲時會往下移）；midOff／farOff＝長卷這一層的水平捲動量
 */
export function drawClimbBg(ctx: CanvasRenderingContext2D, bg: string, layer: 'far' | 'mid', off: number, topY: number, viewW: number, free = false): void {
  ask();
  const C = v2J?.climbUp?.[bg];
  if (!C || topY <= 0) return;
  if (layer === 'far') {
    const im = img(C.path);
    if (!im) return;
    const k = C.height > 0 ? im.naturalHeight / C.height : 1;
    const x = -(off % C.w);
    for (let xx = x; xx < viewW; xx += C.w) ctx.drawImage(im, xx, topY - C.height, C.w, C.height);
    void k;
  } else {
    // 中景那一欄 1536 寬：畫在長卷上對應的位置；練習場這種長卷對不上的地方，夾在畫面裡（整片蓋住畫面寬）。
    // free＝關卡的攀爬段剛好停在這一欄底下（climbAligned）：照長卷一起捲，爬完往右走時這一欄跟著長卷往左移出去（旁邊露出最遠景的夜空）
    const x = free ? C.x - off : Math.min(0, Math.max(viewW - C.w, C.x - off));
    for (const p of C.pieces as { path: string; y: number; h: number }[]) {
      const im = img(p.path);
      if (im) ctx.drawImage(im, x, topY + p.y, C.w, p.h);
    }
  }
  // 接縫：長卷頂上下蓋一條漸層霧
  const g = ctx.createLinearGradient(0, topY - CLIMB_SEAM, 0, topY + CLIMB_SEAM * 0.6);
  const tint = layer === 'far' ? '210,190,220' : '200,205,225';
  // 對齊的（free）那一欄本來就是照長卷頂往上畫的，接縫幾乎看不出來：霧只留一點點，不然霧本身變成一條白帶（09-29 截圖）
  const fog = (layer === 'far' ? 0.5 : 0.42) * (free ? 0.3 : 1);
  g.addColorStop(0, `rgba(${tint},0)`); g.addColorStop(0.55, `rgba(${tint},${fog})`); g.addColorStop(1, `rgba(${tint},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, topY - CLIMB_SEAM, viewW, CLIMB_SEAM * 1.6);
}

/** climbUp 裡有沒有這一關的最遠景往上延伸（s1_far） */
export function hasClimbBg(key: string): boolean { ask(); return !!v2J?.climbUp?.[key]; }

/** 第二版崖壁（s1_rock、s2_rock、s3_plaster）：格式同 terrain.json 的 wall（頂塊＋壁身、faceX） */
export function v2Wall(key: string): { top: { img: HTMLImageElement; w: number; h: number; standY: number; footY: number }; body: { img: HTMLImageElement; w: number; h: number; standY: number; footY: number }; faceX: number } | null {
  ask();
  const W = terrainJ?.wall?.[key];
  const t = img(W?.top?.path), b = img(W?.body?.path);
  if (!W || !t || !b) return null;
  return { top: { img: t, w: W.top.w, h: W.top.h, standY: W.top.standY, footY: W.top.h }, body: { img: b, w: W.body.w, h: W.body.h, standY: 0, footY: W.body.h }, faceX: W.faceX };
}

/** 關卡的攀爬段鏡頭停住（hold）時，中景往上延伸的那一欄剛好蓋滿畫面嗎（第一關瀑布大攀爬照這個對齊） */
export function climbAligned(bg: string, holdOff: number, viewW: number): boolean {
  ask();
  const C = v2J?.climbUp?.[bg];
  if (!C) return false;
  const x = C.x - holdOff;
  return x <= 1 && x >= viewW - C.w - 1;
}

/** 先把往上捲背景的圖叫來載（進關就叫，爬到那裡才不會空一下） */
export function warmClimbBg(keys: string[]): void {
  ask();
  if (!v2J) return;
  for (const k of keys) {
    const C = v2J.climbUp?.[k];
    if (!C) continue;
    if (C.path) img(C.path);
    for (const p of (C.pieces ?? []) as { path: string }[]) img(p.path);
  }
}

/**
 * 瀑布（v2_terrain.json waterfall）：part＝back 畫水柱（往下捲＝在流）＋白沫＋水口，在地形後面；
 * front 畫落水水花（4 格循環）＋水霧（左右慢慢飄），在地形（水潭）之後、角色之前。t＝秒
 */
export function drawWaterfall(ctx: CanvasRenderingContext2D, key: string, x: number, top: number, bottom: number, t: number, part: 'back' | 'front'): boolean {
  ask();
  const W = terrainJ?.waterfall?.[key];
  if (!W) return false;
  if (part === 'back') {
    const col = img(W.column?.path), foam = img(W.foam?.path), lip = img(W.lip?.path);
    if (!col) return false;
    const cw = W.column.w as number, ch = W.column.h as number;
    ctx.save();
    ctx.beginPath(); ctx.rect(x - cw / 2, top, cw, bottom - top + 20); ctx.clip();
    const off = (t * 360) % ch;
    for (let y = top - ch + off; y < bottom + 20; y += ch - 1) ctx.drawImage(col, x - cw / 2, Math.floor(y), cw, ch);
    if (foam) {
      const fh = W.foam.h as number, fo = (t * 540) % fh;
      ctx.globalAlpha = 0.55;
      for (let y = top - fh + fo; y < bottom + 20; y += fh - 1) ctx.drawImage(foam, x - W.foam.w / 2, Math.floor(y), W.foam.w, fh);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (lip) ctx.drawImage(lip, x - W.lip.w / 2, top - W.lip.h * 0.45, W.lip.w, W.lip.h);
    return true;
  }
  const fr = (W.splash?.frames ?? []) as { path: string; w: number; h: number }[];
  const f = fr.length ? fr[Math.floor(t * (W.splash.fps ?? 10)) % fr.length]! : null;
  const sp = f ? img(f.path) : null;
  const mist = img(W.mist?.path);
  if (mist) {
    // 兩層水霧：一層往左、一層往右，慢慢飄
    for (const [k, a] of [[1, 0.5], [-1, 0.35]] as const) {
      const dx = Math.sin(t * 0.35 * k + (k > 0 ? 0 : 2)) * 60;
      ctx.globalAlpha = a;
      ctx.drawImage(mist, x - W.mist.w / 2 + dx, bottom - W.mist.h * 0.72 - (k > 0 ? 0 : 30), W.mist.w, W.mist.h);
    }
    ctx.globalAlpha = 1;
  }
  if (sp && f) {
    const k = (W.column.w * 1.15) / f.w;
    ctx.drawImage(sp, x - (W.splash.baseX ?? f.w / 2) * k, bottom - f.h * k * 0.82, f.w * k, f.h * k);
  }
  return true;
}

/** 瀑布底下的水潭（waterfall.<套>.pool）：幾格輪播、左右重複；回傳 null＝沒有這套圖 */
export function poolArt(key: string): { frames: HTMLImageElement[]; w: number; h: number; surfaceY: number; fps: number; bottomColor: string } | null {
  ask();
  const P = terrainJ?.waterfall?.[key]?.pool;
  if (!P) return null;
  const frames = (P.frames as { path: string }[]).map((f) => img(f.path));
  if (frames.some((f) => !f)) return null;
  return { frames: frames as HTMLImageElement[], w: P.frames[0].w, h: P.frames[0].h, surfaceY: P.surfaceY, fps: P.fps, bottomColor: P.bottomColor };
}
