/**
 * 第一關　黃昏山村 → 梯田坡道 → 竹林 → 山溪瀑布（畫面往上捲的大攀爬）→ 山路 → 山賊寨（教學關）。
 *
 * 第二版階段三（09-29）把這一關加長一倍：21,207 → 42,000。背景長卷改用 public/art/v2/v2.json 的 panels.s1
 * （中景 16 張共 24,480 像素、捲動 0.5697 倍 → 鏡頭走到最後的魔王 40,720 剛好看完），地形分段跟著長卷對齊：
 *
 *   0～10,600        黃昏山村（原樣；5,200 的上坡改陡成 30 度）
 *   10,600～19,200   【新】梯田坡道：連續陡坡、一道 200 高的田埂牆（二段跳）、兩棟沒有踏腳台的屋子（屋頂上有村貓）
 *   19,200～24,770   竹林（原 10,600～16,170 整段往後挪 8,600；中魔王太鼓狸，鏡頭 21,900）
 *   24,770～32,200   【新】山溪瀑布：溪邊岩坡 → 瀑布大攀爬（畫面往上捲：岩棚四層 → 藤蔓 → 瀑布前的岩棚 → 蹬牆夾縫 → 瀑布頂，村貓給 R）
 *                    → 大岩塊一階一階跳下來 → 溪谷裡一道矮的蹬牆夾縫 → 小溪 → 岩棚上丟苦無的忍者
 *   32,200～36,963   【新】山路：窄山道兩頭夾擊（翻滾穿過）、原木高台爬梯子上去（上面有村貓）
 *   36,963～42,000   山賊寨（原 16,170～21,207 整段往後挪 20,793；魔王橘皮大王，鏡頭 40,720）
 *
 * 瀑布大攀爬：鏡頭左緣停在 26,300（中景往上延伸的那一欄 v2.json climbUp.s1_mid 剛好蓋滿畫面、畫的瀑布就在水柱後面），
 * 球球爬到 -700 以上才放開往右捲。坐標、高度都照物理算過（tests/v2p3.test.ts 逐段檢查「跳得上去」、自動玩走到每一段）。
 *
 * 要改這一關只改這個檔（格式說明見 types.ts）。
 */
import { TerrainBuilder } from '../terrain';
import type { BossDef, BreakableDef, CaptiveDef, DeckDef, PlatformDef, PropDef, SpawnDef, StageDef } from './types';

/** 原本的竹林、山賊寨往後挪多少 */
const BAMBOO = 8600, FORT = 20793;
/** 原本的世界 x → 加長後的世界 x（山村不動） */
const sh = (x: number): number => (x < 10600 ? x : x < 16170 ? x + BAMBOO : x + FORT);
/** 原本的出怪鏡頭位置 → 加長後（竹林的在鏡頭 10,000～15,000 之間出） */
const shAt = (at: number): number => (at < 10000 ? at : at < 15000 ? at + BAMBOO : at + FORT);
/** 竹林入口的竹叢、前景（原本擺在 10,300～10,600 迎接竹林）跟著竹林走 */
const shProp = (x: number): number => (x >= 10300 && x < 10600 ? x + BAMBOO : sh(x));

/** 各段的起點（世界 x） */
export const S1_SECTIONS = {
  village: 0, terrace: 10600, bamboo: 19200, stream: 24770, climb: 26350, gorge: 29100, trail: 32200, fort: 36963,
} as const;

/** 坡帶實際畫的角度（v2_terrain.json slope.drawnDeg）：拉坡照這個角度，碰撞線才跟畫出來的坡面一致 */
const TER = { up20: 27.1, dn20: 28.5, up30: 31.6, dn30: 32.3 }, ROCK = { up20: 23.1, up30: 30.8, dn30: 31.5 }, TRAIL = { up20: 22.8, dn20: 26.6, up30: 31.0, dn30: 32.1 };
const lenFor = (dy: number, deg: number): number => Math.round(Math.abs(dy) / Math.tan(deg * Math.PI / 180));

