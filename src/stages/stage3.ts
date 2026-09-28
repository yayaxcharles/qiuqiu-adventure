/**
 * 第三關　鐵爪機關城：城下 → 工廠（蒸汽管走廊、輸送帶、鍛爐、升降機井）→ 天守閣頂（暴風雨）。
 *
 * 長度照背景長卷（art.json panels.s3）：中景 8 張共 12,240 像素、捲動 0.55 倍 → 最後的魔王鎖在鏡頭 19,927、關卡長 21,207（跟前兩關一樣）。
 * 中景第 1～2 張是城下（石牆、齒輪城門）、第 3～6 張是工廠（蒸汽管走廊、輸送帶、鍛爐、升降機井）、第 7～8 張天守閣（樓梯、暴風雨屋頂），
 * 分段照畫面中間看到第 3 張（世界 x 約 5,040）、第 7 張（約 16,170）切。
 * 機關城門擺在 x 4,290：沒打爛時鏡頭停在 3,310，這時背景長卷第 2 張畫的那座鐵柵城門剛好在城門圖正後面（被蓋住），畫面上不會同時看到兩座城門。
 *
 * 地形節奏：城下平地暖身（吸塵機器、空鎧武者）→ 上坡、城牆上的甲蟲砲台、被綁的村貓 1 → 城門（守門石獅，打爛石獅才打得動城門）
 *   → 工廠：蒸汽管走廊（噴口一段一段噴，等它停、或走上面的鐵走道）→ 輸送帶（往回帶的、往前帶的）→ 鍛爐（中魔王 掃地機王）
 *   → 升降機井（牆太高跳不上去，搭升降台上去）→ 天守閣：屋頂一層一層、屋脊站得上去 → 暴風雨屋頂（魔王 鐵爪機關貓，場上兩道屋脊是躲雷射、暴走的安全位置）。
 * 要改這一關只改這個檔（格式說明見 types.ts）。
 */
import { TerrainBuilder } from '../terrain';
import type { StageDef } from './types';

const T = new TerrainBuilder(596);
// ── 城下（0～5,040）──
T.flat(1200);              // 0～1200　城下入口：吸塵機器、空鎧武者
T.slope(300, -60);         // 1200～1500　上坡
T.flat(700);               // 1500～2200　城牆下：牆上的甲蟲砲台、被綁的村貓 1（給鎖鎌）
T.stairs(3, 60, 20);       // 2200～2380　下樓梯
T.flat(2660);              // 2380～5040　機關城門（x 4,290，守門石獅守著）
// ── 工廠：蒸汽管走廊（5,040～7,800）──
T.flat(1600);              // 5040～6640　蒸汽噴口一排、上面有鐵走道
T.pit(200);                // 6640～6840　坑（上面有鐵走道）
T.flat(960);               // 6840～7800　竹籠裡的村貓 2（給棒手裏劍）
// ── 工廠：輸送帶（7,800～10,600）──
T.flat(400);               // 7800～8200
T.pit(420);                // 8200～8620　輸送帶橋（往回帶）
T.flat(600);               // 8620～9220
T.pit(360);                // 9220～9580　輸送帶橋（往前帶）
T.flat(500);               // 9580～10080
T.pit(300);                // 10080～10380　輸送帶橋（往回帶，比較快）
T.flat(220);               // 10380～10600
// ── 工廠：鍛爐（10,600～14,700）──
T.flat(4100);              // 10600～14700　竹籠裡的村貓 3（給風魔大手裏劍）；中魔王 掃地機王（鏡頭 13,300）
// ── 工廠：升降機井（14,700～16,170）──
T.flat(500);               // 14700～15200　升降台（14,960～15,190）
T.cliff(-200);             // 15200　牆高 200，跳不上去，要搭升降台
T.flat(600);               // 15200～15800　上層
T.stairs(4, 60, 50);       // 15800～16040　一階一階跳下去
T.flat(130);               // 16040～16170
// ── 天守閣（16,170～21,207）──
T.flat(500);               // 16170～16670
T.slope(210, -78);         // 16670～16880　順著屋瓦往上一層
T.flat(800);               // 16880～17680　屋脊站得上去
T.slope(300, 78);          // 17680～17980　順著屋瓦往下
T.flat(600);               // 17980～18580　被綁的村貓 4（給爆裂符）
T.pit(200);                // 18580～18780　兩座屋頂中間的空隙
T.flat(2427);              // 18780～21207　暴風雨屋頂（魔王 鐵爪機關貓：鏡頭 19,927）

