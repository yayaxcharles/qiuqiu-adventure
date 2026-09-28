/**
 * 音效與配樂。音效全部用 Web Audio 在程式裡即時合成（src/audio/）；配樂用爪破魔塔的配樂檔（public/bgm/，
 * 串流播放，見 audio/bgm.ts），載不到才退回程式合成的曲子。
 * game.ts 每一格把遊戲事件丟進 play()；這裡決定響哪個聲音、要不要節流，
 * 也從事件推算現在在哪一關、是不是魔王戰，換對應的配樂。
 *
 * 瀏覽器規定使用者動作之後才能出聲：模組一載入就自己掛 keydown／pointerdown 去喚醒；按 M 切換靜音。
 * 沒有 AudioContext 的環境（Node 測試、無頭檢查）只記錄、不出聲，也不報錯。
 */
import type { GameEvent } from './entities';
import { buildMaster, type Master } from './audio/engine';
import { BGM, BgmPlayer } from './audio/bgm';
import { SFX_DEFS } from './audio/sfxDefs';
import { makeRng, playSfx, sfxDuration } from './audio/synth';
import { Throttle } from './audio/throttle';
import { STAGES } from './stages';

/** 遊戲事件 → 音效名稱（有變體的事件在 resolveSfx 裡再細分） */
export const SFX_MAP: Record<string, string> = {
  missionStart: 'mission_start', missionComplete: 'mission_complete',
  fire: 'throw', sub: 'throw_bomb', explode: 'explosion', claw: 'claw_hit',
  kill: 'enemy_down', notice: 'enemy_notice', enemyAttack: 'enemy_attack',
  playerHurt: 'player_hurt', playerDown: 'player_down', respawn: 'respawn',
  captiveFreed: 'thank_you', pickup: 'pickup', break: 'break',
  bossEnter: 'boss_warning', bossPhase: 'boss_roar', bossDown: 'boss_down', partBroken: 'part_break',
  thorns: 'thorns', smoke: 'smoke', fellInPit: 'fall', continuePrompt: 'continue', result: 'result',
  // 後來加的：靠血量換階段的魔王、打掉敵人子彈、敵人掉出畫面、被舌頭抓、狸大人分身散掉、忍具打中敵人、
  // 鐵羅漢正面擋掉忍具、時間到扣命、提示字、石獅守著的封印、敵人分裂
  bossPhaseStart: 'boss_roar', bulletShot: 'deflect', fell: 'enemy_down', grabbed: 'enemy_bite', cloneGone: 'smoke', hit: 'hit',
  blocked: 'block_clang', timeUp: 'time_up', hint: 'hint', sealed: 'deflect', split: 'enemy_water',
};

/** 每種忍具各自的丟出聲 */
export const WEAPON_SFX: Record<string, string> = {
  shuriken: 'throw', H: 'throw_bo', R: 'throw_fuma', F: 'throw_flame', S: 'throw_caltrop',
  L: 'throw_chain', C: 'throw_crane', I: 'throw_mouse', D: 'throw_yarn', B: 'throw_dart',
};

/** 敵人招式名 → 聲音（照 enemies.ts／enemies2.ts 送的 move 文字比對，比不到就用揮擊聲） */
export const MOVE_SFX: [RegExp, string][] = [
  [/吸/, 'enemy_wind'],
  [/震波|壓|踩踏|小震|砸水花/, 'enemy_slam'],
  [/苦無|魚骨|扇子|葉子|吐回來/, 'enemy_throw'],
  [/火球|狐火|鼓爆|光彈|飛彈|垃圾彈/, 'enemy_fire'],
  [/噴水|泡泡/, 'enemy_water'],
  [/叫|分身|石像|放出/, 'enemy_summon'],
  [/咬|撲|舌頭/, 'enemy_bite'],
  [/衝鋒|衝撞|滾|竄/, 'enemy_charge'],
  [/俯衝/, 'enemy_dive'],
  [/風/, 'enemy_wind'],
];

/** 程式裡會用到的所有音效名稱（測試用來確認每個都有合成定義） */
export const ALL_SFX_NAMES: string[] = [...new Set([
  ...Object.values(SFX_MAP), ...Object.values(WEAPON_SFX), ...MOVE_SFX.map(([, n]) => n),
  'explosion_big', 'pickup_weapon', 'break_barrel', 'break_big', 'countdown_tick',
])];

