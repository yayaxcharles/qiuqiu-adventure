/**
 * 第一關　黃昏山村 → 竹林 → 山賊寨（教學關）。
 *
 * 長度照背景長卷算（art.json panels.s1）：中景 8 張共 12,240 像素、捲動 0.55 倍 → 鏡頭走 19,927 像素中景剛好看完，
 * 所以最後的魔王鎖在鏡頭 19,927、關卡長 21,207。中景前 4 張是山村、第 5～6 張竹林、第 7～8 張山賊寨，
 * 地面帶與敵人的分段跟著對齊：畫面中間看到第 5 張（竹林入口）時世界 x 約 10,600、看到第 7 張（木柵與瞭望台）時約 16,170。
 *
 * 地形照越南大戰的節奏：平地暖身 → 上坡 → 山村屋頂 → 小市集 → 上坡到高台（丟苦無的忍者，鎖畫面）→ 跳下斷崖 → 石橋、小溪（坑）
 *   → 竹林竹架平台區（三個坑）→ 中魔王平地 → 樓梯高台 → 山賊營火 → 瞭望台 → 寨門（打爛才過得去）→ 寨內木架與壕溝 → 魔王平地。
 *
 * 要改這一關只改這個檔（格式說明見 types.ts）。
 */
import { TerrainBuilder } from '../terrain';
import type { StageDef } from './types';

const T = new TerrainBuilder(596);
// ── 黃昏山村（0～10,600）──
T.flat(1500);              // 0～1500　村口：搬箱子的鼠兵
T.slope(500, -90);         // 1500～2000　上坡
T.flat(1400);              // 2000～3400　民家：屋頂跳得上去、被綁的村貓 1、屋頂上睡覺的忍者
T.stairs(3, 40, 30);       // 3400～3520　下樓梯
T.flat(1680);              // 3520～5200　小市集：攤位、火藥桶、地洞鼠兵
T.slope(400, -126);        // 5200～5600　上坡到高台
T.flat(1300);              // 5600～6900　高台：丟苦無的忍者（鎖畫面打一波）
T.cliff(140);              // 6900　斷崖，跳下去
T.flat(1300);              // 6900～8200　石橋下
T.slope(300, -14);         // 8200～8500
T.flat(100);
T.pit(170);                // 8600～8770　小溪（第一個坑）
T.flat(1830);              // 8770～10600　村尾：鼠兵成群衝鋒、野豬從背後來
// ── 竹林（10,600～16,170）──
T.flat(500);               // 10600～11100
T.pit(160);                // 11100～11260
T.flat(790);               // 11260～12050　竹架平台區
T.pit(170);                // 12050～12220
T.flat(330);               // 12220～12550　被綁的村貓 2
T.pit(150);                // 12550～12700
T.slope(300, -80);         // 12700～13000
T.flat(50);
T.slope(250, 80);          // 13050～13300
T.flat(1400);              // 13300～14700　中魔王平地（太鼓狸）
T.stairs(4, 60, -26);      // 14700～14940　上樓梯
T.flat(560);               // 14940～15500
T.slope(300, 104);         // 15500～15800
T.flat(370);               // 15800～16170
// ── 山賊寨（16,170～21,207）──
T.flat(830);               // 16170～17000　營火（山賊圍著烤魚）、竹籠裡的村貓 3
T.slope(300, -70);         // 17000～17300
T.flat(400);               // 17300～17700　瞭望台（上面有忍者，打爛會垮）
T.slope(300, 70);          // 17700～18000
T.flat(800);               // 18000～18800　寨門（打爛才過得去）、寨內木架
T.pit(160);                // 18800～18960　壕溝
T.flat(540);               // 18960～19500　攤位、村貓 4
T.slope(150, -40);         // 19500～19650
T.flat(150);
T.cliff(40);               // 19800　跳下去
T.flat(1407);              // 19800～21207　魔王平地（橘皮大王）

