/**
 * 把 world 畫出來（只讀資料、不改遊戲狀態；環境小動畫——飄雲、小鳥、落葉、炊煙、燈籠——是畫面自己的）。
 *
 * 背景（2026-09-26 使用者：「不要一個背景到底，要很多不同但相關的場景拼接起來」）：
 *   四層長卷 far（天空遠山）／midfar（遠方城鎮）／mid（近處建築）／fore（最前景），每層一張接一張往右拼、各自視差捲動。
 *   中景的捲動速率照關卡長度算：鏡頭走到最後的魔王時中景剛好看完（fitRate）；遠景、中遠景用 art.json 建議的速率，
 *   長度不夠就自動放慢。長卷還沒生出來時退回每段一張的 s1_1_far（左右重複）。
 * 地形：地面帶當材質沿著折線鋪，斜坡用錯切（shear）讓材質跟著斜，底下用地面帶最下緣的顏色填到畫面底；坑畫成深淵。
 */
import { tintOf, type ArtImg, type Assets, type LayerName, type Panel, type TerrainArt, type TImg } from './assets';
import { climbAligned, climbColumnX, drawBlock, drawClimbBacking, drawClimb, drawClimbBg, drawLedge, drawWaterfall, poolArt, slopeArt, v2Ground, v2Wall, warmClimbBg } from './v2art';
import { Ambience } from './ambience';
import { ENEMY_DEFS, enemyBox, kingPackBox } from './enemies';
import { fxDraw, loopFrame, type FxSet } from './fx2';
import { laserBox, mouthOf, RAM_DIST } from './enemies3';
import { HUD_BOTTOM, isGate, VIEW_H, VIEW_W, type Breakable, type Bullet, type Captive, type Enemy, type Particle, type Pickup, type Shot } from './entities';
import { HURT_IFRAMES, MAX_HP, SCALE, type Player } from './player';
import { drawFrame, type FrameDef } from './sprite';
import { wallFaceX } from './physics';
import type { DeckDef, PlatformDef, ZoneDef } from './stages/types';
import { SUB_ORDER, SUBS, WEAPONS } from './weapons';
import { TIP_TIME, type World } from './world';

import { FONT } from './fonts';   // 會變的匯出值：F9／?font= 換字型後，下一次組字型字串就是新的（10-09）
/** 出招預兆：紅色邊光（身體原色不變）＋這麼多的紅色疊色，一閃一閃 */
export const WARN_RIM = 'drop-shadow(0 0 2px rgba(255,50,40,1)) drop-shadow(0 0 7px rgba(255,40,30,.75))';
const WARN_A = 0.3;
/** 被打閃白：只閃最前面一兩格（flash 從 0.09～0.12 倒數，剩 0.05 以上才閃），而且淡 */
const FLASH_MIN = 0.05, FLASH_A = 0.45;
/**
 * 魔王被打、出招預兆：身體保持原本的顏色，只加一圈紅橘色的邊光＋很淡的疊色（09-26：鐵爪機關貓二階被連續打中時，
 * 36% 的紅橘疊色一直開著，整隻暗鐵色被洗成淺橘粉色；魔王又大又常被打，疊色要比小兵淡很多）
 */
export const HIT_RIM = 'drop-shadow(0 0 3px rgba(255,110,70,1)) drop-shadow(0 0 9px rgba(255,90,50,.6))';
const BOSS_TINT_A = 0.12;
/** 整隻偏黑、在夜晚或暗色背景看不清楚的敵人：加淡紫白邊光（09-26 獨立審查 中 6） */
const DARK_KINDS = new Set(['black_ninja', 'tadpole', 'armor_ghost', 'iron_arhat']);
/** 黑衣忍者的邊光（整隻黑色，暗背景上看不清楚） */
export const NINJA_RIM = 'drop-shadow(0 0 1.5px rgba(225,215,255,.95)) drop-shadow(0 0 5px rgba(160,140,255,.55))';
/** 打雷一瞬間前面的東西變黑色剪影（天守閣頂暴風雨） */
export const SIL_FILTER = 'brightness(0.08)';
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

interface Leaf { x: number; y: number; vx: number; vy: number; rot: number; spin: number; s: number; ph: number }
interface Puff { x: number; y: number; vx: number; vy: number; r: number; age: number; life: number; ember: boolean }

export class Renderer {
  private leaves: Leaf[] = [];
  private puffs: Puff[] = [];
  private lastCam = 0;
  private lastT = 0;
  private emitT = 0;
  /** 開發用：畫判定框 */
  debugBoxes = false;
  /** 手機（觸控）：提示字裡的鍵盤按鍵換成觸控按鈕的名字 */
  touch = false;
  private tt(s: string): string {
    if (!this.touch || !s) return s;
    let r = s;
    for (const [a, b] of TOUCH_WORDS) r = r.split(a).join(b);
    return r;
  }

  /** 天氣、背景生物、大場面（ambient2；只當背景，不扣血） */
  readonly amb: Ambience;
  constructor(private readonly a: Assets) { this.amb = new Ambience(a); }

  art(k: string): ArtImg | undefined { return this.a.art.get(k); }
  /** 第三批美術（fx2.json）的一組圖；沒有就回 undefined，畫的地方退回舊畫法 */
  fx(k: string): FxSet | undefined { return this.a.fx?.get(k); }

  /** 一次性的小特效（揮爪弧光、丟出閃光、重生光柱、小閃光）：畫面自己的，不影響遊戲 */
  private oneShots: { key: string; x: number; y: number; t: number; life: number; s: number; flip?: boolean; rot?: number; light?: boolean }[] = [];
  private clawSerial = -1;

  /** 遊戲事件（game.ts 每一格轉過來）：丟出閃光、重生光柱、撿道具的小閃光 */
  onEvent(ev: { type: string; [k: string]: unknown }, w: World): void {
    const b = w.player.body, f = b.facing;
    if (ev.type === 'fire' && this.fx('throw_flash')) {
      const aim = ev.aim as string | undefined;
      const up = aim === 'up', down = aim === 'down', diag = aim === 'diag';
      if (diag) this.oneShots.push({ key: 'throw_flash', x: b.x + f * 60, y: b.y - 175, t: 0, life: 0.09, s: 0.5, rot: f > 0 ? -Math.PI / 4 : -Math.PI * 3 / 4 });
      else this.oneShots.push({ key: 'throw_flash', x: b.x + (up || down ? f * 20 : f * 72), y: b.y - (up ? 205 : down ? 60 : 122), t: 0, life: 0.09, s: 0.5, flip: f < 0 && !up && !down, rot: up ? -Math.PI / 2 : down ? Math.PI / 2 : 0 });
    }
    if (ev.type === 'respawn' && typeof ev.x === 'number') {
      const g = w.groundAt(ev.x);
      if (Number.isFinite(g)) this.oneShots.push({ key: 'respawn_pillar', x: ev.x, y: g + 4, t: 0, life: 1.1, s: 0.5, light: true });
    }
    if (ev.type === 'pickup') this.oneShots.push({ key: 'twinkle', x: b.x, y: b.y - 120, t: 0, life: 0.35, s: 0.8 });
    if (ev.type === 'bossEnter') this.bossIntroT = 0;
  }
  /** 魔王登場特寫播了多久（bossEnter 事件歸零） */
  private bossIntroT = 99;

  /** fx_ambient 的一組圖：先找這一關的（s1_bamboo_leaf），沒有就找任何一關同種的 */
  ambient(_zone: ZoneDef, what: string, stage = 's1'): HTMLImageElement[] | null {
    const exact = this.a.ambient.get(`${stage}_${what}`);
    if (exact) return exact;
    for (const [k, v] of this.a.ambient) if (k.endsWith('_' + what)) return v;
    return null;
  }

  /** 這一格畫面經過的時間（環境小動畫用） */
  private frameDt = 0;
  /** 血量條的白色殘影（剛被扣掉的那段）與殘影開始縮之前還要等幾秒 */
  private hpTrail = MAX_HP;
  private hpTrailWait = 0;
  /** 上方資訊欄現在的不透明度（底下有敵人時淡掉） */
  private hudA = 1;
  /** 這一段背景是紅橘色的（第二關夜祭）：敵人子彈的光暈改青白色 */
  private cyanHalo = false;
  /** 飄落物目前是哪一種（換區段就清掉重來） */
  private leafKind: string | null = null;

  draw(ctx: CanvasRenderingContext2D, w: World, now = performance.now() / 1000): void {
    const dt = Math.min(0.05, Math.max(0, now - (this.lastT || now)));
    this.frameDt = dt;
    this.lastT = now;
    this.bossIntroT += dt;
    for (const o of this.oneShots) o.t += dt;
    this.oneShots = this.oneShots.filter((o) => o.t < o.life);
    this.amb.step(w, dt);
    const shake = w.shake > 0 ? w.shake * 26 : 0;
    const sx = shake ? rnd(-1, 1) * shake : 0, sy = shake ? rnd(-1, 1) * shake * 0.6 : 0;
    const cam = w.camX;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const zone = w.stage.zones[Math.max(0, w.zone)] ?? w.stage.zones[0]!;

    ctx.save();
    ctx.translate(sx, sy);
    this.drawBackdrop(ctx, w, cam, now);
    // 打雷那一瞬間：背景一亮、前面的東西全變成黑色剪影（天守閣頂）
    const sil = this.amb.silhouette();
    if (sil > 0) { ctx.fillStyle = `rgba(236,240,255,${0.85 * sil})`; ctx.fillRect(-40, -40, VIEW_W + 80, VIEW_H + 80); ctx.filter = SIL_FILTER; }

    // ── 世界座標 ──
    const camY = w.camY;
    ctx.save();
    ctx.translate(-cam, -camY);
    // 瀑布的水柱（第二版）：最後面，地形、岩棚都蓋在它前面
    for (const f of w.stage.waterfalls ?? []) if (w.onScreen(f.x, 700)) drawWaterfall(ctx, f.art, f.x, f.top, f.bottom, now, 'back');
    // 木柵先畫（最後面），營火、竹叢這些道具畫在木柵前面
    for (const d of w.stage.decks ?? []) if (d.x + d.w > cam - 100 && d.x < cam + VIEW_W + 100) this.drawBackDeck(ctx, w, d);
    this.drawProps(ctx, w, false, cam);
    const artHouse = !!this.a.terrain?.house;
    if (!artHouse) for (const p of w.stage.platforms) if (p.look === 'roof') this.drawHouse(ctx, w, p, now);
    this.drawTerrain(ctx, w, cam);
    this.amb.drawGround(ctx, w, cam);   // 地上的水窪、屋瓦濺水（跟地面一起捲）
    for (const f of w.stage.waterfalls ?? []) if (w.onScreen(f.x, 700)) drawWaterfall(ctx, f.art, f.x, f.top, f.bottom, now, 'front');
    if (artHouse) for (const p of w.stage.platforms) if (p.look === 'roof') this.drawHouse(ctx, w, p, now);
    for (const p of w.stage.platforms) if (p.look === 'stall' && p.x + p.w > cam - 200 && p.x < cam + VIEW_W + 200) this.drawStallArt(ctx, w, p);
    for (const p of w.stage.platforms) this.drawPlatform(ctx, w, p);
    this.drawV2(ctx, w, cam);
    for (const h of w.holes) this.drawHole(ctx, h.x, h.y, Math.min(1, h.age * 4) * Math.min(1, (h.life - h.age) * 2), h.age < 0.7);
    for (const b of w.breakables) if (b.kind === 'tower' || isGate(b.kind)) this.drawBreakable(ctx, b, now);
    for (const v of w.stage.vents ?? []) if (w.onScreen(v.x, 200)) this.drawVentBase(ctx, w, v);
    this.stepAmbientPuffs(ctx, w, dt, cam);
    for (const b of w.breakables) if (b.kind !== 'tower' && !isGate(b.kind) && b.kind !== 'cage') this.drawBreakable(ctx, b, now);
    for (const c of w.captives) this.drawCaptive(ctx, w, c, now);
    for (const b of w.breakables) if (b.kind === 'cage') this.drawBreakable(ctx, b, now);
    for (const k of w.pickups) this.drawPickup(ctx, k, now);
    for (const e of w.enemies) this.drawEnemyShadow(ctx, w, e);
    this.drawPlayerShadow(ctx, w);
    for (const e of w.enemies) if (!e.boss) this.drawEnemy(ctx, e, now);
    for (const e of w.enemies) if (e.boss) this.drawEnemy(ctx, e, now);
    for (const o of this.oneShots) if (o.key === 'respawn_pillar') this.drawOneShot(ctx, o);   // 重生光柱在球球後面
    ctx.restore();

    // 球球（照動作圖基準點畫，跟其他東西用同一個鏡頭小數座標）
    ctx.save(); ctx.translate(0, -camY);
    this.curWorld = w;
    this.drawPlayer(ctx, w.player, cam);
    ctx.restore();

    ctx.save();
    ctx.translate(-cam, -camY);
    this.clawArc(w.player);
    this.drawTip(ctx, w);
    for (const o of this.oneShots) if (o.key !== 'respawn_pillar') this.drawOneShot(ctx, o);
    for (const s of w.shots) this.drawShot(ctx, s, now);
    for (const b of w.bombs) this.drawIcon(ctx, b.kind === 'bigbomb' ? 'horoku' : b.kind === 'smoke' ? 'smoke_ball' : 'bomb_tag', b.x, b.y, b.kind === 'bigbomb' ? 58 : 44, b.rot);
    this.cyanHalo = !!zone.fireworks;
    for (const b of w.bullets) this.drawBullet(ctx, b, now);
    for (const x of w.explosions) this.drawExplosion(ctx, x.x, x.y, x.r, x.age / x.life, !!x.boss);
    for (const p of w.particles) this.drawParticle(ctx, p);
    this.drawProps(ctx, w, true, cam);
    for (const v of w.stage.vents ?? []) if (w.onScreen(v.x, 200)) this.drawVentSteam(ctx, w, v);
    for (const k of w.marks) this.drawMark(ctx, k.x, k.y, k.age, k.life);
    for (const e of w.enemies) { this.drawBubble(ctx, e); this.drawCrushWarning(ctx, w, e); this.drawBossFx(ctx, w, e, now); }
    for (const p of w.pops) this.drawPop(ctx, p.x, p.y, p.text, p.age, p.color, p.size);
    if (this.debugBoxes) this.drawBoxes(ctx, w);
    ctx.restore();
    if (sil > 0) ctx.filter = 'none';

    if (camY > -5) this.drawFore(ctx, w, cam);
    this.drawLeaves(ctx, zone, dt, cam);
    this.amb.drawOverlay(ctx, w, cam);   // 雨幕、光束、飄的東西、閃電閃白
    ctx.restore();

    this.drawHud(ctx, w, now);
    this.drawBanners(ctx, w);
    if (w.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, w.flash * 2.5)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    this.lastCam = cam;
  }

  // ───────────────────────── 背景 ─────────────────────────

  /** 這層該用多快的速率捲：中景照關卡長度算到剛好看完；其他層用建議速率，但不能超過這層的長度 */
  fitRate(layer: LayerName, panels: Panel[], camMax: number, suggested?: number): number {
    const total = panels.reduce((s, p) => s + p.w * (VIEW_H / p.h), 0);
    const fit = camMax > 0 ? Math.max(0, total - VIEW_W) / camMax : 0;
    if (layer === 'mid') return Math.max(0.3, Math.min(0.8, fit));   // 太短的關（練習場）不要捲到飛快
    const want = suggested ?? { far: 0.12, midfar: 0.3, mid: 0.55, fore: 1.3 }[layer];
    if (layer === 'fore') return want;
    return Math.min(want, fit);
  }

