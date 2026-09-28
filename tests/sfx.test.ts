/**
 * 音效與配樂（src/sfx.ts、src/audio/）：每個音效名稱都有合成定義、長度合理；
 * 沒有 AudioContext（Node）時 play 不報錯；同一瞬間一大堆同樣的事件會被節流；配樂樂譜都解析得了、長度是整小節。
 */
import { describe, expect, it } from 'vitest';
import { compilePart, loopSteps, TRACKS } from '../src/audio/music';
import { SFX_DEFS } from '../src/audio/sfxDefs';
import { sfxDuration } from '../src/audio/synth';
import { Throttle } from '../src/audio/throttle';
import { BGM, bgmGain } from '../src/audio/bgm';
import { ALL_SFX_NAMES, bossMusicFor, play, resolveSfx, SFX_MAP, sfxStats, trackForStage, WEAPON_SFX } from '../src/sfx';

describe('音效定義', () => {
  it('SFX_MAP 與所有變體的名稱都有合成定義', () => {
    for (const n of Object.values(SFX_MAP)) expect(SFX_DEFS[n], n).toBeDefined();
    for (const n of ALL_SFX_NAMES) expect(SFX_DEFS[n], n).toBeDefined();
  });

  it('每個音效長度合理（0.03～2.5 秒），每一層的起音＋維持不超過長度', () => {
    for (const [n, d] of Object.entries(SFX_DEFS)) {
      const len = sfxDuration(d);
      expect(len, n).toBeGreaterThanOrEqual(0.03);
      expect(len, n).toBeLessThanOrEqual(2.5);
      for (const l of d.layers) {
        expect(l.dur, n).toBeGreaterThan(0);
        expect((l.a ?? 0) + (l.hold ?? 0), n).toBeLessThanOrEqual(l.dur);
        expect(l.gain, n).toBeLessThanOrEqual(1);
      }
    }
  });

  it('十種忍具各有不同的丟出聲；爆炸、撿東西、打爛東西有變體', () => {
    const names = Object.keys(WEAPON_SFX).map((w) => resolveSfx({ type: 'fire', weapon: w }));
    expect(new Set(names).size).toBe(10);
    expect(resolveSfx({ type: 'explode', big: true })).toBe('explosion_big');
    expect(resolveSfx({ type: 'explode', big: false })).toBe('explosion');
    expect(resolveSfx({ type: 'pickup', kind: 'fish' })).toBe('pickup');
    expect(resolveSfx({ type: 'pickup', kind: 'H' })).toBe('pickup_weapon');
    expect(resolveSfx({ type: 'break', kind: 'crate' })).toBe('break');
    expect(resolveSfx({ type: 'break', kind: 'barrel' })).toBe('break_barrel');
    expect(resolveSfx({ type: 'break', kind: 'gate' })).toBe('break_big');
    expect(resolveSfx({ type: 'enemyAttack', move: '地面震波' })).toBe('enemy_slam');
    expect(resolveSfx({ type: 'enemyAttack', move: '揮木棒' })).toBe('enemy_attack');
    expect(resolveSfx({ type: 'zone' })).toBeNull();
  });

  it('遊戲後來加的事件都有聲音（打中、擋掉、時間到、提示、封印、分裂、新掉落物、第三關招式）', () => {
    expect(resolveSfx({ type: 'hit', kind: 'rat' })).toBe('hit');
    expect(resolveSfx({ type: 'blocked', kind: 'iron_arhat' })).toBe('block_clang');
    expect(resolveSfx({ type: 'timeUp' })).toBe('time_up');
    expect(resolveSfx({ type: 'hint', i: 0 })).toBe('hint');
    expect(resolveSfx({ type: 'sealed' })).toBe('deflect');
    expect(resolveSfx({ type: 'split', kind: 'x' })).toBe('enemy_water');
    expect(resolveSfx({ type: 'thorns' })).toBe('thorns');
    for (const k of ['I', 'D', 'B', 'bigbomb', 'smoke']) expect(resolveSfx({ type: 'pickup', kind: k })).toBe('pickup_weapon');
    const mv = (move: string): string | null => resolveSfx({ type: 'enemyAttack', move });
    expect(mv('吸手裏劍')).toBe('enemy_wind');
    expect(mv('暴走衝撞')).toBe('enemy_charge');
    expect(mv('背後飛彈')).toBe('enemy_fire');
    expect(mv('放出小掃把')).toBe('enemy_summon');
    expect(mv('吐回來')).toBe('enemy_throw');
  });
});

