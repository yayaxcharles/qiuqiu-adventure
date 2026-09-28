/**
 * 第二關　妖怪祭典燈籠街 → 河童川 → 山頂神社（夜）。
 *
 * 長度照背景長卷（art.json panels.s2）：中景 8 張共 12,240 像素、捲動 0.55 倍 → 最後的魔王鎖在鏡頭 19,927、關卡長 21,207（跟第一關一樣）。
 * 中景第 1～3 張是夜祭（入口鳥居、攤位街、煙火廣場）、第 4～6 張河堤／木橋／河童的沼澤、第 7～8 張神社石階與本殿，
 * 分段照畫面中間看到第 4 張（世界 x 約 8,900）、第 7 張（約 16,500）切。
 *
 * 地形節奏：夜祭平地暖身 → 上坡攤位街（攤位屋頂的木台）→ 下樓梯煙火廣場（鎖畫面）→ 燈籠長廊 → 跳下 → 河堤往下
 *   → 河童川：一段一段的水坑（河童從水裡冒出來；兩座木橋、其他要跳）→ 沼澤（中魔王 蛙大名）→ 上坡
 *   → 山頂神社：石階往上、參道、再下坡到本殿前（魔王 狸大人）。
 * 要改這一關只改這個檔（格式說明見 types.ts）。
 */
import { TerrainBuilder } from '../terrain';
import type { PlatformDef, StageDef } from './types';

/**
 * 大鳥居（terrain.json platform.s2_torii，836×660、顯示 0.5 倍）當平台：上橫樑能站的範圍 standX0 147～standX1 674、
 * 橫樑頂 standY 43、柱腳（實心底線）658 → 橫樑離地 (658−43)×0.5＝307.5。比跳得最高（173）高，旁邊要擺一個踏腳台。
 */
function torii(cx: number, ground: number): PlatformDef {
  return { x: cx - 836 * 0.25 + 147 * 0.5, y: ground - (658 - 43) * 0.5, w: (674 - 147) * 0.5, look: 'torii' };
}

const T = new TerrainBuilder(596);
// ── 妖怪祭典燈籠街（0～8,900）──
T.flat(1400);              // 0～1400　夜祭入口：飄來飄去的燈籠鬼、跳舞的面具舞者
T.slope(300, -70);         // 1400～1700　上坡
T.flat(1600);              // 1700～3300　攤位街：攤位屋頂的木台、被綁的村貓 1
T.stairs(3, 50, 24);       // 3300～3450　下樓梯
T.flat(1500);              // 3450～4950　煙火廣場（鎖畫面打一波）、煙火桶
T.slope(250, -60);         // 4950～5200　上坡
T.flat(900);               // 5200～6100　燈籠長廊
T.cliff(58);               // 6100　跳下去
T.flat(1400);              // 6100～7500　祭典尾巴、被綁的村貓 2
T.slope(400, 22);          // 7500～7900　河堤往下
T.flat(1000);              // 7900～8900　河堤
// ── 河童川（8,900～16,500）──
T.pit(170);                // 8900～9070　水坑（河童）
T.flat(430);               // 9070～9500
T.pit(240);                // 9500～9740　水坑（有木橋）
T.flat(560);               // 9740～10300
T.pit(180);                // 10300～10480　水坑（河童）
T.flat(620);               // 10480～11100
T.pit(320);                // 11100～11420　水坑（長木橋）
T.flat(700);               // 11420～12120　竹籠裡的村貓 3
T.pit(170);                // 12120～12290　水坑（河童）
T.flat(2410);              // 12290～14700　沼澤（中魔王 蛙大名：鏡頭 13,300）
T.pit(180);                // 14700～14880　水坑（河童）
T.flat(720);               // 14880～15600
T.slope(500, -40);         // 15600～16100
T.flat(400);               // 16100～16500
// ── 山頂神社（16,500～21,207）──
T.stairs(3, 70, -26);      // 16500～16710　石階往上
T.flat(600);               // 16710～17310　參道：白狐巫女、被綁的村貓 4
T.slope(300, 80);          // 17310～17610　往本殿的下坡
T.flat(3597);              // 17610～21207　本殿前（魔王 狸大人：鏡頭 19,927）

