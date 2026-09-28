/** 關卡清單：新增一關＝寫一個 stageN.ts、加進這裡 */
import { PRACTICE } from './practice';
import { STAGE1 } from './stage1';
import { STAGE2 } from './stage2';
import { STAGE3 } from './stage3';
import type { StageDef } from './types';

export const STAGES: readonly StageDef[] = [STAGE1, STAGE2, STAGE3];
export { PRACTICE };
