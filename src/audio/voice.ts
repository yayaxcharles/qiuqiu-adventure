/**
 * 日文配音的「誰來講、要不要打斷」（純邏輯，不碰 Web Audio；測試直接餵假的時鐘與假的播放器）。
 *
 * 規則（public/voice/voice.json 的 priority_note）：
 * - 同一時間只有一句在講。
 * - 新的一句優先順序比正在講的高才打斷；同順序或比較低就略過。
 * - 例外一：「排隊」（wait 秒）：講不了就排隊，前一句講完接著講；排超過 wait 秒就不講了（任務完成：播報員講完換球球）。
 * - 例外二：「客氣」（polite）：只在沒人講話時講，誰都不打斷（球球丟東西的喊聲，免得蓋掉村貓、魔王的台詞）。
 * - 音檔還沒載好：開始載、先排隊等一下（最多 0.8 秒），載不到就算了（不擋遊戲）。
 */

export interface VoiceClip { id: string; file: string; text: string; variant?: number; dur: number; ok?: boolean }
export interface VoiceGroup { role: string; priority: number; volume: number; clips: VoiceClip[]; hint?: string }
export interface VoiceData {
  roles: Record<string, { priority: number; volume: number; name?: string }>;
  events: Record<string, VoiceGroup[]>;
  say: Record<string, string>;
}

/** 真的出聲的那一層（瀏覽器是 Web Audio；測試是假的） */
export interface VoiceSink {
  /** 現在幾秒（音訊時鐘） */
  now(): number;
  ready(clip: VoiceClip): boolean;
  load(clip: VoiceClip): void;
  /** 開始講（會先停掉正在講的）；不能出聲（還沒解鎖）回 false */
  play(clip: VoiceClip, volume: number): boolean;
  stop(): void;
}

export interface SayOpts {
  /** 同一事件有好幾個角色（村貓甲乙丙、播報員＋球球）時指定哪一個；沒給＝第一個（優先順序最高的） */
  role?: string;
  /** 指定哪一句（字幕跟配音一字不差）；找不到就隨機 */
  text?: string;
  /** 講不了時最多排隊幾秒（0＝不排隊） */
  wait?: number;
  /** 只在沒人講話時講，不打斷任何人 */
  polite?: boolean;
  /** 同順序也打斷（魔王出場警報蓋過連殺、救完村貓這類播報） */
  force?: boolean;
}

export type VoiceAct = 'play' | 'cut' | 'queue' | 'skip' | 'expire' | 'locked';
export interface VoiceLogEntry { at: number; wt: number; event: string; id: string; role: string; act: VoiceAct; dur: number }

interface Queued { event: string; clip: VoiceClip; role: string; prio: number; vol: number; deadline: number; polite: boolean }

/** 兩句之間留一點空 */
export const GAP = 0.12;
/** 音檔還沒載好時最多等多久 */
export const LOAD_WAIT = 0.8;

export class VoiceDirector {
  cur: { event: string; id: string; role: string; prio: number; end: number } | null = null;
  queue: Queued[] = [];
  readonly log: VoiceLogEntry[] = [];
  /** 遊戲時間（記錄用，外面每格設） */
  wt = 0;

  constructor(readonly data: VoiceData, readonly sink: VoiceSink, readonly rand: () => number = Math.random) {}

  busy(now = this.sink.now()): boolean { return !!this.cur && now < this.cur.end; }

  /** 這個事件有沒有配音 */
  has(event: string): boolean { return !!this.data.events[event]?.length; }

  private note(event: string, clip: VoiceClip, role: string, act: VoiceAct, now: number): void {
    if (this.log.length > 4000) this.log.splice(0, 1000);
    this.log.push({ at: +now.toFixed(3), wt: +this.wt.toFixed(2), event, id: clip.id, role, act, dur: clip.dur });
  }

