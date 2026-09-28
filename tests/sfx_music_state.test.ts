/**
 * 配樂狀態（從事件推該放哪首歌）：接關倒數、接關後恢復、魔王戰中接關。
 * 低 8（2026-09-26 獨立審查）：接關倒數用真實時間的計時器，分頁切走時遊戲停了、計時器照跑，
 * 數完就把「該放的歌」清掉，接關後整段沒有配樂。這裡用假時鐘把「倒數數完了才接關」重現出來。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { musicWanted, onScreen, play } from '../src/sfx';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('接關後恢復配樂', () => {
  it('倒數的計時器先數完（分頁切走時會這樣），接關後還是放這一關的歌', () => {
    play({ type: 'missionStart', stage: 'stage2' });
    expect(musicWanted()).toBe('stage2');
    play({ type: 'playerDown', lives: 0 });
    play({ type: 'continuePrompt' });
    vi.advanceTimersByTime(15000);
    play({ type: 'respawn', x: 0 });
    expect(musicWanted()).toBe('stage2');
  });

  it('魔王戰中接關：接回魔王曲', () => {
    play({ type: 'missionStart', stage: 'stage1' });
    play({ type: 'bossEnter', kind: 'orange_king' });
    expect(musicWanted()).toBe('boss');
    play({ type: 'playerDown', lives: 0 });
    play({ type: 'continuePrompt' });
    vi.advanceTimersByTime(15000);
    play({ type: 'respawn', x: 0 });
    expect(musicWanted()).toBe('boss');
  });
});

describe('換畫面（game.ts 叫 onScreen）', () => {
  it('暫停不丟掉該放的歌（繼續時接著放）；遊戲結束放 defeat、回標題放 title', () => {
    play({ type: 'missionStart', stage: 'stage3' });
    onScreen('play');
    onScreen('pause');
    expect(musicWanted()).toBe('stage3');
    onScreen('play');
    expect(musicWanted()).toBe('stage3');
    onScreen('continue');
    onScreen('gameover');
    expect(musicWanted()).toBe('defeat');
    play({ type: 'missionStart', stage: 'stage1' });
    onScreen('play');
    onScreen('pause');
    onScreen('title');
    expect(musicWanted()).toBe('title');
  });
});

describe('一整關的換曲順序', () => {
  it('第三關：關卡曲 → 中魔王 elite → 倒下安靜 → 回關卡曲 → 最終魔王 finalboss → 任務完成安靜；接關倒數放 defeat', () => {
    play({ type: 'missionStart', stage: 'stage3' });
    expect(musicWanted()).toBe('stage3');
    play({ type: 'bossEnter', kind: 'roomba_king' });
    expect(musicWanted()).toBe('elite');
    play({ type: 'bossDown', kind: 'roomba_king', t: 100 });
    expect(musicWanted()).toBeNull();
    play({ type: 'explode', big: true, from: 'scene', t: 102.5 });
    vi.advanceTimersByTime(1000);
    expect(musicWanted()).toBe('stage3');
    play({ type: 'bossEnter', kind: 'iron_claw' });
    expect(musicWanted()).toBe('finalboss');
    play({ type: 'playerDown', lives: 0 });
    play({ type: 'continuePrompt' });
    expect(musicWanted()).toBe('defeat');
    play({ type: 'respawn', x: 0 });
    expect(musicWanted()).toBe('finalboss');
    play({ type: 'bossDown', kind: 'iron_claw', t: 200 });
    play({ type: 'explode', big: true, from: 'scene', t: 202.5 });
    play({ type: 'missionComplete' });
    vi.advanceTimersByTime(8000);
    expect(musicWanted()).toBeNull();
  });
});