  private warmedClimb: object | null = null;
  private drawBackdrop(ctx: CanvasRenderingContext2D, w: World, cam: number, now: number): void {
    const zone = w.stage.zones[Math.max(0, w.zone)] ?? w.stage.zones[0]!;
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, '#5b3d6e'); sky.addColorStop(0.55, zone.sky); sky.addColorStop(1, '#3a2433');
    ctx.fillStyle = sky; ctx.fillRect(-40, -40, VIEW_W + 80, VIEW_H + 80);
    const sp = this.a.panels.get(w.stage.panels);
    const camMax = this.camEnd(w);
    const has = (l: LayerName): boolean => !!sp && sp.layers[l].length > 0;
    // 往上捲（第二版大攀爬段）：每層往下移（越遠移越少），長卷頂上接往上延伸的背景
    const up = -w.camY, vs = up > 0 ? w.vsection() : null;
    const farOff = has('far') ? cam * this.fitRate('far', sp!.layers.far, camMax, sp!.rates.far) : 0;
    ctx.save(); ctx.translate(0, up * V_RATE.far);
    if (has('far')) this.drawLayer(ctx, sp!.layers.far, farOff);
    else this.drawZoneFar(ctx, w, cam);
    ctx.restore();
    if (up > 0) drawClimbBg(ctx, w.stage.panels + '_far', 'far', farOff, up * V_RATE.far, VIEW_W);
    // 畫好的遠景自己有雲；只有退回舊背景（或美術另外給了雲的圖）時才用程式畫飄雲
    if (!has('far') || this.art('ambient_cloud')) this.drawClouds(ctx, cam, now, zone);
    if (!this.amb.hasFlocks()) this.drawBirds(ctx, cam, now);
    if (zone.fireworks) this.drawFireworks(ctx, Math.min(0.05, this.frameDt));
    const rMidfar = has('midfar') ? this.fitRate('midfar', sp!.layers.midfar, camMax, sp!.rates.midfar) : 0.3;
    const rMid = has('mid') ? this.fitRate('mid', sp!.layers.mid, camMax, sp!.rates.mid) : 0.55;
    // 往上延伸的那一欄（下面 drawClimbBg 畫的）蓋住的左右範圍：那裡長卷頂端本來就接著那一欄，不淡出（淡了反而露一條天空）
    const keep = up > 0 && vs?.bg ? climbColumnX(vs.bg, cam * rMid, VIEW_W, vs.hold !== undefined && climbAligned(vs.bg, vs.hold * rMid, VIEW_W)) : null;
    this.amb.drawSky(ctx, w, cam);   // 流星、大隕石、鳥群、雁群（遠山那一層）
    // 鏡頭往上抬（攀爬段）時，長卷整張往下移，頂端在天空裡變成一條筆直的切邊（2026-10-09 使用者：「背景圖片有撕裂感」；
    // 實機錄影第一關 164 秒爬完瀑布那段：岩石樹木被橫著切斷）。抬起來的時候改畫「頂端往上淡出」的版本（drawLayerFaded）
    if (has('midfar')) {
      if (up > 0) this.drawLayerFaded(ctx, sp!.layers.midfar, cam * rMidfar, up * V_RATE.midfar, keep);
      else { ctx.save(); ctx.translate(0, up * V_RATE.midfar); this.drawLayer(ctx, sp!.layers.midfar, cam * rMidfar); ctx.restore(); }
    }
    this.amb.drawMidfar(ctx, w, cam, rMidfar);   // 遠層霧、風箏、飛艇、閃電劈屋脊、百鬼夜行、遠方鐵爪黑影
    if (has('mid')) {
      // 墊底：中景頂端的透明缺口後面先墊上方那一欄的底色（見 drawClimbBacking），破洞就不會是一塊方形天空
      // 只墊「對齊的」攀爬段（第一關瀑布：那一欄照長卷頂往上畫，中景頂端的缺口才會剛好接在它的平直底邊下）。練習場那種沒對齊的，長卷頂上大片是透明天空，墊了會整片透出拉長的條紋（10-09 練習場截圖）
      const aligned = !!vs?.bg && vs.hold !== undefined && climbAligned(vs.bg, vs.hold * rMid, VIEW_W);
      if (up > 0 && vs?.bg && aligned) drawClimbBacking(ctx, vs.bg, cam * rMid, up * V_RATE.mid, VIEW_W, true);
      if (up > 0) this.drawLayerFaded(ctx, sp!.layers.mid, cam * rMid, up * V_RATE.mid, keep);
      else { ctx.save(); ctx.translate(0, up * V_RATE.mid); this.drawLayer(ctx, sp!.layers.mid, cam * rMid); ctx.restore(); }
    }
    if (w.stage.vscroll?.length && this.warmedClimb !== w.stage) { this.warmedClimb = w.stage; warmClimbBg([w.stage.panels + '_far', ...w.stage.vscroll.map((v) => v.bg ?? '')]); }
    // 關卡的攀爬段：鏡頭停住時中景那一欄剛好對上長卷（第一關瀑布）→ 跟著長卷捲；對不上的（練習場）夾在畫面裡
    if (up > 0 && vs?.bg) drawClimbBg(ctx, vs.bg, 'mid', cam * rMid, up * V_RATE.mid, VIEW_W, vs.hold !== undefined && climbAligned(vs.bg, vs.hold * rMid, VIEW_W));
    this.amb.drawMid(ctx, w, cam, rMid);   // 近層霧、背景小動物、火箭、鍛爐爆炸、碎鐵（都在角色後面、不扣血）
  }

  /** 鏡頭最右會到哪（最後的魔王鎖定點） */
  private camEnd(w: World): number {
    const fin = w.stage.bosses.find((b) => b.final);
    return fin ? fin.at : w.stage.length - VIEW_W;
  }

  /**
   * 2026-10-09 使用者：「角色在移動背景一卡一卡」。原本每張背景的左緣取整數像素（Math.floor）：
   * 遠景一格只捲 0.7 像素左右，取整數後變成「這格不動、下格跳 1 像素」，1080p 螢幕再放大 1.5 倍，跑起來就一頓一頓。
   * 改成照小數位置畫（瀏覽器本來就在縮放這些圖，不會更糊）；接縫照舊靠每張多畫 1 像素蓋住。
   */
  /** 頂端淡出用的暫存畫布與遮罩（只有鏡頭往上抬的攀爬段才用） */
  private fadeCanvas: HTMLCanvasElement | null = null;
  private fadeMask: HTMLCanvasElement | null = null;

  /**
   * 長卷往下移 topY 像素畫，頂端 FADE_TOP 像素由全透明漸到不透明，露出後面的遠景天空（10-09 撕裂感）。
   * 先畫在暫存畫布上再用 destination-in 罩一條漸層，最後整張貼回主畫面。
   */
  private drawLayerFaded(ctx: CanvasRenderingContext2D, panels: Panel[], off: number, topY: number, keep: { x0: number; x1: number } | null): void {
    const mk = (): HTMLCanvasElement => { const n = document.createElement('canvas'); n.width = VIEW_W; n.height = VIEW_H; return n; };
    const c = this.fadeCanvas ?? (this.fadeCanvas = mk()), m = this.fadeMask ?? (this.fadeMask = mk());
    const g = c.getContext('2d'), mg = m.getContext('2d');
    if (!g || !mg) { ctx.save(); ctx.translate(0, topY); this.drawLayer(ctx, panels, off); ctx.restore(); return; }
    g.clearRect(0, 0, VIEW_W, VIEW_H);
    g.save(); g.translate(0, topY); this.drawLayer(g, panels, off); g.restore();
    // 遮罩：頂端 FADE_TOP 由透明漸到不透明；往上延伸那一欄蓋住的範圍整條不透明（保持原本的接法）
    mg.clearRect(0, 0, VIEW_W, VIEW_H);
    const gr = mg.createLinearGradient(0, topY, 0, topY + FADE_TOP);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    mg.fillStyle = gr; mg.fillRect(0, topY, VIEW_W, VIEW_H - topY);
    if (keep && keep.x1 > 0 && keep.x0 < VIEW_W) { mg.fillStyle = '#000'; mg.fillRect(keep.x0, 0, keep.x1 - keep.x0, VIEW_H); }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m, 0, 0);
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(c, 0, 0);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, panels: Panel[], off: number): void {
    let x = 0;
    for (const p of panels) {
      const pw = p.w * (VIEW_H / p.h);
      if (x + pw > off && x < off + VIEW_W) ctx.drawImage(p.img, x - off, 0, pw + 1, VIEW_H);
      x += pw;
    }
    // 最後一張之後還有畫面（不該發生，長度照 fitRate 算過）：把最後一張接著畫，不要露出空白
    const last = panels[panels.length - 1];
    if (last && x < off + VIEW_W) { const pw = last.w * (VIEW_H / last.h); ctx.drawImage(last.img, x - off, 0, pw + 1, VIEW_H); }
  }

  /**
   * 最前景：關卡檔的 fore 清單指定每一件在哪裡掠過（捲得比地面快，幾秒就過去）。
   * 圖是畫面像素大小，anchor＝bottom 圖底貼畫面底、top 圖頂貼畫面頂。
   */
  private drawFore(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    const sp = this.a.panels.get(w.stage.panels);
    const list = w.stage.fore;
    if (!sp || !sp.layers.fore.length || !list) return;
    const rate = sp.rates.fore ?? 1.3;
    // 擋到球球或魔王時變淡（前景只是點綴，不能擋住戰鬥）
    const b = w.player.body, pl = b.x - cam;
    const guard = [{ x0: pl - 40, x1: pl + 40 }];
    if (w.boss) guard.push({ x0: w.boss.x - cam - 120, x1: w.boss.x - cam + 120 });
    // 擋到小兵、子彈也變淡；鎖畫面打一波、打魔王的時候鏡頭不動，前景會整場停在畫面上 → 一律淡到 0.35（09-26 獨立審查 中 3）
    for (const e of w.enemies) if (e.dying <= 0 && w.onScreen(e.x, 60)) { const hw = ENEMY_DEFS[e.kind].w / 2 + 20; guard.push({ x0: e.x - cam - hw, x1: e.x - cam + hw }); }
    for (const bl of w.bullets) if (w.onScreen(bl.x, 40)) guard.push({ x0: bl.x - cam - bl.w / 2 - 10, x1: bl.x - cam + bl.w / 2 + 10 });
    const locked = w.lockX !== null || (!!w.boss && !w.boss.dead);
    for (const it of list) {
      const p = sp.layers.fore[it.item];
      if (!p) continue;
      const sx = VIEW_W / 2 - p.w / 2 - (cam - (it.x - VIEW_W / 2)) * rate;
      if (sx > VIEW_W || sx + p.w < 0) continue;
      const hit = locked || guard.some((gd) => gd.x1 > sx + p.w * 0.12 && gd.x0 < sx + p.w * 0.88);
      ctx.globalAlpha = hit ? 0.35 : 0.93;
      ctx.drawImage(p.img, sx, p.anchor === 'top' ? 0 : VIEW_H - p.h, p.w, p.h);   // 不取整數（同 drawLayer，10-09）
    }
    ctx.globalAlpha = 1;
  }

  /** 長卷還沒有時：每段一張遠景左右重複，兩段交界淡入淡出 */
  private drawZoneFar(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    const zones = w.stage.zones, mid = cam + VIEW_W / 2;
    const draw = (z: ZoneDef, alpha: number): void => {
      const a = this.art(z.far);
      const img = a?.img ?? this.a.fallback.bg;
      if (!img || alpha <= 0) return;
      const s = VIEW_H / img.naturalHeight, dw = img.naturalWidth * s;
      const off = ((cam * 0.4) % dw + dw) % dw;
      ctx.globalAlpha = alpha;
      for (let x = -off; x < VIEW_W; x += dw) ctx.drawImage(img, x, 0, dw + 1, VIEW_H);   // 不取整數（同 drawLayer，10-09）
      ctx.globalAlpha = 1;
    };
    let i = 0;
    zones.forEach((z, k) => { if (mid >= z.from) i = k; });
    const cur = zones[i]!, next = zones[i + 1];
    draw(cur, 1);
    if (next) { const k = 1 - (next.from - mid) / 700; if (k > 0) draw(next, Math.min(1, k)); }
  }

  private drawClouds(ctx: CanvasRenderingContext2D, cam: number, now: number, zone: ZoneDef): void {
    const img = this.art('ambient_cloud')?.img;
    for (let i = 0; i < 7; i++) {
      const span = VIEW_W + 600;
      const x = ((i * 397 + now * (6 + i % 3 * 3) - cam * 0.06) % span + span) % span - 300;
      const y = 50 + (i * 53) % 170, s = 0.7 + (i % 4) * 0.25;
      ctx.globalAlpha = 0.34 + (i % 3) * 0.08;
      if (img) ctx.drawImage(img, x, y, img.naturalWidth * 0.5 * s, img.naturalHeight * 0.5 * s);
      else {
        ctx.fillStyle = zone.leaves === 'ember' ? '#f7c6b0' : '#fbe1cf';
        for (const [dx, dy, r] of [[0, 0, 34], [36, -12, 42], [80, 0, 32], [44, 12, 36]] as const) {
          ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, r * s * 1.4, r * s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 遠方小鳥：每 11 秒一群從右往左飛過 */
  private drawBirds(ctx: CanvasRenderingContext2D, cam: number, now: number): void {
    const cyc = 11, k = (now % cyc) / cyc, flock = Math.floor(now / cyc);
    if (k > 0.75) return;
    const bx = VIEW_W + 80 - k / 0.75 * (VIEW_W + 300) - (cam * 0.12) % 40, by = 110 + (flock * 37) % 120;
    ctx.strokeStyle = '#3b2438'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = bx + i * 26 + (i % 2) * 8, y = by + Math.abs(i - 2) * 11 + Math.sin(now * 3 + i) * 3;
      const f = Math.sin(now * 12 + i * 1.7) * 5;
      ctx.beginPath(); ctx.moveTo(x - 8, y - f); ctx.quadraticCurveTo(x - 3, y - 2, x, y); ctx.quadraticCurveTo(x + 3, y - 2, x + 8, y - f); ctx.stroke();
    }
  }

  /** 落葉（山村楓葉、竹林竹葉）、火星（山賊寨）：畫面座標，鏡頭往右時往左飄得快一點＝有前後景深 */
  private drawLeaves(ctx: CanvasRenderingContext2D, zone: ZoneDef, dt: number, cam: number): void {
    const kind = zone.leaves;
    if (kind !== this.leafKind) { this.leaves.length = 0; this.leafKind = kind; }
    // 有第三批天氣美術（ambient2）的：螢火蟲、雨絲、打雷改由 ambience.ts 畫，程式畫的讓位
    if (zone.storm && !this.amb.overrides('storm')) this.drawStorm(ctx, dt);
    if (!kind) return;
    if (kind === 'firefly' && this.amb.overrides('firefly')) return;
    if (kind === 'firefly' || kind === 'lantern') { this.drawFloaters(ctx, kind, dt, cam); return; }
    if (kind === 'rain') { if (!this.amb.overrides('rain')) this.drawRain(ctx, dt, cam); return; }
    if (kind === 'steam') { this.drawSteamDrift(ctx, dt, cam); return; }
    const want = kind === 'ember' ? 26 : kind === 'maple' ? 11 : 20;
    if (this.leaves.length > want) this.leaves.length = want;
    while (this.leaves.length < want) this.leaves.push({ x: rnd(0, VIEW_W + 200), y: rnd(-VIEW_H, 0), vx: rnd(-40, -10), vy: kind === 'ember' ? -rnd(30, 70) : rnd(40, 80), rot: rnd(0, 6), spin: rnd(-3, 3), s: rnd(0.7, 1.3), ph: rnd(0, 6) });
    const dcam = cam - this.lastCam;
    const img = this.art(kind === 'maple' ? 'ambient_maple' : kind === 'bamboo' ? 'ambient_bamboo_leaf' : 'ambient_ember')?.img;
    const frames = kind === 'bamboo' ? this.ambient(zone, 'bamboo_leaf') : null;
    const maples = kind === 'maple' ? ['maple_red', 'maple_orange'].filter((k) => this.a.terrain?.props[k]) : [];
    for (const l of this.leaves) {
      l.ph += dt;
      l.x += (l.vx + Math.sin(l.ph * 1.8) * 30) * dt - dcam * 1.15;
      l.y += l.vy * dt; l.rot += l.spin * dt;
      if (kind === 'ember' ? l.y < -20 : l.y > VIEW_H + 20) { l.y = kind === 'ember' ? VIEW_H + 10 : -20; l.x = rnd(0, VIEW_W + 200); }
      if (l.x < -40) l.x += VIEW_W + 120;
      if (l.x > VIEW_W + 250) l.x -= VIEW_W + 250;
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.scale(l.s, l.s);
      if (frames) {
        // 竹葉：幾張不同角度輪播＝翻轉飄落
        const fr = frames[Math.floor(l.ph * 3 + l.s * 7) % frames.length]!;
        const k = 30 / Math.max(fr.naturalWidth, fr.naturalHeight);
        ctx.drawImage(fr, -fr.naturalWidth * k / 2, -fr.naturalHeight * k / 2, fr.naturalWidth * k, fr.naturalHeight * k);
      } else if (maples.length) {
        // 楓葉圖（紅、橘兩種），翻轉時壓扁
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(l.ph * 2.5)));
        this.drawTProp(ctx, maples[Math.floor(l.s * 10) % maples.length]!, 0, 0, { size: 26, alpha: 0.9 });
      } else if (img) ctx.drawImage(img, -12, -12, 24, 24);
      else if (kind === 'maple') {
        // 楓葉：五片尖葉＋葉柄，半透明，翻轉時壓扁
        ctx.globalAlpha = 0.75; ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(l.ph * 2.5)));
        ctx.fillStyle = '#d4502a'; star(ctx, 0, 0, 5, 7, 3.2); ctx.fill();
        ctx.strokeStyle = '#8a2a14'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 9); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      else if (kind === 'bamboo') { ctx.fillStyle = '#6f9a3a'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 3, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(l.ph * 6); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.restore();
    }
  }

  /** 暴風雨：斜斜的雨絲，跟著鏡頭往後捲 */
  private rain: { x: number; y: number; v: number; l: number }[] = [];
  private drawRain(ctx: CanvasRenderingContext2D, dt: number, cam: number): void {
    while (this.rain.length < 140) this.rain.push({ x: rnd(-100, VIEW_W + 200), y: rnd(-VIEW_H, VIEW_H), v: rnd(900, 1300), l: rnd(18, 34) });
    const dcam = cam - this.lastCam;
    ctx.strokeStyle = 'rgba(190,210,255,.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const r of this.rain) {
      r.y += r.v * dt; r.x += -r.v * 0.25 * dt - dcam * 1.1;
      if (r.y > VIEW_H + 20) { r.y = rnd(-80, -10); r.x = rnd(-100, VIEW_W + 250); }
      if (r.x < -120) r.x += VIEW_W + 300;
      ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.l * 0.25, r.y - r.l);
    }
    ctx.stroke();
  }

  /** 工廠：慢慢往上飄散的蒸氣 */
  private drawSteamDrift(ctx: CanvasRenderingContext2D, dt: number, cam: number): void {
    const want = 14;
    if (this.leaves.length > want) this.leaves.length = want;
    while (this.leaves.length < want) this.leaves.push({ x: rnd(0, VIEW_W + 200), y: rnd(VIEW_H * 0.3, VIEW_H + 100), vx: rnd(-10, 10), vy: -rnd(15, 35), rot: 0, spin: 0, s: rnd(0.7, 1.5), ph: rnd(0, 6) });
    const dcam = cam - this.lastCam;
    for (const l of this.leaves) {
      l.ph += dt; l.x += l.vx * dt - dcam * 0.9; l.y += l.vy * dt;
      if (l.y < -60) { l.y = VIEW_H + 60; l.x = rnd(0, VIEW_W + 200); }
      if (l.x < -80) l.x += VIEW_W + 200;
      const r = 40 * l.s, a = 0.08 + 0.05 * Math.sin(l.ph);
      const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, r);
      g.addColorStop(0, `rgba(235,238,245,${a})`); g.addColorStop(1, 'rgba(235,238,245,0)');
      ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
  }

  /** 打雷：每 5～9 秒閃兩下 */
  private stormT = 3;
  private drawStorm(ctx: CanvasRenderingContext2D, dt: number): void {
    this.stormT -= dt;
    if (this.stormT < -0.35) this.stormT = rnd(5, 9);
    const t = -this.stormT;
    if (t < 0) return;
    const a = t < 0.08 ? 0.28 : t > 0.16 && t < 0.24 ? 0.18 : 0;
    if (a > 0) { ctx.fillStyle = `rgba(220,225,255,${a})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  /** 螢火蟲（河邊、慢慢飄、一閃一閃）、夜祭飄上天的燈籠（fx_ambient 的 s2_lantern） */
  private drawFloaters(ctx: CanvasRenderingContext2D, kind: 'firefly' | 'lantern', dt: number, cam: number): void {
    const want = kind === 'firefly' ? 24 : 5;
    if (this.leaves.length > want) this.leaves.length = want;
    while (this.leaves.length < want) this.leaves.push({ x: rnd(0, VIEW_W + 200), y: kind === 'firefly' ? rnd(260, 640) : rnd(200, VIEW_H + 200), vx: rnd(-14, 14), vy: kind === 'firefly' ? rnd(-10, 10) : -rnd(18, 34), rot: rnd(-0.1, 0.1), spin: 0, s: rnd(0.5, 1), ph: rnd(0, 6) });
    const dcam = cam - this.lastCam;
    const imgs = kind === 'lantern' ? this.a.ambient.get('s2_lantern') : undefined;
    for (const l of this.leaves) {
      l.ph += dt;
      l.x += (l.vx + Math.sin(l.ph * 1.3) * 12) * dt - dcam * (kind === 'lantern' ? 0.3 : 1.05);
      l.y += (l.vy + (kind === 'firefly' ? Math.cos(l.ph * 1.7) * 14 : 0)) * dt;
      if (l.x < -80) l.x += VIEW_W + 160;
      if (l.x > VIEW_W + 160) l.x -= VIEW_W + 160;
      if (kind === 'lantern' && l.y < -80) { l.y = VIEW_H + 60; l.x = rnd(0, VIEW_W); }
      if (kind === 'firefly' && (l.y < 200 || l.y > 680)) l.vy = -l.vy;
      if (kind === 'firefly') {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(l.ph * 3 + l.s * 9));
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 9);
        g.addColorStop(0, `rgba(230,255,150,${a})`); g.addColorStop(1, 'rgba(230,255,150,0)');
        ctx.fillStyle = g; ctx.fillRect(l.x - 9, l.y - 9, 18, 18);
      } else {
        const img = imgs?.[Math.floor(l.s * 10) % (imgs?.length || 1)];
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(Math.sin(l.ph) * 0.08);
        ctx.globalAlpha = 0.85;
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 60 * l.s);
        glow.addColorStop(0, 'rgba(255,190,90,.45)'); glow.addColorStop(1, 'rgba(255,190,90,0)');
        ctx.fillStyle = glow; ctx.fillRect(-60, -60, 120, 120);
        if (img) { const h = 70 * l.s, ww = img.naturalWidth * h / img.naturalHeight; ctx.drawImage(img, -ww / 2, -h / 2, ww, h); }
        else { ctx.fillStyle = '#e8563a'; ctx.beginPath(); ctx.ellipse(0, 0, 14 * l.s, 20 * l.s, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    }
  }

  /** 夜空的煙火（fx_ambient 的 s2_firework：放大＋淡出） */
  private fireworks: { x: number; y: number; t: number; i: number; s: number }[] = [];
  private drawFireworks(ctx: CanvasRenderingContext2D, dt: number): void {
    const imgs = this.a.ambient.get('s2_firework');
    if (Math.random() < dt * 0.55 && this.fireworks.length < 3) this.fireworks.push({ x: rnd(120, VIEW_W - 120), y: rnd(90, 280), t: 0, i: Math.floor(rnd(0, 4)), s: rnd(0.35, 0.6) });
    for (const f of this.fireworks) {
      f.t += dt;
      const k = f.t / 1.6;
      const sc = f.s * (0.3 + 0.9 * Math.min(1, k * 2.5));
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.35) / 0.65) * 0.9;
      const img = imgs?.[f.i % (imgs?.length || 1)];
      if (img) ctx.drawImage(img, f.x - img.naturalWidth * sc / 2, f.y - img.naturalHeight * sc / 2 + k * 20, img.naturalWidth * sc, img.naturalHeight * sc);
      else { ctx.strokeStyle = ['#ffd24a', '#ff6a9a', '#9ff0ff', '#b6ff8a'][f.i % 4]!; ctx.lineWidth = 3; for (let a = 0; a < 12; a++) { const an = a / 12 * Math.PI * 2, r = 120 * sc; ctx.beginPath(); ctx.moveTo(f.x + Math.cos(an) * r * 0.3, f.y + Math.sin(an) * r * 0.3); ctx.lineTo(f.x + Math.cos(an) * r, f.y + Math.sin(an) * r); ctx.stroke(); } }
    }
    ctx.globalAlpha = 1;
    this.fireworks = this.fireworks.filter((f) => f.t < 1.6);
  }

  /** 炊煙（屋頂）、營火的煙與火星：畫面自己的小粒子 */
  private stepAmbientPuffs(ctx: CanvasRenderingContext2D, w: World, dt: number, cam: number): void {
    this.emitT += dt;
    if (this.emitT > 0.22) {
      this.emitT = 0;
      for (const p of w.stage.platforms) if (p.look === 'roof' && p.x + p.w > cam - 100 && p.x < cam + VIEW_W + 100) this.puffs.push({ x: p.x + p.w * 0.72, y: p.y - 34, vx: rnd(4, 14), vy: -rnd(22, 36), r: rnd(7, 11), age: 0, life: rnd(2.2, 3), ember: false });
      for (const p of w.stage.props) if (p.smoke && p.x > cam - 100 && p.x < cam + VIEW_W + 100) {
        const g = w.terrain.groundAt(p.x);
        const top = this.a.terrain?.anim[p.art] ? p.h * 1.9 : p.h * 0.7;   // 營火（柴堆＋火焰格）：煙從火焰頂上冒
        this.puffs.push({ x: p.x + rnd(-10, 10), y: g - top, vx: rnd(-6, 10), vy: -rnd(30, 50), r: rnd(9, 14), age: 0, life: rnd(1.8, 2.6), ember: false });
        this.puffs.push({ x: p.x + rnd(-20, 20), y: g - top * 0.75, vx: rnd(-30, 30), vy: -rnd(80, 150), r: 2.5, age: 0, life: rnd(0.6, 1.1), ember: true });
      }
    }
    const smoke = this.art('smoke')?.img;
    const smokeFrames = this.ambient(w.stage.zones[0]!, 'smoke', w.stage.panels);
    for (const q of this.puffs) {
      q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.r += dt * (q.ember ? 0 : 7);
      const k = q.age / q.life;
      if (q.ember) { ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffcf5a'; ctx.beginPath(); ctx.arc(q.x + Math.sin(q.age * 9) * 4, q.y, q.r, 0, Math.PI * 2); ctx.fill(); continue; }
      if (smokeFrames) {
        // 炊煙：由小到大的動畫格，本身就越來越淡
        const fr = smokeFrames[Math.min(smokeFrames.length - 1, Math.floor(k * smokeFrames.length))]!;
        const wv = q.r * 3.2, hv = wv * fr.naturalHeight / fr.naturalWidth;
        ctx.globalAlpha = 0.8 * Math.min(1, q.age * 3);
        ctx.drawImage(fr, q.x - wv / 2, q.y - hv * 0.8, wv, hv);
        continue;
      }
      ctx.globalAlpha = 0.35 * (1 - k) * Math.min(1, q.age * 3);
      if (smoke) ctx.drawImage(smoke, q.x - q.r * 1.3, q.y - q.r * 1.1, q.r * 2.6, q.r * 2.2);
      else { ctx.fillStyle = '#e8dcd8'; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    this.puffs = this.puffs.filter((q) => q.age < q.life);
  }

  // ───────────────────────── 地形 ─────────────────────────

  private drawTerrain(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    const x0 = cam - 30, x1 = cam + VIEW_W + 30;
    const zones = w.stage.zones;
    for (const sp of w.terrain.spans(x0, x1)) {
      // 照場景分段換地面帶材質
      let a = sp.x0;
      while (a < sp.x1 - 0.01) {
        let zi = 0;
        zones.forEach((z, k) => { if (a >= z.from) zi = k; });
        const next = zones[zi + 1]?.from ?? Infinity;
        const b = Math.min(sp.x1, next);
        const y0 = sp.y0 + (sp.y1 - sp.y0) * (a - sp.x0) / (sp.x1 - sp.x0), y1 = sp.y0 + (sp.y1 - sp.y0) * (b - sp.x0) / (sp.x1 - sp.x0);
        this.drawGroundSpan(ctx, zones[zi]!.ground, a, y0, b, y1);
        a = b;
      }
    }
    // 兩段場景的地面帶交界：後一段的材質往前淡入 120 像素，不要一刀切
    for (let zi = 1; zi < zones.length; zi++) {
      const bx = zones[zi]!.from;
      if (bx < x0 - 130 || bx > x1 + 10) continue;
      for (let k = 0; k < 6; k++) {
        const s0 = bx - 120 + k * 20, s1 = s0 + 20;
        if (!Number.isFinite(w.terrain.groundAt(s0 + 10))) continue;
        ctx.globalAlpha = (k + 1) / 7;
        this.drawGroundSpan(ctx, zones[zi]!.ground, s0, w.terrain.lineAt(s0), s1, w.terrain.lineAt(s1));
      }
      ctx.globalAlpha = 1;
    }
    // 坑：深淵；河童川那一段的坑是水（水面、倒影、波紋）
    for (const [p0, p1] of w.terrain.pits) {
      if (p1 < x0 || p0 > x1) continue;
      // 瀑布底下的坑＝水潭（那一套瀑布自己的水潭圖）
      const fall = (w.stage.waterfalls ?? []).find((f) => f.x > p0 - 200 && f.x < p1 + 200);
      const pool = fall ? poolArt(fall.art) : null;
      if (pool) {
        this.drawWaterArt(ctx, { frames: pool.frames.map((img) => ({ img, w: pool.w, h: pool.h })) as TerrainArt['water'][string]['frames'], surfaceY: pool.surfaceY, fps: pool.fps, scale: 1, bottomColor: pool.bottomColor }, p0, p1, w.waterSurface((p0 + p1) / 2));
        continue;
      }
      if (w.isWaterPit(p0)) { const WA = this.a.terrain?.water.s2_river; if (WA) this.drawWaterArt(ctx, WA, p0, p1, w.waterSurface((p0 + p1) / 2)); else this.drawWater(ctx, p0, p1, w.waterSurface((p0 + p1) / 2)); continue; }
      const top = Math.min(w.terrain.lineAt(p0 - 1), w.terrain.lineAt(p1 + 1)) + 20;
      const g = ctx.createLinearGradient(0, top, 0, VIEW_H);
      g.addColorStop(0, 'rgba(30,14,34,0)'); g.addColorStop(0.35, 'rgba(22,10,28,.85)'); g.addColorStop(1, '#0b0610');
      ctx.fillStyle = g; ctx.fillRect(p0, top, p1 - p0, VIEW_H - top);
    }
    // 崖壁、坑邊（落差 60 以上）：terrain.json 的崖壁頂塊＋壁身；樓梯一階（60 以下）：縮小的石塊補成石階
    const all = w.terrain.walls(x0 - 320, x1 + 320);
    const ST = this.a.terrain?.stair.stone;
    const stoneStair = (x: number): boolean => { let z = w.stage.zones[0]!; for (const q of w.stage.zones) if (x >= q.from) z = q; return z.wall !== 's3_iron'; };
    const isStep = (v: { top: number; bottom: number }): boolean => Number.isFinite(v.bottom) && v.bottom - v.top < STEP_WALL;
    const steps: { x: number; top: number; hiLeft: boolean }[] = [];
    for (const wl of all) {
      const bottom = Math.min(VIEW_H + 40, wl.bottom);
      // 高的那邊在左邊嗎：坑邊看坑在哪一邊；一般落差看左右兩點的高度
      const hiLeft = wl.bottom === Infinity ? w.terrain.inPit(wl.x + 4) : w.terrain.lineAt(wl.x - 2) < w.terrain.lineAt(wl.x + 2);
      const W = this.wallArt(w, wl.x);
      if (W && bottom - wl.top >= STEP_WALL) { this.drawWallArt(ctx, W, wl.x, wl.top, bottom, hiLeft); continue; }
      // 樓梯（旁邊 130 像素內還有另一階）：先收起來，最後從最低的一階畫到最高的一階
      const inStair = isStep(wl) && all.some((o) => o !== wl && isStep(o) && Math.abs(o.x - wl.x) < 130);
      if (ST && inStair && stoneStair(wl.x)) { steps.push({ x: wl.x, top: wl.top, hiLeft }); continue; }
      // 單獨一個 36 以上的小落差（跳下去的地方）：也用整面崖壁，地面帶的直切口才不會露出來
      if (W && !inStair && bottom - wl.top >= 36) { this.drawWallArt(ctx, W, wl.x, wl.top, bottom, hiLeft); continue; }
      if (W) {
        // 樓梯的一階：這一段的崖壁材質（山村石牆、竹林土崖、山賊寨木樁）縮小當石階立面
        this.drawStepRiser(ctx, W, wl.x, wl.top, wl.bottom, hiLeft);
        continue;
      }
      const g = ctx.createLinearGradient(wl.x + (hiLeft ? -16 : 16), 0, wl.x, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,8,4,.45)');
      ctx.fillStyle = g;
      ctx.fillRect(hiLeft ? wl.x - 16 : wl.x, wl.top + 4, 16, bottom - wl.top);
      ctx.strokeStyle = '#2a170c'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(wl.x, wl.top + 2); ctx.lineTo(wl.x, bottom); ctx.stroke();
    }
    if (ST) for (const st of steps.sort((a, b) => b.top - a.top)) this.drawStairArt(ctx, ST, st.x, st.top, st.hiLeft);
    // 留在地上的東西（炸爛的竹簍）
    for (const d of w.decals) if (d.x > x0 - 300 && d.x < x1 + 300) this.drawTProp(ctx, d.key, d.x, d.y, { flip: d.flip });
  }

  /** 第二版：實心方塊、攀爬物、岩棚（look＝ledge 的平台） */
  private drawV2(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    const S = w.stage, vis = (x0: number, x1: number): boolean => x1 > cam - 80 && x0 < cam + VIEW_W + 80;
    for (const c of S.climbs ?? []) if (vis(c.x - 50, c.x + 50)) drawClimb(ctx, c.art, c.x, c.top, c.bottom);
    for (const b of S.solids ?? []) if (vis(b.x, b.x + b.w)) drawBlock(ctx, b.art, b.x, b.y, b.w, b.h);
    for (const p of S.platforms) if (p.look === 'ledge' && vis(p.x, p.x + p.w)) drawLedge(ctx, p.art ?? 's1_rock', p.x, p.y, p.w);
  }

  /**
   * 石階的一階（terrain.json stair）：立面 x 對齊落差、頂塊的站立線對齊這一階高的那邊的踏面，壁身往下接到畫面底。
   * 圖是立面朝左（左低右高）；下樓梯（左邊高）整組水平翻。踏面比關卡的階寬，高的那階畫在後面蓋住低的那階多出來的部分。
   */
  private drawStairArt(ctx: CanvasRenderingContext2D, S: TerrainArt['stair'][string], x: number, top: number, hiLeft: boolean): void {
    const k = S.scale;
    ctx.save();
    ctx.translate(Math.round(x), 0);
    if (hiLeft) ctx.scale(-1, 1);
    const y0 = Math.round(top - S.top.standY * k), fx = -S.faceX * k;
    ctx.drawImage(S.top.img, fx, y0, S.top.w * k, S.top.h * k);
    const bh = S.body.h * k;
    for (let y = y0 + S.top.h * k - 1; y < VIEW_H + 40; y += bh - 1) ctx.drawImage(S.body.img, fx, y, S.body.w * k, bh);
    ctx.restore();
  }

  /** 河面（terrain.json water）：幾格輪播、左右重複；第 surfaceY 列＝水面，圖底以下補 bottomColor */
  private drawWaterArt(ctx: CanvasRenderingContext2D, W: TerrainArt['water'][string], p0: number, p1: number, surf: number): void {
    const fr = W.frames[Math.floor(performance.now() / 1000 * W.fps) % W.frames.length]!;
    const k = W.scale, fw = fr.w * k, fh = fr.h * k;
    const y = Math.round(surf - W.surfaceY * k);
    ctx.save();
    ctx.beginPath(); ctx.rect(p0 - 1, y - 4, p1 - p0 + 2, VIEW_H - y + 80); ctx.clip();
    ctx.fillStyle = W.bottomColor; ctx.fillRect(p0 - 1, y + fh - 2, p1 - p0 + 2, VIEW_H + 80);
    for (let u = Math.floor(p0 / fw) * fw; u < p1; u += fw) ctx.drawImage(fr.img, u, y, fw + 1, fh);
    ctx.restore();
  }

  /** 水坑：水面以下深藍漸層，水面一條亮線、幾條會動的波紋（美術的河面圖交件前先這樣） */
  private drawWater(ctx: CanvasRenderingContext2D, p0: number, p1: number, surf: number): void {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, surf, 0, VIEW_H);
    g.addColorStop(0, 'rgba(70,120,170,.92)'); g.addColorStop(0.4, 'rgba(26,52,92,.96)'); g.addColorStop(1, '#0a1428');
    ctx.fillStyle = g; ctx.fillRect(p0 - 1, surf, p1 - p0 + 2, VIEW_H - surf + 20);
    ctx.save();
    ctx.beginPath(); ctx.rect(p0, surf - 4, p1 - p0, VIEW_H); ctx.clip();
    ctx.strokeStyle = 'rgba(210,235,255,.85)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = p0; x <= p1; x += 8) { const y = surf + Math.sin(x * 0.05 + t * 3) * 2.5; if (x === p0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,210,255,.35)'; ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      const yy = surf + k * 18, off = (t * 30 * (k % 2 ? 1 : -1) + k * 40) % 60;
      for (let x = p0 - 60 + off; x < p1; x += 60) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 26, yy); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** 這個 x 用哪一套崖壁：山村石牆、竹林土崖、山賊寨木樁 */
  private wallArt(w: World, x: number): TerrainArt['wall'][string] | undefined {
    const T = this.a.terrain;
    if (!T) return undefined;
    let zi = 0;
    w.stage.zones.forEach((z, k) => { if (x >= z.from) zi = k; });
    const z = w.stage.zones[zi]!;
    const set = z.wall ?? { village: 'stone', bamboo: 'earth', bandit: 'log' }[T.zones[z.ground] ?? z.ground] ?? 'stone';
    return T.wall[set] ?? v2Wall(set) ?? T.wall.stone;
  }

  /** 崖壁：壁面對齊落差的 x、頂塊的站立線對齊高處地面，壁身往下接到底；圖是壁面朝左（左低右高），左邊高就整組左右翻 */
  private drawWallArt(ctx: CanvasRenderingContext2D, W: TerrainArt['wall'][string], x: number, top: number, bottom: number, hiLeft: boolean): void {
    ctx.save();
    ctx.translate(Math.round(x), 0);
    if (hiLeft) ctx.scale(-1, 1);
    const y0 = Math.round(top - W.top.standY);
    ctx.drawImage(W.top.img, -W.faceX, y0, W.top.w, W.top.h);   // 給目的寬高（手機載入時圖縮過）
    for (let y = y0 + W.top.h - 1; y < bottom + 40; y += W.body.h - 1) ctx.drawImage(W.body.img, -W.faceX, y, W.body.w, W.body.h);
    ctx.restore();
  }

  /**
   * 樓梯一階（26～30 像素）：地面帶自己的剖面會露出一道直切口（高處那一段的土層直接切斷）。
   * 改成一塊石階：高處那一側、從落差往內 70 像素，畫崖壁壁身（縮成 0.5 倍）當立面，右邊淡出接回地面帶。
   * 先在一張小畫布上做好（淡出要用「擦掉」模式，直接在主畫布上擦會連背景一起擦掉），再整塊貼上去；同樣大小的做一次存起來。
   */
  private stepCache = new Map<string, HTMLCanvasElement>();
  private drawStepRiser(ctx: CanvasRenderingContext2D, W: TerrainArt['wall'][string], x: number, top: number, bottom: number, hiLeft: boolean): void {
    const k = 0.5, depth = 70, h = Math.max(4, Math.round(bottom - top + 4));
    const key = `${W.body.img.src}|${h}`;
    let c = this.stepCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = depth + 12; c.height = h + 6;
      const g = c.getContext('2d')!;
      for (let y = 0; y < c.height; y += W.body.h * k - 1) g.drawImage(W.body.img, 10 - W.faceX * k, y, W.body.w * k, W.body.h * k);
      // 左邊（壁面外側）有些崖壁圖留了透明的陰影帶：只留壁面以右
      g.clearRect(0, 0, 10, c.height);
      g.globalCompositeOperation = 'destination-out';
      const fade = g.createLinearGradient(10 + depth - 28, 0, 10 + depth, 0);
      fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = fade; g.fillRect(10 + depth - 28, 0, 40, c.height);
      // 上緣也淡一點，接上高處地面帶的草邊
      const lip = g.createLinearGradient(0, 0, 0, 7);
      lip.addColorStop(0, 'rgba(0,0,0,.85)'); lip.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lip; g.fillRect(0, 0, c.width, 7);
      g.globalCompositeOperation = 'source-over';
      // 壁面一道陰影
      const sh = g.createLinearGradient(10, 0, 18, 0);
      sh.addColorStop(0, 'rgba(10,5,2,.45)'); sh.addColorStop(1, 'rgba(10,5,2,0)');
      g.fillStyle = sh; g.fillRect(10, 0, 8, c.height);
      this.stepCache.set(key, c);
    }
    ctx.save();
    ctx.translate(Math.round(x), 0);
    if (hiLeft) ctx.scale(-1, 1);
    ctx.drawImage(c, -10, Math.round(top + 3));
    ctx.restore();
  }

  /**
   * 畫 terrain.json 的一個道具：bottom-center 的照「圖的實心底線」貼在 (x, y)（y＝地面線，往下陷 3 像素），
   * center 的照中心；size＝顯示時長邊多大（沒給就照 displayScale）。回傳有沒有畫（沒有這張圖就 false，外面退回程式畫）
   */
  private drawTProp(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, o: { flip?: boolean; size?: number; rot?: number; alpha?: number; height?: number; dark?: number } = {}): boolean {
    const P = this.a.terrain?.props[key];
    if (!P) return false;
    const sc = o.height ? o.height / P.h : o.size ? o.size / Math.max(P.w, P.h) : P.scale;
    const dw = P.w * sc, dh = P.h * sc;
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    const img = o.dark ? darkOf(P.img, o.dark) : P.img;
    if (P.anchor === 'bottom-center') ctx.drawImage(img, -dw / 2, 3 - P.footY * sc, dw, dh);
    else ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  /**
   * 檢查用（tools/feet_check.mjs）：把某段地面帶照遊戲的畫法畫在透明畫布上，站立面在 y＝surface、坡度 slope，
   * 每一欄往下找「連續 12 列都實心」的第一列＝看起來的地面頂，回傳跟應該的站立線差幾像素（中位數、最大）。
   */
  measureGround(key: string, surface: number, slope = 0): { median: number; max: number; drawn: boolean } {
    const W = 400, c = document.createElement('canvas');
    c.width = W; c.height = VIEW_H + 120;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    this.drawGroundSpan(g, key, 0, surface, W, surface + slope * W);
    const d = g.getImageData(0, 0, W, c.height).data;
    const offs: number[] = [];
    for (let x = 20; x < W - 20; x += 4) {
      const want = surface + slope * x;
      for (let y = Math.max(0, Math.floor(want) - 120); y < c.height - 12; y++) {
        let ok = true;
        for (let k = 0; k < 12 && ok; k++) if (d[((y + k) * W + x) * 4 + 3]! < 128) ok = false;
        if (ok) { offs.push(y - want); break; }
      }
    }
    offs.sort((a, b) => a - b);
    return { median: offs[Math.floor(offs.length / 2)] ?? NaN, max: Math.max(...offs.map(Math.abs)), drawn: !!(this.newGround(key) ?? this.art(key)) };
  }

  /** 一段斜（或平）的地面：錯切讓地面帶跟著斜，底下填土色 */
  /** 新地面帶（terrain.json）：關卡檔寫的舊鍵名 s1_1_ground 照 _zones 對到 village／bamboo／bandit */
  private newGround(key: string): (Pick<TImg, 'img' | 'w' | 'h' | 'standY'> & { bottomColor: string }) | undefined {
    const T = this.a.terrain;
    return T?.ground[T.zones[key] ?? key] ?? v2Ground(key) ?? undefined;
  }

  private drawGroundSpan(ctx: CanvasRenderingContext2D, key: string, x0: number, y0: number, x1: number, y1: number): void {
    const a = this.art(key), G = this.newGround(key);
    const k = (y1 - y0) / (x1 - x0);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 - 0.6, -3000, x1 - x0 + 1.2, VIEW_H + 3050); ctx.clip();
    ctx.transform(1, k, 0, 1, 0, y0 - k * x0);
    if (G) {
      // 地面帶第 standY 列＝腳踩的線；圖底以下用 bottomColor 補滿到畫面底；每 976 像素重複一次（接縫美術量過看不出來）
      ctx.fillStyle = G.bottomColor;
      ctx.fillRect(x0 - 2, G.h - G.standY - 2, x1 - x0 + 4, VIEW_H + 400);
      for (let u = Math.floor(x0 / G.w) * G.w; u < x1; u += G.w) ctx.drawImage(G.img, u, -G.standY, G.w + 1, G.h);
      // 第二版陡坡：照這段坡實際的角度挑坡帶疊上去（坡頂坡底 40 像素跟平地帶交叉淡化）
      const T = this.a.terrain, S = slopeArt(T?.zones[key] ?? key, k);
      if (S && x1 - x0 > 60) {
        const F = 40, n = 8;
        for (let i = 0; i < n + 2; i++) {
          // 中間一大段不透明，兩頭各切 n/2 片慢慢淡
          const edge = i < n / 2 ? [x0 + i * F / (n / 2), x0 + (i + 1) * F / (n / 2)] : i < n ? [x1 - F + (i - n / 2) * F / (n / 2), x1 - F + (i - n / 2 + 1) * F / (n / 2)] : i === n ? [x0 + F, x1 - F] : null;
          if (!edge || edge[1]! <= edge[0]!) continue;
          const a0 = edge[0]!, a1 = edge[1]!;
          ctx.save();
          ctx.globalAlpha *= i < n / 2 ? (i + 1) / (n / 2 + 1) : i < n ? 1 - (i - n / 2) / (n / 2 + 1) : 1;
          ctx.beginPath(); ctx.rect(a0 - 0.5, -3000, a1 - a0 + 1, VIEW_H + 3050); ctx.clip();
          // 坡帶比平地帶淺（第一關梯田：坡帶 196、平地帶 271）：坡帶底下讓平地帶的石牆露出來，不要一大片暗色（09-29 截圖）
          if (S.h - S.standY >= G.h - G.standY) { ctx.fillStyle = S.bottomColor; ctx.fillRect(a0 - 1, S.h - S.standY - 2, a1 - a0 + 2, VIEW_H + 400); }
          for (let u = Math.floor(a0 / S.w) * S.w; u < a1; u += S.w) ctx.drawImage(S.img, u, -S.standY, S.w + 1, S.h);
          ctx.restore();
        }
      }
    } else if (a && typeof a.meta.surfaceY === 'number') {
      const img = a.img, bw = img.naturalWidth, bh = img.naturalHeight, sY = a.meta.surfaceY;
      ctx.fillStyle = this.a.dirt.get(key) ?? '#4a2e1c';
      ctx.fillRect(x0 - 2, bh - sY - 3, x1 - x0 + 4, VIEW_H + 400);
      for (let u = Math.floor(x0 / bw) * bw; u < x1; u += bw) ctx.drawImage(img, u, -sY, bw + 1, bh);
    } else {
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(x0 - 2, 0, x1 - x0 + 4, VIEW_H + 400);
      ctx.fillStyle = '#b9854e'; ctx.fillRect(x0 - 2, 0, x1 - x0 + 4, 26);
      ctx.fillStyle = '#6f9a3a'; ctx.fillRect(x0 - 2, -4, x1 - x0 + 4, 8);
    }
    ctx.restore();
  }

  private drawHole(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, fresh = false): void {
    // 地洞：剛衝開那一下用土塊飛起來的那張
    if (this.drawTProp(ctx, fresh ? 'burrow_burst' : 'burrow', x, y, { size: 130 / (fresh ? 1 : 1), alpha: a })) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#6b4526'; ctx.beginPath(); ctx.ellipse(x, y + 2, 52, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#140a06'; ctx.beginPath(); ctx.ellipse(x, y + 3, 40, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ───────────────────────── 屋子、平台、裝飾 ─────────────────────────

  private drawProps(ctx: CanvasRenderingContext2D, w: World, front: boolean, cam: number): void {
    for (const p of w.stage.props) {
      if (!!p.front !== front || p.x < cam - 500 || p.x > cam + VIEW_W + 500) continue;
      const g0 = w.terrain.lineAt(p.x);
      if (this.drawTAnim(ctx, p.art, p.x, g0, p.h)) continue;
      // 前景的竹叢：壓暗、微透明（美術說明：當前景時請配合暗一點或半透明）
      // 前景的竹叢擋到球球時變淡（離球球越近越透明），不要把人整個蓋掉
      const TP = this.a.terrain?.props[p.art];
      const fade = front && TP ? Math.max(0.3, Math.min(0.92, 0.3 + (Math.abs(p.x - w.player.body.x) - TP.w * (p.h / TP.h) * 0.4) / 220)) : 1;
      if (this.drawTProp(ctx, p.art, p.x, g0 + 2, { height: p.h, flip: p.flip, ...(front ? { dark: 0.55, alpha: fade } : {}) })) continue;
      const a = this.art(p.art);
      if (!a) continue;
      const hh = p.h, ww = a.img.naturalWidth * (hh / a.img.naturalHeight);
      const g = w.terrain.lineAt(p.x);
      const px = front ? p.x - (cam * 0.25) % 1 : p.x;
      ctx.save();
      if (front) ctx.globalAlpha = 0.88;
      ctx.translate(px, a.meta.anchor === 'top-center' ? 0 : g + 6);
      if (p.flip) ctx.scale(-1, 1);
      if (a.meta.anchor === 'top-center') ctx.drawImage(a.img, -ww / 2, 0, ww, hh);
      else ctx.drawImage(a.img, -ww / 2, -hh, ww, hh);
      ctx.restore();
    }
  }

  /**
   * 屋頂平台底下的民家（terrain.json 的左端＋中段×n＋右端）：屋脊＝站得上去的那條線，圖底埋進地面 6 像素。
   * 縮放照「屋脊到地面的高度」算（屋頂拉高，屋子跟著放大），中段幾塊照平台寬度挑，再整棟水平微調到屋脊剛好＝平台寬。
   */
  private drawHouseArt(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): boolean {
    const H = this.a.terrain?.house;
    if (!H) return false;
    return this.drawRowHouse(ctx, w, p, { ...H, mids: [H.mid] });
  }

  /** 攤位長屋（terrain.json building.s2_stallroof）：屋脊＝站得上去的線，中段在幾種樣子之間輪流挑（一整排才不會每間都一樣） */
  private drawStallArt(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): boolean {
    const B = this.a.terrain?.building.s2_stallroof;
    if (!B) return false;
    return this.drawRowHouse(ctx, w, p, B);
  }

  private drawRowHouse(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef, H: TerrainArt['building'][string]): boolean {
    const mid0 = H.mids[0]!;
    const g = w.terrain.lineAt(p.x + p.w / 2);
    const s = (g + 6 - p.y) / (H.bottomY - H.standY);
    const lr = (H.left.w - H.leftRidgeX) + H.rightRidgeX;
    const n = Math.max(0, Math.round((p.w / s - lr) / mid0.w));
    const ridge = lr + n * mid0.w;
    const fx = p.w / (ridge * s);
    const top = p.y - H.standY * s;
    const seed = Math.floor(p.x / 97);
    const pieces = [H.left, ...Array.from({ length: n }, (_, i) => H.mids[(i + seed) % H.mids.length]!), H.right];
    let x = p.x - H.leftRidgeX * s * fx;
    for (const pc of pieces) {
      const dw = pc.w * s * fx, x0 = Math.round(x), x1 = Math.round(x + dw);
      ctx.drawImage(pc.img, x0, top, x1 - x0 + 1, pc.h * s);   // 多畫 1 像素，接縫不會露出細縫
      x += dw;
    }
    return true;
  }

  /** 屋頂平台底下的屋子：白牆、木樑、紙窗透暖光、門、屋簷下的燈籠 */
  private drawHouse(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef, now: number): void {
    if (this.drawHouseArt(ctx, w, p)) return;
    const g = w.terrain.lineAt(p.x + p.w / 2);
    const top = p.y + 26, x0 = p.x + 14, x1 = p.x + p.w - 14;
    // 木牆（上亮下暗）、粗黑描邊，配合美術的畫風
    const wall = ctx.createLinearGradient(0, top, 0, g);
    wall.addColorStop(0, '#9a6a42'); wall.addColorStop(1, '#5a3a22');
    ctx.fillStyle = wall; ctx.strokeStyle = '#1a0f08'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.rect(x0, top, x1 - x0, g - top + 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(x0, top + 10, x1 - x0, 9);
    for (let x = x0 + 40; x < x1 - 20; x += 70) ctx.fillRect(x, top, 8, g - top);
    ctx.strokeStyle = 'rgba(40,20,10,.35)'; ctx.lineWidth = 2;
    for (let y = top + 34; y < g; y += 16) { ctx.beginPath(); ctx.moveTo(x0 + 2, y); ctx.lineTo(x1 - 2, y); ctx.stroke(); }
    // 紙窗透暖光
    const wx = x0 + 22, wy = top + 34;
    const glow = 0.8 + 0.15 * Math.sin(now * 2 + p.x);
    const halo = ctx.createRadialGradient(wx + 29, wy + 21, 4, wx + 29, wy + 21, 70);
    halo.addColorStop(0, `rgba(255,190,90,${0.35 * glow})`); halo.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = halo; ctx.fillRect(wx - 45, wy - 50, 150, 140);
    ctx.fillStyle = `rgba(255,205,120,${glow})`; ctx.fillRect(wx, wy, 58, 42);
    ctx.strokeStyle = '#2a170b'; ctx.lineWidth = 3; ctx.strokeRect(wx, wy, 58, 42);
    ctx.beginPath(); ctx.moveTo(wx + 29, wy); ctx.lineTo(wx + 29, wy + 42); ctx.moveTo(wx, wy + 21); ctx.lineTo(wx + 58, wy + 21); ctx.stroke();
    // 門（暖簾）
    ctx.fillStyle = '#24162a'; ctx.fillRect(x1 - 78, g - 92, 54, 92);
    ctx.fillStyle = '#b8382e'; ctx.strokeStyle = '#1a0f08'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.rect(x1 - 82, g - 96, 62, 30); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 - 51, g - 96); ctx.lineTo(x1 - 51, g - 66); ctx.stroke();
    // 屋頂（瓦，上亮下暗）：頂邊＝站得上去的那條線
    const roof = ctx.createLinearGradient(0, p.y, 0, p.y + 40);
    roof.addColorStop(0, '#6a6680'); roof.addColorStop(1, '#2e2c40');
    ctx.fillStyle = roof; ctx.strokeStyle = '#120d18'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x - 18, p.y + 40); ctx.lineTo(p.x + 16, p.y); ctx.lineTo(p.x + p.w - 16, p.y); ctx.lineTo(p.x + p.w + 18, p.y + 40); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(160,160,190,.55)'; ctx.lineWidth = 2;
    for (let x = p.x; x < p.x + p.w; x += 22) { ctx.beginPath(); ctx.moveTo(x + 4, p.y + 6); ctx.lineTo(x - 2, p.y + 36); ctx.stroke(); }
    ctx.fillStyle = '#1e1c2c'; ctx.fillRect(p.x + 10, p.y - 6, p.w - 20, 9);
    ctx.fillStyle = '#8a86a4'; ctx.fillRect(p.x + 14, p.y - 5, p.w - 28, 2);
    // 燈籠（搖）
    this.drawLantern(ctx, p.x + 8, p.y + 40, now + p.x * 0.01);
    this.drawLantern(ctx, p.x + p.w - 8, p.y + 40, now + p.x * 0.013 + 1);
  }

  private drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    const a = Math.sin(t * 1.6) * 0.16;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const img = this.art('ambient_lantern')?.img;
    const glow = ctx.createRadialGradient(0, 34, 2, 0, 34, 46);
    glow.addColorStop(0, 'rgba(255,170,80,.45)'); glow.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = glow; ctx.fillRect(-46, -12, 92, 92);
    if (img) ctx.drawImage(img, -16, 6, 32, 48);
    else {
      ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 12); ctx.stroke();
      ctx.fillStyle = '#d9412f'; ctx.strokeStyle = '#3a1410'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 34, 15, 21, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b1a10'; ctx.fillRect(-9, 11, 18, 5); ctx.fillRect(-9, 52, 18, 5);
      ctx.strokeStyle = 'rgba(255,220,160,.6)'; ctx.lineWidth = 1.5;
      for (const dy of [-8, 0, 8]) { ctx.beginPath(); ctx.ellipse(0, 34 + dy, 14, 3, 0, 0, Math.PI); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** 竹架、木架（terrain.json）：支柱從平台面往下重複到地面（坑裡到畫面底），平台面＝左端＋中段×n＋右端、整條水平微調到剛好 */
  private drawRailArt(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): boolean {
    const T = this.a.terrain;
    const R = T?.rail[RAIL_OF[p.look] ?? 'plank'];
    const post = R ? T!.post[R.post] : undefined;
    if (!R || !post) return false;
    const pw = post.w * post.scale, ph = post.h * post.scale;
    // 支柱：兩端各一根；橋在坑（河）上面的那一段每 150 像素再插一根橋墩到水裡
    const posts = [p.x + 16, p.x + p.w - 16];
    if (p.look === 'bridge' || p.look === 'conveyor' || p.look === 'catwalk') for (let px = p.x + 120; px < p.x + p.w - 100; px += 150) if (!Number.isFinite(w.terrain.groundAt(px))) posts.push(px);
    for (const px of posts) {
      const g = Math.min(VIEW_H + 10, w.terrain.groundAt(px));
      ctx.save();
      ctx.beginPath(); ctx.rect(px - pw, p.y, pw * 2, g + 4 - p.y); ctx.clip();
      for (let y = p.y + 6; y < g + 4; y += ph - 1) ctx.drawImage(post.img, px - pw / 2, y, pw, ph);
      ctx.restore();
    }
    const want = (p.w + 12) / R.scale;
    const n = Math.max(0, Math.round((want - R.left.w - R.right.w) / R.mid.w));
    // 輸送帶：中段四格輪播（圖上皮帶往右跑；往左帶就倒著播）
    const midNow = R.midFrames && p.belt ? R.midFrames[((Math.floor(performance.now() / 1000 * (R.fps ?? 12)) * Math.sign(p.belt)) % R.midFrames.length + R.midFrames.length) % R.midFrames.length]! : R.mid;
    const pieces = [R.left, ...Array.from({ length: n }, () => midNow), R.right];
    const natural = pieces.reduce((a, pc) => a + pc.w, 0);
    const fx = (p.w + 12) / natural;
    let x = p.x - 6;
    const top = p.y - R.standY * R.scale;
    for (const pc of pieces) {
      const dw = pc.w * fx, x0 = Math.round(x), x1 = Math.round(x + dw);
      ctx.drawImage(pc.img, x0, top, x1 - x0 + 1, pc.h * R.scale);
      x += dw;
    }
    return true;
  }

  /**
   * 升降台（terrain.json platform.s3_lift）：台面＝平台現在的高度（世界裡的升降台每一格在動），
   * 縮放照「能站的寬度＝平台寬」；鋼索從圖頂往上畫到畫面頂。
   */
  private drawLiftArt(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): boolean {
    const P = this.a.terrain?.platform.s3_lift;
    if (!P) return false;
    const live = w.platforms.find((q) => q.x === p.x && q.w === p.w) ?? p;
    const s = p.w / (P.standX1 - P.standX0);
    const left = p.x - P.standX0 * s, top = live.y - P.standY * s;
    // 鋼索（兩條，從圖頂接到畫面頂）
    ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 6;
    for (const k of LIFT_CABLES) { const cx = left + P.w * s * k; ctx.beginPath(); ctx.moveTo(cx, -20); ctx.lineTo(cx, top + 4); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(200,190,170,.35)'; ctx.lineWidth = 1.5;
    for (const k of LIFT_CABLES) { const cx = left + P.w * s * k - 1; ctx.beginPath(); ctx.moveTo(cx, -20); ctx.lineTo(cx, top + 4); ctx.stroke(); }
    ctx.drawImage(P.img, left, top, P.w * s, P.h * s);
    return true;
  }

  /** 蒸氣噴口的底座（terrain.json anim.s3_steam_vent）：底部中間貼地；要噴之前冒小煙（預兆） */
  private drawVentBase(ctx: CanvasRenderingContext2D, w: World, v: { x: number; period: number; offset: number }): void {
    const A = this.a.terrain?.anim.s3_steam_vent, g = w.terrain.groundAt(v.x);
    if (!Number.isFinite(g)) return;
    const st = w.ventState(v);
    if (A) {
      const B = A.base, bs = B.scale;
      ctx.drawImage(B.img, v.x - B.w * bs / 2, g + 3 - B.footY * bs, B.w * bs, B.h * bs);
    } else {
      ctx.fillStyle = '#4a4440'; ctx.strokeStyle = '#1a1614'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(v.x - 30, g - 34, 60, 36); ctx.fill(); ctx.stroke();
    }
    if (st.warn && Math.random() < 0.5) {
      const px = v.x + rnd(-10, 10), py = g - 40;
      ctx.fillStyle = 'rgba(240,244,250,.55)'; ctx.beginPath(); ctx.arc(px, py - rnd(0, 20), rnd(5, 10), 0, Math.PI * 2); ctx.fill();
    }
  }

  /** 蒸氣（噴的時候）：4 格照噴的進度播（噴出→最高→散開→變弱），畫在角色前面 */
  private drawVentSteam(ctx: CanvasRenderingContext2D, w: World, v: { x: number; period: number; offset: number }): void {
    const st = w.ventState(v), g = w.terrain.groundAt(v.x);
    if (!st.on || !Number.isFinite(g)) return;
    const A = this.a.terrain?.anim.s3_steam_vent;
    const box = w.ventBox(v);
    if (A) {
      const B = A.base, bs = B.scale, fs = A.scale;
      const fr = A.frames[Math.min(A.frames.length - 1, Math.floor(st.k * A.frames.length))]!;
      const top = g + 3 - B.footY * bs;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(fr.img, v.x - A.baseX * fs, top + 6 - fr.h * fs, fr.w * fs, fr.h * fs);
      ctx.globalAlpha = 1;
    } else {
      const k = Math.sin(st.k * Math.PI);
      ctx.fillStyle = `rgba(240,244,250,${0.7 * k + 0.2})`;
      ctx.fillRect(box.x0, box.y0 + (1 - k) * 120, box.x1 - box.x0, box.y1 - box.y0 - (1 - k) * 120);
    }
  }

  /** 飛彈的落點：紅色瞄準圈一閃一閃、越來越小，中間一個「！」 */
  private drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, life: number): void {
    const k = Math.min(1, age / life), pulse = 0.7 + 0.3 * Math.sin(age * 24);
    const r = 115 - k * 25;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - r - 14, y); ctx.lineTo(x - r + 14, y); ctx.moveTo(x + r - 14, y); ctx.lineTo(x + r + 14, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,60,40,.18)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.drawAlert(ctx, x, y - 40, age);
  }

  /**
   * 魔王的招式預告與特效：掃地機王衝撞的地上紅區；鐵爪機關貓雷射的紅線（預兆，照會射的高度）、雷射本身、暴走衝撞的地上紅區；
   * 吸塵機器、掃地機王吸的時候吸口前面一圈淡淡的吸氣。
   */
  private drawBossFx(ctx: CanvasRenderingContext2D, w: World, e: Enemy, now: number): void {
    if (e.dying > 0) return;
    const g = e.y;
    const zone = (x0: number, x1: number, a: number): void => {
      ctx.fillStyle = `rgba(255,50,40,${a})`; ctx.fillRect(Math.min(x0, x1), g - 6, Math.abs(x1 - x0), 12);
      ctx.strokeStyle = `rgba(255,80,60,${a + 0.3})`; ctx.lineWidth = 3; ctx.setLineDash([16, 10]);
      ctx.strokeRect(Math.min(x0, x1), g - 6, Math.abs(x1 - x0), 12); ctx.setLineDash([]);
    };
    const blink = 0.25 + 0.2 * Math.sin(now * 20);
    if (e.kind === 'roomba_king' && e.state === 'ramWind') {
      const d = ENEMY_DEFS[e.kind];
      zone(e.x + e.facing * d.w / 2, e.x + e.facing * (d.w / 2 + RAM_DIST), blink);
    }
    if (e.kind === 'iron_claw' && e.state === 'rampageWind') {
      const ar = w.arena();
      zone(e.x, e.facing > 0 ? ar.x1 : ar.x0, blink);
    }
    if ((e.kind === 'vacuum' || e.kind === 'roomba_king') && e.state === 'suck') {
      const m = mouthOf(e), R = e.kind === 'vacuum' ? 200 : 360;
      const gr = ctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, R);
      gr.addColorStop(0, 'rgba(220,235,255,.35)'); gr.addColorStop(1, 'rgba(220,235,255,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.arc(m.x, m.y, R, e.facing > 0 ? -0.5 : Math.PI - 0.5, e.facing > 0 ? 0.5 : Math.PI + 0.5); ctx.closePath(); ctx.fill();
    }
    if (e.kind !== 'iron_claw') return;
    const L = laserBox(e, w);
    if (!L) return;
    const mx = e.x + e.facing * 200, my = e.y - 250;   // 嘴巴（照 claw2_laser 片段量的：身體左緣、腳底往上 250）
    if (e.state === 'laserWind') {
      // 預兆：會射的高度畫一條紅色虛線（一閃一閃，越來越亮）＋爐心的光
      const k = Math.min(1, e.t / 1.0), cy = (L.y0 + L.y1) / 2;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.5 * k * (0.6 + 0.4 * Math.sin(now * 26));
      ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 4; ctx.setLineDash([22, 14]);
      ctx.beginPath(); ctx.moveTo(L.x0, cy); ctx.lineTo(L.x1, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,60,40,.12)'; ctx.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
      ctx.restore();
      const gl = ctx.createRadialGradient(mx, my, 4, mx, my, 40 + 60 * k);
      gl.addColorStop(0, 'rgba(255,240,180,.95)'); gl.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(mx, my, 40 + 60 * k, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (e.t < 0.05 || e.t > 1.3) return;
    // 雷射：從嘴巴拉到那個高度，再一路射到場地盡頭（外層橘、裡面白）
    const cy = (L.y0 + L.y1) / 2, hh = (L.y1 - L.y0) / 2 * (0.85 + 0.15 * Math.sin(now * 50));
    const beam = this.fx('laser_beam');
    if (beam) {
      // 第三批美術：光束段左右重複（加亮混色），高度＝判定帶的 1.1 倍、核心線對齊帶子中線；嘴巴那端蓋發射口閃光，盡頭畫打中火花
      const bandH = (L.y1 - L.y0) * (1.05 + 0.08 * Math.sin(now * 50));
      const s = bandH / beam.h, tw = beam.w * s;
      const core = beam.meta.coreY as [number, number] | undefined;
      const top = cy - (core ? (core[0] + core[1]) / 2 : beam.h / 2) * s;
      const start = e.facing > 0 ? L.x0 : L.x1, end = e.facing > 0 ? L.x1 : L.x0;
      ctx.save();
      ctx.beginPath(); ctx.rect(L.x0, top - 4, L.x1 - L.x0, beam.h * s + 8); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const scroll = (now * 900) % tw;
      if (e.facing > 0) for (let x = start - scroll; x < end; x += tw - 1) ctx.drawImage(beam.frames[0]!, x, top, tw, beam.h * s);
      else for (let x = start - tw + scroll; x + tw > end; x -= tw - 1) ctx.drawImage(beam.frames[0]!, x, top, tw, beam.h * s);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,200,120,.75)'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(start, cy); ctx.stroke();
      const mz = this.fx('laser_muzzle'), hit = this.fx('laser_hit');
      if (mz) fxDraw(ctx, mz, 0, start, cy, 0.55 + 0.05 * Math.sin(now * 40), { flip: e.facing < 0 });
      if (hit) {
        const p = w.player.body;
        const onP = p.y - 170 < L.y1 && p.y > L.y0 && p.x > L.x0 && p.x < L.x1;
        fxDraw(ctx, hit, 0, onP ? p.x : end, cy, 0.5, { flip: e.facing > 0 });   // 圖上火花往左噴（光束往左射時不翻）
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const band = ctx.createLinearGradient(0, cy - hh, 0, cy + hh);
    band.addColorStop(0, 'rgba(255,120,30,0)'); band.addColorStop(0.3, 'rgba(255,150,40,.85)'); band.addColorStop(0.5, 'rgba(255,250,220,1)');
    band.addColorStop(0.7, 'rgba(255,150,40,.85)'); band.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = band;
    ctx.fillRect(L.x0, cy - hh, L.x1 - L.x0, hh * 2);
    ctx.strokeStyle = 'rgba(255,200,120,.9)'; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(e.facing > 0 ? L.x0 : L.x1, cy); ctx.stroke();
    ctx.restore();
  }

  /**
   * 長條（terrain.json deck：木柵、木造矮牆、屋脊）：左端＋中段×n＋右端、底部貼地，整條水平微調到剛好寬 w。
   * stand 有給（能站的矮牆當平台）：照「站立線到地面」的高度算縮放；沒給（木柵當背景）用美術的顯示縮放。
   */
  private drawDeckArt(ctx: CanvasRenderingContext2D, w: World, key: string, x: number, width: number, stand?: number): boolean {
    const D = this.a.terrain?.deck[key];
    if (!D) return false;
    const g = Math.max(w.terrain.lineAt(x + 4), w.terrain.lineAt(x + width - 4));
    const H = D.mid.h;
    const s = stand !== undefined ? (g + 4 - stand) / (H - D.standY) : D.scale;
    const n = Math.max(0, Math.round((width / s - D.left.w - D.right.w) / D.mid.w));
    const pieces = [D.left, ...Array.from({ length: n }, () => D.mid), D.right];
    const natural = pieces.reduce((a, pc) => a + pc.w, 0);
    const fx = width / (natural * s);
    const top = stand !== undefined ? stand - D.standY * s : g + 6 - H * s;
    let px = x;
    for (const pc of pieces) {
      const dw = pc.w * s * fx, a0 = Math.round(px), a1 = Math.round(px + dw);
      ctx.drawImage(pc.img, a0, top, a1 - a0 + 1, pc.h * s);
      px += dw;
    }
    return true;
  }

  /** 背景的木柵（站不上去）：畫在地面帶後面，底部被地面帶蓋住一點，不會浮起來 */
  private drawBackDeck(ctx: CanvasRenderingContext2D, w: World, d: DeckDef): void {
    this.drawDeckArt(ctx, w, d.key, d.x, d.w);
  }

  /** 大鳥居（terrain.json platform.s2_torii）：上橫樑＝平台；縮放照「橫樑到地面」算，柱腳一定貼地 */
  private drawToriiArt(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): boolean {
    const P = this.a.terrain?.platform.s2_torii;
    if (!P) return false;
    const g = w.terrain.lineAt(p.x + p.w / 2);
    const s = (g + 3 - p.y) / (P.footY - P.standY);
    const left = p.x + p.w / 2 - (P.standX0 + P.standX1) / 2 * s;
    ctx.drawImage(P.img, left, p.y - P.standY * s, P.w * s, P.h * s);
    return true;
  }

  /** 營火（terrain.json anim）：先畫柴堆（底部中間貼地、顯示高 h），火焰格底部中間對齊柴堆中心、往上柴堆高度的 45%，輪播；後面一圈暖光 */
  private drawTAnim(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, h?: number): boolean {
    const A = this.a.terrain?.anim[key];
    if (!A) return false;
    const B = A.base;
    const bs = h ? h / B.footY : B.scale;
    const fs = A.scale * (bs / B.scale);
    const now = performance.now() / 1000;
    const glow = ctx.createRadialGradient(x, y - B.footY * bs * 0.8, 6, x, y - B.footY * bs * 0.8, 150);
    glow.addColorStop(0, `rgba(255,170,70,${0.3 + 0.06 * Math.sin(now * 11 + x)})`); glow.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = glow; ctx.fillRect(x - 150, y - B.footY * bs * 0.8 - 150, 300, 300);
    ctx.drawImage(B.img, x - B.w * bs / 2, y + 3 - B.footY * bs, B.w * bs, B.h * bs);
    const fr = A.frames[Math.floor(now * A.fps + x * 0.013) % A.frames.length]!;
    const fb = y + 3 - B.footY * bs * 0.45;
    ctx.drawImage(fr.img, x - A.baseX * fs, fb - fr.h * fs, fr.w * fs, fr.h * fs);
    return true;
  }

  /** 竹架、木架（屋頂平台的屋子另外畫）：柱子一路插到地面（坑裡就插到畫面底） */
  private drawPlatform(ctx: CanvasRenderingContext2D, w: World, p: PlatformDef): void {
    if (p.look === 'roof' || p.look === 'stall' || p.look === 'ledge') return;
    if (p.look === 'lift' && this.drawLiftArt(ctx, w, p)) return;
    if (p.look === 'ridge' && this.drawDeckArt(ctx, w, 's3_ridge', p.x, p.w, p.y)) return;
    if (p.look === 'torii' && this.drawToriiArt(ctx, w, p)) return;
    if (p.look === 'rampart' && this.drawDeckArt(ctx, w, 's1_rampart', p.x, p.w, p.y)) return;
    if (this.drawRailArt(ctx, w, p)) return;
    const posts = [p.x + 16, p.x + p.w - 16];
    for (const px of posts) {
      const g = Math.min(VIEW_H + 10, w.terrain.groundAt(px));
      if (p.look === 'bamboo') {
        ctx.fillStyle = '#7fa446'; ctx.strokeStyle = '#2c3a12'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.rect(px - 7, p.y, 14, g - p.y); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#4f6e22';
        for (let y = p.y + 40; y < g; y += 56) ctx.fillRect(px - 8, y, 16, 4);
      } else {
        ctx.fillStyle = '#6e4424'; ctx.strokeStyle = '#2b170b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.rect(px - 8, p.y, 16, g - p.y); ctx.fill(); ctx.stroke();
      }
    }
    if (p.look === 'plank') {
      // 斜撐
      ctx.strokeStyle = '#5a3419'; ctx.lineWidth = 6;
      const g = Math.min(VIEW_H, w.terrain.groundAt(p.x + p.w / 2));
      ctx.beginPath(); ctx.moveTo(posts[0]!, p.y + 20); ctx.lineTo(posts[1]!, Math.min(g, p.y + 150)); ctx.moveTo(posts[1]!, p.y + 20); ctx.lineTo(posts[0]!, Math.min(g, p.y + 150)); ctx.stroke();
      ctx.fillStyle = '#7a4a26'; ctx.strokeStyle = '#2b170b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, 22, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b07a45'; ctx.fillRect(p.x + 4, p.y + 3, p.w - 8, 5);
    } else {
      // 竹子橫桿兩根
      for (const dy of [0, 13]) {
        const bg = ctx.createLinearGradient(0, p.y + dy, 0, p.y + dy + 13);
        bg.addColorStop(0, '#c4e27a'); bg.addColorStop(1, dy ? '#4f7a22' : '#6f9a3a');
        ctx.fillStyle = bg; ctx.strokeStyle = '#1f2a0c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(p.x - 6, p.y + dy, p.w + 12, 13, 6); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#4f6e22';
      for (let x = p.x + 30; x < p.x + p.w; x += 60) ctx.fillRect(x, p.y, 3, 26);
      ctx.strokeStyle = '#c9a15a'; ctx.lineWidth = 3;
      for (const px of posts) { ctx.beginPath(); ctx.moveTo(px - 10, p.y + 4); ctx.lineTo(px + 10, p.y + 20); ctx.moveTo(px + 10, p.y + 4); ctx.lineTo(px - 10, p.y + 20); ctx.stroke(); }
    }
  }

  // ───────────────────────── 可破壞物、村貓、掉落物 ─────────────────────────

  /** 可破壞物（terrain.json 的圖；打爛換成 _broken 那張，照各自的實心底線貼地，寨門兩張共用完好版的底線） */
  private drawBreakableArt(ctx: CanvasRenderingContext2D, b: Breakable): boolean {
    const key = b.kind + (b.broken ? '_broken' : '');
    if (!this.a.terrain?.props[key]) return false;
    const sx = b.shake > 0 ? rnd(-3, 3) : 0;
    if (b.flash > 0) ctx.filter = 'brightness(2.2)';
    this.drawTProp(ctx, key, b.x + sx, b.y);
    ctx.filter = 'none';
    if (!b.broken && (b.kind === 'tower' || isGate(b.kind)) && b.hp < b.maxHp) {
      ctx.save(); ctx.translate(b.x, b.y); this.hpBar(ctx, b, -b.h - 24); ctx.restore();
    }
    return true;
  }

  private drawBreakable(ctx: CanvasRenderingContext2D, b: Breakable, now: number): void {
    if (this.drawBreakableArt(ctx, b)) return;
    if (b.broken && b.kind !== 'tower' && !isGate(b.kind)) return;
    const sx = b.shake > 0 ? rnd(-3, 3) : 0;
    ctx.save();
    ctx.translate(b.x + sx, b.y);
    if (b.broken) {
      // 垮下來：往後倒、沉下去、淡掉
      const f = b.fall;
      ctx.globalAlpha = Math.max(0, 1 - f * 0.9);
      if (b.kind === 'tower') ctx.rotate(f * f * 1.35);
      ctx.translate(0, f * f * 60);
    }
    if (b.flash > 0) ctx.filter = 'brightness(2.2)';
    const W = b.w, H = b.h;
    const stroke = '#2b170b';
    switch (b.kind) {
      case 'crate': {
        ctx.fillStyle = '#b07a45'; ctx.strokeStyle = stroke; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.rect(-W / 2, -H, W, H); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a5a2e'; ctx.fillRect(-W / 2 + 4, -H + 4, W - 8, 8); ctx.fillRect(-W / 2 + 4, -12, W - 8, 8);
        ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-W / 2 + 6, -H + 12); ctx.lineTo(W / 2 - 6, -12); ctx.stroke();
        break;
      }
      case 'barrel': case 'powder': {
        const red = b.kind === 'powder';
        ctx.fillStyle = red ? '#b8322a' : '#a0683a'; ctx.strokeStyle = stroke; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(0, -H / 2, W / 2, H / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b1a10'; ctx.fillRect(-W / 2 + 3, -H * 0.8, W - 6, 6); ctx.fillRect(-W / 2 + 3, -H * 0.24, W - 6, 6);
        ctx.fillStyle = red ? '#ffd24a' : '#f4ecd8';
        ctx.beginPath(); ctx.roundRect(-16, -H * 0.66, 32, 28, 4); ctx.fill();
        ctx.fillStyle = red ? '#8a1a14' : '#2b1a10'; ctx.font = `bold 22px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(red ? '火' : '酒', 0, -H * 0.66 + 15);
        if (red) {
          ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -H); ctx.quadraticCurveTo(12, -H - 14, 6, -H - 22); ctx.stroke();
          ctx.fillStyle = Math.sin(now * 30) > 0 ? '#ffcf5a' : '#ff7a2a'; ctx.beginPath(); ctx.arc(6, -H - 24, 5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'cage': {
        ctx.strokeStyle = '#3a4a16'; ctx.lineWidth = 3;
        ctx.fillStyle = '#9bbf5a';
        for (let x = -W / 2; x <= W / 2; x += 18) { ctx.beginPath(); ctx.rect(x - 4, -H, 8, H); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = '#7fa446';
        ctx.beginPath(); ctx.roundRect(-W / 2 - 8, -H - 10, W + 16, 16, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(-W / 2 - 8, -12, W + 16, 14, 6); ctx.fill(); ctx.stroke();
        break;
      }
      case 'stall': {
        ctx.fillStyle = '#8a5a2e'; ctx.strokeStyle = stroke; ctx.lineWidth = 4;
        ctx.fillRect(-W / 2 + 8, -H + 30, 10, H - 30); ctx.fillRect(W / 2 - 18, -H + 30, 10, H - 30);
        ctx.beginPath(); ctx.rect(-W / 2, -64, W, 64); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#f4ecd8' : '#c0453a'; ctx.fillRect(-W / 2 - 10 + i * (W + 20) / 6, -H, (W + 20) / 6, 36); }
        ctx.strokeRect(-W / 2 - 10, -H, W + 20, 36);
        drawOnigiri(ctx, -40, -76, 0.9); drawFish(ctx, 20, -80, 0.9, 0);
        break;
      }
      case 'tower': {
        ctx.strokeStyle = stroke; ctx.lineWidth = 4;
        ctx.fillStyle = '#6e4424';
        for (const x of [-56, 44]) { ctx.beginPath(); ctx.rect(x, -290, 14, 290); ctx.fill(); ctx.stroke(); }
        ctx.strokeStyle = '#5a3419'; ctx.lineWidth = 6;
        for (let y = -270; y < -20; y += 90) { ctx.beginPath(); ctx.moveTo(-50, y); ctx.lineTo(50, y + 90); ctx.moveTo(50, y); ctx.lineTo(-50, y + 90); ctx.stroke(); }
        ctx.fillStyle = '#7a4a26'; ctx.strokeStyle = stroke; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.roundRect(-80, -292, 160, 22, 5); ctx.fill(); ctx.stroke();
        for (const x of [-78, 64]) ctx.fillRect(x, -360, 12, 70);
        ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.moveTo(-96, -350); ctx.lineTo(0, -410); ctx.lineTo(96, -350); ctx.closePath(); ctx.fill(); ctx.stroke();
        this.drawLantern(ctx, 70, -350, now);
        this.hpBar(ctx, b, -H - 70);
        break;
      }
      case 'gate': {
        ctx.fillStyle = '#6e4424'; ctx.strokeStyle = stroke; ctx.lineWidth = 5;
        const f = b.broken ? b.fall : 0;
        for (const s of [-1, 1]) {
          ctx.save(); ctx.translate(s * W / 2, 0); ctx.rotate(s * f * 0.9);
          ctx.beginPath(); ctx.rect(s > 0 ? -W / 2 : 0, -H + 40, W / 2, H - 40); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#3a2410';
          for (let y = -H + 80; y < -10; y += 70) for (let x = 14; x < W / 2 - 6; x += 30) { ctx.beginPath(); ctx.arc(s > 0 ? -x : x, y, 4, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#6e4424';
          ctx.restore();
        }
        ctx.fillStyle = '#4a2c16'; ctx.fillRect(-W / 2 - 24, -H + 20, W + 48, 30); ctx.strokeRect(-W / 2 - 24, -H + 20, W + 48, 30);
        ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.roundRect(-52, -H - 22, 104, 40, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a1a14'; ctx.font = `bold 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('山賊寨', 0, -H - 2);
        this.drawLantern(ctx, -W / 2 - 10, -H + 50, now);
        this.drawLantern(ctx, W / 2 + 10, -H + 50, now + 0.7);
        if (!b.broken) this.hpBar(ctx, b, -H - 40);
        break;
      }
    }
    ctx.filter = 'none';
    ctx.restore();
  }

  private hpBar(ctx: CanvasRenderingContext2D, b: Breakable, y: number): void {
    if (b.broken || b.hp >= b.maxHp) return;
    ctx.fillStyle = '#0008'; ctx.fillRect(-50, y, 100, 9);
    ctx.fillStyle = '#ffb347'; ctx.fillRect(-49, y + 1, 98 * Math.max(0, b.hp / b.maxHp), 7);
  }

  private drawCaptive(ctx: CanvasRenderingContext2D, w: World, c: Captive, now: number): void {
    if (c.state === 'gone' || c.x < w.camX - 200 || c.x > w.camX + VIEW_W + 300) return;
    const happy = c.state !== 'tied';
    const key = `npc_${c.art}_${happy ? 'happy' : 'tied'}`;
    const nf = this.fx(key);   // 第三批美術的六種花色（圖已縮小，照檔案寬高算大小）
    const a = this.art(key);
    const img = nf?.frames[0] ?? a?.img ?? this.a.enemies.get(happy ? 'dozing_tabby_attack' : 'dozing_tabby_idle') ?? null;
    const iw = nf ? nf.w : (img as HTMLImageElement | null)?.naturalWidth ?? 1, ih = nf ? nf.h : (img as HTMLImageElement | null)?.naturalHeight ?? 1;
    const H = 175;
    ctx.save();
    ctx.translate(c.x, c.y);
    let rot = 0;
    if (c.state === 'tied') rot = Math.sin(now * 5 + c.id) * 0.04;
    if (c.state === 'thank') rot = -Math.sin(Math.min(1, c.t / 0.6) * Math.PI) * 0.4;   // 鞠躬（朝左的圖往左彎）
    ctx.rotate(rot);
    if (img) {
      const W = iw * (H / ih);
      ctx.drawImage(img, -W / 2, -H, W, H);
    } else {
      ctx.fillStyle = '#e8c89a'; ctx.beginPath(); ctx.ellipse(0, -70, 40, 70, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // 對話
    const say = c.state === 'tied' ? (Math.floor(now / 2.2 + c.id) % 2 ? '救命喵～！' : '') : c.state === 'thank' ? '謝謝你！' : c.state === 'give' ? '這個給你！' : c.t < 1 ? '好耶～！' : '';
    if (say) this.bubbleAt(ctx, c.x, c.y - H - 20, say);
    // 掏出道具
    if (c.state === 'give') {
      const k = Math.min(1, c.t / 0.5);
      this.drawDropIcon(ctx, c.drop, c.x, c.y - H - 10 - k * 40, 60, now);
      const tw = this.fx('twinkle');   // 掏出道具的小閃光
      if (tw && c.t < 0.6) fxDraw(ctx, tw, 0, c.x + 26, c.y - H - 30 - k * 40, 0.7 + c.t, { alpha: 1 - c.t / 0.6, rot: c.t * 3 });
    }
  }

  private drawPickup(ctx: CanvasRenderingContext2D, k: Pickup, now: number): void {
    const bob = k.onGround ? Math.sin(now * 4 + k.id) * 5 - 8 : 0;
    const y = k.y - 34 + bob;
    const glow = ctx.createRadialGradient(k.x, y, 4, k.x, y, 52);
    glow.addColorStop(0, `rgba(255,240,160,${0.55 + 0.25 * Math.sin(now * 6)})`); glow.addColorStop(1, 'rgba(255,240,160,0)');
    ctx.fillStyle = glow; ctx.fillRect(k.x - 52, y - 52, 104, 104);
    this.drawDropIcon(ctx, k.kind, k.x, y, 70, now);
  }

  private drawDropIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, size: number, now: number): void {
    if (kind === 'fish' && this.drawTProp(ctx, 'fish', x, y, { size: size * 1.1, rot: Math.sin(now * 3) * 0.2 })) return;
    if (kind === 'onigiri' && this.drawTProp(ctx, 'onigiri', x, y, { size: size * 0.85 })) return;
    if (kind === 'H' && this.drawTProp(ctx, 'weapon_H', x, y, { size })) return;
    if (kind === 'fish') { drawFish(ctx, x, y, size / 60, Math.sin(now * 3) * 0.2); return; }
    if (kind === 'onigiri') { drawOnigiri(ctx, x, y, size / 60); return; }
    const key = kind === 'bomb' ? 'weapon_bomb' : kind === 'bigbomb' ? 'weapon_horoku' : kind === 'smoke' ? 'weapon_smoke' : `weapon_${kind}`;
    const a = this.art(key);
    if (a) {
      const s = size / Math.max(a.img.naturalWidth, a.img.naturalHeight);
      ctx.drawImage(a.img, x - a.img.naturalWidth * s / 2, y - a.img.naturalHeight * s / 2, a.img.naturalWidth * s, a.img.naturalHeight * s);
    } else {
      ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#3a1d0e'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, size / 2.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a1d0e'; ctx.font = `bold ${size / 2}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(kind.length === 1 ? kind : kind === 'bomb' ? '符' : kind === 'bigbomb' ? '焙' : '煙', x, y + 2);
    }
  }

  // ───────────────────────── 敵人 ─────────────────────────

  private enemyImg(e: Enemy, pose = e.pose): HTMLImageElement | null {
    const d = ENEMY_DEFS[e.kind], base = d.img + (e.p2 ? '_p2' : '');
    const E = this.a.enemies;
    return E.get(`${base}_${pose}`) ?? (pose === 'down' ? E.get(`${base}_hurt`) : undefined) ?? E.get(`${base}_idle`) ?? E.get(`${d.img}_${pose}`) ?? E.get(`${d.img}_idle`) ?? null;
  }

  private drawEnemyShadow(ctx: CanvasRenderingContext2D, w: World, e: Enemy): void {
    if (e.dying > 0) return;
    const d = ENEMY_DEFS[e.kind];
    const g = e.plat ? e.plat.y : w.terrain.groundAt(e.x);
    if (!Number.isFinite(g)) return;
    // 魔王從天上掉下來、泰山壓頂：影子越來越大（最後 0.45 秒停住閃紅＝快逃）
    if (e.kind === 'orange_king' && (e.state === 'enter' || e.state === 'crushShadow' || e.state === 'crushFall' || e.state === 'belly')) {
      const x = e.state === 'belly' ? e.mem.tx ?? e.x : e.x;
      const k = e.state === 'crushShadow' ? Math.min(1, e.t / 1.15) : e.state === 'enter' ? Math.min(1, e.t / 1.2) : 1;
      const locked = e.state === 'crushShadow' && e.t > 0.7;
      const gy = w.terrain.groundAt(x) + 4, rx = 150 * (0.4 + 0.6 * k), ry = 28 * (0.4 + 0.6 * k);
      ctx.fillStyle = locked && Math.floor(e.t * 14) % 2 ? 'rgba(210,30,30,.7)' : 'rgba(20,5,12,.62)';
      ctx.beginPath(); ctx.ellipse(x, gy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      if (e.state !== 'belly') return;   // 紅色警告圈與箭頭在 drawCrushWarning（畫在球球前面）
    }
    const lift = Math.max(0, Math.min(1, (g - e.y) / 400));
    ctx.fillStyle = `rgba(40,20,10,${0.28 * (1 - lift * 0.6)})`;
    ctx.beginPath(); ctx.ellipse(e.x, g + 3, d.w * 0.55 * (1 - lift * 0.5), 9 * (1 - lift * 0.5), 0, 0, Math.PI * 2); ctx.fill();
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, now: number): void {
    const d = ENEMY_DEFS[e.kind];
    if (e.kind === 'orange_king' && e.part && !e.part.broken && e.dying <= 0 && !(e.animOn && e.state === 'belly')) this.drawKingPack(ctx, e, now);
    if (e.mem.mount && e.dying <= 0) this.drawTProp(ctx, 's3_turret_mount', e.x, e.y - 40);
    if (e.animOn && this.drawEnemyFrame(ctx, e)) { this.drawEnemyExtras(ctx, e, now); return; }
    const img = this.enemyImg(e);
    const H = d.drawH;
    ctx.save();
    let x = e.x, y = e.y, rot = e.lean, sx = 1, sy = 1;
    const moving = e.dying <= 0 && (Math.abs(e.vx) > 30 || ['run', 'walk', 'flee', 'charge', 'start'].includes(e.state)) && e.onGround;
    if (e.dying > 0) {
      rot = e.rot;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, e.dying - 1.3) / 0.9);
      y -= H * 0.5;   // 繞身體中心轉
    } else if (e.kind === 'orange_king' && e.state === 'roll') {
      // 滾：縮成一團轉
      ctx.translate(x, y - 70); ctx.rotate(e.rot);
      const im = this.enemyImg(e, 'block');
      if (im) { const s = 170 / im.naturalHeight; ctx.drawImage(im, -im.naturalWidth * s / 2, -85, im.naturalWidth * s, 170); }
      ctx.restore();
      return;
    } else {
      if (moving) { y -= Math.abs(Math.sin(e.life * 12)) * (d.boss ? 5 : 7); rot += Math.sin(e.life * 12) * 0.06; }
      else if (e.pose === 'idle' && !d.fly) { const b = Math.sin(e.life * 3 + (e.mem.phase ?? 0)) * 0.025; sy = 1 + b; sx = 1 - b * 0.6; }
      if (d.fly) y += Math.sin(e.life * 7) * 4;
      if (e.squash) { sy *= 1 - e.squash; sx *= 1 + e.squash * 0.7; }
      if (e.act === 'sleep' && !e.aware) { sy *= 0.9; rot -= 0.06; }
    }
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx * (e.facing > 0 ? -1 : 1), sy);
    const W = img ? img.naturalWidth * (H / img.naturalHeight) : d.w;
    const oy = e.dying > 0 ? H / 2 : 0;
    if (img) {
      ctx.drawImage(img, -W / 2, -H + oy, W, H);
      // 被打閃白（魔王閃紅）、出招預兆閃紅、中毒偏紫
      // 被打閃一下（淡、一兩格）；出招預兆：紅色邊光＋淡淡的紅疊色閃爍，身體保持原色看得出來（09-26 使用者：整隻塗紅像一團色塊）
      if (e.flash > FLASH_MIN) {
        if (e.boss) { ctx.save(); ctx.filter = HIT_RIM; ctx.drawImage(img, -W / 2, -H + oy, W, H); ctx.restore(); }
        ctx.globalAlpha = e.boss ? BOSS_TINT_A : FLASH_A; ctx.drawImage(tintOf(img, e.boss ? '#ff5a4a' : '#ffffff'), -W / 2, -H + oy, W, H); ctx.globalAlpha = 1;
      }
      else if (e.warn > 0 && Math.floor(e.warn * 12) % 2 === 0) {
        ctx.save(); ctx.filter = WARN_RIM; ctx.drawImage(img, -W / 2, -H + oy, W, H); ctx.restore();
        ctx.globalAlpha = e.boss ? BOSS_TINT_A : WARN_A; ctx.drawImage(tintOf(img, '#ff2a2a'), -W / 2, -H + oy, W, H); ctx.globalAlpha = 1;
      }
      else if (e.poison > 0) { ctx.globalAlpha = 0.25; ctx.drawImage(tintOf(img, '#9b4dff'), -W / 2, -H + oy, W, H); ctx.globalAlpha = 1; }
    } else {
      ctx.fillStyle = '#884'; ctx.fillRect(-d.w / 2, -H + oy, d.w, H);
      ctx.fillStyle = '#fff'; ctx.font = `20px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(d.name, 0, -H / 2 + oy);
    }
    ctx.restore();
    this.drawEnemyExtras(ctx, e, now);
  }

  /**
   * 逐格動作圖（怪物的 Vids 動作片轉出來的）：照基準點（腳底、身體中線）畫在 (x, y)，圖都朝左、朝右時左右翻；
   * 大小＝ENEMY_DEFS 的 drawH（站姿在圖裡是 standHeight 高）。程式另外加的：蓄力傾斜、壓扁、被打閃白（魔王閃紅）、
   * 出招預兆閃紅、中毒偏紫、被炸飛時轉圈、倒地後一閃一閃消失；黑衣忍者整隻黑，加一圈淡紫白邊光才看得清楚。
   */
  private drawEnemyFrame(ctx: CanvasRenderingContext2D, e: Enemy): boolean {
    const d = ENEMY_DEFS[e.kind], m = this.a.monsters.get(d.img), an = e.anim;
    if (!m || !an) return false;
    const fr = an.current(), img = m.lib.images[an.name]?.[an.frame];
    if (!fr || !img) return false;
    const scale = d.drawH / m.standHeight;
    ctx.save();
    let rot = e.lean, sx = 1, sy = 1, y = e.y;
    if (e.dying > 0) {
      if (e.mem.ko) {
        const left = (e.mem.koTime ?? 1.5) + 0.6 - e.dying;
        if (left < 0.6 && Math.floor(left * 14) % 2 === 0) ctx.globalAlpha = 0.25;   // 倒地演完，一閃一閃消失
        rot = 0;
      } else {
        // 被炸飛：繞身體中心轉圈
        rot = e.rot;
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, e.dying - 1.3) / 0.9);
        y -= d.drawH * 0.5;
        ctx.translate(e.x, y); ctx.rotate(rot); ctx.translate(0, d.drawH * 0.5);
        rot = 0;
        this.blitFrame(ctx, e, img, fr, 0, 0, scale);
        ctx.restore();
        return true;
      }
    } else {
      if (d.fly) y += Math.sin(e.life * 7) * 3;
      if (e.squash) { sy = 1 - e.squash; sx = 1 + e.squash * 0.7; }
      if (e.act === 'sleep' && !e.aware) { sy *= 0.92; rot -= 0.05; }
    }
    if (e.mem.clipY !== undefined) { ctx.beginPath(); ctx.rect(e.x - 400, e.mem.clipY - 900, 800, 900); ctx.clip(); }   // 河童：只畫水面以上
    const giant = e.mem.giant ?? 1;
    if (e.kind === 'wraith_samurai' && e.dying <= 0) ctx.globalAlpha *= e.mem.alpha ?? 0.82;
    ctx.translate(e.x, y);
    ctx.rotate(rot);
    ctx.scale(sx * giant, sy * giant);
    this.blitFrame(ctx, e, img, fr, 0, 0, scale);
    ctx.restore();
    return true;
  }

  /** 畫一格（含閃白、預兆閃紅、中毒紫、忍者邊光） */
  private blitFrame(ctx: CanvasRenderingContext2D, e: Enemy, img: CanvasImageSource, fr: FrameDef, x: number, y: number, scale: number): void {
    const flip = (e.facing > 0 ? -1 : 1) as 1 | -1;
    const hitOn = e.flash > FLASH_MIN;
    const warnOn = !hitOn && e.warn > 0 && Math.floor(e.warn * 12) % 2 === 0;
    const dark = DARK_KINDS.has(e.kind);
    if (warnOn) ctx.filter = dark ? `${NINJA_RIM} ${WARN_RIM}` : WARN_RIM;
    else if (hitOn && e.boss) ctx.filter = HIT_RIM;
    else if (dark) ctx.filter = NINJA_RIM;
    drawFrame(ctx, img, fr, x, y, flip, scale);
    ctx.filter = 'none';
    const a0 = ctx.globalAlpha;
    // 逐格圖一格一張，剪影不存起來（玩久了會吃掉幾百 MB），用一張共用的暫存畫布當場染色
    if (hitOn) { ctx.globalAlpha = a0 * (e.boss ? BOSS_TINT_A : FLASH_A); drawFrame(ctx, tintNow(img, e.boss ? '#ff5a4a' : '#ffffff'), fr, x, y, flip, scale); }
    else if (warnOn) { ctx.globalAlpha = a0 * (e.boss ? BOSS_TINT_A : WARN_A); drawFrame(ctx, tintNow(img, '#ff2a2a'), fr, x, y, flip, scale); }
    else if (e.poison > 0) { ctx.globalAlpha = a0 * 0.25; drawFrame(ctx, tintNow(img, '#9b4dff'), fr, x, y, flip, scale); }
    ctx.globalAlpha = a0;
  }

  /** 頭上的東西：預兆「！」、搬箱子、烤魚 */
  private drawEnemyExtras(ctx: CanvasRenderingContext2D, e: Enemy, now: number): void {
    if (e.dying > 0) return;
    const H = ENEMY_DEFS[e.kind].drawH;
    const top = e.y - H - 8;
    if (!e.aware && e.act === 'carry') {
      ctx.save(); ctx.translate(e.x, top + 24 + Math.sin(e.life * 8) * 2);
      ctx.fillStyle = '#b07a45'; ctx.strokeStyle = '#2b170b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(-30, -44, 60, 44); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-26, -40); ctx.lineTo(26, -4); ctx.stroke();
      ctx.restore();
    }
    if (!e.aware && e.act === 'camp') {
      const fx = e.x - e.facing * -40, fy = e.y - H * 0.55;
      ctx.strokeStyle = '#5a3419'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(e.x, e.y - H * 0.4); ctx.lineTo(fx, fy); ctx.stroke();
      drawFish(ctx, fx, fy - 6, 0.7, Math.sin(now * 2) * 0.2);
    }
    if (e.warn > 0) this.drawAlert(ctx, e.x, Math.max(top - 10, HUD_BOTTOM + 44), e.warn);
  }

  /** 橘皮大王第一階段的魚乾背包（背在身後、比肩膀高：往上丟、跳起來丟、爆裂符才打得到） */
  private drawKingPack(ctx: CanvasRenderingContext2D, e: Enemy, now: number): void {
    const b = kingPackBox(e), p = e.part!;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (e.state !== 'roll' && this.a.terrain?.props.king_pack) {
      // 竹簍圖：背帶在左邊（大王朝左時背帶朝向身體）；大王朝右就左右翻；被打閃白、快爛了抖
      if (p.flash > 0) ctx.filter = 'brightness(2)';
      const shakeX = p.hp < p.maxHp * 0.4 ? Math.sin(now * 40) * 2 : 0;
      this.drawTProp(ctx, 'king_pack', cx + shakeX, cy, { size: 175, flip: e.facing > 0 });
      ctx.filter = 'none';
      return;
    }
    ctx.save();
    ctx.translate(cx, cy + (e.state === 'roll' ? 9999 : 0));
    if (p.flash > 0) ctx.filter = 'brightness(2)';
    // 魚尾巴從籃子裡伸出來
    for (let i = 0; i < 4; i++) drawFish(ctx, -50 + i * 34, -62 + Math.sin(now * 3 + i) * 4, 0.9, -1.2 + i * 0.25);
    ctx.fillStyle = '#c58a3e'; ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-78, -50); ctx.lineTo(78, -50); ctx.lineTo(64, 70); ctx.lineTo(-64, 70); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 3;
    for (let y = -30; y < 70; y += 18) { ctx.beginPath(); ctx.moveTo(-74 + (y + 50) * 0.1, y); ctx.lineTo(74 - (y + 50) * 0.1, y); ctx.stroke(); }
    // 背包快爛了：冒煙、裂開
    if (p.hp < p.maxHp * 0.4) { ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-20, -48); ctx.lineTo(4, 0); ctx.lineTo(-10, 30); ctx.stroke(); }
    ctx.filter = 'none';
    ctx.restore();
  }

  /** 橘皮大王從天上砸下來：落點的紅色警告圈＋往下的箭頭（畫在球球前面，一眼看得到） */
  private drawCrushWarning(ctx: CanvasRenderingContext2D, w: World, e: Enemy): void {
    const jumper = (e.kind === 'frog_daimyo' && (e.state === 'jumpWind' || e.state === 'jumpAir')) || (e.kind === 'drum_tanuki' && (e.state === 'hopWind' || e.state === 'hopAir'));
    if (e.dying > 0 || (!jumper && (e.kind !== 'orange_king' || !(e.state === 'enter' || e.state === 'crushShadow' || e.state === 'crushFall')))) return;
    if (jumper && e.mem.tx === undefined) return;
    const x = jumper ? e.mem.tx! : e.x, gy = w.terrain.groundAt(x) + 4;
    if (!Number.isFinite(gy)) return;
    const k = e.state === 'crushShadow' ? Math.min(1, e.t / 1.15) : e.state === 'enter' ? Math.min(1, e.t / 1.2) : 1;
    const rx = 150 * (0.4 + 0.6 * k), ry = 28 * (0.4 + 0.6 * k);
    const pulse = 0.8 + 0.2 * Math.sin(e.t * 20);
    ctx.strokeStyle = `rgba(255,60,40,${pulse})`; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(x, gy, rx + 10, ry + 6, 0, 0, Math.PI * 2); ctx.stroke();
    const ay = gy - 250 - Math.abs(Math.sin(e.t * 8)) * 18;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff4a3a'; ctx.strokeStyle = '#3a0a06'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - 34, ay); ctx.lineTo(x + 34, ay); ctx.lineTo(x, ay + 44); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 預兆：頭上紅黃「！」一跳一跳 */
  private drawAlert(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    const s = 1 + Math.sin(t * 40) * 0.12;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#8a1a14'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(24, 4); ctx.lineTo(-24, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a1a14'; ctx.font = `bold 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('！', 0, -12);
    ctx.restore();
  }

  private drawBubble(ctx: CanvasRenderingContext2D, e: Enemy): void {
    if (!e.bubble || e.dying > 0) return;
    const d = ENEMY_DEFS[e.kind];
    const k = e.bubble.t / e.bubble.life;
    ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
    this.bubbleAt(ctx, e.x, Math.max(e.y - d.drawH - (e.warn > 0 ? 60 : 16), HUD_BOTTOM + (e.warn > 0 ? 80 : 36)), e.bubble.text, e.bubble.text === '！' ? 34 : 22);
    ctx.globalAlpha = 1;
  }

  private bubbleAt(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size = 22): void {
    ctx.font = `bold ${size}px ${FONT}`;
    const tw = ctx.measureText(text).width + 22, th = size + 16;
    ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y - th, tw, th, 12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 8, y - 2); ctx.lineTo(x, y + 10); ctx.lineTo(x + 8, y - 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x, y + 10); ctx.lineTo(x + 8, y); ctx.stroke();
    ctx.fillStyle = text === '！' ? '#c0201a' : '#2b1a10'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - th / 2 + 1);
  }

  // ───────────────────────── 球球 ─────────────────────────

  private drawPlayerShadow(ctx: CanvasRenderingContext2D, w: World): void {
    const b = w.player.body;
    let g = w.terrain.groundAt(b.x);
    for (const p of w.platforms) if (b.x >= p.x && b.x <= p.x + p.w && p.y >= b.y - 1 && p.y < g) g = p.y;
    if (!Number.isFinite(g)) return;
    const lift = Math.min(1, Math.max(0, (g - b.y) / 300));
    ctx.fillStyle = 'rgba(40,20,10,.28)';
    ctx.beginPath(); ctx.ellipse(b.x, g + 2, 42 * (1 - lift * 0.5), 8 * (1 - lift * 0.5), 0, 0, Math.PI * 2); ctx.fill();
  }

  /** 畫球球時要查牆面用的物理世界（render 每格從 game 帶進來的 world） */
  private wallWorld(_p: Player): ReturnType<World['physWorld']> { return this.curWorld!.physWorld(); }
  private curWorld: World | null = null;

  /** 上一次畫的是哪個動作第幾格（檢查腳底、換動作有沒有空白用） */
  lastDraw = { name: '', frame: -1, serial: 0, ok: false };

  private drawPlayer(ctx: CanvasRenderingContext2D, p: Player, cam: number): void {
    const an = p.anim, fr = an.current(), img = this.a.sprites.images[an.name]?.[an.frame];
    this.lastDraw = { name: an.name, frame: an.frame, serial: an.serial, ok: !!(fr && img) };
    if (!fr || !img) return;
    const b = p.body;
    ctx.save();
    if (p.hidden > 0) ctx.globalAlpha = 0.35;
    else if (p.act !== 'dash' && p.act !== 'roll' && p.invincible > 0 && p.invincible < HURT_IFRAMES * 3 && Math.floor(p.invincible * 16) % 2 === 0) ctx.globalAlpha = 0.45;
    if (p.act === 'down' && !this.a.sprites.defs.down) {
      // 沒有倒下動作：把這一格慢慢放倒
      ctx.translate(b.x - cam, b.y); ctx.rotate(-b.facing * p.downT * 1.35); ctx.translate(-(b.x - cam), -b.y);
    }
    // 手感變形（feel.ts）：以腳底為中心拉長／壓扁、前傾、轉身壓窄；關掉時三個值都是 1、1、0
    const fl = p.feel;
    if (fl.scaleX !== 1 || fl.scaleY !== 1 || fl.lean !== 0) {
      ctx.translate(b.x - cam, b.y); ctx.rotate(b.facing * fl.lean); ctx.scale(fl.scaleX, fl.scaleY); ctx.translate(-(b.x - cam), -b.y);
    }
    // 攀爬（2026-10-09 使用者：「球球在攀爬時穿模了」）：攀爬動作是側身、手往前伸抓，身體中心卻對齊梯子／藤蔓中心，
    // 身體前半截塞進旁邊的木牆。畫的時候往背後挪 CLIMB_DX，手剛好抓在梯子上、身體留在外側（物理位置不動）
    let dx = p.act === 'climb' && an.name === 'climb' ? -b.facing * CLIMB_DX : 0;
    // 貼牆下滑（10-09）：判定框半寬 22，動作圖的手掌卻伸到身體前方 80 像素，等於插進牆裡將近 60 像素。
    // 找出牆面實際在哪，把整張往後挪到手掌剛好貼著牆面（物理位置不動）
    const sc = SCALE / (this.a.sprites.shrink ?? 1);
    if (an.name === 'wallslide' && b.sliding && fr.k) {
      const side = (b.wall || b.wallSide || b.facing) as 1 | -1;
      const face = wallFaceX(b, this.wallWorld(p), side);
      if (face !== null) dx = face - (b.x + side * (fr.k[2] - fr.k[4]) * sc) + side * 2;
    }
    drawFrame(ctx, img, fr, b.x - cam + dx, b.y, b.facing, sc);   // 圖已縮成畫面大小（shrink）
    ctx.restore();
  }

  /** 新動作第一次提示：球球頭上一個小按鍵牌（最多 6 個字、1.5 秒，前後淡入淡出） */
  private drawTip(ctx: CanvasRenderingContext2D, w: World): void {
    const tip = w.tip;
    if (!tip) return;
    const b = w.player.body, k = tip.t / TIP_TIME;
    ctx.save();
    ctx.globalAlpha = Math.min(1, tip.t / 0.12, (TIP_TIME - tip.t) / 0.25);
    ctx.font = `900 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(this.tt(tip.text)).width + 28, x = b.x, y = b.y - 232 - Math.sin(Math.min(1, k * 6) * Math.PI / 2) * 6;
    ctx.fillStyle = 'rgba(20,12,8,.78)'; ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 21, tw, 42, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff3c4'; ctx.fillText(this.tt(tip.text), x, y + 1);
    ctx.restore();
  }

  /** 揮爪弧光：揮爪動作走到出手那一格，在球球前面播一次（打沒打中都播） */
  private clawArc(p: Player): void {
    const an = p.anim;
    if (an.name !== 'claw' || an.serial === this.clawSerial || !this.fx('claw_arc')) return;
    if (an.frame < Math.max(0, (an.def?.markers.hit ?? 0) - 1)) return;
    this.clawSerial = an.serial;
    const b = p.body;
    this.oneShots.push({ key: 'claw_arc', x: b.x + b.facing * 60, y: b.y - 110, t: 0, life: 0.15, s: 0.5, flip: b.facing < 0 });
  }

  private drawOneShot(ctx: CanvasRenderingContext2D, o: Renderer['oneShots'][number]): void {
    const f = this.fx(o.key);
    if (!f) return;
    const k = o.t / o.life;
    const i = Math.min(f.frames.length - 1, Math.floor(k * f.frames.length));
    let alpha = 1;
    if (o.key === 'respawn_pillar') alpha = Math.min(1, o.t / 0.15) * Math.min(1, (o.life - o.t) / 0.45) * 0.85;
    else if (o.key === 'twinkle') alpha = 1 - k * k;
    ctx.save();
    if (o.light) ctx.globalCompositeOperation = 'lighter';
    fxDraw(ctx, f, i, o.x, o.y, o.s, { flip: o.flip, rot: o.rot, alpha });
    ctx.restore();
  }

  // ───────────────────────── 忍具、子彈、爆炸、粒子 ─────────────────────────

  /** 畫 art.json 的一張圖：中心在 (x, y)、長邊 size 像素、轉 rot */
  private drawIcon(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, size: number, rot = 0, flip = false): boolean {
    if (key === 'weapon_H' && this.drawTProp(ctx, 'weapon_H', x, y, { size, rot, flip })) return true;   // 新的棒手裏劍圖示（舊的是苦無）
    const a = this.art(key);
    if (!a) return false;
    const img = a.img, nw = img.naturalWidth, nh = img.naturalHeight, s = size / Math.max(nw, nh);
    const [cx, cy] = a.meta.center ?? [nw / 2, nh / 2];
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -cx * s, -cy * s, nw * s, nh * s);   // 給目的寬高（手機載入時圖縮過，不能用圖本身的大小）
    ctx.restore();
    return true;
  }

  /** 可拉長的特效（火焰、鎖鏈）：左端接在 (x, y)，往 ang 方向拉到 len 長，高 h */
  private drawStretch(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, ang: number, len: number, h: number): boolean {
    const a = this.art(key);
    if (!a || len < 2) return !!a;
    const img = a.img, iw = img.naturalWidth, ih = img.naturalHeight, sc = h / ih;
    const [s0, s1] = a.meta.stretchX ?? [iw * 0.15, iw * 0.85];
    const head = s0 * sc, tail = (iw - s1) * sc;
    const r = (img as unknown as { width: number }).width / iw;   // 手機載入時圖縮過：取圖的座標照比例換
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    if (len <= head + tail) ctx.drawImage(img, 0, -h / 2, len, h);
    else {
      ctx.drawImage(img, 0, 0, s0 * r, ih * r, 0, -h / 2, head, h);
      ctx.drawImage(img, s0 * r, 0, (s1 - s0) * r, ih * r, head, -h / 2, len - head - tail + 1, h);
      ctx.drawImage(img, s1 * r, 0, (iw - s1) * r, ih * r, len - tail, -h / 2, tail, h);
    }
    ctx.restore();
    return true;
  }

  private drawShot(ctx: CanvasRenderingContext2D, s: Shot, now: number): void {
    const ang = s.aim === 'up' ? -Math.PI / 2 : s.aim === 'down' ? Math.PI / 2 : s.aim === 'diag' ? (s.facing > 0 ? -Math.PI / 4 : -Math.PI * 3 / 4) : s.facing > 0 ? 0 : Math.PI;
    switch (s.kind) {
      case 'shuriken':
        if (!this.drawIcon(ctx, 'shuriken', s.x, s.y, 42, s.rot)) {
          const img = this.a.fallback.shuriken;
          if (img) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.scale(0.36, 0.36); ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore(); }
        }
        break;
      case 'bo': this.drawIcon(ctx, 'bo_shuriken', s.x, s.y, 62, s.rot) || this.drawIcon(ctx, 'kunai', s.x, s.y, 56, s.rot); break;
      case 'fuma': this.drawIcon(ctx, 'fuma_shuriken', s.x, s.y, 118, s.rot); break;
      case 'dart': this.drawIcon(ctx, 'blow_dart', s.x, s.y, 56, s.rot); break;
      case 'crane': this.drawIcon(ctx, 'paper_crane', s.x, s.y + Math.sin(now * 20) * 2, 52, s.rot, Math.cos(s.rot) < 0 ? false : false); break;
      case 'caltrop': this.drawIcon(ctx, 'caltrop', s.x, s.y, s.phase === 1 ? 30 : 30, s.rot); break;
      case 'mouse': {
        const key = Math.floor(now * 14) % 2 ? 'mouse_fire_1' : 'mouse_fire_2';
        this.drawIcon(ctx, key, s.x, s.y - 22, 58, 0, s.facing < 0);
        break;
      }
      case 'yarn': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.fillStyle = '#f59ac0'; ctx.strokeStyle = '#7a2a4a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#c85a86'; ctx.lineWidth = 2;
        for (const a of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, a, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'flame': {
        const flick = 1 + Math.sin(now * 50) * 0.08;
        if (!this.drawStretch(ctx, 'bamboo_flame', s.x, s.y, ang, s.phase, 78 * flick)) {
          const g = ctx.createLinearGradient(s.x, s.y, s.x + Math.cos(ang) * s.phase, s.y + Math.sin(ang) * s.phase);
          g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#ff9a2a'); g.addColorStop(1, 'rgba(255,60,20,0)');
          ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(ang); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(s.phase / 2, 0, s.phase / 2, 34, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        this.drawIcon(ctx, 'bamboo_tube', s.x - Math.cos(ang) * 10, s.y - Math.sin(ang) * 10, 64, ang);
        break;
      }
      case 'chain': {
        if (!this.drawStretch(ctx, 'kusarigama_chain', s.x, s.y, ang, s.phase, 22)) {
          ctx.strokeStyle = '#8a8a9a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(ang) * s.phase, s.y + Math.sin(ang) * s.phase); ctx.stroke();
        }
        this.drawIcon(ctx, 'kusarigama_sickle', s.x + Math.cos(ang) * s.phase, s.y + Math.sin(ang) * s.phase, 70, ang + Math.sin(now * 30) * 0.2);
        break;
      }
    }
  }

  /**
   * 子彈圖照判定框放大縮小（2026-10-10）：近身招改成丟東西後，同一種子彈有大有小（鐵爪的火焰刃 90 寬、鼠兵的小魚骨 26 寬），
   * 圖是照原本的大小畫的；不縮放的話判定框比畫面上的東西大，會被看不到的地方打到。
   * 震波、泡泡、鼓爆、風本來就照 b.w／b.h 畫，不用管。蛙大名的黏液（打中會變慢）染成綠色
   */
  private drawBullet(ctx: CanvasRenderingContext2D, b: Bullet, now: number): void {
    const base = BULLET_BASE_W[b.kind];
    const k = base ? b.w / base : 1;
    if (Math.abs(k - 1) < 0.05 && !b.slow) { this.drawBullet0(ctx, b, now); return; }
    ctx.save();
    if (b.slow) ctx.filter = 'hue-rotate(-95deg) saturate(1.6)';
    ctx.translate(b.x, b.y); ctx.scale(k, k); ctx.translate(-b.x, -b.y);
    this.drawBullet0(ctx, b, now);
    ctx.restore();
  }

  private drawBullet0(ctx: CanvasRenderingContext2D, b: Bullet, now: number): void {
    // 敵人子彈一律加紅色光暈，看得清楚
    const halo = (r: number): void => {
      const g = ctx.createRadialGradient(b.x, b.y - (b.ground ? b.h / 2 : 0), 2, b.x, b.y - (b.ground ? b.h / 2 : 0), r);
      if (this.cyanHalo) { g.addColorStop(0, 'rgba(150,240,255,.75)'); g.addColorStop(0.55, 'rgba(120,220,255,.35)'); g.addColorStop(1, 'rgba(120,220,255,0)'); }
      else { g.addColorStop(0, 'rgba(255,60,40,.55)'); g.addColorStop(1, 'rgba(255,60,40,0)'); }
      ctx.fillStyle = g; ctx.fillRect(b.x - r, b.y - r - (b.ground ? b.h / 2 : 0), r * 2, r * 2);
    };
    if (this.bulletFx(ctx, b, halo)) return;   // 第三批美術有這種子彈的圖就用圖
    switch (b.kind) {
      case 'kunai':
        halo(34);
        if (!this.drawIcon(ctx, 'kunai', b.x, b.y, 64, b.rot)) { ctx.fillStyle = '#333'; ctx.fillRect(b.x - 20, b.y - 4, 40, 8); }
        break;
      case 'bone': halo(38); if (!this.drawTProp(ctx, 'fish_bone', b.x, b.y, { size: 70, rot: b.rot })) drawBone(ctx, b.x, b.y, b.rot); break;
      case 'wave': {
        halo(46);
        const f = 1 + Math.sin(now * 40) * 0.1;
        ctx.save(); ctx.translate(b.x, b.y);
        const g = ctx.createLinearGradient(0, -b.h, 0, 0);
        g.addColorStop(0, 'rgba(255,240,180,.95)'); g.addColorStop(1, 'rgba(255,140,40,.9)');
        ctx.fillStyle = g; ctx.strokeStyle = '#7a3a10'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(0, 0, b.w * 0.55, b.h * f, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
        for (const k of [0.4, 0.7]) { ctx.beginPath(); ctx.ellipse(0, 0, b.w * 0.55 * k, b.h * f * k, 0, Math.PI, 0); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'blast': {
        const k = b.age / b.life;
        ctx.strokeStyle = `rgba(255,${160 - k * 100},40,${1 - k})`; ctx.lineWidth = 18 * (1 - k) + 4;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, b.w * (0.3 + k * 0.5), b.h * (0.3 + k * 0.5), 0, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'fireball': {
        halo(36);
        if (this.cyanHalo) { ctx.strokeStyle = 'rgba(235,252,255,.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, 24, 0, Math.PI * 2); ctx.stroke(); }
        if (!this.drawIcon(ctx, 'enemy_fireball', b.x, b.y, 64, b.rot + Math.PI, false)) {
          const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, 20);
          g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#ff8a2a'); g.addColorStop(1, 'rgba(255,60,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, 20, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'water': halo(34); if (!this.drawIcon(ctx, 'enemy_water', b.x, b.y, 64, b.rot + Math.PI)) { ctx.fillStyle = '#9fd8ff'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 24, 12, b.rot, 0, Math.PI * 2); ctx.fill(); } break;
      case 'leaf': halo(30); if (!this.drawIcon(ctx, 'enemy_leaf', b.x, b.y, 46, b.rot)) { ctx.fillStyle = '#6f9a3a'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 16, 7, b.rot, 0, Math.PI * 2); ctx.fill(); } break;
      case 'fan': {
        // 扇子（程式畫：紅扇面金骨）
        halo(34);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = '#c0302a'; ctx.strokeStyle = '#2a0a06'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.arc(0, 8, 30, Math.PI * 1.15, Math.PI * 1.85); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5;
        for (let k = 0; k < 6; k++) { const a = Math.PI * (1.15 + k * 0.14); ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(Math.cos(a) * 28, 8 + Math.sin(a) * 28); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'foxfire': {
        const r = 18 + Math.sin(b.age * 18 + b.id) * 3;
        const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, r * 2);
        g.addColorStop(0, 'rgba(230,250,255,1)'); g.addColorStop(0.35, 'rgba(90,190,255,.95)'); g.addColorStop(1, 'rgba(40,120,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(160,230,255,.9)';
        ctx.beginPath(); ctx.moveTo(b.x - 10, b.y + 6); ctx.quadraticCurveTo(b.x, b.y - 30 - Math.sin(b.age * 12) * 6, b.x + 10, b.y + 6); ctx.fill();
        break;
      }
      case 'pellet': {
        // 光彈（甲蟲砲台、吸塵機器吐回來的）：橘色發光的小球
        halo(30);
        const r = 11 + Math.sin(b.age * 30) * 1.5;
        const g2 = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, r * 1.8);
        g2.addColorStop(0, '#fffbe0'); g2.addColorStop(0.45, '#ffb347'); g2.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(b.x, b.y, r * 1.8, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'garbage': {
        // 垃圾彈：一團灰灰的垃圾（空罐、紙屑）在空中翻
        halo(36);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = '#6a6460'; ctx.strokeStyle = '#1e1a18'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(-8, -20); ctx.lineTo(14, -16); ctx.lineTo(22, 4); ctx.lineTo(8, 18); ctx.lineTo(-16, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c8b27a'; ctx.fillRect(-10, -8, 12, 16); ctx.strokeRect(-10, -8, 12, 16);
        ctx.fillStyle = '#e8e2d8'; ctx.beginPath(); ctx.arc(10, 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'missile': {
        // 飛彈：往上飛的時候尾巴朝下、掉下來的時候頭朝下，尾巴一道火
        if (b.vy > 0) halo(40);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx) - Math.PI / 2);
        const fl = 14 + Math.sin(now * 60) * 5;
        ctx.fillStyle = '#ffcf5a'; ctx.beginPath(); ctx.moveTo(-6, -22); ctx.lineTo(0, -22 - fl); ctx.lineTo(6, -22); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a2a1a'; ctx.strokeStyle = '#1a0a06'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-9, -22); ctx.lineTo(9, -22); ctx.lineTo(9, 14); ctx.lineTo(0, 28); ctx.lineTo(-9, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#d8d0c0'; ctx.fillRect(-9, -4, 18, 6);
        ctx.fillStyle = '#4a4440'; ctx.beginPath(); ctx.moveTo(-9, -22); ctx.lineTo(-16, -30); ctx.lineTo(-9, -12); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(9, -22); ctx.lineTo(16, -30); ctx.lineTo(9, -12); ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'splash': ctx.fillStyle = 'rgba(200,235,255,.9)'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 8, 12, Math.atan2(b.vy, b.vx) + Math.PI / 2, 0, Math.PI * 2); ctx.fill(); break;
      case 'bubble': {
        halo(40);
        ctx.fillStyle = 'rgba(200,235,255,.28)'; ctx.strokeStyle = 'rgba(230,248,255,.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(b.x - 10, b.y - 12, 8, 5, -0.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'gust': {
        // 風：一條條白色的風線往前刷（不傷人）
        const k = b.age / b.life, dir = Math.sign(b.vx) || 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - k) * 2) * 0.75;
        ctx.strokeStyle = '#f4fbff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const yy = b.y - b.h / 2 + (i + 0.5) * b.h / 9;
          const xx = b.x - dir * b.w / 2 + dir * (((b.age * 900 + i * 137) % b.w));
          ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + dir * 40, yy - 10, xx + dir * 90, yy); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      default: break;
    }
  }

  /**
   * 子彈用第三批美術（fx2.json bullets）：照速度方向轉、圖朝左的往右飛就翻過來（不會上下顛倒）。
   * 回傳 false＝這種沒有圖，照舊程式畫。
   */
  private bulletFx(ctx: CanvasRenderingContext2D, b: Bullet, halo: (r: number) => void): boolean {
    const t = b.age;
    const dir = (key: string, s: number, i?: number): boolean => {
      const f = this.fx(key);
      if (!f) return false;
      const right = b.vx >= 0, ang = Math.atan2(b.vy, b.vx);
      const flip = right !== (f.facing !== 'left');
      fxDraw(ctx, f, i ?? loopFrame(f, t), b.x, b.y, s, { flip, rot: right ? ang : ang - Math.PI });
      return true;
    };
    const spin = (key: string, s: number, rot: number, i = 0): boolean => {
      const f = this.fx(key);
      if (!f) return false;
      fxDraw(ctx, f, i, b.x, b.y, s, { rot });
      return true;
    };
    switch (b.kind) {
      case 'fireball': {
        const key = this.cyanHalo ? 'fireball_cyan' : 'fireball';
        if (!this.fx(key)) return false;
        halo(36); return dir(key, 0.5);
      }
      case 'water': if (!this.fx('water')) return false; halo(34); return dir('water', 0.5);
      case 'wave': {
        const f = this.fx('wave');
        if (!f) return false;
        halo(46);
        fxDraw(ctx, f, loopFrame(f, t), b.x, b.y + 2, (b.h * 1.05) / f.h, { flip: b.vx < 0 });   // 圖高對到判定高
        return true;
      }
      case 'splash': {
        const f = this.fx('splash');
        if (!f) return false;
        fxDraw(ctx, f, Math.floor(t * 10) % f.frames.length, b.x, b.y + 14, 0.42);
        return true;
      }
      case 'fan': if (!this.fx('fan')) return false; halo(34); return spin('fan', 0.5, b.rot);
      case 'pellet': {
        const key = Math.floor(t * 12) % 2 ? 'pellet_2' : 'pellet_1';
        if (!this.fx(key)) return false;
        halo(30); return spin(key, 0.55, 0);
      }
      case 'bubble': {
        const key = Math.floor(t * 4) % 2 ? 'bubble_2' : 'bubble_1', f = this.fx(key);
        if (!f) return false;
        halo(40); return spin(key, (b.w * 1.1) / 125, 0);
      }
      case 'foxfire': {
        const f = this.fx('foxfire');
        if (!f) return false;
        fxDraw(ctx, f, loopFrame(f, t + b.id * 0.13), b.x, b.y, 0.55);
        return true;
      }
      case 'garbage': {
        const key = ['garbage_can', 'garbage_bone', 'garbage_paper'][b.id % 3]!;
        if (!this.fx(key)) return false;
        halo(36); return spin(key, 0.55, b.rot);
      }
      case 'gust': {
        const f = this.fx('gust');
        if (!f) return false;
        const k = b.age / b.life, d = Math.sign(b.vx) || 1;
        const img = f.frames[loopFrame(f, t)]!;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - k) * 2) * Math.min(1, t * 6) * 0.8;
        ctx.translate(b.x, b.y);
        if (d < 0) ctx.scale(-1, 1);
        ctx.drawImage(img, -b.w / 2 - 20, -b.h / 2 - 10, b.w + 40, b.h + 20);
        ctx.restore();
        return true;
      }
      case 'missile': {
        const m = this.fx('missile'), fl = this.fx('missile_flame');
        if (!m) return false;
        if (b.vy > 0) halo(40);
        const s = 0.55, ang = Math.atan2(b.vy, b.vx);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang);
        if (fl) fxDraw(ctx, fl, loopFrame(fl, t), (Number(m.meta.tailX ?? 2) - m.ax) * s + 3, 0, s);
        fxDraw(ctx, m, 0, 0, 0, s);
        ctx.restore();
        return true;
      }
      default: return false;
    }
  }

  private drawExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, boss = false): void {
    // 第三批美術：小（r < 110）、中、大（只有魔王倒下用）三組 8 格；畫布寬 ≈ r × 3.2，最後 25% 淡出
    const f = this.fx(boss ? 'explosion_large' : r >= 110 ? 'explosion_medium' : 'explosion_small');
    if (f) {
      fxDraw(ctx, f, Math.min(7, Math.floor(k * 8)), x, y, (r * 3.2) / f.w, { alpha: k > 0.75 ? (1 - k) / 0.25 : 1 });
      return;
    }
    const i = Math.min(3, Math.floor(k * 4));
    const a = this.art(`explosion_${i + 1}`);
    const size = r * (1.2 + k * 1.3);
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    if (a) this.drawIcon(ctx, `explosion_${i + 1}`, x, y, size * 2);
    else {
      ctx.fillStyle = i < 2 ? '#fff3a0' : '#ff8a2a'; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 粒子用第三批美術（fx2.json particles）；回傳 false＝這種沒有圖，照舊程式畫 */
  private particleFx(ctx: CanvasRenderingContext2D, p: Particle, k: number): boolean {
    const one = (key: string, width: number, o: { rot?: number; flip?: boolean; alpha?: number; i?: number; y?: number } = {}): boolean => {
      const f = this.fx(key);
      if (!f) return false;
      fxDraw(ctx, f, o.i ?? 0, p.x, o.y ?? p.y, width / f.w, { rot: o.rot, flip: o.flip, alpha: o.alpha });
      return true;
    };
    const four = (n: number): number => Math.min(n - 1, Math.floor(k * n));
    const c = p.color.toLowerCase();
    switch (p.kind) {
      case 'hit': return !!p.sprite && one(p.sprite, p.r * 2, { rot: p.rot, flip: p.flip, alpha: 1 - k * k });
      case 'puff':
        if (c === '#c9a77a') return one('dust', p.r * 7, { i: four(4), y: p.y + p.r, alpha: 0.85 });   // 落地揚塵
        return one('smoke_white', p.r * (1 + k) * 2.8, { i: four(4), alpha: 0.8 });
      case 'spark': return one('spark', p.r * 5.5 * (1 - k * 0.4), { rot: p.rot });
      case 'ember': return one('ember', p.r * 4.2, { rot: p.rot });
      case 'smoke': {
        if (c === '#8a5ac8') return false;   // 紫煙（煙玉、狸大人）照舊
        const dark = c === '#3a3040' || c === '#4a4048';
        return one(dark ? 'smoke_black' : 'smoke_white', p.r * 2 * 1.8, { i: four(4), alpha: Math.min(1, p.age * 10) * 0.85 });
      }
      case 'fire': {
        const f = this.fx('fire');
        if (!f) return false;
        fxDraw(ctx, f, loopFrame(f, p.age + p.rot), p.x, p.y + p.r * 0.7, (p.r * 4) / f.h);   // 火焰高 ≈ 半徑 4 倍，底部貼在粒子下緣
        return true;
      }
      case 'drop': {
        const key = c === '#b06cff' ? 'drop_poison' : c === '#ffd23a' ? 'coin' : /^#(e8f4ff|8fd3ff|bfe6ff|dff4ff)$/.test(c) ? 'drop_water' : '';
        if (!key) return false;
        return one(key, p.r * (key === 'coin' ? 3 : 2.5), { rot: key === 'coin' ? p.rot : 0 });
      }
      case 'star': return one('star', p.r * 2.6, { rot: p.rot });
      default: return false;
    }
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
    const k = p.age / p.life;
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    if (this.particleFx(ctx, p, k)) { ctx.globalAlpha = 1; return; }
    switch (p.kind) {
      case 'puff': ctx.globalAlpha *= 0.8; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2); ctx.fill(); break;
      case 'spark': ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill(); break;
      case 'ember': ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); break;
      case 'debris':
        if (p.sprite && this.drawTProp(ctx, p.sprite, p.x, p.y, { size: p.r * 3.2, rot: p.rot })) break;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.strokeStyle = '#2b170b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7); ctx.fill(); ctx.stroke(); ctx.restore();
        break;
      case 'smoke': {
        const img = this.art('smoke')?.img;
        ctx.globalAlpha = 0.7 * (1 - k);
        const r = p.r * (1 + k * 0.8);
        if (img) ctx.drawImage(img, p.x - r, p.y - r * 0.85, r * 2, r * 1.7);
        else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'fire': {
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
        g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#ff8a2a'); g.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'drop': ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.7, p.r, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'star': ctx.fillStyle = p.color; star(ctx, p.x, p.y, 4, p.r, p.r * 0.4); ctx.fill(); break;
      case 'fish': drawFish(ctx, p.x, p.y, 0.6, p.rot); break;
    }
    ctx.globalAlpha = 1;
  }

  private drawPop(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, age: number, color: string, size: number): void {
    const k = age / 0.9;
    ctx.globalAlpha = 1 - k * k;
    ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 5; ctx.strokeStyle = '#3a1d0e'; ctx.fillStyle = color;
    const yy = y - 50 * Math.sqrt(k);
    const s = age < 0.08 ? 1.4 - age * 5 : 1;
    ctx.save(); ctx.translate(x, yy); ctx.scale(s, s);
    ctx.strokeText(text, 0, 0); ctx.fillText(text, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawBoxes(ctx: CanvasRenderingContext2D, w: World): void {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f0'; const pb = w.player.box(); ctx.strokeRect(pb.x0, pb.y0, pb.x1 - pb.x0, pb.y1 - pb.y0);
    for (const e of w.enemies) {
      const b = enemyBox(e); ctx.strokeStyle = e.bodyHarm ? '#f00' : '#ff0'; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      if (e.harm) { ctx.strokeStyle = '#f0f'; ctx.strokeRect(e.harm.x0, e.harm.y0, e.harm.x1 - e.harm.x0, e.harm.y1 - e.harm.y0); }
    }
    for (const b of w.bullets) { const x = w.bulletBox(b); ctx.strokeStyle = '#f80'; ctx.strokeRect(x.x0, x.y0, x.x1 - x.x0, x.y1 - x.y0); }
  }

  // ───────────────────────── 畫面資訊 ─────────────────────────

  /** drawHud 這一格用的畫布（hudInner 畫木牌用） */
  private hudCtx: CanvasRenderingContext2D | null = null;

  private drawHud(ctx: CanvasRenderingContext2D, w: World, now: number): void {
    this.hudCtx = ctx;
    const p = w.player, a = p.arsenal;
    const cam = w.camX;
    const under = w.enemies.some((e) => e.dying <= 0 && w.onScreen(e.x, 80) && e.y - ENEMY_DEFS[e.kind].drawH - (e.warn > 0 ? 60 : 0) < HUD_BOTTOM + 6)
      || w.bullets.some((b) => b.y < HUD_BOTTOM + 30 && b.x > cam && b.x < cam + VIEW_W);
    this.hudA += ((under ? 0.4 : 1) - this.hudA) * Math.min(1, this.frameDt * 10);
    ctx.save();
    ctx.globalAlpha = this.hudA;
    // 2026-10-09 使用者：「左上狀態列一堆字超出框」。木牌圖（第三批美術）四邊有厚木框和鐵角，能寫字的只有中間那塊深色內板
    // （量圖：hud_score／hud_weapon 寬 8.6%～89.8%、高 23.4%～73.4%）。原本的字照舊的程式畫框排，整排壓在木框上。
    // 改成照內板排：每塊牌子算出內板，字都放在裡面，太長就縮字（fitFont），左右再各讓開鐵角。牌子外框大小、位置沒變（HUD_BOTTOM 不動）。
    const SAFE = 18;   // 內板左右再讓開鐵角的寬度
    // 左上：血、命、分數（兩排）
    const sp = this.hudInner('hud_score', 14, 12, 330, 98);
    const r1 = sp.y0 + 11, r2 = sp.y1 - 13;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fitFont(ctx, '球球', 17, 60); ctx.fillStyle = '#ffe9c4'; ctx.fillText('球球', sp.x0 + SAFE, r1);
    const lives = `命 ×${Math.max(0, w.lives)}`;
    // 血量條（2026-10-10 取代三個貓掌）：剛被扣掉的那段先留白、0.35 秒後再慢慢縮掉，看得出這一下扣多少
    const hp = Math.max(0, p.hp), frac = hp / MAX_HP;
    if (hp >= this.hpTrail) { this.hpTrail = hp; this.hpTrailWait = 0.35; }
    else if ((this.hpTrailWait -= this.frameDt) <= 0) this.hpTrail = Math.max(hp, this.hpTrail - MAX_HP * 0.9 * this.frameDt);
    const bx0 = sp.x0 + SAFE + 50, bx1 = sp.x1 - SAFE - 74, bh = 14, by = r1 - bh / 2, bw = bx1 - bx0;
    ctx.fillStyle = '#2a140a'; ctx.fillRect(bx0 - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#4a2a1a'; ctx.fillRect(bx0, by, bw, bh);
    ctx.fillStyle = '#fff6e8'; ctx.fillRect(bx0, by, bw * Math.min(1, this.hpTrail / MAX_HP), bh);
    ctx.fillStyle = frac > 0.5 ? '#7bd86a' : frac > 0.25 ? '#ffc94a' : (Math.sin(performance.now() / 90) > 0 ? '#ff5a4a' : '#d83a2e');
    ctx.fillRect(bx0, by, bw * frac, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(bx0, by, bw * frac, 4);
    ctx.textAlign = 'center'; fitFont(ctx, '100', 13, 40); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2a140a'; ctx.lineWidth = 3;
    ctx.strokeText(String(Math.ceil(hp)), bx0 + bw / 2, r1 + 1); ctx.fillText(String(Math.ceil(hp)), bx0 + bw / 2, r1 + 1);
    ctx.textAlign = 'right'; fitFont(ctx, lives, 17, 70); ctx.fillStyle = '#ffe9c4'; ctx.fillText(lives, sp.x1 - SAFE, r1);
    ctx.textAlign = 'left';
    const sc = String(w.score).padStart(8, '0');
    fitFont(ctx, sc, 25, sp.x1 - sp.x0 - SAFE * 2); ctx.fillStyle = '#fff3a0'; ctx.strokeStyle = '#3a1d0e'; ctx.lineWidth = 4;
    ctx.strokeText(sc, sp.x0 + SAFE, r2); ctx.fillText(sc, sp.x0 + SAFE, r2);
    // 忍具：左半 K 特殊攻擊（撿到的忍具＋彈數；沒有就淡淡的空格），右半 L 大招（圖示＋名字＋個數）。J 永遠是手裏劍，不佔格子
    const wp = this.hudInner('hud_weapon', 354, 12, 330, 98);
    const wr1 = wp.y0 + 11, wr2 = wp.y1 - 13, mid = (wp.y0 + wp.y1) / 2, half = (wp.x0 + wp.x1) / 2;
    const kKey = this.touch ? '特' : 'K', lKey = this.touch ? '大' : 'L';
    const tx = wp.x0 + SAFE + 46;
    // 按鍵字母畫成圖示左上角的小圓章（名字才有地方放大；10-10 截圖：「K 風魔大手裏劍」被縮到看不清）
    if (a.hasSpecial) {
      const wd = WEAPONS[a.weapon], nm = HUD_SHORT[a.weapon] ?? wd.name.replace('！', ''), ammo = String(a.ammo);
      this.drawIcon(ctx, wd.icon, wp.x0 + SAFE + 20, mid, 42);
      fitFont(ctx, nm, 17, half - tx - 4); ctx.fillStyle = '#ffe9c4'; ctx.fillText(nm, tx, wr1);
      fitFont(ctx, ammo, 23, half - tx - 6); ctx.fillStyle = a.ammo < 10 ? '#ff8a6a' : '#fff3a0'; ctx.fillText(ammo, tx, wr2);
    } else {
      ctx.save(); ctx.globalAlpha *= 0.35; this.drawIcon(ctx, 'weapon_R', wp.x0 + SAFE + 20, mid, 40); ctx.restore();
      fitFont(ctx, '特殊忍具', 16, half - tx - 4); ctx.fillStyle = '#c8b49a'; ctx.fillText('特殊忍具', tx, wr1);
      fitFont(ctx, '救村貓拿', 15, half - tx - 6); ctx.fillStyle = '#a8957c'; ctx.fillText('救村貓拿', tx, wr2);
    }
    keyBadge(ctx, wp.x0 + SAFE + 2, mid - 17, kKey, a.hasSpecial);
    const sd = SUBS[a.sub];
    this.drawIcon(ctx, a.sub === 'bomb' ? 'bomb_tag' : a.sub === 'bigbomb' ? 'horoku' : 'smoke_ball', half + 16, mid, 36);
    keyBadge(ctx, half + 2, mid - 15, lKey, a.subs[a.sub] > 0);
    const sx = half + 38, subName = sd.name.replace('！', ''), subN = `×${a.subs[a.sub]}`;
    fitFont(ctx, subName, 16, wp.x1 - SAFE - sx); ctx.fillStyle = '#ffe9c4'; ctx.fillText(subName, sx, wr1);
    fitFont(ctx, subN, 23, wp.x1 - SAFE - sx); ctx.fillStyle = '#fff3a0'; ctx.fillText(subN, sx, wr2);
    const others = SUB_ORDER.filter((s) => s !== a.sub && a.subs[s] > 0);
    if (others.length) {
      // 還有別種副武器：框下面一條小字「Q 換：焙烙玉×3」
      ctx.font = `bold 15px ${FONT}`; ctx.fillStyle = '#9ff0ff'; ctx.lineWidth = 4; ctx.strokeStyle = '#1a1020';
      const t = `${this.touch ? '「換」：' : 'Q 換：'}${others.map((s) => `${SUBS[s].name.replace('！', '')}×${a.subs[s]}`).join('　')}`;
      ctx.strokeText(t, 560, 122); ctx.fillText(t, 560, 122);
    }
    // 中上：時間（內板只有 28 像素高，排成一排：「時間」小字＋秒數）
    const tp = this.hudInner('hud_time', VIEW_W / 2 + 60, 12, 150, 60), tm = (tp.y0 + tp.y1) / 2;
    ctx.textAlign = 'left'; fitFont(ctx, '時間', 15, 34); ctx.fillStyle = '#ffe9c4'; ctx.fillText('時間', tp.x0 + 8, tm);
    const secs = String(Math.ceil(w.timeLeft));
    ctx.textAlign = 'right'; fitFont(ctx, secs, 24, tp.x1 - tp.x0 - 52); ctx.fillStyle = w.timeLeft < 60 ? '#ff8a6a' : '#fff3a0'; ctx.fillText(secs, tp.x1 - 8, tm);
    // 右上：救了幾隻村貓
    const cp = this.hudInner('hud_cats', VIEW_W - 214, 12, 200, 60);
    const cats = `村貓 ${w.rescued} / ${w.captives.length}`;
    ctx.textAlign = 'center'; fitFont(ctx, cats, 21, cp.x1 - cp.x0 - SAFE); ctx.fillStyle = '#ffe9c4'; ctx.fillText(cats, (cp.x0 + cp.x1) / 2, (cp.y0 + cp.y1) / 2);
    if (w.god) { ctx.font = `bold 16px ${FONT}`; ctx.fillStyle = '#ff9ad5'; ctx.fillText('無敵（開發用）', VIEW_W - 114, 86); }
    ctx.restore();
    // 魔王血條
    const boss = w.boss;
    if (boss && boss.state !== 'start' && !boss.dead) {
      const d = ENEMY_DEFS[boss.kind];
      const partOn = !!boss.part && !boss.part.broken;
      const hp = partOn ? boss.part!.hp / boss.part!.maxHp : Math.max(0, boss.hp / boss.maxHp);
      const bw = 620, bx = VIEW_W / 2 - bw / 2, by = VIEW_H - 54;
      const woodBar = this.fx('hud_bar');
      // 牌子加高到 88、往下挪（內板約 by-19～by+24）：名字一排在上、血條 by～by+18 在下，都在內板裡（原本 70 高，名字壓在上緣木框）
      const bp = this.hudInner('hud_boss', bx - 16, by - 40, bw + 32, 88);
      const bossName = `${d.name}${partOn ? '（魚乾背包）' : boss.p2 ? '（發怒）' : ''}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; fitFont(ctx, bossName, 18, bw - 20); ctx.fillStyle = '#ffe9c4';
      ctx.fillText(bossName, bx, bp.y0 + 10);
      if (woodBar) fxDraw(ctx, woodBar, 0, bx - 10, by - 4, 0.5);   // 血條的木槽
      else { ctx.fillStyle = '#2a1016'; ctx.fillRect(bx, by, bw, 18); }
      ctx.fillStyle = partOn ? '#ffb347' : boss.p2 ? '#ff3a5a' : '#ff6a3a';
      ctx.fillRect(bx + 2, by + 2, (bw - 4) * hp, 14);
      if (boss.flash > 0 || boss.part?.flash) { ctx.fillStyle = '#fff8'; ctx.fillRect(bx + 2, by + 2, (bw - 4) * hp, 14); }
    }
    void now;
  }

  /** 大字招牌（「任務一 開始！」「任務完成！」）有沒有書法招牌圖：照 fx2.json signs 的 text 對 */
  signFor(text: string): FxSet | undefined {
    for (const k of ['sign_m1', 'sign_m2', 'sign_m3', 'sign_clear', 'sign_continue']) {
      const f = this.fx(k);
      if (f && f.meta.text === text) return f;
    }
    return undefined;
  }

  /** 資訊欄的框：木牌圖（第三批美術，圖的大小就是框的大小），沒有就退回程式畫的深色方框 */
  private hudPanel(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number): void {
    const f = this.fx(key);
    if (f?.frames[0]) ctx.drawImage(f.frames[0], x, y, w, h);
    else panel(ctx, x, y, w, h);
  }

  /** 畫木牌，回傳中間能寫字的內板（畫面座標）。比例照 HUD_INNER（量圖得來）；沒有木牌圖時是程式畫的框，四邊留 8 像素 */
  private hudInner(ctx0: string, x: number, y: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
    this.hudPanel(this.hudCtx!, ctx0, x, y, w, h);
    const k = this.fx(ctx0)?.frames[0] ? HUD_INNER[ctx0] : undefined;
    if (!k) return { x0: x + 8, y0: y + 8, x1: x + w - 8, y1: y + h - 8 };
    return { x0: x + w * k[0], y0: y + h * k[1], x1: x + w * k[2], y1: y + h * k[3] };
  }

  /** 書法招牌（任務開始／完成）：畫在畫面中間、寬 width，副標寫在招牌下方 */
  private drawSign(ctx: CanvasRenderingContext2D, f: FxSet, cy: number, width: number, scale: number, sub: string): void {
    const h = f.h * (width / f.w);
    ctx.save();
    ctx.translate(VIEW_W / 2, cy); ctx.scale(scale, scale);
    ctx.drawImage(f.frames[0]!, -width / 2, -h / 2, width, h);
    if (sub) {
      ctx.font = `bold 26px ${FONT}`; ctx.lineWidth = 6; ctx.strokeStyle = '#3a0f0a'; ctx.fillStyle = '#fff3e0';
      ctx.strokeText(sub, 0, h / 2 + 22); ctx.fillText(sub, 0, h / 2 + 22);
    }
    ctx.restore();
  }

  /**
   * 魔王登場：畫面壓暗、魔王半身特寫從右邊滑進來（底邊貼畫面底）、左邊掛警告橫幅寫名字（09-27 第三批美術）。
   * 戰鬥還在跑（魔王走出場），所以壓暗只到 1.6 秒就淡掉。
   */
  private drawBossIntro(ctx: CanvasRenderingContext2D, w: World, b: World['banners'][number]): boolean {
    const boss = w.boss ?? w.enemies.find((e) => e.boss && !e.dead);
    const cu = boss ? this.fx(`boss_${ENEMY_DEFS[boss.kind].img}`) : undefined;
    const warn = this.fx('sign_warning');
    if (!cu || !warn) return false;
    const t = b.age;
    const vis = Math.min(1, t / 0.2) * Math.max(0, Math.min(1, (1.95 - t) / 0.35));
    if (vis <= 0) return true;
    ctx.save();
    ctx.globalAlpha = vis;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const slide = (1 - easeOut(Math.min(1, t / 0.28))) * 520;
    ctx.drawImage(cu.frames[0]!, slide, VIEW_H - cu.h, cu.w, cu.h);   // 底邊、右邊貼齊畫面邊（被切掉的地方才不會露出直線）
    const bw = 860, bh = warn.h * (bw / warn.w), bx = 20 - slide * 0.4, by = 330;
    ctx.drawImage(warn.frames[0]!, bx, by, bw, bh);
    const cx = bx + bw / 2, cy = by + bh / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 20px ${FONT}`; ctx.fillStyle = '#ffd23a'; ctx.fillText('警告　WARNING　警告', cx, cy - 26);
    ctx.font = `900 50px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = '#2a0505'; ctx.fillStyle = '#fff';
    ctx.strokeText(b.text, cx, cy + 10); ctx.fillText(b.text, cx, cy + 10);
    if (b.sub) { ctx.font = `bold 22px ${FONT}`; ctx.lineWidth = 4; ctx.fillStyle = '#ffe0a0'; ctx.strokeText(b.sub, cx, by + bh + 16); ctx.fillText(b.sub, cx, by + bh + 16); }
    ctx.restore();
    return true;
  }

  private drawBanners(ctx: CanvasRenderingContext2D, w: World): void {
    for (let b of w.banners) {
      const k = b.age / b.life;
      const inT = Math.min(1, b.age / 0.18), out = k > 0.85 ? (1 - k) / 0.15 : 1;
      ctx.save();
      ctx.globalAlpha = out;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const sign = b.style === 'mission' ? this.signFor(b.text) : undefined;
      if (sign) this.drawSign(ctx, sign, 300, 780, 2.2 - 1.2 * easeOut(inT), b.sub);
      else if (b.style === 'boss' && this.drawBossIntro(ctx, w, b)) { /* 魔王特寫畫好了 */ }
      else if (b.style === 'mission') {
        const s = 2.2 - 1.2 * easeOut(inT);
        ctx.fillStyle = 'rgba(20,8,20,.45)'; ctx.fillRect(0, VIEW_H / 2 - 90, VIEW_W, 170);
        ctx.translate(VIEW_W / 2, VIEW_H / 2 - 20); ctx.scale(s, s);
        ctx.font = `900 84px ${FONT}`; ctx.lineWidth = 12; ctx.strokeStyle = '#3a0f0a'; ctx.fillStyle = '#ffd23a';
        ctx.strokeText(b.text, 0, 0); ctx.fillText(b.text, 0, 0);
        ctx.font = `bold 28px ${FONT}`; ctx.lineWidth = 6; ctx.fillStyle = '#fff3e0';
        ctx.strokeText(b.sub, 0, 62); ctx.fillText(b.sub, 0, 62);
      } else if (b.style === 'weapon') {
        const s = 1.5 - 0.5 * easeOut(inT);
        ctx.globalAlpha *= 0.8;
        ctx.translate(VIEW_W / 2, 190); ctx.scale(s, s);
        ctx.font = `900 58px ${FONT}`; ctx.lineWidth = 10; ctx.strokeStyle = '#1a2a5a'; ctx.fillStyle = '#9ff0ff';
        ctx.strokeText(b.text, 0, 0); ctx.fillText(b.text, 0, 0);
        if (b.sub) { ctx.font = `bold 24px ${FONT}`; ctx.lineWidth = 5; ctx.fillStyle = '#fff'; ctx.strokeText(b.sub, 0, 44); ctx.fillText(b.sub, 0, 44); }
      } else if (b.style === 'hint') {
        b = { ...b, text: this.tt(b.text), sub: this.tt(b.sub) };   // 手機：鍵盤按鍵換成觸控按鈕的名字
        const y = VIEW_H - 78 - (w.boss && !w.boss.dead ? 100 : 0);   // 地面帶上（腳底 596 以下），不擋角色
        ctx.font = `bold 28px ${FONT}`;
        const tw = Math.max(ctx.measureText(b.text).width, b.sub ? (ctx.font = `bold 20px ${FONT}`, ctx.measureText(b.sub).width) : 0);
        ctx.fillStyle = 'rgba(14,8,24,.72)'; ctx.strokeStyle = 'rgba(255,224,122,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - tw / 2 - 26, y - 26, tw + 52, b.sub ? 84 : 52, 12); ctx.fill(); ctx.stroke();
        ctx.font = `bold 28px ${FONT}`; ctx.fillStyle = '#ffe07a'; ctx.fillText(b.text, VIEW_W / 2, y);
        if (b.sub) { ctx.font = `bold 20px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(b.sub, VIEW_W / 2, y + 34); }
      } else if (b.style === 'boss') {
        const y = VIEW_H / 2 - 60;
        ctx.fillStyle = 'rgba(120,10,10,.6)'; ctx.fillRect(0, y - 60, VIEW_W, 120);
        if (b.sub) { ctx.fillStyle = 'rgba(40,6,6,.7)'; ctx.fillRect(VIEW_W / 2 - 220, y + 64, 440, 34); }
        ctx.fillStyle = '#ffd23a';
        for (let x = -((b.age * 200) % 80); x < VIEW_W; x += 80) { ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x + 40, y - 60); ctx.lineTo(x + 20, y - 48); ctx.lineTo(x - 20, y - 48); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y + 60); ctx.lineTo(x + 40, y + 60); ctx.lineTo(x + 20, y + 48); ctx.lineTo(x - 20, y + 48); ctx.fill(); }
        ctx.font = `900 22px ${FONT}`; ctx.fillStyle = '#ffd23a'; ctx.fillText('警告　WARNING　警告', VIEW_W / 2, y - 26);
        ctx.font = `900 56px ${FONT}`; ctx.lineWidth = 10; ctx.strokeStyle = '#2a0505'; ctx.fillStyle = '#fff';
        ctx.strokeText(b.text, VIEW_W / 2, y + 14); ctx.fillText(b.text, VIEW_W / 2, y + 14);
        if (b.sub) { ctx.font = `bold 22px ${FONT}`; ctx.fillStyle = '#ffe0a0'; ctx.fillText(b.sub, VIEW_W / 2, y + 82); }
      } else {
        ctx.font = `900 40px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#ffec8a';
        ctx.strokeText(b.text, VIEW_W / 2, 250); ctx.fillText(b.text, VIEW_W / 2, 250);
        if (b.sub) { ctx.font = `bold 20px ${FONT}`; ctx.lineWidth = 5; ctx.fillStyle = '#fff'; ctx.strokeText(this.tt(b.sub), VIEW_W / 2, 286); ctx.fillText(this.tt(b.sub), VIEW_W / 2, 286); }
      }
      ctx.restore();
    }
  }
}

// ───────────────────────── 小圖（程式畫） ─────────────────────────

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
/** 手機：關卡提示字裡的鍵盤按鍵 → 觸控按鈕（照 stages/*.ts 的 hints 寫法對） */
const TOUCH_WORDS: [string, string][] = [
  ['← → 移動　空白鍵 跳（按久跳高）', '左邊方向盤 ◀ ▶ 移動　按「跳」跳（按久跳高）'],
  ['J 攻擊：', '「攻」：'], ['J 普通攻擊：', '「攻」：'], ['K 特殊攻擊', '「特」特殊攻擊'], ['　L 丟爆裂符', '　「大」丟爆裂符'],
  ['按住 ↑ 往上丟', '按住方向盤 ▲ 再按「攻」往上丟'], ['↓＋跳', '方向盤 ▼＋「跳」'], ['爆裂符（L）', '爆裂符（「大」）'], ['按 K 丟', '按「特」丟'], ['K 特殊', '「特」特殊'],
];
/** 升降台圖上兩條鋼索在圖寬的幾成（量 platform_s3_lift.webp 的頂端） */
const LIFT_CABLES = [0.087, 0.912];

/** 平台樣子 → terrain.json 的 rail 套名（沒列的用 plank） */
const RAIL_OF: Partial<Record<PlatformDef['look'], string>> = { bamboo: 'bamboo', bridge: 's2_bridge', stage: 's2_stage', catwalk: 's3_catwalk', conveyor: 's3_conveyor' };

/** 壓暗的圖（前景竹叢）：做一次存起來 */
const darkCache = new WeakMap<object, Map<number, HTMLCanvasElement>>();
export function darkOf(img: HTMLImageElement, k: number): HTMLCanvasElement {
  let m = darkCache.get(img);
  if (!m) { m = new Map(); darkCache.set(img, m); }
  let c = m.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = (img as { width: number }).width; c.height = (img as { height: number }).height;   // 照圖實際存的大小（手機縮過）
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(8,4,14,${1 - k})`;
    g.fillRect(0, 0, c.width, c.height);
    m.set(k, c);
  }
  return c;
}

/** 落差比這小的是樓梯的一階（用縮小的石塊補），這個以上畫整面崖壁 */
const STEP_WALL = 60;
/** 往上捲的時候各層背景往下移的比例（近的移得多；美術模擬 tools/sim_v2.py 用的值） */
const V_RATE = { far: 0.2, midfar: 0.4, mid: 0.8 } as const;

/** 當場染色：把圖畫進一張共用的暫存畫布、整張蓋上顏色（只蓋在不透明的地方）；回傳的畫布下一次呼叫就會被蓋掉，要馬上畫 */
let tintScratch: HTMLCanvasElement | null = null;
function tintNow(img: CanvasImageSource, color: string): HTMLCanvasElement {
  const w = (img as { width: number }).width, h = (img as { height: number }).height;
  tintScratch ??= document.createElement('canvas');
  const c = tintScratch;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'copy';
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** 攀爬段鏡頭往上抬時，長卷頂端淡出多高（像素） */
const FADE_TOP = 150;

/** 攀爬時球球往背後挪幾像素（量 climb 動作：手在身體中線前方約 45 像素） */
const CLIMB_DX = 44;

/** 木牌圖中間深色內板的範圍（佔整張圖的比例：左、上、右、下；2026-10-09 用 PIL 量 public/art/fx2/hud_*.webp） */
const HUD_INNER: Record<string, [number, number, number, number]> = {
  hud_score: [0.086, 0.234, 0.898, 0.734], hud_weapon: [0.086, 0.234, 0.898, 0.734],
  hud_time: [0.13, 0.242, 0.85, 0.717], hud_cats: [0.098, 0.242, 0.887, 0.717], hud_boss: [0.037, 0.236, 0.949, 0.729],
};

/** 設粗體字級：從 px 開始往下縮，直到 text 寬度不超過 maxW（最小 10 像素） */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, px: number, maxW: number): number {
  let size = px;
  ctx.font = `bold ${size}px ${FONT}`;
  while (size > 10 && ctx.measureText(text).width > maxW) { size -= 1; ctx.font = `bold ${size}px ${FONT}`; }
  return size;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(24,12,26,.62)'; ctx.strokeStyle = 'rgba(255,220,170,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill(); ctx.stroke();
}

/** 子彈圖原本是照這個寬度畫的（world.addBullet 的預設判定寬）；判定框改大改小時圖跟著縮放 */
const BULLET_BASE_W: Partial<Record<Bullet['kind'], number>> = { kunai: 44, bone: 40, fireball: 40, water: 52, pellet: 26, leaf: 36, splash: 22, garbage: 44 };

/** 狀態列 K 格只放得下四個字：名字太長的用短名 */
const HUD_SHORT: Partial<Record<string, string>> = { H: '棒手裏劍', R: '風魔', C: '式神紙鶴' };

/** 狀態列忍具格的按鍵小圓章（K／L；手機是「特」「大」） */
function keyBadge(ctx: CanvasRenderingContext2D, x: number, y: number, key: string, on: boolean): void {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#ffd23a' : '#6a5a48'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#2a140a'; ctx.stroke();
  ctx.font = `900 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a140a'; ctx.fillText(key, x, y + 1);
  ctx.restore();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, full: boolean): void {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(0, r * 0.9);
  ctx.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.7, -r * 1.3, 0, -r * 0.4);
  ctx.bezierCurveTo(r * 0.7, -r * 1.3, r * 1.6, -r * 0.2, 0, r * 0.9);
  ctx.fillStyle = full ? '#ff4a6a' : '#4a2a36'; ctx.fill();
  ctx.strokeStyle = '#2a0a14'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, r0: number, r1: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r1 : r0, a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath();
}

export function drawFish(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = '#c9b48a'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(34, -10); ctx.lineTo(34, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b1a10'; ctx.beginPath(); ctx.arc(-14, -2, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawOnigiri(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#fbf7ee'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(26, 14, 20, 20); ctx.lineTo(-20, 20); ctx.quadraticCurveTo(-26, 14, 0, -24); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1f2a1a'; ctx.fillRect(-12, 4, 24, 16);
  ctx.restore();
}

function drawBone(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.stroke();
  for (let i = -12; i <= 8; i += 7) { ctx.beginPath(); ctx.moveTo(i, -10); ctx.lineTo(i, 10); ctx.stroke(); }
  ctx.strokeStyle = '#f7f1e3'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.stroke();
  for (let i = -12; i <= 8; i += 7) { ctx.beginPath(); ctx.moveTo(i, -10); ctx.lineTo(i, 10); ctx.stroke(); }
  ctx.fillStyle = '#f7f1e3'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(32, -12); ctx.lineTo(32, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-30, -9); ctx.lineTo(-30, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
