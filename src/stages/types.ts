/**
 * 關卡資料格式：一關＝一個檔（stage1.ts、stage2.ts…），照這個格式寫就能玩，不用改遊戲程式。
 *
 * 座標：x＝世界座標（從關卡最左邊算起，像素），y＝畫面座標（往下為正，平地在 596）。
 * 「鏡頭 x」＝畫面左緣在世界的位置；畫面寬 1280。出怪表、魔王都用鏡頭 x 觸發（鏡頭走到那裡就出）。
 */
import type { Activity, BreakKind, CaptiveArt, DropKind, EnemyKind } from '../entities';
import type { TerrainDef } from '../terrain';

/** 一段場景（決定地面帶材質、退路背景、落葉種類、環境色） */
export interface ZoneDef {
  /** 從世界 x 多少開始 */
  from: number;
  name: string;
  /** 地面帶（art.json 的 key，例如 s1_1_ground） */
  ground: string;
  /** 背景長卷還沒生出來時的退路遠景（art.json 的 key，例如 s1_1_far） */
  far: string;
  /** 飄在空中的東西：楓葉、竹葉、火星、螢火蟲、飄起來的燈籠 */
  leaves: 'maple' | 'bamboo' | 'ember' | 'firefly' | 'lantern' | 'rain' | 'steam' | null;
  /** 天空顏色（畫飄雲、遠方小鳥用） */
  sky: string;
  /** 崖壁、坑邊用哪一套（terrain.json 的 wall）：沒給就照地面帶推（山村石牆、竹林土崖、山賊寨木樁） */
  wall?: string;
  /** 這一段的坑是水（河童從水裡冒出來；畫成水面） */
  water?: boolean;
  /** 夜空放煙火 */
  fireworks?: boolean;
  /** 暴風雨：偶爾打雷閃一下 */
  storm?: boolean;
}

/**
 * 單向平台（從下面跳得上去）：屋頂、木架、竹架；第二批美術（09-26）：
 * stall＝攤位長屋（屋脊站）、stage＝祭典木台、bridge＝朱紅平橋、rampart＝山賊寨木造矮牆（底部貼地）、
 * torii＝大鳥居上橫樑（x、w＝能站的範圍，用 stage2.ts 的 torii() 算）
 */
export interface PlatformDef {
  x: number; y: number; w: number;
  look: 'roof' | 'plank' | 'bamboo' | 'stall' | 'stage' | 'bridge' | 'rampart' | 'torii' | 'catwalk' | 'conveyor' | 'lift' | 'ridge' | 'ledge';
  /** look＝ledge（第二版岩棚、鐵架、屋簷）：v2_terrain.json 的 ledge 套名（s1_rock、s3_iron、s3_eave…） */
  art?: string;
  /** 輸送帶：站在上面每秒被帶走幾像素（負的＝往左，跟球球前進的方向相反） */
  belt?: number;
  /** 升降台：y 在 y～y1 之間來回（上下各停 stop 秒，走一趟 travel 秒）；phase＝一開始在週期的哪裡（0～1） */
  lift?: { y1: number; travel: number; stop: number; phase?: number };
}

/** 站不上去、底部貼地的長條背景（山賊寨木柵）：terrain.json 的 deck，從 x 開始、寬 w */
export interface DeckDef { x: number; w: number; key: string }

/** 裝飾：back＝角色後面、front＝角色前面（半透明）。art 先找 terrain.json 的 anim（營火）、props（竹叢、神社大鈴），再找 art.json */
export interface PropDef {
  x: number;
  art: string;
  /** 畫多高（畫面像素） */
  h: number;
  front?: boolean;
  flip?: boolean;
  /** 冒炊煙／火星（營火、煙囪） */
  smoke?: boolean;
}

/** 出怪表的一筆 */
export interface SpawnDef {
  /** 鏡頭左緣走到這個 x 就出 */
  at: number;
  kind: EnemyKind;
  /**
   * 從哪裡出：right＝畫面右邊外衝進來、left＝左邊（背後）、top＝天上、
   * hole＝地洞冒出來（x 給洞的位置）、water＝從水坑裡冒出來（x 給坑裡的位置，河童）、
   * place＝一開始就擺在 x（通常在畫面外先擺好、在做自己的事）
   */
  from: 'right' | 'left' | 'top' | 'hole' | 'water' | 'place';
  x?: number;
  /** 擺在平台／屋頂上（y 用 x 那裡的平台高度） */
  plat?: boolean;
  /** 固定在這個高度（牆上的甲蟲砲台） */
  y?: number;
  /** 一次幾隻（成群）；gap＝每隻隔幾秒出；spread＝擺放時每隻隔幾像素 */
  count?: number;
  gap?: number;
  spread?: number;
  /** 發現球球之前在做什麼 */
  act?: Activity;
  /** 這一波沒打完鏡頭不往前（越南大戰的停下來打一波） */
  lock?: boolean;
}

