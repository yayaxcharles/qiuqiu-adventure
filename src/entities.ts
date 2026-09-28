/**
 * 遊戲裡各種東西的資料形狀（敵人、飛出去的忍具、敵人的子彈、可破壞的木箱、被綁的村貓、掉落物、特效粒子）。
 * 只有型別與小工具，不碰畫面；world.ts 管它們怎麼動，render.ts 管怎麼畫。
 */
import type { Platform } from './physics';
import type { Animator } from './sprite';
import type { SubId, WeaponId } from './weapons';

export const VIEW_W = 1280, VIEW_H = 720;
/** 平地的高度（地形的基準線，美術的地面帶也是照這條畫） */
export const GROUND = 596;
/** 畫面上方資訊欄（血量、分數、忍具、時間那排框）的下緣：預兆「！」、會飛的敵人出招都要在這條線以下（09-26 獨立審查 中 2） */
export const HUD_BOTTOM = 110;

export interface Box { x0: number; y0: number; x1: number; y1: number }
export const overlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export const boxAt = (x: number, bottom: number, w: number, h: number): Box => ({ x0: x - w / 2, y0: bottom - h, x1: x + w / 2, y1: bottom });

export type EnemyKind = 'rat' | 'orange_bandit' | 'black_ninja' | 'crow_small' | 'wild_boar' | 'tanuki_kid' | 'drum_tanuki' | 'orange_king' | 'dummy'
  // 第二關
  | 'lantern_ghost' | 'kasa_obake' | 'paper_crane' | 'kappa' | 'mask_dancer' | 'fox_miko' | 'tengu' | 'tadpole'
  | 'frog_daimyo' | 'tanuki_lord' | 'tanuki_clone'
  | 'vacuum' | 'mini_broom' | 'broom_centipede' | 'iron_arhat' | 'armor_ghost' | 'plated_beetle' | 'wraith_samurai' | 'guardian_statue'
  | 'roomba_king' | 'iron_claw';
/** 立繪的五個姿勢（爪破魔塔每隻都有） */
export type Pose = 'idle' | 'attack' | 'hurt' | 'block' | 'down';
/** 還沒發現球球之前在做什麼（越南大戰的敵人不是站著等你） */
export type Activity = 'none' | 'camp' | 'carry' | 'sleep' | 'patrol' | 'chat' | 'graze';

export type DropKind = WeaponId | SubId | 'fish' | 'onigiri';

export interface Bubble { text: string; t: number; life: number }

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number; y: number; vx: number; vy: number;
  /** 1＝朝右、-1＝朝左（立繪都是朝左畫的） */
  facing: 1 | -1;
  hp: number; maxHp: number;
  /** 目前在做什麼、做了幾秒 */
  state: string; t: number;
  pose: Pose;
  /** 魔王第二階段（換 _p2 立繪） */
  p2: boolean;
  aware: boolean;
  act: Activity;
  onGround: boolean;
  /** 站在哪塊平台上（沒有＝站在地形上） */
  plat: Platform | null;
  /** 被打閃白（魔王閃紅） */
  flash: number;
  /** 出招預兆：閃爍＋頭上「！」 */
  warn: number;
  bubble: Bubble | null;
  /** 程式做動感用：往前衝的距離、傾斜、壓扁、旋轉 */
  lunge: number; lean: number; squash: number; rot: number; spin: number;
  stun: number;
  /** 死了正在彈飛（秒） */
  dying: number;
  /** 可以從清單移除了 */
  dead: boolean;
  /** 這一刻會打到球球的範圍（出招時才有） */
  harm: Box | null;
  /** 身體碰到會痛（衝鋒、俯衝、魔王） */
  bodyHarm: boolean;
  /** 出怪表第幾筆（鎖畫面用；-1＝不屬於任何一波） */
  group: number;
  /** 延燒、中毒還剩幾秒；dotT＝下一跳傷害倒數 */
  burn: number; poison: number; dotT: number;
  /** 穿透的忍具：這一發（id）多久後才能再打同一隻 */
  hitCd: Map<number, number>;
  /** 各種怪自己的暫存數字 */
  mem: Record<string, number>;
  boss: boolean;
  invuln: number;
  /** 已經嚇到逃過一次（只逃一次） */
  fled: boolean;
  /** 可以打爛的部位（橘皮大王的魚乾背包） */
  part: { hp: number; maxHp: number; broken: boolean; flash: number } | null;
  /** 出場後的時間（呼吸、走路擺動用） */
  life: number;
  /** 逐格動畫（有這隻怪的動作圖才有）；animOn＝這一格有在用（沒有就畫單張立繪） */
  anim: Animator | null;
  animOn: boolean;
  /** 上一格的狀態、再上一個狀態（接招收尾的動作用：肚皮壓完、滾完各有各的收尾） */
  lastState: string;
  prevState: string;
}

