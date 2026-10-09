/**
 * 畫面流程：標題（← → 選關）→ 任務 N 開始！ → 玩 ⇄ 暫停 → （命用完）繼續？ → 遊戲結束
 *                                   → （打倒魔王）任務完成！ → 結算（一行一行跳出來加總） → 下一關（分數、命帶過去）
 *                                   → 最後一關打完 → 結局 → 標題
 * 遊戲世界本身在 world.ts，畫在 render.ts。
 */
import type { Assets } from './assets';
import type { AnimDefs } from './sprite';
import { VIEW_H, VIEW_W, type GameEvent } from './entities';
import { NO_INPUT, type Frame } from './input';
import { Renderer } from './render';
import * as sfx from './sfx';
import { PRACTICE, STAGES } from './stages';
import type { StageDef } from './stages/types';
import { voice } from './voice';
import { World } from './world';

export type Screen = 'title' | 'play' | 'pause' | 'continue' | 'gameover' | 'result' | 'ending' | 'loading';
import { FONT } from './fonts';   // 同 render.ts（10-09）
const CONTINUE_SECONDS = 10;
const RESULT_ROW = 0.55;

export class Game {
  screen: Screen = 'title';
  world: World | null = null;
  renderer: Renderer;
  stage: StageDef | null = null;
  screenT = 0;
  continueT = 0;
  /** 這一關到目前為止的所有事件（自動檢查、截圖用；最多留 6000 筆） */
  eventLog: GameEvent[] = [];
  /** eventLog 最多留幾筆（測試的平衡報表要整關的事件，會調大） */
  eventCap = 6000;
  /** 自動玩：有設就不看鍵盤（main.ts 帶 ?bot 會接上 autopilot.ts） */
  bot: ((g: Game, dt: number) => Frame) | null = null;
  /** 開局就開無敵（?god） */
  startGod = false;
  /** 標題畫面選到第幾關（0 起算） */
  pickStage = 0;
  /** 過關帶到下一關的東西（越南大戰：分數、剩的命帶著走） */
  carry: { score: number; lives: number } | null = null;

  constructor(readonly a: Assets) {
    this.renderer = new Renderer(a);
  }

  /** 背景載入（瀏覽器裡才有）：這一關的圖還沒好就先顯示「準備中」 */
  loader: { ready(st: StageDef): boolean; progress(st: StageDef): number; want(st: StageDef): void; focus?(st: StageDef): void; prefetch?(st: StageDef): void } | null = null;
  /** 手機（觸控）：畫面上的「按 Enter」改成「點畫面」 */
  touch = false;
  private pending: { stage: StageDef; carry: { score: number; lives: number } | null } | null = null;

  start(stage: StageDef, carry: { score: number; lives: number } | null = null): void {
    this.stage = stage;
    if (this.loader && !this.loader.ready(stage)) { this.pending = { stage, carry }; this.loader.want(stage); this.go('loading'); return; }
    this.pending = null;
    this.loader?.focus?.(stage);   // 別關的圖放掉（手機記憶體）
    // 怪物動作圖的定義用「現查」的：魔王的圖進關後才在背景載（assets.ts 的 playTick），載好就查得到
    const A = this.a;
    const monsterDefs = new Proxy({} as Record<string, AnimDefs>, { get: (_t, k) => (typeof k === 'string' ? A.monsters.get(k)?.lib.defs : undefined) });
    this.world = new World(stage, this.a.sprites.defs, monsterDefs);
    this.world.god = this.startGod;
    if (carry) { this.world.score = carry.score; this.world.lives = Math.max(1, carry.lives); }
    this.eventLog = [];
    this.go('play');
  }

  private go(s: Screen): void { this.screen = s; this.screenT = 0; sfx.onScreen(s); voice.onScreen(s); }   // 配樂跟著畫面走（暫停壓低、接關恢復：音效代理 09-26）