export const STAGE1: StageDef = {
  id: 'stage1',
  num: 1,
  mission: '任務一',
  name: '黃昏山村 → 竹林 → 山賊寨',
  titleArt: 'ui_stage1_title',
  panels: 's1',
  length: 21207,
  start: 260,
  timeLimit: 600,
  terrain: T.build(),
  zones: [
    { from: 0, name: '黃昏山村', ground: 's1_1_ground', far: 's1_1_far', leaves: 'maple', sky: '#f3a46b' },
    { from: 10600, name: '竹林', ground: 's1_2_ground', far: 's1_2_far', leaves: 'bamboo', sky: '#f0b27a' },
    { from: 16170, name: '山賊寨', ground: 's1_3_ground', far: 's1_3_far', leaves: 'ember', sky: '#e88a6a' },
  ],
  platforms: [
    // 山村民家（地面 506）：屋脊比地面高 220，屋子才比球球（190）大、像真的房子。
    // 球球按住跳最高 173（PARAMS 算的），一次跳不上去 → 第一棟前面擺一個 110 高的踏腳木台，兩段各 110，離上限留 63 的餘裕。
    // 屋簷會比屋脊多伸出去約 55，屋脊之間隔 150：屋簷之間還留一點縫不會疊在一起；
    // 從屋簷邊全速起跳可以飛約 218（09-26 實測），隔 150 留 68 的餘裕，屋頂上一路跑跳得過去。
    { x: 1990, y: 396, w: 110, look: 'plank' },
    { x: 2120, y: 286, w: 280, look: 'roof' }, { x: 2550, y: 286, w: 260, look: 'roof' }, { x: 2960, y: 286, w: 260, look: 'roof' },
    // 高台上的民家（地面 470）：屋脊高 200（再高會頂到畫面上的分數欄），踏腳木台高 100
    { x: 6170, y: 370, w: 110, look: 'plank' },
    { x: 6300, y: 270, w: 280, look: 'roof' },
    // 竹林竹架（坑上面也有：跳不過去就爬竹架）
    { x: 11040, y: 470, w: 240, look: 'bamboo' }, { x: 11380, y: 390, w: 200, look: 'bamboo' }, { x: 11700, y: 470, w: 200, look: 'bamboo' },
    { x: 11980, y: 440, w: 260, look: 'bamboo' }, { x: 12460, y: 450, w: 260, look: 'bamboo' }, { x: 12780, y: 380, w: 180, look: 'bamboo' },
    // 營地的木造矮牆（上面鋪木板，站得上去；terrain.json deck.s1_rampart，底部貼地、高 148）
    { x: 16640, y: 448, w: 200, look: 'rampart' },
    // 寨內：寨門後面一道矮牆，接木架
    { x: 18340, y: 448, w: 180, look: 'rampart' }, { x: 18520, y: 400, w: 220, look: 'plank' }, { x: 18770, y: 440, w: 240, look: 'plank' },
    { x: 19150, y: 460, w: 220, look: 'plank' },
  ],
  // 山賊寨的木柵（terrain.json deck.s1_palisade，站不上去）：畫在地面帶後面，取代舊的亮色木柵
  decks: [
    { x: 16190, w: 420, key: 's1_palisade' }, { x: 17930, w: 160, key: 's1_palisade' },
    { x: 18990, w: 440, key: 's1_palisade' }, { x: 19840, w: 560, key: 's1_palisade' }, { x: 20620, w: 520, key: 's1_palisade' },
  ],
  props: [
    { x: 1150, art: 'props_s1_fish_rack', h: 160 }, { x: 2460, art: 'props_s1_fish_rack', h: 150 }, { x: 2900, art: 'props_s1_fish_rack', h: 150 },
    { x: 7700, art: 'props_s1_fish_rack', h: 150 },
    // 竹林的大竹叢（terrain.json props.s1_bamboo_fore，暗色版，上端超出畫面頂；前景那叢會壓暗）
    { x: 10400, art: 's1_bamboo_fore', h: 900, front: true }, { x: 10900, art: 's1_bamboo_fore', h: 860 },
    { x: 11620, art: 's1_bamboo_fore', h: 900, flip: true }, { x: 13150, art: 's1_bamboo_fore', h: 880 },
    { x: 15300, art: 's1_bamboo_fore', h: 840, flip: true },
    // 營火（terrain.json anim.s1_campfire：柴堆＋4 格火焰），h＝柴堆高
    { x: 16550, art: 's1_campfire', h: 70, smoke: true },
    { x: 19420, art: 's1_campfire', h: 64, smoke: true },
  ],
  fore: [
    { x: 1900, item: 1 }, { x: 4300, item: 3 }, { x: 8000, item: 4 }, { x: 10450, item: 0 },
    { x: 15750, item: 0 }, { x: 16350, item: 5 }, { x: 19300, item: 2 },
  ],
  // 第二版（09-28 使用者：不要長篇教學、讓玩家自己發現）：關卡裡不跳教學字幕，按鍵一覽只在標題、暫停畫面
  hints: [],
  breakables: [
    { x: 700, kind: 'crate', drop: 'onigiri' }, { x: 790, kind: 'crate' }, { x: 1420, kind: 'crate' },
    { x: 2300, kind: 'barrel', drop: 'fish' }, { x: 3620, kind: 'crate' },
    { x: 3950, kind: 'stall' }, { x: 4300, kind: 'stall' }, { x: 4640, kind: 'powder' }, { x: 5000, kind: 'barrel' },
    { x: 7200, kind: 'crate' }, { x: 7290, kind: 'crate', drop: 'fish' }, { x: 7600, kind: 'barrel' },
    { x: 9000, kind: 'crate', drop: 'onigiri' }, { x: 9900, kind: 'crate' }, { x: 10200, kind: 'powder' },
    { x: 10700, kind: 'crate' }, { x: 13100, kind: 'crate', drop: 'onigiri' }, { x: 15000, kind: 'crate', drop: 'I' }, { x: 15100, kind: 'powder' },
    { x: 16260, kind: 'barrel' }, { x: 16660, kind: 'powder' }, { x: 16800, kind: 'crate', drop: 'fish' },
    { x: 17500, kind: 'tower' },
    { x: 18200, kind: 'gate' },
    { x: 18420, kind: 'crate' }, { x: 18520, kind: 'powder' }, { x: 19080, kind: 'stall' }, { x: 19460, kind: 'barrel', drop: 'fish' },
    { x: 19600, kind: 'crate' }, { x: 19690, kind: 'crate', drop: 'bigbomb' },
  ],
  captives: [
    { x: 3250, art: 'grey', drop: 'H' },
    { x: 7450, art: 'tuxedo', drop: 'D' },
    { x: 12300, art: 'calico', drop: 'S' },
    { x: 16920, art: 'orange_white', drop: 'F', caged: true },
    { x: 19260, art: 'grey_tabby', drop: 'bomb' },
  ],
  spawns: [
    // ── 黃昏山村 ──
    { at: 0, kind: 'rat', from: 'place', x: 1180, count: 2, spread: 90, act: 'carry' },
    { at: 250, kind: 'rat', from: 'right', count: 3, gap: 0.5 },
    { at: 800, kind: 'orange_bandit', from: 'right' },
    { at: 1150, kind: 'crow_small', from: 'top', count: 2, gap: 0.9 },
    { at: 1400, kind: 'rat', from: 'right', count: 4, gap: 0.35 },
    { at: 1500, kind: 'black_ninja', from: 'place', x: 2720, plat: true, act: 'sleep' },
    { at: 1700, kind: 'orange_bandit', from: 'place', x: 2470, act: 'patrol' },
    { at: 2100, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
    { at: 2600, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 3000, kind: 'wild_boar', from: 'right' },
    { at: 3300, kind: 'orange_bandit', from: 'place', x: 4480, count: 2, spread: 110, act: 'chat' },
    { at: 3500, kind: 'rat', from: 'hole', x: 4720, count: 5, gap: 0.45 },
    { at: 3900, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 4300, kind: 'rat', from: 'right', count: 4, gap: 0.3 },
    { at: 4700, kind: 'black_ninja', from: 'place', x: 5650, count: 2, spread: 260, lock: true },
    { at: 4900, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.4, lock: true },
    { at: 5300, kind: 'black_ninja', from: 'place', x: 6460, plat: true, act: 'sleep' },
    { at: 5600, kind: 'rat', from: 'right', count: 4, gap: 0.3 },
    { at: 6000, kind: 'crow_small', from: 'top', count: 3, gap: 0.6 },
    { at: 6400, kind: 'orange_bandit', from: 'place', x: 7400, count: 2, spread: 110, act: 'chat' },
    { at: 6800, kind: 'wild_boar', from: 'right' },
    { at: 7300, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
    { at: 7700, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 8100, kind: 'black_ninja', from: 'place', x: 9300 },
    { at: 8600, kind: 'rat', from: 'right', count: 7, gap: 0.25 },
    { at: 9100, kind: 'orange_bandit', from: 'right', count: 2, gap: 0.9 },
    { at: 9500, kind: 'wild_boar', from: 'left' },
    // ── 竹林 ──
    { at: 10000, kind: 'crow_small', from: 'top', count: 2, gap: 0.8 },
    { at: 10300, kind: 'black_ninja', from: 'place', x: 11160, plat: true },
    { at: 10500, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
    { at: 10700, kind: 'crow_small', from: 'top', count: 3, gap: 0.5 },
    { at: 10900, kind: 'orange_bandit', from: 'place', x: 12470, act: 'patrol' },
    { at: 11200, kind: 'black_ninja', from: 'place', x: 12600, plat: true },
    { at: 11600, kind: 'wild_boar', from: 'right' },
    { at: 11900, kind: 'rat', from: 'hole', x: 13220, count: 5, gap: 0.4 },
    { at: 12200, kind: 'orange_bandit', from: 'right', count: 2, gap: 0.9 },
    { at: 12400, kind: 'crow_small', from: 'top', count: 2, gap: 0.6 },
    // （中魔王：鏡頭 13,300）
    { at: 13400, kind: 'rat', from: 'right', count: 6, gap: 0.3 },
    { at: 13800, kind: 'crow_small', from: 'top', count: 2, gap: 0.6 },
    { at: 14000, kind: 'black_ninja', from: 'place', x: 15200 },
    { at: 14300, kind: 'rat', from: 'hole', x: 15650, count: 4, gap: 0.45 },
    { at: 14700, kind: 'orange_bandit', from: 'right', count: 2, gap: 0.8 },
    // ── 山賊寨 ──
    { at: 15000, kind: 'orange_bandit', from: 'place', x: 16430, count: 3, spread: 100, act: 'camp' },
    { at: 15700, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
    { at: 16000, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 16300, kind: 'black_ninja', from: 'place', x: 17500, plat: true, act: 'sleep' },
    { at: 16500, kind: 'wild_boar', from: 'right' },
    { at: 16800, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.0 },
    { at: 17000, kind: 'orange_bandit', from: 'left', count: 2, gap: 2.2 },
    { at: 17100, kind: 'rat', from: 'hole', x: 17950, count: 4, gap: 0.5 },
    { at: 17150, kind: 'crow_small', from: 'top', count: 2, gap: 1.2 },
    // （寨門 18,200：沒打爛鏡頭停在 17,220）
    { at: 17400, kind: 'orange_bandit', from: 'right', count: 3, gap: 0.6, lock: true },
    { at: 17600, kind: 'black_ninja', from: 'place', x: 18620, plat: true },
    { at: 17900, kind: 'rat', from: 'right', count: 6, gap: 0.25 },
    { at: 18200, kind: 'crow_small', from: 'top', count: 3, gap: 0.5 },
    { at: 18400, kind: 'wild_boar', from: 'left' },
    { at: 18600, kind: 'orange_bandit', from: 'place', x: 19330, count: 2, spread: 120, act: 'camp' },
    { at: 18900, kind: 'black_ninja', from: 'right', count: 2, gap: 1.0, lock: true },
    { at: 19300, kind: 'rat', from: 'hole', x: 20200, count: 5, gap: 0.4 },
    { at: 19500, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 19700, kind: 'orange_bandit', from: 'right', count: 2, gap: 0.8 },
  ],
  bosses: [
    { at: 13300, kind: 'drum_tanuki' },
    { at: 19927, kind: 'orange_king', final: true },
  ],
};
