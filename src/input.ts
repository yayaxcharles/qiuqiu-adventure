/**
 * 鍵盤：按著的鍵＋這一格剛按下的鍵（`consume` 之後清掉）。
 * 方向鍵移動／瞄準（↑ 朝上丟、空中 ↓ 朝下丟、地上 ↓ 蹲）、空白鍵跳。
 * 2026-10-10 使用者：「變成有普通攻擊 J、特殊攻擊 K、大招 L」——J 手裏劍（近身自動揮爪）、K 救村貓拿到的特殊忍具、L 爆裂符這類大招。
 */
const held = new Set<string>();
const pressed = new Set<string>();
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F2', 'F5', 'F6', 'F7']);

export function attachInput(target: Window = window): void {
  target.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!held.has(e.code)) pressed.add(e.code);
    held.add(e.code);
  });
  target.addEventListener('keyup', (e) => { held.delete(e.code); });
  target.addEventListener('blur', () => { held.clear(); });
}

/** 觸控按鈕（touch.ts）按下／放開：跟鍵盤同一套（按下那一格算「剛按下」） */
export function virtualKey(code: string, down: boolean): void {
  if (down) { if (!held.has(code)) pressed.add(code); held.add(code); }
  else held.delete(code);
}

const any = (set: Set<string>, codes: readonly string[]): boolean => codes.some((c) => set.has(c));
export const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  walk: ['ShiftLeft', 'ShiftRight'], jump: ['Space'],
  attack: ['KeyJ'], special: ['KeyK'], sub: ['KeyL'], subSwitch: ['KeyQ'], dash: ['KeyI'],
  start: ['Enter', 'NumpadEnter'], pause: ['KeyP', 'Escape'], reset: ['KeyR'],
} as const;
/** 開發用：Digit1～9＝九種撿來的忍具、Digit0＝退回手裏劍；F5/F6/F7＝補爆裂符／焙烙玉／煙玉；F2＝無敵 */
const DIGITS = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

export interface Frame {
  left: boolean; right: boolean; up: boolean; down: boolean; walk: boolean;
  jumpHeld: boolean; jumpPressed: boolean;
  attackPressed: boolean; attackHeld: boolean;
  /** K：特殊攻擊（撿到的忍具；連發的按住就一直丟） */
  specialPressed: boolean; specialHeld: boolean;
  subPressed: boolean; subSwitchPressed: boolean;
  dashPressed: boolean;
  startPressed: boolean; pausePressed: boolean; reset: boolean;
  /** 開發用：換武器（0～9，-1＝沒按）、補副武器（0 爆裂符 1 焙烙玉 2 煙玉，-1＝沒按）、切換無敵 */
  devWeapon: number; devSub: number; devGod: boolean;
  /** 按了哪個數字鍵（0～9，沒按＝-1）：標題畫面選關用，一般遊玩不管 */
  digit: number;
}

export const NO_INPUT: Frame = {
  left: false, right: false, up: false, down: false, walk: false, jumpHeld: false, jumpPressed: false,
  attackPressed: false, attackHeld: false, specialPressed: false, specialHeld: false, subPressed: false, subSwitchPressed: false, dashPressed: false,
  startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, digit: -1,
};

/** 開發用按鍵（數字鍵換忍具、F5～F7 補副武器、F2 無敵）：網址帶 ?dev 才開（09-26 獨立審查 低 3） */
let devKeys = false;
export function setDevKeys(on: boolean): void { devKeys = on; }

/** 讀這一格的輸入，剛按下的只算一次 */
export function consume(): Frame {
  const f: Frame = {
    left: any(held, KEYS.left), right: any(held, KEYS.right), up: any(held, KEYS.up), down: any(held, KEYS.down), walk: any(held, KEYS.walk),
    jumpHeld: any(held, KEYS.jump), jumpPressed: any(pressed, KEYS.jump),
    attackPressed: any(pressed, KEYS.attack), attackHeld: any(held, KEYS.attack),
    specialPressed: any(pressed, KEYS.special), specialHeld: any(held, KEYS.special),
    subPressed: any(pressed, KEYS.sub), subSwitchPressed: any(pressed, KEYS.subSwitch),
    dashPressed: any(pressed, KEYS.dash),
    startPressed: any(pressed, KEYS.start), pausePressed: any(pressed, KEYS.pause), reset: any(pressed, KEYS.reset),
    devWeapon: devKeys ? DIGITS.findIndex((c) => pressed.has(c)) : -1,
    devSub: devKeys ? ['F5', 'F6', 'F7'].findIndex((c) => pressed.has(c)) : -1,
    devGod: devKeys && pressed.has('F2'),
    digit: DIGITS.findIndex((c) => pressed.has(c)),
  };
  pressed.clear();
  return f;
}

/** 同一格切成好幾小步時，第二步以後只留「按著」的鍵，剛按下的不重複算 */
export const heldOnly = (f: Frame): Frame => ({
  ...f, jumpPressed: false, attackPressed: false, subPressed: false, subSwitchPressed: false, dashPressed: false,
  startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, digit: -1,
});
