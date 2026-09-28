/**
 * 怪物的逐格動畫（2026-09-26 使用者：「怪物也需要用 vids 做吧？不然很不流暢？」）：
 * Vids 生的動作片轉成 public/sprites/monsters/<怪>/<動作>/，這裡照每隻怪「現在在做什麼」挑片段、決定播到哪一格。
 *
 * 對齊原則：
 *   - 出招分「蓄力」和「出手」兩個狀態（enemies.ts 的 windup → bite／swing／throw…）。蓄力狀態把片段從頭播到出手格的前一格，
 *     播放速度照蓄力的秒數算好，狀態一換到出手，畫面剛好是出手格（hit）——傷害判定、苦無飛出去都在這一格。
 *   - 中途換過別的片段（例如被打的受傷格）再回來，照「這個狀態已經過了幾秒」快轉，不會從頭播而跟判定錯開。
 *   - 受傷：down 片段開頭那一小段（到 hurtEnd，約 0.3 秒）再回原本的動作；只插在走路、待機時，蓄力中被打不插（預兆不能被蓋掉）。
 *   - 沒有片段的招式回傳 null，畫面退回原本的單張立繪＋程式動感。
 * 純邏輯（Animator 不碰畫面），測試直接餵。
 */
import type { Enemy } from './entities';
import type { AnimDefs } from './sprite';

/** 一段要播的片段：from／to 可以寫標記名（hit、hurtEnd…）或格號，負數＝從尾巴倒數；dur＝這一段要剛好在幾秒內播完 */
export interface ClipSpec {
  name: string;
  from?: number | string;
  to?: number | string;
  dur?: number;
  rate?: number;
  loop?: boolean;
  /** 從這個狀態開始後經過的秒數（中途換回來時快轉用）；不給＝不快轉 */
  since?: number;
}

const HURT_TIME = 0.3;
const LIGHT = new Set(['rat', 'orange_bandit', 'black_ninja', 'wild_boar', 'lantern_ghost', 'kasa_obake', 'kappa', 'mask_dancer', 'fox_miko', 'tengu',
  'vacuum', 'mini_broom', 'iron_arhat', 'armor_ghost', 'plated_beetle', 'wraith_samurai', 'guardian_statue']);

function resolve(defs: AnimDefs, name: string, v: number | string | undefined, dflt: number): number {
  const d = defs[name]!;
  const n = d.frames.length;
  if (v === undefined) return dflt;
  if (typeof v === 'string') {
    const m = /^([a-zA-Z0-9]+)([+-]\d+)?$/.exec(v);
    const base = m ? d.markers[m[1]!] : undefined;
    return Math.max(0, Math.min(n - 1, (base ?? dflt) + (m?.[2] ? Number(m[2]) : 0)));
  }
  return Math.max(0, Math.min(n - 1, v < 0 ? n + v : v));
}

/** 照 spec 播：同一段就接著播，換段才重來（並照 since 快轉） */
export function applyClip(e: Enemy, defs: AnimDefs, c: ClipSpec): boolean {
  const an = e.anim;
  if (!an || !defs[c.name]) return false;
  const d = defs[c.name]!;
  const from = resolve(defs, c.name, c.from, 0);
  const to = Math.max(from, resolve(defs, c.name, c.to, d.frames.length - 1));
  const frames = to - from + 1;
  const rate = c.rate ?? (c.dur ? frames / d.fps / Math.max(0.05, c.dur) : 1);
  const loop = c.loop ?? false;
  const same = an.name === c.name && e.mem.animFrom === from && e.mem.animTo === to && !!e.mem.animLoop === loop;
  if (!same) {
    an.play(c.name, loop ? { restart: true, from, loop: true, rate } : { restart: true, from, to, rate });
    e.mem.animFrom = from; e.mem.animTo = to; e.mem.animLoop = loop ? 1 : 0;
    if (c.since && c.since > 0) an.update(c.since);
  } else an.rate = rate;
  return true;
}

/**
 * 這一格要播什麼（每隻怪的對照表）。回傳 null＝沒有對應的片段，畫單張立繪。
 * speed＝這一格實際移動的速度（像素／秒），走路、跑步的播放速度跟著它。
 */