const T = new TerrainBuilder(596);
// ── 黃昏山村（0～10,600）──
T.flat(1500);              // 0～1500　村口：搬箱子的鼠兵
T.slope(500, -90);         // 1500～2000　上坡
T.flat(1400);              // 2000～3400　民家：屋頂跳得上去、被綁的村貓 1、屋頂上睡覺的忍者
T.stairs(3, 40, 30);       // 3400～3520　下樓梯
T.flat(1680);              // 3520～5200　小市集：攤位、火藥桶、地洞鼠兵
T.flat(183);               // 5200～5383
T.slope(217, -126);        // 5383～5600　上坡到高台（第二版改陡：30 度，山村陡坡帶）
T.flat(1300);              // 5600～6900　高台：丟苦無的忍者（鎖畫面打一波）
T.cliff(140);              // 6900　斷崖，跳下去
T.flat(1300);              // 6900～8200　石橋下
T.slope(300, -14);         // 8200～8500
T.flat(100);
T.pit(170);                // 8600～8770　小溪（第一個坑）
T.flat(1830);              // 8770～10600　村尾：鼠兵成群衝鋒、野豬從背後來
// ── 【新】梯田坡道（10,600～19,200）──
T.flat(300);
T.slopeDeg(lenFor(100, TER.up20), TER.up20);    // 上到第一層田（496）
T.flat(500);
T.slopeDeg(lenFor(110, TER.up30), TER.up30);    // 上到第二層田（386）
const TER_TOP = T.x;
T.flat(600);
T.slopeDeg(lenFor(110, TER.dn20), -TER.dn20);
T.flat(300);
T.slopeDeg(lenFor(100, TER.dn30), -TER.dn30);   // 回到田底（596）
const HOUSES = T.x;
T.flat(1550);              // 兩棟沒有踏腳台的農舍（屋脊比地面高 220：一次跳 177 上不去，要二段跳）
const DIKE = T.x;
T.cliff(-200);             // 田埂石牆 200 高（二段跳；從田底起算，上面那層田的地面帶才蓋得到畫面底）
T.flat(500);               // 上層的田（396）：丟苦無的忍者
T.slopeDeg(lenFor(200, TER.dn30), -TER.dn30);   // 長長的陡下坡，鼠兵從底下衝上來
T.flat(600);
const DITCH = T.x;
T.pit(160);                // 灌溉渠（坑）
T.flat(400);
T.slopeDeg(lenFor(100, TER.up20), TER.up20);
const PINCER1 = T.x;
T.flat(700);               // 兩頭夾擊（鎖畫面）
T.slopeDeg(lenFor(100, TER.dn20), -TER.dn20);
T.flat(S1_SECTIONS.bamboo - T.x);
// ── 竹林（19,200～24,770；原 10,600～16,170）──
T.flat(500);
T.pit(160);
T.flat(790);               // 竹架平台區
T.pit(170);
T.flat(330);               // 被綁的村貓
T.pit(150);
T.slope(300, -80);
T.flat(50);
T.slope(250, 80);
T.flat(1400);              // 中魔王平地（太鼓狸）
T.stairs(4, 60, -26);
T.flat(560);
T.slope(300, 104);
T.flat(370);
// ── 【新】山溪瀑布（24,770～32,200）──
T.flat(230);
T.slopeDeg(lenFor(120, ROCK.up30), ROCK.up30);  // 溪邊岩坡：坡頂站著丟苦無的忍者
T.flat(400);
T.slopeDeg(lenFor(120, ROCK.dn30), -ROCK.dn30);
/** 瀑布：水潭（坑）從 POOL 到右邊整面岩壁；鏡頭停在 HOLD，這一整個畫面寬是大攀爬 */
const POOL = 26820, HOLD = 26300, SUMMIT = 27540;
T.flat(POOL - T.x);
T.pit(SUMMIT - POOL);      // 瀑布水潭（掉下去扣一滴血，回到水潭左邊重爬）
T.flat(S1_SECTIONS.gorge - T.x);   // 大岩塊底下的地（被岩塊蓋住）
T.flat(600);
const GORGE_SHAFT = T.x;   // 29,700：溪谷裡的矮夾縫
T.flat(1200);
const CREEK = T.x;
T.pit(160);                // 小溪
T.flat(500);
T.slopeDeg(lenFor(100, ROCK.up20), ROCK.up20);
T.flat(S1_SECTIONS.trail - T.x);
// ── 【新】山路（32,200～36,963）──
T.flat(400);
T.slopeDeg(lenFor(100, TRAIL.dn20), -TRAIL.dn20);
const PINCER2 = T.x;
T.flat(700);               // 窄山道：鼠兵、野豬兩頭夾擊（翻滾穿過）
T.slopeDeg(lenFor(150, TRAIL.up30), TRAIL.up30);
T.flat(300);
T.slopeDeg(lenFor(150, TRAIL.dn30), -TRAIL.dn30);
const LOG = T.x + 410;     // 原木高台（330 高，梯子爬上去，上面有村貓）
T.flat(1400);
T.slopeDeg(lenFor(100, TRAIL.up20), TRAIL.up20);
T.flat(300);
T.slopeDeg(lenFor(100, TRAIL.dn20), -TRAIL.dn20);
T.flat(S1_SECTIONS.fort - T.x);
// ── 山賊寨（36,963～42,000；原 16,170～21,207）──
T.flat(830);               // 營火（山賊圍著烤魚）、竹籠裡的村貓
T.slope(300, -70);
T.flat(400);               // 瞭望台（上面有忍者，打爛會垮）
T.slope(300, 70);
T.flat(800);               // 寨門（打爛才過得去）、寨內木架
T.pit(160);                // 壕溝
T.flat(540);
T.slope(150, -40);
T.flat(150);
T.cliff(40);
T.flat(1407);              // 魔王平地（橘皮大王）

