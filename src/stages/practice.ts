/**
 * 動作練習場：原本的動作測試場（一塊平地、四塊木板、三根木樁人，0～3400 不動，tools/game_check.mjs 在這裡量手感），
 * 第二版階段二在後面接一段「新動作練習」（標題畫面按 R 進來）：
 *   陡坡（坡上有木樁人、木箱）→ 250 高的牆（二段跳）→ 岩棚兩層上 330 高台 → 蹬牆夾縫（兩塊方塊夾 260 寬）→
 *   藤蔓爬上 330 高的岩塊 → 畫面往上捲的大攀爬（岩棚四層 → 藤蔓 → 蹬牆夾縫爬到 1600 高）→ 跳下來回到地面
 * 不往上捲的地方，站得到的最高處在 y 266 左右（頭在資訊欄下面；第二版規劃 5.7）。
 * 座標、高度都照物理算過（tests/v2p2.test.ts 逐段檢查「跳得上去／一定要用新動作」）。
 */
import { TerrainBuilder } from '../terrain';
import type { StageDef } from './types';

/** 山村坡帶實際畫出來的角度（v2_terrain.json slope.drawnDeg）：上坡 30.2、下坡 32.1 */
const UP = 30.2, DOWN = 32.1;
const t = new TerrainBuilder(596).flat(3700);
const upH = Math.round(300 * Math.tan(UP * Math.PI / 180));        // 175
t.slopeDeg(300, UP).flat(260).slope(Math.round(upH / Math.tan(DOWN * Math.PI / 180)), upH);
t.flat(4700 - t.x);
// 二段跳的牆：250 高（一次跳 177 上不去、二段跳約 300 上得去）
t.cliff(-250).flat(400).cliff(250).flat(400);
t.flat(10800 - t.x);

export const PRACTICE: StageDef = {
  id: 'practice',
  num: 0,
  mission: '練習',
  name: '動作練習場',
  titleArt: 'ui_stage1_title',
  panels: 's1',
  length: 10800,
  start: 220,
  timeLimit: 9999,
  terrain: t.build(),
  zones: [
    { from: 0, name: '練習場', ground: 's1_1_ground', far: 's1_1_far', leaves: 'maple', sky: '#f3a46b' },
    { from: 5300, name: '岩場', ground: 's1_rock', far: 's1_1_far', leaves: null, sky: '#e98f6a', wall: 's1_rock' },
  ],
  platforms: [
    { x: 560, y: 470, w: 230, look: 'plank' }, { x: 1080, y: 372, w: 210, look: 'plank' },
    { x: 1560, y: 470, w: 260, look: 'plank' }, { x: 2350, y: 420, w: 240, look: 'plank' },
    // 岩棚兩層（上 330 高台）
    { x: 5560, y: 470, w: 200, look: 'ledge', art: 's1_rock' }, { x: 5700, y: 350, w: 190, look: 'ledge', art: 's1_rock' },
    // 大攀爬：岩棚四層、藤蔓頂的岩棚（也是夾縫的底）
    { x: 8300, y: 450, w: 200, look: 'ledge', art: 's1_rock' }, { x: 8600, y: 310, w: 200, look: 'ledge', art: 's1_rock' },
    { x: 8300, y: 170, w: 200, look: 'ledge', art: 's1_rock' }, { x: 8600, y: 30, w: 220, look: 'ledge', art: 's1_rock' },
    { x: 8760, y: -330, w: 260, look: 'ledge', art: 's1_rock' },
  ],
  solids: [
    // 岩棚上高台：330 高的岩塊（二段跳 306 上不去），前面兩層岩棚；離下一段夾縫 450（從高台跳不過去，一定要從地面進夾縫）
    { x: 5900, y: 266, w: 350, h: 330, art: 's1_rock' },
    // 蹬牆夾縫：左邊懸空的岩塊（底下留 16 走得過去；比出口高 60：從右牆蹬出來衝過頭會再碰到左牆）、右邊落地的高岩（330 高），中間 260 寬
    { x: 6700, y: 206, w: 160, h: 224, art: 's1_rock' }, { x: 7120, y: 266, w: 160, h: 330, art: 's1_rock' },
    // 藤蔓爬上去的岩塊（330 高）
    { x: 7580, y: 266, w: 300, h: 330, art: 's1_rock' },
    // 大攀爬：夾縫左壁（懸空）、右邊整面到地的高岩（頂在 -1000）
    { x: 8640, y: -1080, w: 120, h: 750, art: 's1_rock' }, { x: 9020, y: -1000, w: 140, h: 1596, art: 's1_rock' },
  ],
  climbs: [
    { x: 7552, top: 266, bottom: 596, art: 's1_vine' },
    { x: 8780, top: -330, bottom: 30, art: 's1_vine' },
  ],
  vscroll: [{ x0: 7950, x1: 10000, top: -1500, hold: 8100, release: -900, bg: 's1_mid' }],
  shafts: [{ x0: 6860, x1: 7120, top: 266, bottom: 596 }, { x0: 8760, x1: 9020, top: -1000, bottom: -330 }],
  props: [],
  breakables: [{ x: 3790, kind: 'crate', drop: 'fish' }],
  captives: [],
  spawns: [
    ...[900, 1880, 2750].map((x) => ({ at: 0, kind: 'dummy' as const, from: 'place' as const, x })),
    { at: 3000, kind: 'dummy', from: 'place', x: 3930 },
  ],
  bosses: [],
};
