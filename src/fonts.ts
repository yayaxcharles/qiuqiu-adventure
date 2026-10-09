/**
 * 遊戲字型（2026-10-09，使用者：「文字改用藝術一點的字體試試看」）。
 * 兩款開源繁中字型（SIL OFL 1.1），只留遊戲用得到的字（tools/make_fonts.py → public/fonts/*-sub.woff2）：
 *   wenkai  霞鶩文楷 TC：手寫楷書（預設；使用者 10-09 選定）
 *   huninn  jf 粉圓：圓潤可愛
 *   old     原本的系統字（微軟正黑體）
 * 網址 `?font=huninn`／`?font=old` 指定；遊戲中按 F9 輪流切換。
 * 字型檔是背景下載：下載好之前照舊用系統字，下載好的下一格就換掉（畫布每一格都重畫字，不用重新整理）。
 * `FONT` 是會變的匯出值：render.ts、game.ts 用 `${FONT}` 組字型字串時，讀到的永遠是目前這一款。
 */
export type FontKey = 'huninn' | 'wenkai' | 'old';
export const FONT_KEYS: readonly FontKey[] = ['wenkai', 'huninn', 'old'];
const SYS = '"Microsoft JhengHei", "Noto Sans TC", sans-serif';
const FAMILY: Record<Exclude<FontKey, 'old'>, string> = { huninn: 'QQ Huninn', wenkai: 'QQ WenKai' };
export const FONT_LABEL: Record<FontKey, string> = { huninn: '粉圓', wenkai: '文楷', old: '原本的字' };

export let FONT = SYS;
export let fontKey: FontKey = 'old';
const loaded = new Set<FontKey>(['old']);

/** 網址參數挑字型（沒指定＝霞鶩文楷） */
export function fontFromUrl(search: string): FontKey {
  const v = new URLSearchParams(search).get('font');
  return v === 'wenkai' || v === 'old' || v === 'huninn' ? v : 'wenkai';
}

/** 換字型：還沒下載過就先下載（失敗就留在原本的字），好了才換 */
export async function useFont(k: FontKey, base = '/'): Promise<void> {
  if (k !== 'old' && !loaded.has(k)) {
    try {
      const ff = new FontFace(FAMILY[k], `url(${base}fonts/${k}-sub.woff2)`);
      await ff.load();
      document.fonts.add(ff);
      loaded.add(k);
    } catch {
      return;
    }
  }
  fontKey = k;
  FONT = k === 'old' ? SYS : `"${FAMILY[k]}", ${SYS}`;
  document.documentElement.style.setProperty('--qq-font', FONT);
}

/** F9：換下一款 */
export function nextFont(k: FontKey): FontKey {
  return FONT_KEYS[(FONT_KEYS.indexOf(k) + 1) % FONT_KEYS.length]!;
}