  /** 事件＋選項 → 哪個角色、哪一句 */
  pick(event: string, o: SayOpts = {}): { group: VoiceGroup; clip: VoiceClip } | null {
    const groups = this.data.events[event];
    if (!groups?.length) return null;
    const group = o.role ? groups.find((g) => g.role === o.role) : groups[0];
    if (!group) return null;
    const ok = group.clips.filter((c) => c.ok !== false);
    if (!ok.length) return null;
    const clip = (o.text !== undefined ? ok.find((c) => c.text === o.text) : undefined) ?? ok[Math.floor(this.rand() * ok.length) % ok.length]!;
    return { group, clip };
  }

  say(event: string, o: SayOpts = {}): VoiceAct | 'none' {
    const p = this.pick(event, o);
    if (!p) return 'none';
    const { group, clip } = p;
    const now = this.sink.now();
    const prio = group.priority, vol = group.volume ?? 1;
    const q: Queued = { event, clip, role: group.role, prio, vol, deadline: now + (o.wait ?? 0), polite: !!o.polite };
    // 還沒載好；或是「客氣＋排隊」而前面已經有人在排：排到最後面（接著講的順序不亂）
    if (!this.sink.ready(clip) || (this.queue.length && o.polite && o.wait)) {
      this.sink.load(clip);
      if (o.polite && !o.wait) { this.note(event, clip, group.role, 'skip', now); return 'skip'; }   // 喊聲晚了就沒意思
      q.deadline = now + Math.max(o.wait ?? 0, LOAD_WAIT);
      return this.enqueue(q, now);
    }
    if (this.busy(now)) {
      if (!o.polite && (prio > this.cur!.prio || (o.force && prio >= this.cur!.prio))) return this.start(q, now, true);
      if ((o.wait ?? 0) > 0) return this.enqueue(q, now);
      this.note(event, clip, group.role, 'skip', now);
      return 'skip';
    }
    return this.start(q, now, false);
  }

  private enqueue(q: Queued, now: number): VoiceAct {
    if (this.queue.some((x) => x.event === q.event && x.role === q.role)) { this.note(q.event, q.clip, q.role, 'skip', now); return 'skip'; }
    this.queue.push(q);
    this.note(q.event, q.clip, q.role, 'queue', now);
    return 'queue';
  }

  private start(q: Queued, now: number, cut: boolean): VoiceAct {
    if (cut && this.cur) this.log.push({ at: +now.toFixed(3), wt: +this.wt.toFixed(2), event: this.cur.event, id: this.cur.id, role: this.cur.role, act: 'cut', dur: 0 });
    if (!this.sink.play(q.clip, q.vol)) { this.note(q.event, q.clip, q.role, 'locked', now); return 'locked'; }
    this.cur = { event: q.event, id: q.clip.id, role: q.role, prio: q.prio, end: now + q.clip.dur + GAP };
    this.note(q.event, q.clip, q.role, 'play', now);
    return 'play';
  }

  /** 每格叫：排隊的過期就丟掉；沒人講話了就照排隊順序換下一句（排隊的不打斷人） */
  tick(): void {
    if (!this.queue.length) return;
    const now = this.sink.now();
    this.queue = this.queue.filter((q) => {
      if (q.deadline >= now) return true;
      this.note(q.event, q.clip, q.role, 'expire', now);
      return false;
    });
    if (this.busy(now)) return;
    // 照順序：排第一的還沒載好就等它（載不到的會過期被丟掉），不插隊
    if (!this.sink.ready(this.queue[0]!.clip)) return;
    this.start(this.queue.shift()!, now, false);
  }

  /** 回標題、換關：全部停掉 */
  clear(): void {
    this.queue = [];
    const now = this.sink.now();
    if (this.cur && now < this.cur.end) this.log.push({ at: +now.toFixed(3), wt: +this.wt.toFixed(2), event: this.cur.event, id: this.cur.id, role: this.cur.role, act: 'cut', dur: 0 });
    if (this.cur) { this.sink.stop(); this.cur = null; }
  }

  /** 先把這些角色的音檔載起來（不播） */
  prefetch(roles: string[]): void {
    const want = new Set(roles);
    for (const groups of Object.values(this.data.events)) {
      for (const g of groups) if (want.has(g.role)) for (const c of g.clips) if (c.ok !== false && !this.sink.ready(c)) this.sink.load(c);
    }
  }
}