export type ShotKind = 'shuriken' | 'bo' | 'fuma' | 'flame' | 'caltrop' | 'chain' | 'crane' | 'mouse' | 'yarn' | 'dart';

/** 球球丟出去的東西 */
export interface Shot {
  id: number;
  kind: ShotKind;
  x: number; y: number; vx: number; vy: number;
  /** 旋轉角度與轉速（畫手裏劍旋轉） */
  rot: number; spin: number;
  age: number; life: number;
  dmg: number;
  /** 打中判定半徑 */
  r: number;
  /** 穿透：打中不消失（同一隻隔 rehit 秒才能再打） */
  pierce: boolean;
  rehit: number;
  /** 各種飛法自己的狀態（風魔：0 去 1 回；撒菱：1＝落地了；鎖鎌：伸出長度…） */
  phase: number;
  /** 被吸塵機器、掃地機王吸住了（飛向吸口，這一路上不會打到東西） */
  sucked?: boolean;
  target: Enemy | null;
  bounces: number;
  /** 往上、往下丟的（畫的時候轉方向） */
  aim: Aim;
  facing: 1 | -1;
}
export type Aim = 'fwd' | 'up' | 'down' | 'low';

export type BulletKind = 'kunai' | 'bone' | 'wave' | 'blast' | 'spark'
  // 第二關：燈籠鬼的火球、河童的水彈、面具舞者會飛回來的扇子、白狐巫女會追人的狐火、狸大人的葉子手裏劍、
  // 蛙大名跳下來濺起的水花、鼓頰吹出來的泡泡、天狗的風（不傷人，把球球往後吹）
  | 'fireball' | 'water' | 'fan' | 'foxfire' | 'leaf' | 'splash' | 'bubble' | 'gust'
  /** 第三關：甲蟲砲台的光彈、掃地機王的垃圾彈（拋物線、落地小爆炸）、鐵爪的飛彈（從天上掉、落地爆炸） */
  | 'pellet' | 'garbage' | 'missile';
/** 敵人的子彈、震波（一律看得很清楚：有光暈） */
export interface Bullet {
  id: number;
  kind: BulletKind;
  x: number; y: number; vx: number; vy: number;
  /** 重力（拋物線） */
  g: number;
  w: number; h: number;
  rot: number; spin: number;
  age: number; life: number;
  /** 貼著地形跑（震波） */
  ground: boolean;
  /** 扇子：丟出去的人（飛到底會轉回去找他） */
  owner?: Enemy | null;
  /** 追著球球轉彎（每秒最多轉幾弧度） */
  homing?: number;
  /** 打得掉（被忍具打中幾下就散掉） */
  hp?: number;
  /** 風：不傷人，每秒把球球往 vx 的方向推這麼多 */
  push?: number;
}

/** 副武器（爆裂符、焙烙玉、煙玉）飛行中 */
export interface Bomb { id: number; kind: SubId; x: number; y: number; vx: number; vy: number; rot: number; age: number }

export interface Explosion {
  x: number; y: number; r: number;
  age: number; life: number;
  dmg: number;
  /** 傷害只算一次 */
  dealt: boolean;
  /** 誰炸的：球球的炸敵人、敵人的炸球球、場景的兩邊都炸 */
  from: 'player' | 'enemy' | 'scene';
  /** 魔王倒下的那一炸（畫大爆炸；其他爆炸再大都用中爆炸） */
  boss?: boolean;
}