/** 這個事件該響哪個聲音（沒有就 null） */
export function resolveSfx(ev: GameEvent): string | null {
  switch (ev.type) {
    case 'fire': return WEAPON_SFX[String(ev.weapon)] ?? 'throw';
    case 'explode': return ev.big ? 'explosion_big' : 'explosion';
    case 'enemyAttack': {
      const move = String(ev.move ?? '');
      return MOVE_SFX.find(([re]) => re.test(move))?.[1] ?? 'enemy_attack';
    }
    case 'pickup': return ev.kind === 'fish' || ev.kind === 'onigiri' ? 'pickup' : 'pickup_weapon';
    case 'break': return ev.kind === 'barrel' ? 'break_barrel' : ev.kind === 'tower' || ev.kind === 'gate' ? 'break_big' : 'break';
    default: return SFX_MAP[ev.type] ?? null;
  }
}

/** 這些不管多吵都要響（整體上限不擋它們） */
const IMPORTANT = new Set(['mission_start', 'mission_complete', 'boss_warning', 'boss_roar', 'boss_down', 'player_hurt', 'player_down',
  'continue', 'countdown_tick', 'result', 'thank_you', 'pickup_weapon', 'pickup', 'time_up']);

export const sfxLog: string[] = [];
/** 真的排進去播的次數、被節流擋掉的次數（自動檢查用） */
export const sfxStats = { played: 0, throttled: 0 };

const rng = makeRng();
const throttle = new Throttle(20);
let ctx: AudioContext | null = null;
let master: Master | null = null;
let music: BgmPlayer | null = null;
let recDest: MediaStreamAudioDestinationNode | null = null;
let muted = false;
/** 節流用的時鐘換了（沒聲音時用系統時間、有聲音後用音訊時鐘）就把節流紀錄清掉 */
let clockKind: 'perf' | 'audio' = 'perf';

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = g.AudioContext ?? g.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
    master = buildMaster(ctx);
    master.mute.gain.value = muted ? 0 : 1;
    music = new BgmPlayer(ctx, master.music, rng);
    ctx.onstatechange = syncMusic;   // 能出聲了（使用者按了鍵、切回分頁）就補放該放的歌
  } catch {
    ctx = null; master = null; music = null;
  }
  return ctx;
}

const running = (): boolean => !!ctx && ctx.state === 'running';

/** 該放的歌（want）還沒在放就放；已經是這首但還沒放起來（剛解鎖）就補放 */
function syncMusic(): void {
  if (!running() || !music) return;
  if (music.playing !== want) music.play(want);
  else music.resume();
}

// ───────────── 配樂：從事件推現在該放哪首 ─────────────

/** 這一關的配樂代號（audio/bgm.ts 的 BGM） */
let stageMusic = 'stage1';
/** 這一場魔王的配樂代號（elite／boss／finalboss） */
let bossMusic = 'boss';
/** 現在「應該」在放的配樂代號（還沒能出聲時先記著，能出聲了再補放）；一開始在標題畫面 */
let want: string | null = 'title';
/** 魔王戰中（魔王出場到倒下） */
let inBoss = false;
let bossDying = false;
/** 魔王倒下那一刻的遊戲時間（事件的 t） */
let bossDownT = 0;
let cleared = false;
let timers: ReturnType<typeof setTimeout>[] = [];
let countdown: ReturnType<typeof setInterval> | null = null;

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (countdown) { clearInterval(countdown); countdown = null; }
}
const later = (sec: number, fn: () => void): void => { timers.push(setTimeout(fn, sec * 1000)); };

/** 事件裡的關卡代號（stage1、stage2…）→ 那一關的配樂代號；看不懂的（練習場、測試關）用第一關 */
export function trackForStage(stage: unknown): string {
  const n = /(\d+)/.exec(String(stage ?? ''))?.[1];
  return n && BGM[`stage${n}`] ? `stage${n}` : 'stage1';
}

