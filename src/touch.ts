/**
 * 手機觸控（09-27 使用者：「推上 git 讓我也能夠用手機玩」）。只在觸控裝置出現。
 *   左邊：方向盤（左右移動、上＝朝上丟、下＝蹲；手指在盤上滑就換方向，斜上也行）
 *   右邊：跳（最大）、攻擊、爆裂符、換副武器；右上：暫停、全螢幕
 *   其他畫面（標題、接關、結算、結局、遊戲結束）：點畫面＝按 Enter
 * 每個按鈕各自追蹤自己的手指（pointer id），多指同時按（邊跑邊跳邊丟）互不干擾。
 * 按鈕送的是跟鍵盤一樣的鍵（input.ts 的 virtualKey），遊戲那邊不用分鍵盤還是觸控。
 */
import { virtualKey } from './input';

/** 手機、平板（主要的指標是手指）；有觸控螢幕的筆電主要還是滑鼠，不出現按鈕 */
export const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const mq = (q: string): boolean => !!window.matchMedia?.(q).matches;
  if (mq('(pointer: coarse)')) return true;
  return (('ontouchstart' in window) || (navigator.maxTouchPoints ?? 0) > 0) && !mq('(pointer: fine)');
};

const CSS = `
#tc { position: fixed; inset: 0; pointer-events: none; z-index: 10; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
#tc .b { position: absolute; pointer-events: auto; touch-action: none; border-radius: 50%; display: grid; place-items: center;
  background: rgba(20,12,28,.38); border: 2px solid rgba(255,235,200,.55); color: rgba(255,244,220,.92);
  font: 900 calc(var(--u) * .34) "Microsoft JhengHei", "Noto Sans TC", sans-serif; text-shadow: 0 1px 3px #000; box-sizing: border-box; }
#tc .b.on { background: rgba(255,210,58,.45); border-color: rgba(255,240,180,.95); }
#tc .b small { display: block; font-size: calc(var(--u) * .16); font-weight: 700; opacity: .85; margin-top: calc(var(--u) * -.06); }
#tc #dpad { border-radius: 50%; }
#tc #dpad i { position: absolute; font-style: normal; font-size: calc(var(--u) * .3); opacity: .8; }
#tc .sq { border-radius: 22%; }
#rot { position: fixed; inset: 0; z-index: 20; display: none; place-items: center; background: #16121c; color: #f3e9d8; text-align: center;
  font: 700 22px "Microsoft JhengHei", "Noto Sans TC", sans-serif; }
#rot b { display: block; font-size: 64px; margin-bottom: 12px; }
`;

/**
 * 裝上觸控按鈕。screen()＝現在是哪個畫面（play 以外點畫面＝Enter）
 */