export function pickClip(e: Enemy, defs: AnimDefs, speed: number): ClipSpec | null {
  const has = (n: string): boolean => !!defs[n];
  const s = e.state, t = e.t;
  const moving = speed > 25;
  const loopRun = (name: string, perPx: number, min = 0.35): ClipSpec => ({ name, loop: true, rate: Math.max(min, speed * perPx) });
  // 死了
  if (e.dying > 0) {
    if (e.mem.ko && has('down')) return { name: 'down', from: 0, dur: (defs.down!.frames.length / 24) / 1.7 };
    if (has('down')) return { name: 'down', from: 0, to: 'hurtEnd', dur: HURT_TIME };
    // 沒有倒下片段（烏鴉、小狸）：停在死的那一格，照舊轉圈飛出去（不要換回單張立繪，畫風會跳）
    const an = e.anim;
    if (an && an.name && defs[an.name]) { e.mem.deadFrame ??= an.frame; return { name: an.name, from: e.mem.deadFrame, to: e.mem.deadFrame }; }
    return null;
  }
  // 受傷（只插在走路、待機）
  if ((e.mem.hurtT ?? 0) > 0 && LIGHT.has(e.kind) && has('down') && !/wind|swing|bite|throw|charge|swoop/.test(s)) {
    return { name: 'down', from: 0, to: 'hurtEnd', dur: HURT_TIME, since: HURT_TIME - (e.mem.hurtT ?? 0) };
  }
  switch (e.kind) {
    case 'rat':
      if (s === 'surprised') return { name: 'down', from: 1, to: 'hurtEnd', dur: 0.5, since: t };
      if (!e.aware) return moving ? loopRun('run', 0.0035) : { name: 'idle', loop: true };
      if (s === 'windup') return { name: 'attack', from: 4, to: 'hit-1', dur: 0.3, since: t };
      if (s === 'bite') return { name: 'attack', from: 'hit', to: 'hit+10', dur: 0.22, since: t };
      if (s === 'recover') return { name: 'attack', from: 'hit+11', to: -1, dur: 0.45, since: t };
      if (!e.onGround) return { name: 'run', from: 4, to: 4 };
      return moving ? loopRun('run', 0.0045) : { name: 'idle', loop: true };
    case 'orange_bandit':
      if (s === 'surprised') return { name: 'down', from: 1, to: 'hurtEnd', dur: 0.5, since: t };
      if (s === 'windup') return { name: 'attack', from: 6, to: 'hit-1', dur: 0.5, since: t };
      if (s === 'swing') return { name: 'attack', from: 'hit', to: 'hit+6', dur: 0.22, since: t };
      if (s === 'recover') return { name: 'attack', from: 'hit+7', to: 'hit+30', dur: 0.6, since: t };
      if (e.stun > 0) return { name: 'down', from: 0, to: 'hurtEnd', dur: 0.25 };
      if (s === 'flee') return loopRun('walk', 0.012);
      return moving ? loopRun('walk', 0.009) : { name: 'idle', loop: true };
    case 'black_ninja':
      if (s === 'surprised') return { name: 'down', from: 1, to: 'hurtEnd', dur: 0.5, since: t };
      if (!e.onGround) return { name: 'run', from: 5, to: 5 };
      if (!e.aware && e.act === 'sleep') return { name: 'idle', from: 0, to: 0 };
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.5, since: t };
      if (s === 'throw') return { name: 'attack', from: 'hit', to: 'hit+16', dur: 0.35, since: t };
      if (s === 'flee') return loopRun('run', 0.006);
      return moving ? loopRun('run', 0.0055) : { name: 'idle', loop: true };
    case 'crow_small':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.45, since: t };
      if (s === 'swoop') return { name: 'attack', from: 'hit', to: 'hit+3', dur: 0.2, since: t };
      return { name: 'fly', loop: true, rate: s === 'leave' ? 1.4 : 1 };
    case 'wild_boar':
      if (s === 'dizzy') return { name: 'down', from: 0, to: 'hurtEnd', dur: 0.4 };
      if (!e.aware) return { name: 'run', from: 0, to: 0 };
      if (s === 'windup') return { name: 'run', loop: true, rate: 0.35 };
      if (s === 'charge') return { name: 'run', loop: true, rate: 1.6 };
      return { name: 'run', loop: true, rate: moving ? Math.max(0.5, speed * 0.004) : 0.3 };
    case 'tanuki_kid':
      if (!e.onGround) return { name: 'run', from: 8, to: 8 };
      return { name: 'run', loop: true, rate: s === 'crouch' ? 0.2 : 1.1 };
    case 'drum_tanuki': {
      const low = e.hp < e.maxHp * 0.5;
      if (s === 'die') return { name: 'down', from: 0, dur: 2.2, since: t };
      if (s === 'waveWind') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.75, since: t };
      if (s === 'wave') return low ? { name: 'attack', from: 'hit', to: 'hit2', dur: 0.45, since: t } : { name: 'attack', from: 'hit', to: 'hit+14', dur: 0.9, since: t };
      if (s === 'blastWind') return { name: 'attack', from: 'hit2-12', to: 'hit2-1', dur: 0.55, since: t };
      if (s === 'blast') return { name: 'attack', from: 'hit2', to: 'hit2+12', dur: 0.5, since: t };
      if (s === 'summonWind') return { name: 'attack', from: 0, to: 'hit3', dur: 0.6, since: t };
      if (s === 'hopWind') return { name: 'attack', from: 0, to: 0 };
      if (s === 'hopAir') return { name: 'walk', from: 6, to: 6 };
      return { name: 'walk', loop: true, rate: moving ? Math.max(0.6, speed * 0.006) : 0.45 };
    }
    case 'orange_king': {
      if (!e.p2) {
        switch (s) {
          case 'start': case 'enter': return { name: 'slam', from: 'air', to: 'air' };
          case 'roar': return { name: 'throw', from: -8, to: -1, dur: 1.2, since: t };
          case 'bellyWind': return { name: 'slam', from: 0, to: 'jump', dur: 0.6, since: t };
          case 'belly': return { name: 'slam', from: 'air', to: 'land-1', dur: 0.9, since: t };
          case 'fishWind': return { name: 'throw', from: 0, to: 'hit-1', dur: 0.5, since: t };
          case 'fishThrow': return { name: 'throw', from: 'hit', to: 'hit+18', dur: 0.5, since: t };
          case 'rollWind': return { name: 'curl', from: 0, dur: 0.7, since: t };
          case 'roll': return { name: 'roll', loop: true, rate: 1.6 };
          case 'recover':
            if (e.prevState === 'roll') return { name: 'uncurl', from: 0, dur: 0.8, since: t };
            if (e.prevState === 'belly') return { name: 'slam', from: 'land', to: -1, dur: 0.9, since: t };
            if (e.prevState === 'fishThrow') return { name: 'throw', from: 'hit+18', to: -1, dur: 0.5, since: t };
            return { name: 'walk', loop: true, rate: 0.6 };
          case 'break': return { name: 'rage', from: 0, dur: 1.6, since: t };
          default: return { name: 'walk', loop: true, rate: 0.6 };
        }
      }
      // 第二階段：走路、倒下、跳起來（肚皮壓、泰山壓頂）有片段；滾、丟魚骨頭 Vids 生不出來，退回二階單張立繪（程式動感）
      const J = has('jump_p2');
      switch (s) {
        case 'die': return has('down_p2') ? { name: 'down_p2', from: 0, dur: 2.2, since: t } : null;
        case 'roll': case 'fishWind': case 'fishThrow': return null;
        case 'bellyWind': return J ? { name: 'jump_p2', from: 0, to: 'jump', dur: 0.45, since: t } : { name: 'walk_p2', from: 0, to: 0 };
        case 'belly': return J ? { name: 'jump_p2', from: 'jump', to: 'land-1', dur: 0.9, since: t } : null;
        case 'crushWind': return J ? { name: 'jump_p2', from: 0, to: 'jump', dur: 0.4, since: t } : { name: 'walk_p2', from: 0, to: 0 };
        case 'crushUp': return J ? { name: 'jump_p2', from: 'jump', to: 'jump' } : null;
        case 'crushFall': return J ? { name: 'jump_p2', from: 'land-4', to: 'land-1', dur: 0.3, since: t } : null;
        case 'recover':
          if (J && (e.prevState === 'belly' || e.prevState === 'crushFall')) return { name: 'jump_p2', from: 'land', to: -1, dur: e.prevState === 'belly' ? 0.6 : 1.0, since: t };
          return has('walk_p2') ? { name: 'walk_p2', loop: true, rate: 0.8 } : null;
        case 'rollWind': return { name: 'walk_p2', from: 0, to: 0 };
        default: return has('walk_p2') ? { name: 'walk_p2', loop: true, rate: s === 'roar' ? 1.4 : 0.8 } : null;
      }
    }
    // ── 第二關 ──
    case 'lantern_ghost':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.6, since: t };
      if (s === 'spit') return { name: 'attack', from: 'hit', to: -1, dur: 0.6, since: t };
      return { name: 'float', loop: true };
    case 'kasa_obake':
      if (!e.aware || s === 'crouch') return { name: 'shut', from: 0, to: -1, dur: 0.3, since: t };
      return { name: 'hop', loop: true, rate: e.onGround ? 0.6 : 1.3 };
    case 'paper_crane': return { name: 'fly', loop: true, rate: 1.4 };
    case 'kappa':
      if (s === 'aim') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.5, since: t };
      if (s === 'spit') return { name: 'attack', from: 'hit', to: -1, dur: e.mem.water ? 0.8 : 0.7, since: t };
      return moving ? loopRun('walk', 0.009) : { name: 'walk', from: 0, to: 0 };
    case 'mask_dancer':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.6, since: t };
      if (s === 'throw') return { name: 'attack', from: 'hit', to: -1, dur: 0.7, since: t };
      return moving ? loopRun('walk', 0.008) : { name: 'walk', from: 0, to: 0 };
    case 'fox_miko':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.7, since: t };
      if (s === 'cast') return { name: 'attack', from: 'hit', to: -1, dur: 0.9, since: t };
      return { name: 'idle', loop: true };
    case 'tengu':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.6, since: t };
      if (s === 'gust') return { name: 'attack', from: 'hit', to: 'end', dur: 0.9, since: t };
      return { name: 'fly', loop: true };
    case 'tadpole': return { name: 'swim', loop: true, rate: 1.3 };
    case 'frog_daimyo':
      if (s === 'die') return has('down_p2') ? { name: 'down_p2', from: 0, dur: 2.2, since: t } : null;
      if (s === 'change') return { name: 'change', from: 0, to: -1, dur: 2.4, since: t };
      if (!e.p2) {
        switch (s) {
          case 'tongueWind': return { name: 'tongue', from: 0, to: 'hit-1', dur: 0.6, since: t };
          case 'tongue': return { name: 'tongue', from: 'hit', to: -1, dur: 0.75, since: t };
          case 'jumpWind': return { name: 'jump', from: 0, to: 'jump', dur: 0.55, since: t };
          case 'jumpAir': return { name: 'jump', from: 'air', to: 'land-1', dur: 0.8, since: t };
          case 'splash': return { name: 'jump', from: 'land', to: 'up-1', dur: 0.6, since: t };
          case 'recover': if (e.prevState === 'splash') return { name: 'jump', from: 'up', to: -1, dur: 0.5, since: t }; break;
          case 'summonWind': return { name: 'walk', loop: true, rate: 2.2 };
          default: break;
        }
        return { name: 'walk', loop: true, rate: moving ? 1 : 0.5 };
      }
      // 二階：舌頭、跳（09-26 補的片段）；鼓頰蓄力停在走路第一格（程式把臉頰撐大）
      if (has('tongue_p2')) {
        if (s === 'tongueWind') return { name: 'tongue_p2', from: 0, to: 'hit-1', dur: 0.45, since: t };
        if (s === 'tongue') return { name: 'tongue_p2', from: 'hit', to: -1, dur: 0.87, since: t };
      }
      if (has('jump_p2')) {
        if (s === 'jumpWind') return { name: 'jump_p2', from: 0, to: 'jump', dur: 0.55, since: t };
        if (s === 'jumpAir') return { name: 'jump_p2', from: 'air', to: 'land-1', dur: 0.8, since: t };
        if (s === 'splash') return { name: 'jump_p2', from: 'land', to: 'up-1', dur: 0.6, since: t };
        if (s === 'recover' && e.prevState === 'splash') return { name: 'jump_p2', from: 'up', to: -1, dur: 0.5, since: t };
      }
      if (['tongueWind', 'tongue', 'jumpWind', 'jumpAir', 'splash'].includes(s)) return null;
      if (s === 'cheekWind' || s === 'cheek') return { name: 'walk_p2', from: 0, to: 0 };
      return { name: 'walk_p2', loop: true, rate: moving ? 1 : 0.6 };
    case 'tanuki_lord': case 'tanuki_clone':
      if (s === 'die') return has('down_p2') ? { name: 'down_p2', from: 0, dur: 2.2, since: t } : null;
      if (s === 'change') return { name: 'change', from: 0, to: -1, dur: 2.8, since: t };
      if (!e.p2) {
        switch (s) {
          case 'leafWind': return { name: 'leaf', from: 0, to: 'hit-1', dur: 0.8, since: t };
          case 'leaf': return { name: 'leaf', from: 'hit', to: -1, dur: 0.5, since: t };
          case 'drumWind': return { name: 'drum', from: 0, to: 'hit-1', dur: 0.5, since: t };
          case 'drum': return { name: 'drum', from: 'hit', to: -1, dur: 1.3, since: t };
          case 'stone': return { name: 'stone', from: 0, to: -1, dur: 2.9, since: t };
          case 'dizzy': return { name: 'walk', from: 0, to: 0 };
          default: return { name: 'walk', loop: true, rate: moving ? 1 : 0.5 };
        }
      }
      if (s === 'giantWind') return { name: 'stomp_p2', from: 0, to: 'hit-10', dur: 0.6, since: t };
      if (s === 'giant') return { name: 'stomp_p2', from: 'hit-9', to: -1, dur: 2.4, since: t };
      // 二階甩葉子（09-26 補的片段）：舉手、轉一圈、甩出去；分身丟葉子也用這段
      if (has('leaf_p2') && (s === 'leafWind' || s === 'windup')) return { name: 'leaf_p2', from: 'hit-30', to: 'hit-1', dur: 0.6, since: t };
      if (has('leaf_p2') && s === 'leaf') return { name: 'leaf_p2', from: 'hit', to: -1, dur: 0.5, since: t };
      if (s === 'leafWind' || s === 'leaf') return null;
      if (s === 'windup' || s === 'cloneWind') return { name: 'walk_p2', from: 0, to: 0 };
      return { name: 'walk_p2', loop: true, rate: moving ? 1 : 0.6 };
    // ── 第三關 ──
    case 'vacuum':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.55, since: t };
      if (s === 'suck') return { name: 'attack', from: 'hit', to: 'end', dur: 1.0, since: t };
      if (s === 'spit') return { name: 'attack', from: 'end', to: -1, dur: 0.6, since: t };
      return loopRun('glide', 0.008, 0.4);
    case 'mini_broom': return { name: 'hop', loop: true, rate: 1.2 };
    case 'broom_centipede':
      if (s === 'rear') return { name: 'crawl', from: 0, to: 0 };
      return { name: 'crawl', loop: true, rate: s === 'lunge' ? 2.6 : 1 };
    case 'iron_arhat':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.6, since: t };
      if (s === 'punch') return { name: 'attack', from: 'hit', to: 'hit+8', dur: 0.3, since: t };
      if (s === 'recover') return { name: 'attack', from: 'hit+9', to: -1, dur: 0.7, since: t };
      return moving ? loopRun('walk', 0.012) : { name: 'walk', from: 0, to: 0 };
    case 'armor_ghost':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.6, since: t };
      if (s === 'thrust') return { name: 'attack', from: 'hit', to: 'hit+10', dur: 0.35, since: t };
      if (s === 'recover') return { name: 'attack', from: 'hit+11', to: -1, dur: 0.6, since: t };
      return moving ? loopRun('walk', 0.011) : { name: 'walk', from: 0, to: 0 };
    case 'plated_beetle':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.7, since: t };
      if (s === 'shoot') return { name: 'attack', from: 'hit', to: -1, dur: 0.5, since: t };
      return { name: 'crawl', loop: true, rate: 0.25 };
    case 'wraith_samurai':
      if (s === 'vanish') return { name: 'vanish', from: 0, to: -1, dur: 0.55, since: t };
      if (s === 'appear') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.45, since: t };
      if (s === 'slash') return { name: 'attack', from: 'hit', to: 'end', dur: 0.35, since: t };
      if (s === 'recover') return { name: 'attack', from: 'end', to: -1, dur: 0.8, since: t };
      return moving ? loopRun('walk', 0.012) : { name: 'walk', loop: true, rate: 0.5 };
    case 'guardian_statue':
      if (s === 'windup') return { name: 'attack', from: 0, to: 'hit-1', dur: 0.8, since: t };
      if (s === 'swipe') return { name: 'attack', from: 'hit', to: 'hit+8', dur: 0.4, since: t };
      if (s === 'recover') return { name: 'attack', from: 'hit+9', to: -1, dur: 1.0, since: t };
      return { name: 'idle', loop: true, rate: 0.6 };
    case 'roomba_king':
      if (s === 'die') return { name: 'down', from: 0, dur: 2.2, since: t };
      if (s === 'suckWind') return { name: 'suck', from: 0, to: 'hit-1', dur: 0.7, since: t };
      if (s === 'suck') return { name: 'suck', from: 'hit', to: 'end', dur: 1.8, since: t };
      if (s === 'garbage') return { name: 'suck', from: 'end', to: -1, dur: 0.5, since: t };
      if (s === 'ramWind') return { name: 'ram', from: 0, to: 'hit-1', dur: 0.7, since: t };
      if (s === 'ram') return { name: 'ram', from: 'hit', to: 'back-1', dur: 0.45, since: t };
      if (s === 'ramBack') return { name: 'ram', from: 'back', to: -1, dur: 0.6, since: t };
      if (s === 'garbageWind') return { name: 'drive', from: 0, to: 0 };
      return { name: 'drive', loop: true, rate: moving ? Math.max(0.6, speed * 0.008) : 0.4 };
    case 'iron_claw': {
      if (s === 'die') return has('down_p2') ? { name: 'down_p2', from: 0, dur: 2.2, since: t } : null;
      if (s === 'change') return { name: 'change', from: 0, to: -1, dur: 2.6, since: t };
      if (!e.p2) {
        switch (s) {
          case 'swipeWind': return { name: 'swipe', from: 0, to: 'hit-1', dur: 0.7, since: t };
          case 'swipe': return { name: 'swipe', from: 'hit', to: 'end', dur: 0.5, since: t };
          case 'missileWind': case 'broomWind': return { name: 'missile', from: 0, to: 'hit-1', dur: 0.6, since: t };
          case 'missile': return { name: 'missile', from: 'hit', to: -1, dur: 0.8, since: t };
          case 'recover':
            if (e.prevState === 'swipe') return { name: 'swipe', from: 'end', to: -1, dur: 0.6, since: t };
            return { name: 'walk', loop: true, rate: 0.5 };
          case 'roar': return { name: 'walk', loop: true, rate: 1.6 };
          default: return { name: 'walk', loop: true, rate: moving ? Math.max(0.6, speed * 0.008) : 0.5 };
        }
      }
      // 二階：雷射有片段；橫掃、飛彈、暴走用二階走路（程式做壓低、往前衝的動感），不換回一階的樣子
      switch (s) {
        case 'laserWind': return { name: 'laser_p2', from: 0, to: 'hit-1', dur: 1.0, since: t };
        case 'laser': return { name: 'laser_p2', from: 'hit', to: 'end', dur: 1.4, since: t };
        case 'recover': if (e.prevState === 'laser') return { name: 'laser_p2', from: 'end', to: -1, dur: 0.8, since: t }; break;
        case 'swipeWind': case 'missileWind': case 'rampageWind': return { name: 'walk_p2', from: 0, to: 0 };
        case 'swipe': case 'rampage': return { name: 'walk_p2', loop: true, rate: 2.6 };
        default: break;
      }
      return { name: 'walk_p2', loop: true, rate: moving ? Math.max(0.6, speed * 0.008) : 0.5 };
    }
    default: return null;
  }
}

/** 每一格：挑片段、往前播 dt。回傳這一格有沒有用逐格動畫（沒有＝畫單張立繪） */
export function animateEnemy(e: Enemy, defs: AnimDefs | undefined, dt: number): boolean {
  if (!e.anim || !defs) return false;
  const px = e.mem.animX ?? e.x;
  const speed = dt > 0 ? Math.abs(e.x - px) / dt : 0;
  e.mem.animX = e.x;
  const k = 1 - Math.pow(0.7, dt * 120);   // 每 1/120 秒往新速度靠 3 成，跟一秒推幾步無關
  e.mem.animSpeed = (e.mem.animSpeed ?? speed) * (1 - k) + speed * k;   // 平滑一點，不要一格走一格停就換動作
  if (e.lastState !== e.state) { e.prevState = e.lastState; e.lastState = e.state; }
  if ((e.mem.hurtT ?? 0) > 0) e.mem.hurtT = Math.max(0, e.mem.hurtT! - dt);
  const c = pickClip(e, defs, e.mem.animSpeed);
  if (!c || !applyClip(e, defs, c)) { e.animOn = false; return false; }
  e.anim.update(dt);
  e.animOn = true;
  return true;
}
