/**
 * 配樂播放（2026-09-27 使用者：「音樂可以拿抓破的歌來用」）：用爪破魔塔的配樂檔（public/bgm/*.mp3，使用者自己的曲子）。
 *
 * - 不整首解碼：兩分鐘的歌解成 AudioBuffer 約 40 MB，手機吃不消。改用兩個 <audio> 元素輪流串流播放（換曲時交叉淡入淡出），
 *   各接一個 MediaElementAudioSourceNode 進總輸出（錄影的混音照樣錄得到、M 靜音照樣有效）。
 *   同時最多兩首在記憶體裡：正在放的、上一首（或預先載好的下一首）。
 * - 各首響度不同：用 ffmpeg ebur128 量好整合響度（LUFS），播放時乘增益拉到同一個響度。
 * - 檔案載不到（離線、檔案不見、瀏覽器不支援）就退回程式合成的曲子（music.ts）；沒有對應合成曲的就安靜。
 */
import { MusicPlayer, TRACKS } from './music';

export interface BgmDef {
  /** public/bgm/ 底下的檔名（不含 .mp3） */
  file: string;
  /** 整合響度（LUFS，ffmpeg ebur128 量的，2026-09-27） */
  lufs: number;
  /** 檔案載不到時改放哪首合成曲（music.ts 的 TRACKS）；null＝安靜 */
  synth: string | null;
}

/** 配樂代號 → 檔案。代號是 sfx.ts 從事件推出來的「現在該放什麼」 */
export const BGM: Record<string, BgmDef> = {
  title: { file: 'leisure', lufs: -17.2, synth: null },
  stage1: { file: 'act1', lufs: -13.6, synth: 'stage1' },
  stage2: { file: 'act2', lufs: -13.8, synth: 'stage2' },
  stage3: { file: 'act3', lufs: -9.4, synth: 'stage3' },
  /** 中魔王（太鼓狸、蛙大名、掃地機王） */
  elite: { file: 'elite', lufs: -13.2, synth: 'boss' },
  /** 第一、二關的魔王 */
  boss: { file: 'boss', lufs: -12.2, synth: 'boss' },
  /** 最後一關的最終魔王 */
  finalboss: { file: 'finalboss', lufs: -12.6, synth: 'boss' },
  ending: { file: 'ending', lufs: -16.2, synth: null },
  /** 接關倒數、遊戲結束 */
  defeat: { file: 'defeat', lufs: -16.9, synth: null },
};

/**
 * 拉齊到的響度（進配樂匯流之前）。之後配樂匯流乘 0.3（約 -10.5 dB），總輸出的壓縮器、限幅器又會自動補回約 +9.5 dB，
 * 實測出來總輸出約 -21 LUFS，跟原本合成配樂（-21 LUFS）差不多、比音效低（tools/render_audio.mjs 量）
 */
export const REF_LUFS = -18.5;
/** 換曲的交叉淡入淡出（秒） */
export const FADE = 1;

