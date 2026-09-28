/**
 * 節流：同一幀一大堆同樣的事件（連射、一顆爆裂符炸死一排）不要疊成噪音。
 * 規則兩條：同名兩次之間至少隔 gap 秒；同名同時最多 max 個在響。另外整體同時最多 total 個。
 * 純邏輯、不碰 Web Audio（測試直接餵時間）。
 */
export class Throttle {
  private last = new Map<string, number>();
  private live = new Map<string, number[]>();
  private all: number[] = [];

  constructor(readonly total = 20) {}

  /** now 秒要開始一個 name，會響到 end 秒：可以就記下來回傳 true */
  allow(name: string, now: number, end: number, max = 3, gap = 0.03, important = false): boolean {
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < gap) return false;
    const mine = (this.live.get(name) ?? []).filter((e) => e > now);
    this.all = this.all.filter((e) => e > now);
    if (mine.length >= max) return false;
    if (!important && this.all.length >= this.total) return false;
    mine.push(end);
    this.live.set(name, mine);
    this.all.push(end);
    this.last.set(name, now);
    return true;
  }

  reset(): void { this.last.clear(); this.live.clear(); this.all = []; }
}