export type BreakKind = 'crate' | 'barrel' | 'powder' | 'cage' | 'tower' | 'gate' | 'stall'
  /** 第二關（terrain.json 第二批）：燈籠攤、祭典木箱、酒樽堆、石燈籠、賽錢箱、木看板 */
  | 's2_lantern_stall' | 's2_crate' | 's2_sake_stack' | 's2_stone_lantern' | 's2_offering_box' | 's2_signboard'
  /** 第三關：油桶（打爛會小爆炸）、齒輪箱、機關城木箱、蒸氣管段、機關城城門（石獅守著，石獅打爛才打得動） */
  | 's3_oil_drum' | 's3_gearbox' | 's3_crate' | 's3_steam_pipe' | 's3_gate';

/** 擋路、打爛才過得去的門（第一關寨門、第三關機關城城門） */
export const isGate = (k: BreakKind): boolean => k === 'gate' || k === 's3_gate';
export interface Breakable {
  /** 城門封印的提示上次跳出來的時間 */
  sealPop?: number;
  id: number;
  kind: BreakKind;
  x: number; y: number;
  w: number; h: number;
  hp: number; maxHp: number;
  flash: number; shake: number;
  broken: boolean;
  /** 垮下來的進度（瞭望台、寨門：0～1） */
  fall: number;
  drop?: DropKind;
  /** 竹籠裡關著的村貓 */
  captive: Captive | null;
  /** 瞭望台頂端可以站的平台 */
  top: Platform | null;
  /** 穿透的忍具：這一發（id）多久後才能再打 */
  hitCd: Map<number, number>;
}

/** 被綁的村貓花色：前三種是 art.json 的，後六種是第三批美術（fx2.json npc_*），每關不重複 */
export type CaptiveArt = 'calico' | 'grey' | 'tuxedo' | 'orange_white' | 'black' | 'white' | 'siamese' | 'grey_tabby' | 'calico_long';
export interface Captive {
  id: number;
  x: number; y: number;
  art: CaptiveArt;
  drop: DropKind;
  /** tied＝綁著、thank＝道謝鞠躬、give＝掏出道具丟給你、run＝開心跑走、gone＝跑出畫面了 */
  state: 'tied' | 'thank' | 'give' | 'run' | 'gone';
  t: number;
  caged: boolean;
  vx: number; vy: number;
  onGround: boolean;
}

export interface Pickup { id: number; kind: DropKind; x: number; y: number; vx: number; vy: number; age: number; onGround: boolean; taken: boolean }

/** hit＝打中火花（sprite 寫用 fx2 的哪一張：hit_claw／hit_shuriken／hit_blunt） */
export type ParticleKind = 'puff' | 'spark' | 'debris' | 'smoke' | 'ember' | 'fire' | 'drop' | 'star' | 'fish' | 'hit';
export interface Particle {
  kind: ParticleKind;
  x: number; y: number; vx: number; vy: number;
  g: number;
  age: number; life: number;
  r: number;
  rot: number; spin: number;
  color: string;
  /** 在最前面畫（蓋過角色） */
  front?: boolean;
  /** 用 terrain.json 的哪張碎片圖（debris_plank…）；沒有就畫色塊 */
  sprite?: string;
  /** 圖水平翻轉（打中火花照打的方向） */
  flip?: boolean;
}

/** 留在地上的東西（橘皮大王炸爛的竹簍） */
export interface Decal { key: string; x: number; y: number; flip: boolean }

/** 跳出來的數字、分數 */
export interface Pop { x: number; y: number; text: string; age: number; color: string; size: number }

/** 畫面大字（任務開始、撿到武器、魔王出場） */
export interface Banner { text: string; sub: string; age: number; life: number; style: 'mission' | 'weapon' | 'boss' | 'warn' | 'hint' }

/** 給音效、截圖、自動檢查用的事件 */
export interface GameEvent { type: string; [k: string]: unknown }

/** 地上的洞（鼠兵從地洞冒出來） */
export interface Hole { x: number; y: number; age: number; life: number }