export function attachTouch(canvas: HTMLCanvasElement, screen: () => string): void {
  if (!isTouchDevice()) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'tc';
  document.body.appendChild(root);

  // 按鈕大小：跟螢幕高度走（橫向手機約 390 高 → 單位約 70 像素，適合拇指）
  const layout = (): void => {
    const u = Math.max(52, Math.min(96, Math.min(window.innerWidth, window.innerHeight) * 0.18));
    root.style.setProperty('--u', `${u}px`);
    const pad = Math.max(12, u * 0.25);
    place(dpad, pad, null, null, pad, u * 2.3, u * 2.3);
    place(jump, null, pad, null, pad, u * 1.25, u * 1.25);
    place(attack, null, pad + u * 1.45, null, pad + u * 0.35, u * 1.1, u * 1.1);
    place(bomb, null, pad + u * 0.1, null, pad + u * 1.45, u * 0.9, u * 0.9);
    place(swap, null, pad + u * 2.65, null, pad + u * 0.2, u * 0.72, u * 0.72);
    // 暫停、全螢幕疊在右上角（畫面左右有黑邊時剛好在黑邊裡，不擋資訊欄）
    place(pause, null, pad, pad, null, u * 0.7, u * 0.7);
    place(full, null, pad, pad + u * 0.85, null, u * 0.7, u * 0.7);
  };
  const place = (el: HTMLElement, left: number | null, right: number | null, top: number | null, bottom: number | null, w: number, h: number): void => {
    el.style.left = left === null ? '' : `${left}px`; el.style.right = right === null ? '' : `${right}px`;
    el.style.top = top === null ? '' : `${top}px`; el.style.bottom = bottom === null ? '' : `${bottom}px`;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
  };

  // 一顆按鈕：按下送 keydown、放開（或手指滑出去、被系統取消）送 keyup
  const button = (html: string, code: string, cls = ''): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = `b ${cls}`;
    el.innerHTML = html;
    root.appendChild(el);
    const ids = new Set<number>();
    const up = (e: PointerEvent): void => {
      if (!ids.delete(e.pointerId)) return;
      if (!ids.size) { virtualKey(code, false); el.classList.remove('on'); }
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      if (!ids.size) { virtualKey(code, true); el.classList.add('on'); }
      ids.add(e.pointerId);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return el;
  };

  // 方向盤：手指在盤上的位置決定方向（中間一小圈不算），可以斜著按（右上＝往右跑＋朝上丟）
  const dpad = document.createElement('div');
  dpad.className = 'b';
  dpad.id = 'dpad';
  dpad.innerHTML = '<i style="left:8%;top:40%">◀</i><i style="right:8%;top:40%">▶</i><i style="top:6%;left:42%">▲</i><i style="bottom:6%;left:42%">▼</i>';
  root.appendChild(dpad);
  const dirKeys = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' } as const;
  const dirOn: Record<keyof typeof dirKeys, boolean> = { left: false, right: false, up: false, down: false };
  let dpadId: number | null = null;
  const setDir = (want: Record<keyof typeof dirKeys, boolean>): void => {
    for (const k of Object.keys(dirKeys) as (keyof typeof dirKeys)[]) {
      if (want[k] !== dirOn[k]) { virtualKey(dirKeys[k], want[k]); dirOn[k] = want[k]; }
    }
    dpad.classList.toggle('on', want.left || want.right || want.up || want.down);
  };
  const aim = (e: PointerEvent): void => {
    const r = dpad.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const dead = 0.22;
    setDir({ left: dx < -dead, right: dx > dead, up: dy < -0.5, down: dy > 0.5 });
  };
  dpad.addEventListener('pointerdown', (e) => { e.preventDefault(); if (dpadId !== null) return; dpadId = e.pointerId; dpad.setPointerCapture?.(e.pointerId); aim(e); });
  dpad.addEventListener('pointermove', (e) => { if (e.pointerId === dpadId) aim(e); });
  const dpadUp = (e: PointerEvent): void => { if (e.pointerId !== dpadId) return; dpadId = null; setDir({ left: false, right: false, up: false, down: false }); };
  dpad.addEventListener('pointerup', dpadUp);
  dpad.addEventListener('pointercancel', dpadUp);
  dpad.addEventListener('lostpointercapture', dpadUp);

  const jump = button('跳', 'Space');
  const attack = button('攻<small>揮爪／丟</small>', 'KeyJ');
  const bomb = button('符<small>爆裂符</small>', 'KeyL');
  const swap = button('換', 'KeyQ');
  const pause = button('❚❚', 'KeyP', 'sq');
  const full = document.createElement('div');
  full.className = 'b sq';
  full.textContent = '⛶';
  root.appendChild(full);
  full.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || d.webkitFullscreenElement) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else {
      const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
      void Promise.resolve(p).then(() => (window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape')).catch(() => {});
    }
  });

  // 戰鬥中的按鈕只在 play、pause 顯示；其他畫面點畫面＝Enter
  const fightOnly = [dpad, jump, attack, bomb, swap];
  const sync = (): void => {
    const s = screen();
    const fight = s === 'play' || s === 'pause';
    for (const el of fightOnly) el.style.display = fight || s === 'title' ? '' : 'none';   // 標題也留方向盤：← → 選關
    for (const el of [jump, attack, bomb, swap]) if (s === 'title') el.style.display = 'none';
    pause.style.display = fight ? '' : 'none';
  };
  setInterval(sync, 150);
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const s = screen();
    if (s !== 'play' && s !== 'pause' && s !== 'loading') { virtualKey('Enter', true); setTimeout(() => virtualKey('Enter', false), 60); }
  });

  // 第一次觸控解鎖音效：音效那邊聽 keydown／pointerdown，但手機要在 touchend 裡才准開聲音 → 在 touchend 裡補一個假的 keydown
  const unlock = (): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F24' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'F24' }));
  };
  window.addEventListener('touchend', unlock, { passive: true });

  // 擋掉雙指縮放、捲動、長按選單、雙擊放大
  const stop = (e: Event): void => { e.preventDefault(); };
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('gesturestart', stop as EventListener);
  document.addEventListener('contextmenu', stop);
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 350) e.preventDefault(); lastTouchEnd = now; }, { passive: false });
  document.body.style.touchAction = 'none';
  canvas.style.touchAction = 'none';

  // 直向：提示轉成橫向
  const rot = document.createElement('div');
  rot.id = 'rot';
  rot.innerHTML = '<div><b>⟳</b>請把手機轉成橫向</div>';
  document.body.appendChild(rot);
  const orient = (): void => { rot.style.display = window.innerHeight > window.innerWidth ? 'grid' : 'none'; layout(); };
  window.addEventListener('resize', orient);
  window.addEventListener('orientationchange', orient);
  orient();
  sync();
}
