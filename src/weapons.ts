/**
 * 忍具（武器第二版，2026-09-26 使用者：「槍變成球球扔出手裏劍」「多做一點不同的忍具取代不同槍枝效果」）。
 * 全部由球球用「丟」的動作發射；一種忍具對一種越南大戰的槍。這裡只有數字與彈數規則（純資料、不碰畫面，測試直接餵），
 * 飛出去之後怎麼飛、怎麼打，在 world.ts 的 fireWeapon／updateShots。
 */
export type WeaponId = 'shuriken' | 'H' | 'R' | 'F' | 'S' | 'L' | 'C' | 'I' | 'D' | 'B';
export type SubId = 'bomb' | 'bigbomb' | 'smoke';

export interface WeaponDef {
  id: WeaponId;
  /** 撿到時畫面大字喊的名字 */
  name: string;
  /** 越南大戰對應的槍（說明用） */
  like: string;
  /** 撿一次給幾發（手裏劍無限） */
  ammo: number;
  /** 按住連發 */
  auto: boolean;
  /** 兩發之間至少隔幾秒 */
  cooldown: number;
  /** 每發（或每一下）打多少 */
  dmg: number;
  /** 圖示（art.json 的 key），沒有就用程式畫 */
  icon: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  shuriken: { id: 'shuriken', name: '手裏劍', like: '手槍', ammo: Infinity, auto: false, cooldown: 0.13, dmg: 10, icon: 'shuriken' },
  H: { id: 'H', name: '棒手裏劍連射！', like: '重機槍', ammo: 200, auto: true, cooldown: 1 / 13, dmg: 7, icon: 'weapon_H' },
  R: { id: 'R', name: '風魔大手裏劍！', like: '火箭', ammo: 20, auto: false, cooldown: 0.45, dmg: 24, icon: 'weapon_R' },
  F: { id: 'F', name: '火藥竹筒！', like: '火焰槍', ammo: 30, auto: true, cooldown: 0.42, dmg: 7, icon: 'weapon_F' },
  S: { id: 'S', name: '撒菱！', like: '散彈', ammo: 30, auto: false, cooldown: 0.3, dmg: 13, icon: 'weapon_S' },
  L: { id: 'L', name: '鎖鎌！', like: '雷射', ammo: 30, auto: false, cooldown: 0.4, dmg: 24, icon: 'weapon_L' },
  C: { id: 'C', name: '式神紙鶴！', like: '追蹤彈', ammo: 40, auto: true, cooldown: 0.22, dmg: 16, icon: 'weapon_C' },
  I: { id: 'I', name: '鼠火！', like: '地面爬行彈', ammo: 20, auto: false, cooldown: 0.35, dmg: 36, icon: 'weapon_I' },
  D: { id: 'D', name: '毛球彈！', like: '彈跳彈', ammo: 40, auto: true, cooldown: 0.2, dmg: 12, icon: 'weapon_D' },
  B: { id: 'B', name: '吹箭！', like: '（新增）', ammo: 30, auto: false, cooldown: 0.2, dmg: 9, icon: 'weapon_B' },
};

export interface SubDef { id: SubId; name: string; start: number; pickup: number; icon: string }
export const SUBS: Record<SubId, SubDef> = {
  bomb: { id: 'bomb', name: '爆裂符', start: 10, pickup: 10, icon: 'weapon_bomb' },
  bigbomb: { id: 'bigbomb', name: '焙烙玉！', start: 0, pickup: 3, icon: 'weapon_bigbomb' },
  smoke: { id: 'smoke', name: '煙玉！', start: 0, pickup: 3, icon: 'weapon_smoke' },
};
export const SUB_ORDER: readonly SubId[] = ['bomb', 'bigbomb', 'smoke'];

/** 開發用數字鍵：1～9 換主武器，0 退回手裏劍 */
export const DEV_WEAPON_KEYS: readonly WeaponId[] = ['shuriken', 'H', 'R', 'F', 'S', 'L', 'C', 'I', 'D', 'B'];

/** 身上的忍具與彈數（越南大戰規則：撿到的武器限量，用完退回手裏劍；副武器各自算數量） */
export class Arsenal {
  weapon: WeaponId = 'shuriken';
  ammo = Infinity;
  subs: Record<SubId, number> = { bomb: SUBS.bomb.start, bigbomb: SUBS.bigbomb.start, smoke: SUBS.smoke.start };
  sub: SubId = 'bomb';

  get def(): WeaponDef { return WEAPONS[this.weapon]; }

  /** 撿到主武器：同一種就加彈數，不同種就換過去（越南大戰也是換掉） */
  pick(id: WeaponId): void {
    if (id === 'shuriken') { this.weapon = 'shuriken'; this.ammo = Infinity; return; }
    if (this.weapon === id) this.ammo += WEAPONS[id].ammo;
    else { this.weapon = id; this.ammo = WEAPONS[id].ammo; }
  }

  /** 丟一發：扣彈數，最後一發丟完就退回手裏劍。回傳這一發是哪種忍具 */
  use(): WeaponId {
    const w = this.weapon;
    if (w === 'shuriken') return w;
    this.ammo -= 1;
    if (this.ammo <= 0) { this.weapon = 'shuriken'; this.ammo = Infinity; }
    return w;
  }

  pickSub(id: SubId): void {
    this.subs[id] += SUBS[id].pickup;
    if (id !== 'bomb') this.sub = id;   // 撿到特殊副武器就先拿著它
  }

  /** 丟副武器：用目前選的；沒了就換下一種有數量的。都沒有回傳 null */
  useSub(): SubId | null {
    if (this.subs[this.sub] <= 0) this.cycleSub();
    const s = this.sub;
    if (this.subs[s] <= 0) return null;
    this.subs[s] -= 1;
    if (this.subs[s] <= 0) this.cycleSub();
    return s;
  }

  /** 換下一種還有數量的副武器（Q 鍵） */
  cycleSub(): void {
    const i = SUB_ORDER.indexOf(this.sub);
    for (let k = 1; k <= SUB_ORDER.length; k++) {
      const s = SUB_ORDER[(i + k) % SUB_ORDER.length]!;
      if (this.subs[s] > 0) { this.sub = s; return; }
    }
  }
}
