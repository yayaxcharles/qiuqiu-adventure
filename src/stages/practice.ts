/**
 * 動作練習場：原本的動作測試場（一塊平地、四塊木板、三根木樁人），用同一套關卡格式寫。
 * 給轉動作圖的人看新動作、給 tools/game_check.mjs 量手感用。標題畫面按 R 進來。
 */
import { TerrainBuilder } from '../terrain';
import type { StageDef } from './types';

export const PRACTICE: StageDef = {
  id: 'practice',
  num: 0,
  mission: '練習',
  name: '動作練習場',
  titleArt: 'ui_stage1_title',
  panels: 's1',
  length: 3400,
  start: 220,
  timeLimit: 9999,
  terrain: new TerrainBuilder(596).flat(3400).build(),
  zones: [{ from: 0, name: '練習場', ground: 's1_1_ground', far: 's1_1_far', leaves: 'maple', sky: '#f3a46b' }],
  platforms: [
    { x: 560, y: 470, w: 230, look: 'plank' }, { x: 1080, y: 372, w: 210, look: 'plank' },
    { x: 1560, y: 470, w: 260, look: 'plank' }, { x: 2350, y: 420, w: 240, look: 'plank' },
  ],
  props: [],
  breakables: [],
  captives: [],
  spawns: [900, 1880, 2750].map((x) => ({ at: 0, kind: 'dummy' as const, from: 'place' as const, x })),
  bosses: [],
};
