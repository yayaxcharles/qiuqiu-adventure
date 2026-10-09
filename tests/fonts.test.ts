import { describe, expect, it } from 'vitest';
import { fontFromUrl, FONT_KEYS, nextFont } from '../src/fonts';

// 不用 node:fs（tsc 沒有裝 node 型別）：照 voice.test.ts 的做法用 import.meta.glob 讀檔
const SRC = import.meta.glob('../src/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FONTS = Object.keys(import.meta.glob('../public/fonts/*')).map((f) => f.slice(f.lastIndexOf('/') + 1));

describe('遊戲字型 fonts.ts（10-09）', () => {
  it('沒指定＝霞鶩文楷；?font= 可換粉圓、原本的字；亂寫的退回文楷', () => {
    expect(fontFromUrl('')).toBe('wenkai');
    expect(fontFromUrl('?font=huninn')).toBe('huninn');
    expect(fontFromUrl('?font=old&pick=2')).toBe('old');
    expect(fontFromUrl('?font=comic')).toBe('wenkai');
  });
  it('F9 依序輪流', () => {
    expect(FONT_KEYS.map((k) => nextFont(k))).toEqual(['huninn', 'old', 'wenkai']);
  });
  it('字型檔與授權說明都在 public/fonts', () => {
    for (const f of ['wenkai-sub.woff2', 'huninn-sub.woff2', '字型授權.txt']) expect(FONTS, f).toContain(f);
  });
  it('狀態列、遊戲畫面、觸控按鈕都吃同一個字型設定（不再各自寫死微軟正黑體）', () => {
    for (const f of ['../src/render.ts', '../src/game.ts']) expect(SRC[f], f).toContain("import { FONT } from './fonts'");
    expect(SRC['../src/touch.ts']).toContain('var(--qq-font');
  });
});