/** 魔王 → 配樂：關卡表裡不是最後一隻的（中魔王）＝elite；最後一關的最終魔王＝finalboss；其他關的魔王＝boss */
export function bossMusicFor(kind: unknown): string {
  const i = STAGES.findIndex((st) => st.bosses.some((b) => b.kind === kind));
  if (i < 0) return 'boss';
  const b = STAGES[i]!.bosses.find((x) => x.kind === kind)!;
  if (!b.final) return 'elite';
  return i === STAGES.length - 1 ? 'finalboss' : 'boss';
}

/** 這一關的最終魔王的配樂（中魔王打完先預載） */
function finalBossMusic(stageId: string): string {
  const st = STAGES.find((x) => x.id === stageId);
  const b = st?.bosses.find((x) => x.final);
  return b ? bossMusicFor(b.kind) : 'boss';
}

function startMusic(id: string | null, delay = 0): void {
  want = id;
  if (!music || !running()) return;
  music.play(id, delay);
}

/** 照現在在哪一段該放的歌：魔王戰中＝魔王曲；魔王正在倒下、任務完成了＝安靜；其他＝這一關的歌 */
function phaseTrack(): string | null {
  if (cleared || bossDying) return null;
  return inBoss ? bossMusic : stageMusic;
}

function stopCountdown(): void {
  if (countdown) { clearInterval(countdown); countdown = null; }
}

function onMusicEvent(ev: GameEvent): void {
  switch (ev.type) {
    case 'missionStart':
      clearTimers(); bossDying = false; cleared = false; inBoss = false;
      stageMusic = trackForStage(ev.stage);
      startMusic(stageMusic, 1.2);   // 讓「任務開始」的號角先響完
      later(4, () => music?.preload('elite'));   // 這一關第一個魔王是中魔王：先載好
      break;
    case 'bossEnter':
      clearTimers(); bossDying = false; inBoss = true;
      bossMusic = bossMusicFor(ev.kind);
      startMusic(bossMusic, 1.5);   // 關卡曲馬上淡出，警報響完才進魔王曲
      break;
    case 'bossDown':
      bossDying = true; inBoss = false; bossDownT = Number(ev.t) || 0;
      startMusic(null);
      later(6, () => { if (bossDying && !cleared) { bossDying = false; startMusic(stageMusic); } });   // 保險
      break;
    case 'explode':
      // 魔王倒下演完（約 2.4 秒後）會大爆炸一次（scene、big）；倒下途中的小爆炸不算。
      // 同一格若沒有「任務完成」就是中魔王，回到這一關的歌
      if (bossDying && ev.from === 'scene' && ev.big && !(Number(ev.t) - bossDownT < 2)) {
        bossDying = false;
        later(0.8, () => { if (!cleared) startMusic(stageMusic); });
        later(4, () => { if (!cleared) music?.preload(finalBossMusic(stageMusic)); });
      }
      break;
    case 'missionComplete':
      clearTimers(); cleared = true; bossDying = false;
      startMusic(null);
      break;
    case 'playerDown':
      music?.duck(0.45, 0.3);
      break;
    case 'respawn':
      // 接關、重生：照現在在哪一段恢復配樂（審查低 8：不能靠倒數途中可能被清掉的 want）
      stopCountdown();
      want = phaseTrack();
      syncMusic();
      music?.duck(1, 0.8);
      break;
    case 'continuePrompt': {
      startMusic('defeat');
      // 接關倒數聲（畫面上 9 → 0，一秒一個）。畫面的倒數用遊戲時間：分頁切走、暫停時遊戲停了，這裡也不數。
      // 倒數只管「叩」聲，不碰配樂；遊戲結束由畫面切到 gameover 收掉配樂（見 setScreen）
      let n = 0;
      stopCountdown();
      countdown = setInterval(() => {
        if (holding()) return;
        n++;
        if (n < 10) playName('countdown_tick', n === 9 ? 0.8 : 1);
        else stopCountdown();
      }, 1000);
      break;
    }
  }
}

// ───────────── 畫面：暫停、標題、遊戲結束 ─────────────

/** 遊戲現在的畫面（title／play／pause／continue／gameover／result／ending） */
let screen = 'title';
/** 遊戲有直接告訴我們換畫面（onScreen）；沒有的話退回看 window.__game.screen */
let screenHooked = false;

const hidden = (): boolean => typeof document !== 'undefined' && document.hidden;
/** 該停住聲音的時候：暫停中、分頁切走 */
const holding = (): boolean => screen === 'pause' || hidden();