  update(dt: number, keys: Frame): void {
    if (!(dt > 0)) return;   // 負的、零、不是數字的時間不推（保險：主迴圈第一格的時間戳可能比開始計時還早）
    const f = this.bot ? this.bot(this, dt) : keys;
    this.screenT += dt;
    if (this.screen !== 'play') voice.tick();   // 排隊的配音（任務完成、遊戲結束）換了畫面也講完
    switch (this.screen) {
      case 'title': {
        // ← → 選關（數字鍵 1～9 直接選那一關）
        const n = STAGES.length;
        if (keys.left && !this.titleHeld) this.pickStage = (this.pickStage + n - 1) % n;
        if (keys.right && !this.titleHeld) this.pickStage = (this.pickStage + 1) % n;
        this.titleHeld = keys.left || keys.right;
        if (keys.digit >= 1 && keys.digit <= n) this.pickStage = keys.digit - 1;
        // 選到的那一關停 1 秒沒換：背景先載那一關（其他關放掉，手機記憶體）
        if (this.pickStage !== this.pickSeen) { this.pickSeen = this.pickStage; this.pickT = 0; }
        else if ((this.pickT += dt) > 1 && this.pickT - dt <= 1) this.loader?.focus?.(STAGES[this.pickStage]!);
        if (f.startPressed) this.start(STAGES[this.pickStage]!);
        else if (keys.reset || (f as Frame & { practice?: boolean }).practice) this.start(PRACTICE);
        break;
      }
      case 'play': {
        const w = this.world!;
        if (f.pausePressed) { this.go('pause'); break; }
        w.update(dt, f);
        for (const ev of w.events) { sfx.play(ev); this.renderer.onEvent(ev, w); if (this.eventLog.length < this.eventCap) this.eventLog.push(ev); }
        voice.onFrame(w, w.events);   // 日文配音（事件＋敵人頭上新冒的對話框）
        w.events.length = 0;
        if (w.state === 'continue') { this.continueT = CONTINUE_SECONDS; this.go('continue'); }
        else if (w.state === 'done') { w.banners = []; this.go('result'); }
        break;
      }
      case 'loading':
        if (this.pending && (!this.loader || this.loader.ready(this.pending.stage))) this.start(this.pending.stage, this.pending.carry);
        break;
      case 'pause':
        if (f.pausePressed) this.go('play');
        else if (f.reset) this.go('title');
        break;
      case 'continue':
        this.continueT -= dt;
        voice.onCount(Math.max(0, Math.ceil(this.continueT) - 1));   // 跟畫面上的倒數數字一樣
        if (f.startPressed) { this.world!.continueGame(); this.go('play'); }
        else if (this.continueT <= 0) this.go('gameover');
        break;
      case 'gameover':
        if (this.screenT > 1 && f.startPressed) this.go('title');
        break;
      case 'ending':
        if (this.screenT > 6.2 && f.startPressed) this.go('title');   // 「全任務完成！總分」出來之後才能回標題
        break;
      case 'result': {
        const rows = this.world!.resultRows().length;
        // 結算畫面：下一關先在背景載，按 Enter 時多半已經好了
        const ni = STAGES.indexOf(this.stage!);
        if (this.screenT === dt && ni >= 0 && ni + 1 < STAGES.length) this.loader?.prefetch?.(STAGES[ni + 1]!);
        if (f.startPressed && this.screenT > (rows + 2) * RESULT_ROW) {
          const w = this.world!, i = STAGES.indexOf(this.stage!);
          const total = w.score + w.resultRows().reduce((a, r) => a + r.points, 0);
          if (i >= 0 && i + 1 < STAGES.length) this.start(STAGES[i + 1]!, { score: total, lives: w.lives });
          else if (i >= 0) { this.finalScore = total; this.go('ending'); }
          else this.go('title');
        } else if (f.startPressed) this.screenT = (rows + 2) * RESULT_ROW + 0.01;   // 按一下跳過動畫
        break;
      }
    }
  }