// ───────────── 原本那一版的東西（竹林、山賊寨照 sh 往後挪） ─────────────

const OLD_PLATFORMS: PlatformDef[] = [
  // 山村民家（地面 506）：屋脊比地面高 220，屋子才比球球（190）大、像真的房子。
  // 球球按住跳最高 177，一次跳不上去 → 第一棟前面擺一個 110 高的踏腳木台
  { x: 1990, y: 396, w: 110, look: 'plank' },
  { x: 2120, y: 286, w: 280, look: 'roof' }, { x: 2550, y: 286, w: 260, look: 'roof' }, { x: 2960, y: 286, w: 260, look: 'roof' },
  // 高台上的民家（地面 470）
  { x: 6170, y: 370, w: 110, look: 'plank' },
  { x: 6300, y: 270, w: 280, look: 'roof' },
  // 竹林竹架（坑上面也有：跳不過去就爬竹架）
  { x: 11040, y: 470, w: 240, look: 'bamboo' }, { x: 11380, y: 390, w: 200, look: 'bamboo' }, { x: 11700, y: 470, w: 200, look: 'bamboo' },
  { x: 11980, y: 440, w: 260, look: 'bamboo' }, { x: 12460, y: 450, w: 260, look: 'bamboo' }, { x: 12780, y: 380, w: 180, look: 'bamboo' },
  // 營地的木造矮牆
  { x: 16640, y: 448, w: 200, look: 'rampart' },
  // 寨內：寨門後面一道矮牆，接木架
  { x: 18340, y: 448, w: 180, look: 'rampart' }, { x: 18520, y: 400, w: 220, look: 'plank' }, { x: 18770, y: 440, w: 240, look: 'plank' },
  { x: 19150, y: 460, w: 220, look: 'plank' },
];
const OLD_DECKS: DeckDef[] = [
  { x: 16190, w: 420, key: 's1_palisade' }, { x: 17930, w: 160, key: 's1_palisade' },
  { x: 18990, w: 440, key: 's1_palisade' }, { x: 19840, w: 560, key: 's1_palisade' }, { x: 20620, w: 520, key: 's1_palisade' },
];
const OLD_PROPS: PropDef[] = [
  { x: 1150, art: 'props_s1_fish_rack', h: 160 }, { x: 2460, art: 'props_s1_fish_rack', h: 150 }, { x: 2900, art: 'props_s1_fish_rack', h: 150 },
  { x: 7700, art: 'props_s1_fish_rack', h: 150 },
  { x: 10400, art: 's1_bamboo_fore', h: 900, front: true }, { x: 10900, art: 's1_bamboo_fore', h: 860 },
  { x: 11620, art: 's1_bamboo_fore', h: 900, flip: true }, { x: 13150, art: 's1_bamboo_fore', h: 880 },
  { x: 15300, art: 's1_bamboo_fore', h: 840, flip: true },
  { x: 16550, art: 's1_campfire', h: 70, smoke: true },
  { x: 19420, art: 's1_campfire', h: 64, smoke: true },
];
const OLD_FORE = [
  { x: 1900, item: 1 }, { x: 4300, item: 3 }, { x: 8000, item: 4 }, { x: 10450, item: 0 },
  { x: 15750, item: 0 }, { x: 16350, item: 5 }, { x: 19300, item: 2 },
];
const OLD_BREAKABLES: BreakableDef[] = [
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
];
const OLD_CAPTIVES: CaptiveDef[] = [
  { x: 3250, art: 'grey', drop: 'H' },
  { x: 7450, art: 'tuxedo', drop: 'D' },
  { x: 12300, art: 'calico', drop: 'S' },
  { x: 16920, art: 'orange_white', drop: 'F', caged: true },
  { x: 19260, art: 'grey_tabby', drop: 'bomb' },
];
const OLD_SPAWNS: SpawnDef[] = [
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
  // ── 竹林（鏡頭 10,000～15,000 出的都往後挪 8,600）──
  { at: 10000, kind: 'crow_small', from: 'top', count: 2, gap: 0.8 },
  { at: 10300, kind: 'black_ninja', from: 'place', x: 11160, plat: true },
  { at: 10500, kind: 'rat', from: 'right', count: 3, gap: 0.4 },   // 加長後這裡接在梯田的長平地後面，球球跑得快，背後出的追不上 → 改從前面
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
  // ── 山賊寨（鏡頭 15,000 以後的往後挪 20,793）──
  { at: 15000, kind: 'orange_bandit', from: 'place', x: 16430, count: 3, spread: 100, act: 'camp' },
  { at: 15700, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
  { at: 16000, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
  { at: 16300, kind: 'black_ninja', from: 'place', x: 17500, plat: true, act: 'sleep' },
  { at: 16500, kind: 'wild_boar', from: 'right' },
  { at: 16800, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.0 },
  { at: 17000, kind: 'orange_bandit', from: 'left', count: 2, gap: 2.2 },
  { at: 17100, kind: 'rat', from: 'hole', x: 17950, count: 4, gap: 0.5 },
  { at: 17150, kind: 'crow_small', from: 'top', count: 2, gap: 1.2 },
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
];
const OLD_BOSSES: BossDef[] = [
  { at: 13300, kind: 'drum_tanuki' },
  { at: 19927, kind: 'orange_king', final: true },
];

// ───────────── 新段落 ─────────────

/** 瀑布大攀爬：岩棚（左邊四層 → 藤蔓頂 → 瀑布前兩層，最後那層也是夾縫的底） */
const CLIMB_LEDGES: PlatformDef[] = [
  { x: 26580, y: 456, w: 200, look: 'ledge', art: 's1_rock' }, { x: 26380, y: 316, w: 200, look: 'ledge', art: 's1_rock' },
  { x: 26600, y: 176, w: 200, look: 'ledge', art: 's1_rock' }, { x: 26380, y: 36, w: 200, look: 'ledge', art: 's1_rock' },
  { x: 26400, y: -324, w: 260, look: 'ledge', art: 's1_rock' },
  { x: 26720, y: -364, w: 200, look: 'ledge', art: 's1_rock' }, { x: 26980, y: -404, w: SUMMIT - 26980, look: 'ledge', art: 's1_rock' },
];

const NEW_PLATFORMS: PlatformDef[] = [
  // 梯田的兩棟農舍（地面 596、屋脊 376：沒有踏腳台，二段跳才上得去）
  { x: HOUSES + 270, y: 376, w: 280, look: 'roof' }, { x: HOUSES + 700, y: 376, w: 260, look: 'roof' },
  ...CLIMB_LEDGES,
  // 小溪對岸的岩棚：丟苦無的忍者站在上面
  { x: CREEK + 280, y: 440, w: 220, look: 'ledge', art: 's1_rock' },
];

const solidTo = (x: number, y: number, w: number, art: string): { x: number; y: number; w: number; h: number; art: string } => ({ x, y, w, h: 596 - y, art });

export const STAGE1: StageDef = {
  id: 'stage1',
  num: 1,
  mission: '任務一',
  name: '黃昏山村 → 竹林 → 山賊寨',
  titleArt: 'ui_stage1_title',
  panels: 's1',
  length: 42000,
  start: 260,
  timeLimit: 1000,
  terrain: T.build(),
  zones: [
    { from: 0, name: '黃昏山村', ground: 's1_1_ground', far: 's1_1_far', leaves: 'maple', sky: '#f3a46b' },
    { from: S1_SECTIONS.terrace, name: '梯田坡道', ground: 's1_terrace', far: 's1_1_far', leaves: 'maple', sky: '#f3a46b' },
    { from: S1_SECTIONS.bamboo, name: '竹林', ground: 's1_2_ground', far: 's1_2_far', leaves: 'bamboo', sky: '#f0b27a' },
    { from: S1_SECTIONS.stream, name: '山溪瀑布', ground: 's1_rock', far: 's1_2_far', leaves: 'firefly', sky: '#b86a8a', wall: 's1_rock', water: true },
    { from: S1_SECTIONS.trail, name: '山路', ground: 's1_trail', far: 's1_3_far', leaves: 'firefly', sky: '#a45f86', wall: 's1_rock' },
    { from: S1_SECTIONS.fort, name: '山賊寨', ground: 's1_3_ground', far: 's1_3_far', leaves: 'ember', sky: '#e88a6a' },
  ],
  platforms: [...OLD_PLATFORMS.map((p) => ({ ...p, x: sh(p.x) })), ...NEW_PLATFORMS],
  decks: OLD_DECKS.map((d) => ({ ...d, x: sh(d.x) })),
  props: OLD_PROPS.map((p) => ({ ...p, x: shProp(p.x) })),
  fore: OLD_FORE.map((f) => ({ ...f, x: shProp(f.x) })),
  // 第二版（09-28 使用者：不要長篇教學、讓玩家自己發現）：關卡裡不跳教學字幕，按鍵一覽只在標題、暫停畫面
  hints: [],
  breakables: [
    ...OLD_BREAKABLES.map((b) => ({ ...b, x: sh(b.x) })),
    // 梯田
    { x: TER_TOP + 200, kind: 'crate', drop: 'onigiri' }, { x: HOUSES + 120, kind: 'barrel' }, { x: DITCH + 300, kind: 'crate', drop: 'fish' },
    // 山溪
    { x: 25100, kind: 'crate', drop: 'fish' }, { x: S1_SECTIONS.gorge + 250, kind: 'crate', drop: 'onigiri' }, { x: CREEK + 560, kind: 'barrel' },
    // 山路
    { x: PINCER2 + 620, kind: 'crate', drop: 'onigiri' }, { x: LOG + 600, kind: 'barrel', drop: 'fish' },
  ],
  captives: [
    ...OLD_CAPTIVES.map((c) => ({ ...c, x: sh(c.x) })),
    // 自己發現的獎勵（不提示）：梯田農舍屋頂、瀑布頂、原木高台上
    { x: HOUSES + 410, y: 376, art: 'white', drop: 'C' },
    { x: 27745, y: -850, art: 'siamese', drop: 'R' },
    { x: LOG + 200, y: 266, art: 'black', drop: 'B' },
  ],
  solids: [
    // 瀑布大攀爬：夾縫左壁（懸空，底下留 20 走得過去）、瀑布頂（右邊整面岩壁）、往下三階大岩塊
    { x: 27180, y: -1000, w: 110, h: 426, art: 's1_rock' },
    solidTo(SUMMIT, -850, 410, 's1_rock'),
    solidTo(27950, -560, 400, 's1_rock'), solidTo(28350, -270, 400, 's1_rock'), solidTo(28750, 20, 350, 's1_rock'),
    // 溪谷的矮夾縫（練習場那一道的樣子：左邊懸空、右邊 330 高，中間 260 寬；掉下去不扣血）
    { x: GORGE_SHAFT, y: 206, w: 160, h: 224, art: 's1_rock' }, solidTo(GORGE_SHAFT + 420, 266, 200, 's1_rock'),
    // 山路的原木高台（330 高，梯子爬上去）
    solidTo(LOG, 266, 400, 's1_log'),
  ],
  climbs: [
    { x: 26450, top: -324, bottom: 36, art: 's1_vine' },
    { x: LOG - 20, top: 266, bottom: 596, art: 's1_ladder' },
  ],
  vscroll: [{ x0: S1_SECTIONS.climb, x1: S1_SECTIONS.gorge + 100, top: -1350, hold: HOLD, release: -700, bg: 's1_mid' }],
  shafts: [
    { x0: 27290, x1: SUMMIT, top: -850, bottom: -404 },
    { x0: GORGE_SHAFT + 160, x1: GORGE_SHAFT + 420, top: 266, bottom: 596 },
  ],
  waterfalls: [{ x: 27010, top: -1000, bottom: 630, art: 's1' }],
  spawns: ([
    ...OLD_SPAWNS.map((s) => ({ ...s, at: shAt(s.at), ...(s.x !== undefined ? { x: sh(s.x) } : {}) })),
    // ── 梯田坡道（鼠兵、野豬從坡頂衝下來；烏鴉）──
    { at: 10300, kind: 'rat', from: 'right', count: 3, gap: 0.5 },
    { at: 10800, kind: 'crow_small', from: 'top', count: 2, gap: 0.8 },
    { at: 11100, kind: 'orange_bandit', from: 'place', x: TER_TOP + 420, act: 'patrol' },
    { at: 11600, kind: 'wild_boar', from: 'right' },
    { at: 12200, kind: 'rat', from: 'left', count: 3, gap: 0.4 },
    { at: 12500, kind: 'black_ninja', from: 'place', x: HOUSES + 830, plat: true, act: 'sleep' },
    { at: 13000, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.0 },
    { at: 13500, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 14300, kind: 'black_ninja', from: 'place', x: DIKE + 380 },
    { at: 14600, kind: 'rat', from: 'right', count: 4, gap: 0.35 },
    { at: 15300, kind: 'wild_boar', from: 'right' },
    { at: 15800, kind: 'rat', from: 'hole', x: DITCH + 280, count: 4, gap: 0.45 },
    // 兩頭夾擊（灌溉渠之後才出，左邊來的不會卡在渠邊）
    { at: PINCER1 - 150, kind: 'orange_bandit', from: 'right', count: 2, gap: 0.9, lock: true },
    { at: PINCER1 - 150, kind: 'rat', from: 'left', count: 3, gap: 0.5, lock: true },
    { at: 17300, kind: 'crow_small', from: 'top', count: 3, gap: 0.6 },
    { at: 17800, kind: 'rat', from: 'right', count: 5, gap: 0.3 },
    // ── 山溪瀑布 ──
    { at: 24300, kind: 'crow_small', from: 'top', count: 2, gap: 0.8 },
    { at: 24600, kind: 'black_ninja', from: 'place', x: 25420 },
    { at: 25100, kind: 'rat', from: 'right', count: 3, gap: 0.45 },
    { at: 26250, kind: 'orange_bandit', from: 'place', x: 27860, act: 'camp' },   // 瀑布頂
    { at: 27300, kind: 'black_ninja', from: 'place', x: 28520 },                  // 第二階大岩塊上
    { at: 28300, kind: 'rat', from: 'right', count: 3, gap: 0.4 },
    { at: 28700, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 29300, kind: 'black_ninja', from: 'place', x: CREEK + 390, plat: true },
    { at: 29600, kind: 'rat', from: 'right', count: 4, gap: 0.35 },
    { at: 30300, kind: 'wild_boar', from: 'right' },
    { at: 30800, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.0 },
    // ── 山路 ──
    { at: 31700, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 32300, kind: 'rat', from: 'right', count: 4, gap: 0.3, lock: true },
    { at: 32300, kind: 'rat', from: 'left', count: 3, gap: 0.4, lock: true },
    { at: 32500, kind: 'wild_boar', from: 'right', lock: true },
    { at: 33200, kind: 'black_ninja', from: 'place', x: PINCER2 + 1080 },
    // 原木高台的山賊等球球翻過高台才出（早出的會走到高台右邊的壁前站著，球球跳下去正好落在兩隻中間）
    { at: LOG + 300, kind: 'orange_bandit', from: 'right', count: 2, gap: 1.0 },
    { at: 34700, kind: 'rat', from: 'hole', x: LOG + 900, count: 4, gap: 0.45 },
    { at: 35200, kind: 'crow_small', from: 'top', count: 2, gap: 0.7 },
    { at: 35700, kind: 'wild_boar', from: 'left' },
  ] as SpawnDef[]).sort((a, b) => a.at - b.at),
  bosses: OLD_BOSSES.map((b) => ({ ...b, at: shAt(b.at) })),
};