export const STAGE2: StageDef = {
  id: 'stage2',
  num: 2,
  mission: '任務二',
  name: '妖怪祭典 → 河童川 → 山頂神社',
  titleArt: 'ui_stage2_title',
  panels: 's2',
  length: 21207,
  start: 260,
  timeLimit: 600,
  terrain: T.build(),
  zones: [
    // 地面帶、崖壁直接寫 terrain.json 的鍵（第二批：夜祭石板街、河堤泥地、神社石徑；神社石垣、石砌河堤）
    { from: 0, name: '妖怪祭典燈籠街', ground: 's2_street', far: 's2_1_far', leaves: 'lantern', sky: '#3a2a5a', wall: 's2_shrine', fireworks: true },
    { from: 8900, name: '河童川', ground: 's2_bank', far: 's2_2_far', leaves: 'firefly', sky: '#23334f', wall: 's2_embank', water: true },
    { from: 16500, name: '山頂神社', ground: 's2_shrine', far: 's2_3_far', leaves: 'maple', sky: '#3a2440', wall: 's2_shrine' },
  ],
  platforms: [
    // 攤位街：攤位長屋（屋脊站；地面 526，屋脊高 140～150，跳一下就上得去；屋脊之間隔 180，從屋簷邊跑跳過得去）
    { x: 1950, y: 386, w: 200, look: 'stall' }, { x: 2330, y: 376, w: 250, look: 'stall' }, { x: 2760, y: 386, w: 220, look: 'stall' },
    // 煙火廣場（地面 598）：祭典木台（高 158）當踏腳 → 大鳥居上橫樑（再高 150）→ 另一座木台下來。
    // 背景長卷第 1 張（入口）已經有一座鳥居，這座擺在鏡頭 2,900 以後才出現的地方，兩座不會同時在畫面上
    { x: 3900, y: 440, w: 230, look: 'stage' }, torii(4330, 598), { x: 4560, y: 452, w: 200, look: 'stage' },
    // 燈籠長廊（地面 538）
    { x: 5450, y: 408, w: 200, look: 'plank' }, { x: 5800, y: 388, w: 220, look: 'plank' },
    // 河童川的兩座橋（跟河堤一樣高，走得過去）：第一座朱紅平橋；第二座那時背景長卷正好有一座紅色拱橋，改用普通木橋，不要兩座紅橋同時在畫面上
    { x: 9470, y: 618, w: 300, look: 'bridge' }, { x: 11070, y: 618, w: 380, look: 'plank' },
    // 神社參道（地面 500）
    { x: 17000, y: 380, w: 180, look: 'plank' },
  ],
  // 舊的亮色道具（鳥居、攤位、燈籠串、石燈籠）都拿掉了：背景長卷本身就畫了鳥居、攤位、燈籠串；石燈籠、燈籠攤改成打得爛的
  props: [
    { x: 16880, art: 's2_ema_rack', h: 160 }, { x: 18900, art: 's2_ema_rack', h: 150, flip: true },
    { x: 20760, art: 's2_shrine_bell', h: 220 },
  ],
  // 最前景：燈籠串、祭典布簾、鳥居柱擺在祭典段（鳥居柱放在背景看不到鳥居、大鳥居平台也不在畫面上的地方）；
  // 朱紅橋欄杆不用（河童川那段背景已經有紅色拱橋，加上第一座朱紅平橋，紅橋會太多）
  fore: [
    { x: 1800, item: 0 }, { x: 5300, item: 5 }, { x: 6600, item: 1 }, { x: 8300, item: 3 },
    { x: 15200, item: 3 }, { x: 18700, item: 4 },
  ],
  hints: [
    { at: 8300, text: '河童躲在水裡：冒泡泡的地方牠會冒出來', sub: '在水裡打不到，等牠探出頭' },
  ],
  // 打得爛的東西（terrain.json 第二批：燈籠攤、祭典木箱、酒樽堆、石燈籠、賽錢箱、木看板；火藥桶沿用第一關的）
  breakables: [
    { x: 700, kind: 's2_crate', drop: 'onigiri' }, { x: 800, kind: 's2_crate' }, { x: 1200, kind: 's2_sake_stack' },
    { x: 3140, kind: 's2_lantern_stall' },
    { x: 3620, kind: 's2_lantern_stall' }, { x: 4000, kind: 'powder' }, { x: 4650, kind: 'powder' }, { x: 4850, kind: 's2_signboard', drop: 'D' },
    { x: 5600, kind: 's2_sake_stack', drop: 'fish' }, { x: 6400, kind: 's2_crate' }, { x: 6950, kind: 's2_signboard', drop: 'onigiri' }, { x: 7700, kind: 's2_sake_stack' },
    { x: 9300, kind: 's2_crate' }, { x: 10800, kind: 's2_crate', drop: 'fish' }, { x: 12500, kind: 's2_sake_stack' },
    { x: 15100, kind: 's2_crate', drop: 'onigiri' }, { x: 15400, kind: 'powder' },
    { x: 16770, kind: 's2_stone_lantern' }, { x: 17900, kind: 's2_stone_lantern' }, { x: 18300, kind: 'powder' }, { x: 18650, kind: 's2_stone_lantern' },
    { x: 19400, kind: 's2_offering_box', drop: 'fish' }, { x: 19620, kind: 's2_stone_lantern' },
  ],
  captives: [
    { x: 2670, art: 'calico_long', drop: 'F' },
    { x: 6650, art: 'siamese', drop: 'C' },
    { x: 9200, art: 'black', drop: 'B' },
    { x: 11800, art: 'white', drop: 'R', caged: true },
    { x: 15250, art: 'grey_tabby', drop: 'smoke' },
    { x: 17240, art: 'orange_white', drop: 'bomb' },
  ],
  spawns: [
    // ── 妖怪祭典燈籠街 ──
    { at: 0, kind: 'lantern_ghost', from: 'place', x: 1350, act: 'patrol' },
    { at: 200, kind: 'kasa_obake', from: 'right', count: 2, gap: 1.2 },
    { at: 500, kind: 'mask_dancer', from: 'place', x: 1800, act: 'chat' },
    { at: 700, kind: 'paper_crane', from: 'right', count: 5, gap: 0.2 },
    { at: 1000, kind: 'lantern_ghost', from: 'right', count: 1 },
    { at: 1400, kind: 'kasa_obake', from: 'left', count: 2, gap: 1.0 },
    { at: 1700, kind: 'paper_crane', from: 'right', count: 6, gap: 0.18 },
    { at: 2000, kind: 'fox_miko', from: 'place', x: 3200 },
    { at: 2300, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.8, lock: true },
    { at: 2700, kind: 'lantern_ghost', from: 'right', count: 2, gap: 1.2, lock: true },
    { at: 3000, kind: 'tengu', from: 'top' },
    { at: 3300, kind: 'paper_crane', from: 'right', count: 6, gap: 0.18 },
    { at: 3600, kind: 'mask_dancer', from: 'right', count: 2, gap: 2.0, lock: true },
    { at: 3900, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.7 },
    { at: 4300, kind: 'tengu', from: 'top' },
    { at: 4500, kind: 'lantern_ghost', from: 'place', x: 5600, act: 'patrol' },
    { at: 4800, kind: 'fox_miko', from: 'place', x: 6000 },
    { at: 5200, kind: 'paper_crane', from: 'left', count: 5, gap: 0.2 },
    { at: 5500, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.7 },
    { at: 5800, kind: 'mask_dancer', from: 'right' },
    { at: 6100, kind: 'lantern_ghost', from: 'right', count: 1 },
    { at: 6400, kind: 'tengu', from: 'top' },
    { at: 6800, kind: 'kasa_obake', from: 'right', count: 2, gap: 0.9 },
    { at: 6900, kind: 'paper_crane', from: 'right', count: 5, gap: 0.2 },
    { at: 7200, kind: 'mask_dancer', from: 'place', x: 8300, act: 'chat' },
    { at: 7300, kind: 'fox_miko', from: 'place', x: 8650 },
    // ── 河童川 ──
    { at: 7700, kind: 'kappa', from: 'water', x: 8985 },
    { at: 8000, kind: 'paper_crane', from: 'right', count: 5, gap: 0.2 },
    { at: 8400, kind: 'lantern_ghost', from: 'right', count: 2, gap: 1.2 },
    { at: 8800, kind: 'kappa', from: 'water', x: 10390 },
    { at: 9100, kind: 'tengu', from: 'top' },
    { at: 9500, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.8, lock: true },
    { at: 9900, kind: 'kappa', from: 'water', x: 12205 },
    { at: 10200, kind: 'paper_crane', from: 'left', count: 6, gap: 0.18 },
    { at: 10500, kind: 'kappa', from: 'place', x: 11750, count: 2, spread: 140 },
    { at: 11000, kind: 'mask_dancer', from: 'right', count: 2, gap: 1.5 },
    { at: 11400, kind: 'lantern_ghost', from: 'right', count: 1 },
    { at: 11900, kind: 'kappa', from: 'place', x: 13100, act: 'patrol' },
    // （中魔王：鏡頭 13,300）
    { at: 13400, kind: 'paper_crane', from: 'right', count: 6, gap: 0.18 },
    { at: 13600, kind: 'kappa', from: 'water', x: 14790 },
    { at: 14000, kind: 'tengu', from: 'top' },
    { at: 14300, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.8 },
    { at: 14700, kind: 'fox_miko', from: 'place', x: 15900 },
    { at: 15000, kind: 'lantern_ghost', from: 'right', count: 2, gap: 1.2 },
    { at: 15100, kind: 'mask_dancer', from: 'left' },
    // ── 山頂神社 ──
    { at: 15500, kind: 'paper_crane', from: 'right', count: 6, gap: 0.18 },
    { at: 15800, kind: 'fox_miko', from: 'place', x: 16900 },
    { at: 16000, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.8, lock: true },
    { at: 16400, kind: 'tengu', from: 'top', count: 2, gap: 2.0, lock: true },
    { at: 16800, kind: 'lantern_ghost', from: 'right', count: 2, gap: 1.2 },
    { at: 17100, kind: 'mask_dancer', from: 'right', count: 2, gap: 1.6 },
    { at: 17500, kind: 'paper_crane', from: 'left', count: 5, gap: 0.2 },
    { at: 17800, kind: 'fox_miko', from: 'place', x: 18900 },
    { at: 17900, kind: 'kasa_obake', from: 'right', count: 2, gap: 0.9 },
    { at: 18200, kind: 'tengu', from: 'top' },
    { at: 18600, kind: 'mask_dancer', from: 'right', count: 2, gap: 1.4, lock: true },
    { at: 19000, kind: 'lantern_ghost', from: 'right', count: 1 },
    { at: 19100, kind: 'kasa_obake', from: 'right', count: 3, gap: 0.8 },
    { at: 19400, kind: 'paper_crane', from: 'right', count: 6, gap: 0.18 },
  ],
  bosses: [
    { at: 13300, kind: 'frog_daimyo' },
    { at: 19927, kind: 'tanuki_lord', final: true },
  ],
};
