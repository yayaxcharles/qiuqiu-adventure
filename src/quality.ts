/**
 * 電腦版／手機版（09-27 使用者裁定：電腦版怪物維持每秒 24 格的完整動作，手機才用 12 格的跳格版）：
 *   觸控裝置（主要指標是手指）或螢幕短邊 < 500 → 手機版；網址 ?hq 強制電腦版、?lq 強制手機版（測試用）。
 *   手機版：怪物動作圖讀 sprites/monsters_m/（約每秒 12 格），圖載進來再縮成螢幕看得到的大小（TEX_Q）。
 *
 * 手機的圖要存多細（09-27 手機記憶體）：畫布固定 1280×720，但手機橫拿時整個畫布只有約 390 個 CSS 像素高（縮成 0.54 倍），
 * 圖存到「畫布原尺寸」其實有一大半細節螢幕根本顯示不出來。手機上怪物、球球、背景長卷、特效載進來時再縮成
 * 「螢幕真的看得到的大小 × 1.15」（常見手機約 0.62 倍，解碼後的記憶體剩 4 成），桌機照原尺寸。
 * 網址帶 ?q=0.7 可以強制指定（1＝原尺寸），檢查畫質用。
 */
import { isTouchDevice } from './touch';

function computeLow(): boolean {
  if (typeof window === 'undefined' || typeof location === 'undefined') return false;
  const p = new URLSearchParams(location.search);
  if (p.has('hq')) return false;
  if (p.has('lq')) return true;
  const sc = window.screen as Screen | undefined;
  const short = sc ? Math.min(sc.width, sc.height) : Math.min(window.innerWidth, window.innerHeight);
  return isTouchDevice() || short < 500;
}
/** 手機版（跳格的怪物動作圖＋縮小存圖） */
export const LOW = computeLow();
/** 怪物動作圖的資料夾：電腦版 sprites/monsters（每秒 24 格）、手機版 sprites/monsters_m（約 12 格） */
export const MON_DIR = LOW ? 'monsters_m' : 'monsters';

function computeQ(): number {
  if (typeof window === 'undefined' || typeof location === 'undefined') return 1;
  const forced = new URLSearchParams(location.search).get('q');
  if (forced !== null && Number.isFinite(Number(forced))) return Math.max(0.3, Math.min(1, Number(forced)));
  if (!LOW) return 1;
  const long = Math.max(window.innerWidth, window.innerHeight), short = Math.min(window.innerWidth, window.innerHeight);
  const css = Math.min(long / 1280, short / 720);
  return Math.max(0.5, Math.min(1, +(css * 1.15).toFixed(3)));
}

/** 圖要縮成幾倍存（1＝不縮） */
export const TEX_Q = computeQ();