  private titleHeld = false;
  /** 「按 Enter ＿」（手機：「點畫面＿」） */
  private tap(what: string): string { return this.touch ? `點畫面${what}` : `按 Enter ${what}`; }
  private pickSeen = -1;
  private pickT = 0;
  /** 全部打完的總分（結局畫面用） */
  finalScore = 0;

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.screen === 'ending') { this.drawEnding(ctx); return; }
    if (this.screen === 'loading') { this.drawLoading(ctx); return; }
    if (this.screen === 'title' || !this.world) { this.drawTitle(ctx); return; }
    this.renderer.draw(ctx, this.world);
    if (this.screen === 'pause') { this.overlay(ctx, '暫停', this.touch ? '按右上角 ❚❚ 繼續' : 'P 或 Esc 繼續｜R 回標題'); this.drawKeys(ctx, VIEW_H / 2 + 110); }
    if (this.screen === 'continue') this.drawContinue(ctx);
    if (this.screen === 'gameover') this.overlay(ctx, '遊戲結束', `分數 ${this.world.score}　${this.tap('回標題')}`);
    if (this.screen === 'result') this.drawResult(ctx);
  }

  private drawTitle(ctx: CanvasRenderingContext2D): void {
    const t = this.screenT;
    const pick = STAGES[this.pickStage] ?? STAGES[0]!;
    const art = this.a.art.get(pick.titleArt)?.img ?? this.a.art.get('ui_stage1_title')?.img ?? this.a.fallback.bg;
    ctx.fillStyle = '#1a1020'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (art) {
      const s = Math.max(VIEW_W / art.naturalWidth, VIEW_H / art.naturalHeight);
      ctx.drawImage(art, (VIEW_W - art.naturalWidth * s) / 2, (VIEW_H - art.naturalHeight * s) / 2, art.naturalWidth * s, art.naturalHeight * s);
    }
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, 'rgba(20,8,24,.2)'); g.addColorStop(0.7, 'rgba(20,8,24,.35)'); g.addColorStop(1, 'rgba(20,8,24,.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const s = 1 + Math.sin(t * 2) * 0.015;
    ctx.save(); ctx.translate(VIEW_W / 2, 130); ctx.scale(s, s);
    ctx.font = `900 96px ${FONT}`; ctx.lineWidth = 14; ctx.strokeStyle = '#3a0f0a'; ctx.fillStyle = '#ffd23a';
    ctx.strokeText('球球大冒險', 0, 0); ctx.fillText('球球大冒險', 0, 0);
    ctx.font = `bold 30px ${FONT}`; ctx.lineWidth = 7; ctx.fillStyle = '#fff3e0';
    ctx.strokeText('忍者貓橫向捲軸', 0, 70); ctx.fillText('忍者貓橫向捲軸', 0, 70);
    ctx.restore();
    // 選關：◀ 任務二　妖怪祭典 → 河童川 → 山頂神社 ▶
    const sel = `${STAGES.length > 1 ? '◀　' : ''}${pick.mission}　${pick.name}${STAGES.length > 1 ? '　▶' : ''}`;
    ctx.font = `900 34px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#9ff0ff';
    ctx.strokeText(sel, VIEW_W / 2, 300); ctx.fillText(sel, VIEW_W / 2, 300);
    if (STAGES.length > 1) { ctx.font = `bold 18px ${FONT}`; ctx.fillStyle = '#ffe9c4'; ctx.fillText(this.touch ? '左下方向盤按 ◀ ▶ 選關' : '← → 選關（數字鍵 1～' + STAGES.length + ' 也可以）', VIEW_W / 2, 340); }
    if (Math.floor(t * 2) % 2 === 0) {
      const go = this.tap('開始');
      ctx.font = `900 40px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#fff';
      ctx.strokeText(go, VIEW_W / 2, VIEW_H - 190); ctx.fillText(go, VIEW_W / 2, VIEW_H - 190);
    }
    this.drawKeys(ctx, VIEW_H - 128);
  }

  /** 按鍵表（標題、暫停畫面）：一行一組「鍵：動作」，不寫教學句子（第二版第 7 節） */
  private drawKeys(ctx: CanvasRenderingContext2D, y: number): void {
    ctx.font = `bold 20px ${FONT}`; ctx.fillStyle = '#ffe9c4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const help = this.touch ? KEY_HELP_TOUCH : [...KEY_HELP.slice(0, -1), KEY_HELP[KEY_HELP.length - 1] + (this.devKeys ? '　｜開發用：1～9 換忍具、0 手裏劍、F5～F7 補副武器、F2 無敵' : '')];
    help.forEach((h, i) => ctx.fillText(h, VIEW_W / 2, y + i * 32));
  }
  /** 開發用按鍵（網址帶 ?dev 才開） */
  devKeys = false;

  /**
   * 結局：結局圖（terrain.json ending.rescued，16:9，球球跟被救的村貓在天守閣頂合照）鋪滿畫面，淡入；
   * 貓都在畫面上半到中間，字放在下面屋瓦那一條（壓一層暗色）：先是三行故事，再換成「全任務完成！」和總分。
   * 沒有結局圖就退回 art.json 的 ui_ending，再沒有就只有字。
   */
  private drawEnding(ctx: CanvasRenderingContext2D): void {
    const t = this.screenT;
    ctx.fillStyle = '#140c1c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const art = this.a.terrain?.ending.rescued?.img ?? this.a.art.get('ui_ending')?.img;
    if (art) {
      const s = Math.max(VIEW_W / art.naturalWidth, VIEW_H / art.naturalHeight), w = art.naturalWidth * s, h = art.naturalHeight * s;
      ctx.globalAlpha = Math.min(1, t / 1.5);
      ctx.drawImage(art, (VIEW_W - w) / 2, VIEW_H - h, w, h);
      ctx.globalAlpha = 1;
    }
    // 下面一條壓暗，字才看得清楚
    const band = ctx.createLinearGradient(0, 470, 0, VIEW_H);
    band.addColorStop(0, 'rgba(14,6,18,0)'); band.addColorStop(0.35, 'rgba(14,6,18,.62)'); band.addColorStop(1, 'rgba(14,6,18,.82)');
    ctx.fillStyle = band; ctx.fillRect(0, 470, VIEW_W, VIEW_H - 470);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = ['山賊寨、妖怪祭典、鐵爪機關城……', '被綁走的村貓們全部回家了。', '球球，謝謝你！'];
    const out = Math.max(0, Math.min(1, (t - 5.2) / 0.6));   // 故事字幕淡出，換成「全任務完成！」
    lines.forEach((l, i) => {
      const k = Math.max(0, Math.min(1, (t - 0.8 - i * 1.1) / 0.8)) * (1 - out);
      if (k <= 0) return;
      ctx.globalAlpha = k;
      ctx.font = `bold 32px ${FONT}`; ctx.lineWidth = 7; ctx.strokeStyle = '#1a0a14'; ctx.fillStyle = '#fff3e0';
      const y = 548 + i * 50 - (1 - k) * 10;
      ctx.strokeText(l, VIEW_W / 2, y); ctx.fillText(l, VIEW_W / 2, y);
    });
    ctx.globalAlpha = 1;
    if (out > 0) {
      ctx.globalAlpha = out;
      ctx.font = `900 64px ${FONT}`; ctx.lineWidth = 12; ctx.strokeStyle = '#3a0f0a'; ctx.fillStyle = '#ffd23a';
      ctx.strokeText('全任務完成！', VIEW_W / 2, 560); ctx.fillText('全任務完成！', VIEW_W / 2, 560);
      ctx.font = `900 40px ${FONT}`; ctx.lineWidth = 8; ctx.fillStyle = '#fff3a0';
      ctx.strokeText(`總分　${this.finalScore}`, VIEW_W / 2, 630); ctx.fillText(`總分　${this.finalScore}`, VIEW_W / 2, 630);
      ctx.globalAlpha = 1;
    }
    if (t > 6.2 && Math.floor(t * 2) % 2 === 0) { const b = this.tap('回標題'); ctx.font = `bold 22px ${FONT}`; ctx.lineWidth = 5; ctx.strokeStyle = '#1a0a14'; ctx.fillStyle = '#fff'; ctx.strokeText(b, VIEW_W / 2, 690); ctx.fillText(b, VIEW_W / 2, 690); }
  }

  /** 準備中：這一關的圖還在載入、預熱（通常一兩秒） */
  private drawLoading(ctx: CanvasRenderingContext2D): void {
    const st = this.pending?.stage ?? this.stage;
    ctx.fillStyle = '#16121c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const art = st ? this.a.art.get(st.titleArt)?.img : null;
    if (art) {
      const s = Math.max(VIEW_W / art.naturalWidth, VIEW_H / art.naturalHeight);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(art, (VIEW_W - art.naturalWidth * s) / 2, (VIEW_H - art.naturalHeight * s) / 2, art.naturalWidth * s, art.naturalHeight * s);
      ctx.globalAlpha = 1;
    }
    const k = st && this.loader ? this.loader.progress(st) : 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 44px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#ffd23a';
    const t = st ? `${st.mission}　準備中…` : '準備中…';
    ctx.strokeText(t, VIEW_W / 2, VIEW_H / 2 - 30); ctx.fillText(t, VIEW_W / 2, VIEW_H / 2 - 30);
    const bw = 520, bx = VIEW_W / 2 - bw / 2, by = VIEW_H / 2 + 20;
    ctx.fillStyle = '#2a1016'; ctx.fillRect(bx, by, bw, 18);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(bx + 2, by + 2, (bw - 4) * k, 14);
    ctx.font = `bold 20px ${FONT}`; ctx.fillStyle = '#fff3e0'; ctx.fillText(`${Math.round(k * 100)}%`, VIEW_W / 2, by + 44);
  }

  private overlay(ctx: CanvasRenderingContext2D, title: string, sub: string): void {
    ctx.fillStyle = 'rgba(10,4,14,.62)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 80px ${FONT}`; ctx.lineWidth = 12; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#ffd23a';
    ctx.strokeText(title, VIEW_W / 2, VIEW_H / 2 - 40); ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 40);
    ctx.font = `bold 28px ${FONT}`; ctx.lineWidth = 6; ctx.fillStyle = '#fff';
    ctx.strokeText(sub, VIEW_W / 2, VIEW_H / 2 + 40); ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 + 40);
  }

  private drawContinue(ctx: CanvasRenderingContext2D): void {
    const n = Math.max(0, Math.ceil(this.continueT) - 1);
    const sub = `${this.tap('接關')}（命補滿，從這裡繼續）`;
    const sign = this.a.fx?.get('sign_continue');
    let ny = VIEW_H / 2 + 140;
    if (sign?.frames[0]) {
      // 書法招牌「接關？」（第三批美術）：畫面壓暗、招牌在中間、下面寫怎麼接關、再下面倒數
      ctx.fillStyle = 'rgba(10,4,14,.62)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const w = 560, h = sign.h * (w / sign.w);
      ctx.drawImage(sign.frames[0], VIEW_W / 2 - w / 2, 290 - h / 2, w, h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold 26px ${FONT}`; ctx.lineWidth = 6; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#fff';
      ctx.strokeText(sub, VIEW_W / 2, 290 + h / 2 + 34); ctx.fillText(sub, VIEW_W / 2, 290 + h / 2 + 34);
      ny = 290 + h / 2 + 120;
    } else this.overlay(ctx, '繼續？', sub);
    const s = 1.4 - (this.continueT % 1) * 0.4;
    ctx.save(); ctx.translate(VIEW_W / 2, ny); ctx.scale(s, s);
    ctx.font = `900 90px ${FONT}`; ctx.lineWidth = 12; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#ff6a5a';
    ctx.strokeText(String(n), 0, 0); ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  /** 結算：每 0.55 秒跳出一行，分數滾動加上去，最後是總分 */
  private drawResult(ctx: CanvasRenderingContext2D): void {
    const w = this.world!;
    const art = this.a.art.get(this.stage?.titleArt ?? '')?.img;
    ctx.fillStyle = 'rgba(12,6,18,.78)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (art) { ctx.globalAlpha = 0.25; ctx.drawImage(art, 0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 64px ${FONT}`; ctx.lineWidth = 10; ctx.strokeStyle = '#3a0f0a'; ctx.fillStyle = '#ffd23a';
    const title = `${this.stage?.mission ?? ''} 完成！`;
    ctx.strokeText(title, VIEW_W / 2, 92); ctx.fillText(title, VIEW_W / 2, 92);
    const rows = w.resultRows();
    let total = w.score;
    const t = this.screenT;
    rows.forEach((r, i) => {
      const k = (t - (i + 1) * RESULT_ROW) / RESULT_ROW;
      if (k < 0) return;
      const shown = Math.min(1, k);
      const y = 190 + i * 64;
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.font = `bold 34px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#ffe9c4';
      ctx.fillText(r.label, 250, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(r.value, 700, y);
      ctx.fillStyle = '#9ff0ff'; ctx.fillText(r.points ? `+${Math.round(r.points * shown)}` : '—', 1030, y);
      ctx.globalAlpha = 1;
      total += Math.round(r.points * shown);
    });
    if (t > (rows.length + 1) * RESULT_ROW) {
      ctx.textAlign = 'center';
      ctx.font = `900 54px ${FONT}`; ctx.lineWidth = 9; ctx.strokeStyle = '#2a0a0a'; ctx.fillStyle = '#fff3a0';
      ctx.strokeText(`總分　${total}`, VIEW_W / 2, 560); ctx.fillText(`總分　${total}`, VIEW_W / 2, 560);
    }
    if (t > (rows.length + 2) * RESULT_ROW && Math.floor(t * 2) % 2 === 0) {
      ctx.font = `bold 26px ${FONT}`; ctx.fillStyle = '#fff';
      const i = STAGES.indexOf(this.stage!);
      ctx.fillText(this.tap(i >= 0 && i + 1 < STAGES.length ? '前往下一關' : '看結局'), VIEW_W / 2, 640);
    }
  }
}

export { NO_INPUT };

/** 按鍵一覽（電腦）：第二版加了二段跳、蹬牆、攀爬、翻滾、斜丟 */
export const KEY_HELP = [
  '← → 移動　↑ 朝上丟　↑＋← → 斜上丟　↓ 蹲（空中朝下丟）　空白鍵 跳（空中再按＝二段跳）',
  'J 普通攻擊（貼近自動揮爪）　K 特殊攻擊（救村貓拿到的忍具）　L 大招　Q 換大招　I 地上翻滾／空中衝刺',
  '貼牆按跳＝蹬牆跳　↑ 抓藤蔓、梯子（↑↓ 爬、跳＝跳開）',
  'P 暫停　R 動作練習場',
];
/** 按鍵一覽（手機） */
export const KEY_HELP_TOUCH = [
  '左邊方向盤：◀ ▶ 走　▲ 朝上丟、抓藤蔓梯子　▼ 蹲（空中按住朝下丟）',
  '右邊：跳（按久跳高、空中再按二段跳、貼牆按蹬牆跳）　攻（手裏劍，貼近自動揮爪）　特（救村貓拿到的忍具）　大（大招）　換（換大招）',
  '右上角：❚❚ 暫停　⛶ 全螢幕',
];