describe('沒有 AudioContext 時', () => {
  it('每種事件丟進 play 都不報錯（含配樂的換歌事件）', () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe('undefined');
    const evs = [
      { type: 'missionStart', stage: 'stage2' }, { type: 'bossEnter', kind: 'orange_king' }, { type: 'bossPhase' },
      { type: 'bossDown' }, { type: 'explode', big: true, from: 'scene' }, { type: 'missionComplete' }, { type: 'result' },
      { type: 'playerDown', lives: 0 }, { type: 'continuePrompt' }, { type: 'respawn', x: 0 },
      ...Object.keys(SFX_MAP).map((type) => ({ type })),
      ...Object.keys(WEAPON_SFX).map((weapon) => ({ type: 'fire', weapon })),
      { type: 'somethingUnknown' },
    ];
    for (const ev of evs) expect(() => play(ev)).not.toThrow();
  });
});

describe('節流', () => {
  it('同一瞬間連丟 30 發棒手裏劍，只算一次', async () => {
    await new Promise((r) => setTimeout(r, 150));   // 前一個測試也丟過，先等它的間隔過去
    const before = { ...sfxStats };
    for (let i = 0; i < 30; i++) play({ type: 'fire', weapon: 'H' });
    expect(sfxStats.played - before.played).toBe(1);
    expect(sfxStats.throttled - before.throttled).toBe(29);
  });

  it('同名同時最多 max 個；響完了才能再開；整體上限只擋不重要的', () => {
    const t = new Throttle(4);
    // 每 0.1 秒來一個、每個響 1 秒、最多同時 2 個
    const ok = [0, 0.1, 0.2, 0.3].map((now) => t.allow('boom', now, now + 1, 2, 0.05));
    expect(ok).toEqual([true, true, false, false]);
    expect(t.allow('boom', 1.05, 2.05, 2, 0.05)).toBe(true);   // 第一個響完了
    // 間隔太近：擋
    expect(t.allow('tick', 5, 5.1, 3, 0.05)).toBe(true);
    expect(t.allow('tick', 5.02, 5.12, 3, 0.05)).toBe(false);
    // 整體上限 4：塞滿之後，不重要的擋、重要的照響
    const u = new Throttle(4);
    for (let i = 0; i < 4; i++) expect(u.allow(`s${i}`, 0, 1)).toBe(true);
    expect(u.allow('s9', 0, 1)).toBe(false);
    expect(u.allow('fanfare', 0, 1, 1, 1, true)).toBe(true);
  });
});

describe('配樂', () => {
  it('每首歌每個聲部都解析得了，而且都是整小節（16 格的倍數）', () => {
    for (const t of Object.values(TRACKS)) {
      for (const p of t.parts) {
        const c = compilePart(p, t);
        expect(c.len % 16, `${t.id} ${p.inst}`).toBe(0);
        expect(c.notes.size, `${t.id} ${p.inst}`).toBeGreaterThan(0);
      }
      expect(loopSteps(t)).toBeGreaterThanOrEqual(16);
    }
  });

  it('從事件的關卡代號選歌；看不懂的用第一關', () => {
    expect(trackForStage('stage1')).toBe('stage1');
    expect(trackForStage('stage2')).toBe('stage2');
    expect(trackForStage('stage3')).toBe('stage3');
    expect(trackForStage('practice')).toBe('stage1');
    expect(trackForStage(undefined)).toBe('stage1');
    expect(trackForStage('stage9')).toBe('stage1');
  });

  it('魔王配樂：中魔王＝elite、第一二關魔王＝boss、最後一關的最終魔王＝finalboss', () => {
    for (const k of ['drum_tanuki', 'frog_daimyo', 'roomba_king']) expect(bossMusicFor(k), k).toBe('elite');
    expect(bossMusicFor('orange_king')).toBe('boss');
    expect(bossMusicFor('tanuki_lord')).toBe('boss');
    expect(bossMusicFor('iron_claw')).toBe('finalboss');
    expect(bossMusicFor('not_a_boss')).toBe('boss');
  });

  it('每個配樂代號都有檔案在 public/bgm/、響度有量過、增益合理；合成退路的曲子都存在', () => {
    const files = Object.keys(import.meta.glob('../public/bgm/*.mp3')).map((f) => f.replace(/^.*\//, '').replace(/\.mp3$/, ''));
    for (const [id, d] of Object.entries(BGM)) {
      expect(files, id).toContain(d.file);
      expect(d.lufs, id).toBeLessThan(-5);
      expect(d.lufs, id).toBeGreaterThan(-30);
      expect(bgmGain(id), id).toBeGreaterThan(0.3);
      expect(bgmGain(id), id).toBeLessThan(3);
      if (d.synth) expect(TRACKS[d.synth], id).toBeDefined();
    }
    for (const id of ['title', 'stage1', 'stage2', 'stage3', 'elite', 'boss', 'finalboss', 'ending', 'defeat']) expect(BGM[id], id).toBeDefined();
  });
});