/**
 * 第二版（規劃 5.3）實心方塊：上面能站、左右是牆（能蹬）、下面撞頭。x, y＝左上角。
 * art＝v2_terrain.json 的 block 套名（s1_rock、s1_log、s2_stone、s3_iron、s3_plaster）
 */
export interface SolidDef { x: number; y: number; w: number; h: number; art: string }
/** 第二版（規劃 5.4）攀爬物：中心 x、腳能到的範圍 top～bottom；art＝v2_terrain.json 的 climb 套名（s1_vine、s1_ladder、s3_chain…） */
export interface ClimbDef { x: number; top: number; bottom: number; art: string }
/**
 * 第二版「畫面往上捲」的區段（09-28 使用者同意做大攀爬）：球球在 x0～x1 之間時鏡頭跟著上下，最高捲到 top（負的＝往上）。
 * hold＝鏡頭左緣停在這裡（整段攀爬在一個畫面寬裡），球球爬到 release 以上（y 更小）才放開往右捲；
 * bg＝往上捲時中景畫哪一套往上延伸的背景（v2.json 的 climbUp，例如 s1_mid）
 */
export interface VScrollDef { x0: number; x1: number; top: number; hold?: number; release?: number; bg?: string }
/**
 * 第二版瀑布（規劃 5.6）：畫在角色後面、水一直往下流；x＝水柱中心、top＝水口（瀑布頂）、bottom＝落水處（水潭水面）。
 * art＝v2_terrain.json 的 waterfall 套名（s1、s2、s3）。底下的水潭是關卡的坑（掉下去扣血），水不會推人。
 */
export interface WaterfallDef { x: number; top: number; bottom: number; art: string }
/** 給自動玩看的標記：蹬牆夾縫（x0～x1 之間、底在 bottom、要一路蹬到 top 以上） */
export interface ShaftDef { x0: number; x1: number; top: number; bottom: number }

export interface BreakableDef { x: number; kind: BreakKind; drop?: DropKind }
/** 被綁的村貓：caged＝關在竹籠裡（先打爛竹籠）；y＝綁在高處（屋頂、岩頂這種站得上去的面，沒給＝地面） */
export interface CaptiveDef { x: number; art: CaptiveArt; drop: DropKind; caged?: boolean; y?: number }
/** 魔王：鏡頭走到 at 就鎖住畫面、魔王出場，打倒才解鎖；final＝打倒就過關 */
export interface BossDef { at: number; kind: EnemyKind; final?: boolean }

export interface StageDef {
  id: string;
  num: number;
  /** 開場大字：「任務一 開始！」 */
  mission: string;
  name: string;
  /** 關卡標題圖（art.json key） */
  titleArt: string;
  /** 背景長卷在 art.json panels 裡的關卡代號（s1） */
  panels: string;
  /** 世界總長（鏡頭最右到 length - 1280） */
  length: number;
  /** 球球起點 x */
  start: number;
  /** 限時（秒），結算時剩餘時間換分數 */
  timeLimit: number;
  terrain: TerrainDef;
  zones: ZoneDef[];
  platforms: PlatformDef[];
  /** 背景長條（木柵），畫在地面帶後面 */
  decks?: DeckDef[];
  /** 當場跳出的小提示（教學）：鏡頭走到 at 就在畫面下方顯示 3.5 秒 */
  hints?: { at: number; text: string; sub?: string }[];
  /** 蒸氣噴口（第三關）：每 period 秒噴一次（先冒小煙 0.6 秒當預兆，再噴 0.9 秒），offset＝錯開幾秒 */
  vents?: { x: number; period: number; offset: number }[];
  props: PropDef[];
  breakables: BreakableDef[];
  captives: CaptiveDef[];
  spawns: SpawnDef[];
  bosses: BossDef[];
  /** 第二版：實心方塊、攀爬物、往上捲的區段、蹬牆夾縫標記 */
  solids?: SolidDef[];
  climbs?: ClimbDef[];
  vscroll?: VScrollDef[];
  shafts?: ShaftDef[];
  waterfalls?: WaterfallDef[];
  /**
   * 最前景單件（art.json panels 的 fore 第幾張）掠過畫面的位置：世界 x＝這一件正好在畫面中間時球球附近的位置。
   * 前景捲得比地面快（約 1.3 倍），幾秒就過去；避開魔王與鎖畫面的地方，別擋住戰鬥。沒給就不畫前景。
   */
  fore?: { x: number; item: number }[];
}