/** 暫停或分頁切走：整個音訊停住（配樂停在原地）；回來就從停住的地方接著放 */
function applyHold(): void {
  if (!ctx) return;
  const h = holding();
  music?.hold(h);   // 配樂檔是 <audio> 元素在放：要另外停住／接著放
  if (h) { if (ctx.state === 'running') void ctx.suspend().catch(() => {}); }
  else if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

function setScreen(s: string): void {
  if (s === screen) return;
  screen = s;
  if (s !== 'continue') stopCountdown();
  // 標題＝輕鬆的曲子；遊戲結束＝接關倒數那首（defeat）繼續放；全破結局＝ending
  if (s === 'title' || s === 'gameover' || s === 'ending') { clearTimers(); startMusic(s === 'title' ? 'title' : s === 'gameover' ? 'defeat' : 'ending'); }
  applyHold();
}

/** 遊戲換畫面時叫（game.ts 的 go() 裡叫一行就好）：暫停停住聲音、繼續接著放、回標題與遊戲結束收掉配樂 */
export function onScreen(s: string): void {
  screenHooked = true;
  setScreen(s);
}

// ───────────── 播音效 ─────────────

function playName(name: string, pitch = 1): void {
  const def = SFX_DEFS[name];
  if (!def) return;
  const live = running();
  const kind = live ? 'audio' : 'perf';
  if (kind !== clockKind) { throttle.reset(); clockKind = kind; }
  const now = live ? ctx!.currentTime + 0.01 : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  if (!throttle.allow(name, now, now + sfxDuration(def), def.max ?? 3, def.gap ?? 0.03, IMPORTANT.has(name))) { sfxStats.throttled++; return; }
  sfxStats.played++;
  if (live) {
    try { playSfx(ctx!, master!.sfx, def, now, rng, pitch); } catch { /* 出不了聲就算了，遊戲照跑 */ }
  }
}

export function play(ev: GameEvent): void {
  const name = resolveSfx(ev);
  if (typeof window !== 'undefined') ensureCtx();
  try { onMusicEvent(ev); } catch { /* 配樂出錯不影響遊戲 */ }
  if (!name) return;
  sfxLog.push(name);
  if (sfxLog.length > 80) sfxLog.shift();
  playName(name);
}

// ───────────── 靜音、錄影、喚醒 ─────────────

export function isMuted(): boolean { return muted; }

/** 現在「應該」在放哪首歌（測試、除錯用；沒有＝該安靜） */
export function musicWanted(): string | null { return want; }

export function toggleMute(): boolean {
  muted = !muted;
  if (ctx && master) {
    const g = master.mute.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(muted ? 0 : 1, now + 0.08);
  }
  return muted;
}

/** 混好音的總輸出（音效＋配樂），錄影時加進 MediaRecorder；沒有 Web Audio 就回 null */
export function getMixStream(): MediaStream | null {
  const c = ensureCtx();
  if (!c || !master) return null;
  if (!recDest) {
    recDest = c.createMediaStreamDestination();
    master.out.connect(recDest);
  }
  return recDest.stream;
}

/** 使用者按了鍵或點了畫面：建立／喚醒音訊，該放的歌還沒放就補放 */
function wake(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended' && !holding()) c.resume().catch(() => {});
  else syncMusic();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) toggleMute();
    wake();
  });
  window.addEventListener('pointerdown', wake);
  document.addEventListener('visibilitychange', applyHold);
  // 退路：遊戲還沒在換畫面時叫 onScreen 的話，每 0.2 秒看一下 window.__game.screen（main.ts 給自動檢查的入口）
  setInterval(() => {
    if (screenHooked) return;
    const scr = (window as unknown as { __game?: { screen?: string } }).__game?.screen;
    if (scr) setScreen(scr);
  }, 200);
  // 給錄影工具、除錯用
  (window as unknown as { __qqAudio: unknown }).__qqAudio = {
    getMixStream, toggleMute, isMuted, stats: sfxStats,
    state: () => ({ ctx: ctx?.state ?? 'none', music: music?.playing ?? null, source: music?.source ?? null, pos: music?.position ?? null, want, muted, screen, screenHooked }),
  };
}