/** 這首要乘多少增益才會到 REF_LUFS */
export const bgmGain = (id: string): number => {
  const d = BGM[id];
  return d ? Math.pow(10, (REF_LUFS - d.lufs) / 20) : 1;
};

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  /** 這個元素現在裝的是哪首 */
  id: string | null;
  /** 延遲開始的時間到了、應該在放 */
  want: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class BgmPlayer {
  private readonly decks: Deck[] = [];
  private active: Deck | null = null;
  private cur: string | null = null;
  private held = false;
  private readonly broken = new Set<string>();
  private readonly duckNode: GainNode;
  private readonly synth: MusicPlayer;

  constructor(private readonly ctx: AudioContext, out: AudioNode, rnd: () => number, private readonly base = 'bgm/') {
    this.duckNode = ctx.createGain();
    this.duckNode.connect(out);
    this.synth = new MusicPlayer(ctx, this.duckNode, rnd);
    if (typeof Audio === 'undefined') return;
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.duckNode);
      const d: Deck = { el, gain, id: null, want: false, timer: undefined };
      // 檔案載不到：記下來，這一場之後都改放合成曲
      el.addEventListener('error', () => { if (d.id && el.error) this.fail(d); });
      this.decks.push(d);
    }
  }

  /** 現在該放的配樂代號 */
  get playing(): string | null { return this.cur; }

  /** 檢查用：實際在出聲的是檔案、合成曲、還是安靜 */
  get source(): 'file' | 'synth' | null {
    if (this.active && this.active.id === this.cur && this.cur) return 'file';
    return this.synth.playing ? 'synth' : null;
  }

  /** 檢查用：正在放的配樂檔放到第幾秒（暫停時應該停在原地） */
  get position(): number | null { return this.active ? +this.active.el.currentTime.toFixed(2) : null; }

  private fileOk(id: string): boolean { return !!BGM[id] && !this.broken.has(id) && this.decks.length > 0; }

  private load(d: Deck, id: string): void {
    if (d.id === id && d.el.getAttribute('src')) return;
    d.id = id;
    d.el.src = `${this.base}${BGM[id]!.file}.mp3`;
  }

  /** 換到 id（null＝安靜）：舊的淡出、新的 delay 秒後淡入 */
  play(id: string | null, delay = 0): void {
    if (id === this.cur) return;
    this.cur = id;
    const prev = this.active;
    if (prev) this.fadeOut(prev);
    this.active = null;
    this.synth.stop(FADE);
    if (!id) return;
    if (!this.fileOk(id)) { this.startSynth(id, delay); return; }
    // 用另一個元素（舊的那個正在淡出）；已經裝著這首的優先（剛載好、或魔王戰完回關卡曲）
    const d = this.decks.find((x) => x !== prev && x.id === id) ?? this.decks.find((x) => x !== prev) ?? this.decks[0]!;
    clearTimeout(d.timer); d.timer = undefined;
    this.active = d;
    this.load(d, id);
    try { d.el.currentTime = 0; } catch { /* 還沒載到也沒關係，會從頭放 */ }
    const g = d.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(0, now);
    d.want = false;
    // 沒有延遲就同步叫 play()：手機第一次觸控時要在觸控的處理裡直接叫才算解鎖
    if (delay <= 0) { d.want = true; this.kick(d); }
    else d.timer = setTimeout(() => { d.timer = undefined; d.want = true; this.kick(d); }, delay * 1000);
  }

  /** 真的開始（或繼續）放，淡入到這首的增益 */
  private kick(d: Deck): void {
    if (this.held || d !== this.active || !d.want) return;
    const id = d.id;
    d.el.play().then(() => {
      if (d !== this.active || d.id !== id) return;
      const g = d.gain.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(bgmGain(id!), now + FADE);
    }, (e: unknown) => {
      const name = (e as { name?: string } | null)?.name;
      // 還沒解鎖（使用者還沒按鍵／觸控）、或被下一次換曲打斷：不算壞掉，之後 resume() 再試
      if (name === 'NotAllowedError' || name === 'AbortError') return;
      this.fail(d);
    });
  }

  private fadeOut(d: Deck): void {
    clearTimeout(d.timer); d.timer = undefined;
    d.want = false;
    const g = d.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + FADE);
    setTimeout(() => { if (d !== this.active) d.el.pause(); }, FADE * 1000 + 60);
  }

  private startSynth(id: string, delay: number): void {
    const s = BGM[id]?.synth;
    const t = s ? TRACKS[s] : undefined;
    if (t) this.synth.play(t, delay, FADE);
  }

  private fail(d: Deck): void {
    const id = d.id;
    if (!id) return;
    this.broken.add(id);
    d.id = null; d.want = false;
    d.el.removeAttribute('src');
    if (d === this.active) { this.active = null; if (this.cur === id) this.startSynth(id, 0); }
  }

  /** 先把下一段可能要用的歌載進閒著的那個元素（不播） */
  preload(id: string): void {
    if (!this.fileOk(id) || id === this.cur) return;
    const idle = this.decks.find((x) => x !== this.active && !x.want && x.timer === undefined && x.el.paused);
    if (idle && idle.id !== id) this.load(idle, id);
  }

  /** 暫停、切走分頁時停住（檔案的播放位置停在原地），回來接著放 */
  hold(on: boolean): void {
    this.held = on;
    if (on) for (const d of this.decks) d.el.pause();
    else if (this.active) this.kick(this.active);
  }

  /** 使用者按了鍵（解鎖了）：該放還沒放起來的補放 */
  resume(): void { if (this.active) this.kick(this.active); }

  /** 暫時壓低（球球倒下時） */
  duck(level: number, time = 0.3): void {
    const g = this.duckNode.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(level, now + time);
  }
}