export const STAGE3: StageDef = {
  id: 'stage3',
  num: 3,
  mission: '任務三',
  name: '鐵爪機關城 → 工廠 → 天守閣頂',
  titleArt: 'ui_stage3_title',
  panels: 's3',
  length: 21207,
  start: 260,
  timeLimit: 600,
  terrain: T.build(),
  zones: [
    // 地面帶、崖壁直接寫 terrain.json 的鍵（第二批：城下石板路、工廠鐵格柵、天守閣瓦屋頂；城牆石垣、工廠鐵板牆）
    { from: 0, name: '機關城城下', ground: 's3_town', far: 's3_1_far', leaves: 'ember', sky: '#6a4a5a', wall: 's3_castle' },
    { from: 5040, name: '機關工廠', ground: 's3_grate', far: 's3_2_far', leaves: 'steam', sky: '#3a2a2a', wall: 's3_iron' },
    { from: 16170, name: '天守閣頂', ground: 's3_roof', far: 's3_3_far', leaves: 'rain', sky: '#2a2a44', wall: 's3_castle', storm: true },
  ],
  platforms: [
    // 城下：鐵走道（地面 596／536，高 146～150）
    { x: 600, y: 450, w: 220, look: 'catwalk' }, { x: 2560, y: 446, w: 240, look: 'catwalk' },
    // 蒸汽管走廊：噴口上面的鐵走道（從上面走就不會被噴到）、坑上的鐵走道
    { x: 5700, y: 446, w: 460, look: 'catwalk' }, { x: 6560, y: 470, w: 360, look: 'catwalk' },
    // 輸送帶：坑上的輸送帶橋（跟地面一樣高）、架高的一條；belt＝每秒帶走幾像素（負的往回帶）
    { x: 8180, y: 596, w: 460, look: 'conveyor', belt: -120 },
    { x: 9200, y: 596, w: 400, look: 'conveyor', belt: 140 },
    { x: 9660, y: 450, w: 320, look: 'conveyor', belt: -100 },
    { x: 10060, y: 596, w: 340, look: 'conveyor', belt: -150 },
    // 鍛爐：鐵走道；中魔王場（鏡頭 13,300）兩條鐵走道＝躲掃地機王衝撞的地方
    { x: 11300, y: 446, w: 260, look: 'catwalk' }, { x: 12400, y: 446, w: 260, look: 'catwalk' },
    { x: 13520, y: 446, w: 240, look: 'catwalk' }, { x: 14120, y: 446, w: 240, look: 'catwalk' },
    // 升降機井：升降台（地面 596 ↔ 上層 396，上下各停 1.2 秒、走一趟 1.6 秒）
    { x: 14960, y: 596, w: 230, look: 'lift', lift: { y1: 396, travel: 1.6, stop: 1.2 } },
    // 天守閣：屋脊（站得上去）；魔王場上兩道屋脊＝躲雷射（低的）、暴走衝撞的安全位置
    { x: 17100, y: 368, w: 200, look: 'ridge' }, { x: 18060, y: 446, w: 200, look: 'ridge' },
    { x: 20140, y: 446, w: 190, look: 'ridge' }, { x: 20760, y: 446, w: 190, look: 'ridge' },
  ],
  // 蒸氣噴口：每 period 秒噴一次（先冒小煙 0.6 秒，再噴 0.9 秒）
  vents: [
    { x: 5400, period: 3.0, offset: 0 }, { x: 5820, period: 3.0, offset: 1.5 }, { x: 6060, period: 3.0, offset: 0.4 },
    { x: 6480, period: 2.6, offset: 1.0 }, { x: 7050, period: 3.0, offset: 2.0 },
    { x: 11000, period: 3.2, offset: 0 }, { x: 12150, period: 3.0, offset: 1.2 },
  ],
  props: [],
  // 最前景（art.json panels.s3.fore）：0 吊鉤鐵鍊、1 直立蒸汽管、2 鐵欄杆、3 大齒輪、4 破布旗、5 鋼樑柱
  fore: [
    { x: 1500, item: 4 }, { x: 6200, item: 1 }, { x: 8900, item: 0 }, { x: 11000, item: 3 },
    { x: 12500, item: 5 }, { x: 15500, item: 2 }, { x: 17800, item: 4 },
  ],
  hints: [
    { at: 2400, text: '鐵羅漢正面擋手裏劍', sub: '從背後打、用爆裂符、或趁牠出拳的時候打' },
    { at: 3100, text: '城門有石獅守著：先打爛石獅，城門才打得動', sub: '' },
    { at: 5000, text: '蒸氣噴口：冒小煙就要噴了', sub: '等它停，或走上面的鐵走道' },
    { at: 14300, text: '牆太高跳不上去：站上升降台', sub: '' },
  ],
  breakables: [
    { x: 700, kind: 's3_crate', drop: 'onigiri' }, { x: 1350, kind: 's3_oil_drum' },
    { x: 2050, kind: 's3_gearbox', drop: 'fish' }, { x: 2900, kind: 's3_crate' }, { x: 3150, kind: 's3_oil_drum' }, { x: 3600, kind: 's3_crate' },
    { x: 4290, kind: 's3_gate' },
    { x: 4700, kind: 's3_crate', drop: 'onigiri' }, { x: 5250, kind: 's3_steam_pipe' }, { x: 6300, kind: 's3_gearbox' },
    { x: 7500, kind: 's3_oil_drum' }, { x: 8000, kind: 's3_crate', drop: 'fish' }, { x: 8900, kind: 's3_steam_pipe' },
    { x: 9800, kind: 's3_gearbox' }, { x: 10500, kind: 's3_oil_drum' }, { x: 11800, kind: 's3_crate', drop: 'onigiri' },
    { x: 12600, kind: 's3_steam_pipe' }, { x: 12900, kind: 's3_oil_drum', drop: 'B' },
    { x: 15500, kind: 's3_crate', drop: 'fish' }, { x: 16400, kind: 's3_gearbox' },
    { x: 17400, kind: 's3_crate' }, { x: 18100, kind: 's3_oil_drum', drop: 'onigiri' }, { x: 19200, kind: 's3_crate', drop: 'fish' },
    { x: 19500, kind: 's3_oil_drum' },
  ],
  captives: [
    { x: 1900, art: 'black', drop: 'L' },
    { x: 4850, art: 'siamese', drop: 'I' },
    { x: 7300, art: 'grey', drop: 'H', caged: true },
    { x: 11600, art: 'white', drop: 'R', caged: true },
    { x: 16550, art: 'calico_long', drop: 'bigbomb' },
    { x: 18300, art: 'tuxedo', drop: 'bomb' },
  ],
  spawns: [
    // ── 城下 ──
    { at: 0, kind: 'vacuum', from: 'place', x: 1080, act: 'patrol' },
    { at: 150, kind: 'armor_ghost', from: 'right' },
    { at: 500, kind: 'mini_broom', from: 'right', count: 3, gap: 0.5 },
    { at: 800, kind: 'vacuum', from: 'right', count: 2, gap: 1.2 },
    { at: 1000, kind: 'plated_beetle', from: 'place', x: 1960, y: 330 },
    { at: 1300, kind: 'wraith_samurai', from: 'right' },
    { at: 1600, kind: 'broom_centipede', from: 'right' },
    { at: 2000, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.6, lock: true },
    { at: 2300, kind: 'vacuum', from: 'left', count: 2, gap: 1.0 },
    { at: 2450, kind: 'iron_arhat', from: 'place', x: 3400 },
    // （機關城門 4,290：沒打爛鏡頭停在 3,310；右邊出的怪會卡在門後，這一段只從左邊、擺好的出）
    { at: 2900, kind: 'guardian_statue', from: 'place', x: 4010 },   // 不鎖畫面：城門本身就擋住鏡頭（停在 3,310），石獅沒打爛城門打不動
    { at: 3000, kind: 'plated_beetle', from: 'place', x: 3700, y: 360 },
    { at: 3250, kind: 'mini_broom', from: 'left', count: 3, gap: 0.6 },
    { at: 3500, kind: 'wraith_samurai', from: 'right' },
    { at: 3800, kind: 'mini_broom', from: 'right', count: 3, gap: 0.5 },
    { at: 4050, kind: 'iron_arhat', from: 'right' },
    // ── 工廠：蒸汽管走廊 ──
    { at: 4300, kind: 'plated_beetle', from: 'place', x: 5500, y: 380 },
    { at: 4600, kind: 'vacuum', from: 'place', x: 5620, act: 'patrol' },
    { at: 4800, kind: 'armor_ghost', from: 'right' },
    { at: 5100, kind: 'plated_beetle', from: 'place', x: 6260, y: 330 },
    { at: 5300, kind: 'mini_broom', from: 'right', count: 4, gap: 0.35 },
    { at: 5600, kind: 'wraith_samurai', from: 'right' },
    { at: 5900, kind: 'broom_centipede', from: 'right', lock: true },
    { at: 6400, kind: 'iron_arhat', from: 'right' },
    { at: 6700, kind: 'plated_beetle', from: 'place', x: 7650, y: 340 },
    { at: 6900, kind: 'vacuum', from: 'left', count: 2, gap: 1.0 },
    // ── 工廠：輸送帶 ──
    { at: 7300, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.5, lock: true },
    { at: 7600, kind: 'mini_broom', from: 'right', count: 4, gap: 0.4 },
    { at: 7900, kind: 'wraith_samurai', from: 'right' },
    { at: 8200, kind: 'plated_beetle', from: 'place', x: 9000, y: 330 },
    { at: 8500, kind: 'broom_centipede', from: 'right' },
    { at: 8800, kind: 'vacuum', from: 'right', count: 2, gap: 1.2 },
    { at: 9100, kind: 'iron_arhat', from: 'right' },
    { at: 9400, kind: 'wraith_samurai', from: 'left' },
    { at: 9700, kind: 'mini_broom', from: 'right', count: 5, gap: 0.3 },
    // ── 工廠：鍛爐 ──
    { at: 10000, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.4, lock: true },
    { at: 10300, kind: 'plated_beetle', from: 'place', x: 11200, y: 330 },
    { at: 10500, kind: 'broom_centipede', from: 'right' },
    { at: 10800, kind: 'iron_arhat', from: 'right' },
    { at: 11100, kind: 'wraith_samurai', from: 'right', count: 2, gap: 2.5 },
    { at: 11500, kind: 'vacuum', from: 'right', count: 2, gap: 1.2 },
    { at: 11800, kind: 'plated_beetle', from: 'place', x: 12720, y: 340 },
    { at: 12100, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.2, lock: true },
    { at: 12500, kind: 'mini_broom', from: 'right', count: 5, gap: 0.3 },
    { at: 12800, kind: 'iron_arhat', from: 'right' },
    // （中魔王：鏡頭 13,300）
    // ── 升降機井 ──
    { at: 13700, kind: 'wraith_samurai', from: 'right' },
    { at: 14000, kind: 'armor_ghost', from: 'right' },
    { at: 14300, kind: 'plated_beetle', from: 'place', x: 15320, y: 300 },
    { at: 14400, kind: 'vacuum', from: 'place', x: 15520, act: 'patrol' },
    { at: 14700, kind: 'armor_ghost', from: 'place', x: 15720 },
    { at: 15000, kind: 'mini_broom', from: 'right', count: 4, gap: 0.4 },
    { at: 15300, kind: 'iron_arhat', from: 'right' },
    // ── 天守閣 ──
    { at: 15700, kind: 'wraith_samurai', from: 'right' },
    { at: 16000, kind: 'broom_centipede', from: 'right' },
    { at: 16300, kind: 'plated_beetle', from: 'place', x: 17320, y: 310 },
    { at: 16500, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.5, lock: true },
    { at: 16900, kind: 'mini_broom', from: 'right', count: 4, gap: 0.4 },
    { at: 17200, kind: 'wraith_samurai', from: 'right', count: 2, gap: 2.2 },
    { at: 17600, kind: 'iron_arhat', from: 'right' },
    { at: 17900, kind: 'vacuum', from: 'right', count: 2, gap: 1.2 },
    { at: 18200, kind: 'plated_beetle', from: 'place', x: 19120, y: 380 },
    { at: 18500, kind: 'armor_ghost', from: 'right', count: 2, gap: 1.4, lock: true },
    { at: 18800, kind: 'broom_centipede', from: 'right' },
    { at: 19200, kind: 'wraith_samurai', from: 'right' },
    { at: 19400, kind: 'mini_broom', from: 'right', count: 4, gap: 0.4 },
  ],
  bosses: [
    { at: 13300, kind: 'roomba_king' },
    { at: 19927, kind: 'iron_claw', final: true },
  ],
};
