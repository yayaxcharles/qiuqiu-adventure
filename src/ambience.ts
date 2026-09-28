/**
 * 天氣、背景生物、大場面（art/ambient2.json＋public/sprites/ambient/；09-27 第三批美術）。
 *
 * 使用者 09-27 裁定：大場面（火箭、隕石、碎鐵、閃電）只當背景熱鬧、不扣血 → 這裡全部只是畫面，不碰遊戲世界。
 * 每一段自己的天氣，走著走著慢慢變（強度照鏡頭位置漸變，再平滑一次，不會一刀切）：
 *   第一關：黃昏山村夕陽光束＋稻穗飛絮＋雁群、扛米袋推車的村貓 → 竹林起霧、中段毛毛雨（地上水窪）、雨停後螢火蟲、鹿
 *          → 山賊寨入口背景射來火箭插地燃燒、瞭望台上舉火把巡邏的山賊
 *   第二關：夜祭飄紙花瓣＋蝙蝠群 → 河童川起霧、月光、螢火蟲、鯉魚跳、遠處百鬼夜行 → 往山頂神社流星雨、魔王前大隕石劃過爆光團、狐狸
 *   第三關：城下煙霧＋灰燼＋機關風箏＋小飛艇＋城牆上行軍的機關貓兵＋遠方鐵爪機關貓黑影走過（魔王預告）
 *          → 工廠火花雨、背景鍛爐爆炸噴碎鐵 → 天守閣頂暴風雨三級（飄雨→大雨→魔王戰狂風暴雨）、打雷閃白＋剪影、劈中遠方屋脊、屋瓦濺水
 * 擺放：背景生物站在 mid 長卷畫出來的台階、城牆、瞭望台上（位置照 art_raw/ambient/_check/mock_*.png 的鏡頭換算），
 * 不站在遊戲地面線（596）上，免得看起來像小一號的敵人。
 */
import type { Assets } from './assets';
import { VIEW_H, VIEW_W } from './entities';
import { fxDraw, type AmbItem, type Creature } from './fx2';
import type { World } from './world';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
/** 第二關中景長卷畫的河面高度（鯉魚從這裡跳出來） */
const CARP_Y = 582;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** a0→a1 由 0 升到 1、b0→b1 由 1 降到 0 */
const ramp = (x: number, a0: number, a1: number, b0 = Infinity, b1 = Infinity): number =>
  (a1 <= a0 ? (x >= a1 ? 1 : 0) : clamp01((x - a0) / (a1 - a0))) * (b1 <= b0 ? (x < b0 ? 1 : 0) : 1 - clamp01((x - b0) / (b1 - b0)));

type Layer = 'sky' | 'midfar' | 'mid' | 'fore';
interface Floater { x: number; y: number; vx: number; vy: number; rot: number; spin: number; h: number; i: number; fore: boolean; ph: number }
interface Thing {
  key: string; layer: Layer;
  /** 螢幕座標（sky／fore）或該層的長卷座標（midfar／mid：畫的時候減掉 鏡頭×速率） */
  x: number; y: number; vx: number; vy: number; g: number;
  t: number; life: number; size: number; rot: number; spin: number; alpha: number;
  flip?: boolean; frame?: number; phase?: number; stuck?: boolean; burn?: number; add?: boolean; kind?: string;
}
/** 在背景長卷上來回走的生物：x0～x1 是那一層長卷的座標 */
interface Walker { key: string; x0: number; x1: number; y: number; speed: number; motion: 'walk' | 'hop' | 'patrol'; count: number; gap: number; pos: number; dir: -1 | 1; wait: number; ph: number }

/** 背景生物的定點（mock 圖的鏡頭 cam 時畫面上的 x＝那一層長卷座標 x＋cam×速率） */
const SPOTS: Record<string, { key: string; mx: number; cam: number; y: number; range: number; speed: number; motion: Walker['motion']; count?: number; gap?: number }[]> = {
  s1: [
    { key: 'rice_cat', mx: 720, cam: 3000, y: 497, range: 230, speed: 26, motion: 'walk' },
    { key: 'cart_cat', mx: 900, cam: 3000, y: 497, range: 230, speed: 22, motion: 'walk' },
    // 第二版第一關加長（09-29）：長卷在竹林前插了 3 張、山賊寨前又插 5 張 → 直接寫中景長卷座標（cam 0）
    { key: 'deer', mx: 11980, cam: 0, y: 548, range: 260, speed: 70, motion: 'hop' },
    { key: 'torch_bandit', mx: 22175, cam: 0, y: 256, range: 40, speed: 16, motion: 'patrol' },
  ],
  s2: [
    { key: 'fox', mx: 900, cam: 15800, y: 530, range: 280, speed: 120, motion: 'hop' },
  ],
  s3: [
    { key: 'mech_soldier', mx: 1050, cam: 0, y: 152, range: 360, speed: 20, motion: 'walk', count: 3, gap: 40 },
  ],
};

export class Ambience {
  private world: World | null = null;
  private st = '';
  private rMid = 0.55;
  private rMidfar = 0.3;
  private lastCam = 0;
  private time = 0;
  private floaters: Floater[] = [];
  private flies: Floater[] = [];
  private things: Thing[] = [];
  private walkers: Walker[] = [];
  private timers: Record<string, number> = {};
  private done = new Set<string>();
  /** 平滑過的強度（每種天氣各一個） */
  private I: Record<string, number> = {};
  private storm = 0;
  private flashT = 9;
  private rainOff: Record<string, [number, number]> = {};
  private puddles: { x: number; w: number; i: number }[] = [];

  constructor(private readonly a: Assets) {}

  private jsonMidRate(): number { return this.a.panels.get(this.st)?.rates.mid ?? 0.55; }
  private item(k: string): AmbItem | undefined { return this.a.amb2?.get(this.st)?.items.get(k); }
  private cre(k: string): Creature | undefined { return this.a.amb2?.get(this.st)?.creatures.get(k); }

  /** 程式畫的舊天氣要不要讓位（有新美術就不畫舊的：螢火蟲、雨絲、打雷閃白） */
  overrides(kind: 'firefly' | 'rain' | 'storm'): boolean {
    if (kind === 'firefly') return !!this.item('fireflies');
    return !!this.item('storm_rain_1');
  }
  hasFlocks(): boolean { return !!this.item('bird_flocks'); }
  /** 打雷那一瞬間（0～1）：前面的東西畫成黑色剪影 */
  silhouette(): number { return this.flashT < 0.09 ? 1 : 0; }

  private reset(w: World): void {
    this.world = w; this.st = w.stage.panels;
    this.floaters = []; this.flies = []; this.things = []; this.timers = {}; this.done.clear(); this.I = {}; this.storm = 0; this.flashT = 9;
    this.lastCam = w.camX;
    // mock 圖是用 art.json 寫的中景速率算的：長卷座標＝mock 畫面 x＋mock 鏡頭×那個速率（跟遊戲實際捲的速率無關）
    const jr = this.jsonMidRate();
    this.walkers = (SPOTS[this.st] ?? []).map((s) => {
      const X = s.mx + s.cam * jr;
      return { key: s.key, x0: X - s.range, x1: X + s.range, y: s.y, speed: s.speed, motion: s.motion, count: s.count ?? 1, gap: s.gap ?? 0, pos: X + rnd(-0.5, 1) * s.range, dir: -1 as const, wait: 0, ph: rnd(0, 6) };
    });
    // 竹林中段毛毛雨：地上一路散幾個水窪（世界座標，平的地方才放）
    this.puddles = [];
    if (this.st === 's1') for (let x = 20100; x < 23800; x += rnd(380, 720)) this.puddles.push({ x, w: [90, 140, 200][Math.floor(rnd(0, 3))]!, i: Math.floor(rnd(0, 3)) });
  }

  /** 這一段各種天氣的目標強度（照畫面中間在世界的位置） */
  private targets(w: World): Record<string, number> {
    const m = w.camX + VIEW_W / 2;
    const bossOn = !!w.boss && !w.boss.dead;
    switch (this.st) {
      // 第二版第一關（42,000）：山村 0～10,600 → 梯田 → 竹林 19,200～24,770 → 山溪瀑布、山路 → 山賊寨 36,963～
      case 's1': return {
        sun: ramp(m, -1, 0, 17800, 18800), fluff: ramp(m, -1, 0, 17800, 18800), geese: ramp(m, -1, 0, 10000, 10600) + ramp(m, 13000, 13600, 16000, 16600),
        fog: ramp(m, 18900, 19800, 24700, 25500), drizzle: ramp(m, 19900, 20900, 23300, 24100), flyA: ramp(m, 23500, 24200, 36300, 37000),
        arrows: bossOn ? 0 : ramp(m, 37100, 37600, 40100, 40700), flocks: ramp(m, -1, 0, 10000, 10600) + ramp(m, 37100, 37800) * 0.6,
      };
      case 's2': return {
        petals: ramp(m, -1, 0, 8300, 9300), bats: ramp(m, -1, 0, 15600, 16500),
        fog: ramp(m, 8500, 9400, 16200, 17000), moon: ramp(m, 8700, 9600, 16100, 16900), flyA: ramp(m, 8800, 9600, 16300, 17000),
        meteors: ramp(m, 16400, 17200), parade: ramp(m, 9400, 10000, 15600, 16200), carp: ramp(m, 9000, 9600, 16200, 16800), flocks: 0.3 * ramp(m, -1, 0, 8300, 9000),
      };
      case 's3': return {
        fog: ramp(m, -1, 0, 5000, 6200), ash: ramp(m, -1, 0, 4800, 5800), sky3: ramp(m, -1, 0, 6500, 7500), flocks: ramp(m, -1, 0, 5000, 5800) + ramp(m, 16400, 17200) * 0.7,
        sparks: ramp(m, 5300, 6100, 15900, 16600), forge: bossOn ? 0.5 * ramp(m, 5600, 6300, 15700, 16300) : ramp(m, 5600, 6300, 15700, 16300),
        storm: m < 16000 ? 0 : (w.boss && w.boss.kind === 'iron_claw' && !w.boss.dead) || (m > 19900 && w.lockX !== null) ? 3 : m > 17700 ? 2 : ramp(m, 16000, 16900),
      };
      default: return {};
    }
  }

  step(w: World, dt: number): void {
    if (w !== this.world) this.reset(w);
    if (!this.a.amb2?.get(this.st)) return;
    this.time += dt;
    this.frameGuess = dt;
    const cam = w.camX, dcam = cam - this.lastCam;
    this.lastCam = cam;
    const T = this.targets(w);
    for (const [k, v] of Object.entries(T)) {
      if (k === 'storm') continue;
      const cur = this.I[k] ?? v;
      this.I[k] = cur + (v - cur) * Math.min(1, dt * 1.5);
    }
    if (T.storm !== undefined) this.storm += (T.storm - this.storm) * Math.min(1, dt * 0.6);
    this.flashT += dt;

    this.stepFloaters(dt, dcam);
    this.stepFlies(dt, dcam);
    this.stepWalkers(dt);
    this.spawn(w, dt);
    for (const t of this.things) {
      if (t.t < 0) { t.t += dt; continue; }   // 還沒輪到（一排火箭一支一支射）
      t.t += dt; t.vy += t.g * dt; t.rot += t.spin * dt;
      if (t.layer === 'sky' || t.layer === 'fore') t.x -= dcam * (t.layer === 'sky' ? 0.12 : 1.1);
      if (!t.stuck) { t.x += t.vx * dt; t.y += t.vy * dt; }
      if (t.kind === 'arrow' && !t.stuck) {
        // 火箭插進背景地面（地形比背景地面高的地方插高一點，不要整支躲在地形後面）：之後燒 3～6 秒，火慢慢變小熄掉，箭留著再淡掉
        const sx = t.x - cam * this.rMid, g = w.groundAt(cam + sx);
        const land = Math.min(572, (Number.isFinite(g) ? g : 600) - 14) + (t.phase ?? 0);
        if (t.y >= land) { t.stuck = true; t.t = 0; t.life = 10; t.burn = rnd(3, 6); t.y = land; }
      }
      if (t.kind === 'scrap' && t.y > 560) t.life = Math.min(t.life, t.t + 0.25);
      if (t.kind === 'bigMeteor' && !t.stuck && t.t > t.life - 0.05) {
        // 大隕石落到遠山後面：爆一團光（閃光→光罩→火球蘑菇雲→餘光）
        t.stuck = true;
        this.things.push({ key: 'impact_glow', layer: 'sky', kind: 'glow', x: t.x - 40, y: 330, vx: 0, vy: 0, g: 0, t: 0, life: 1.6, size: 230, rot: 0, spin: 0, alpha: 1, add: true });
      }
    }
    this.things = this.things.filter((t) => t.t < t.life && t.x > -3000 && t.x < 1e6);
  }

  // ───────────── 產生 ─────────────

  private every(k: string, dt: number, lo: number, hi: number, on: boolean): boolean {
    if (!on) { this.timers[k] = Math.min(this.timers[k] ?? rnd(lo * 0.3, lo), lo * 0.6); return false; }
    this.timers[k] = (this.timers[k] ?? rnd(lo * 0.2, lo * 0.6)) - dt;
    if (this.timers[k]! > 0) return false;
    this.timers[k] = rnd(lo, hi);
    return true;
  }

  private spawn(w: World, dt: number): void {
    const I = this.I, cam = w.camX, m = cam + VIEW_W / 2;
    const midX = (sx: number): number => sx + cam * this.rMid;
    const mfX = (sx: number): number => sx + cam * this.rMidfar;
    // 遠山上的鳥群剪影（第一關黃昏、第三關城下；第三關屋頂是被暴風雨嚇飛的烏鴉）
    const flocks = this.item('bird_flocks');
    if (flocks && this.every('flock', dt, 9, 15, (I.flocks ?? 0) > 0.3)) {
      const i = Math.floor(rnd(0, flocks.frames.length));
      this.things.push({ key: 'bird_flocks', layer: 'sky', x: VIEW_W + 120, y: rnd(60, 180), vx: -rnd(45, 70), vy: 0, g: 0, t: 0, life: 40, size: rnd(80, 150), rot: 0, spin: 0, alpha: 0.85, frame: i, phase: rnd(0, 6) });
    }
    // 人字雁群（第一關黃昏，Vids 動畫）：5～7 隻排成人字
    if (this.cre('goose') && this.every('geese', dt, 14, 20, (I.geese ?? 0) > 0.5)) {
      const n = 5 + Math.floor(rnd(0, 3)), y0 = rnd(80, 150);
      for (let k = 0; k < n; k++) {
        const row = Math.ceil(k / 2), side = k % 2 ? -1 : 1;
        this.things.push({ key: 'goose', layer: 'sky', x: VIEW_W + 80 + row * 46, y: y0 + (k ? side * row * 22 : 0), vx: -62, vy: 0, g: 0, t: 0, life: 40, size: 1, rot: 0, spin: 0, alpha: 0.9, phase: rnd(0, 1) });
      }
    }
    // 蝙蝠群（第二關夜祭、河童川）
    if (this.cre('bat') && this.every('bats', dt, 8, 13, (I.bats ?? 0) > 0.4)) {
      const n = 4 + Math.floor(rnd(0, 4)), x0 = rnd(VIEW_W * 0.55, VIEW_W + 60), y0 = rnd(60, 170);
      for (let k = 0; k < n; k++) this.things.push({ key: 'bat', layer: 'midfar', x: mfX(x0 + rnd(-90, 90)), y: y0 + rnd(-40, 40), vx: -rnd(90, 150), vy: rnd(-20, 20), g: 0, t: 0, life: 14, size: rnd(0.7, 1), rot: 0, spin: 0, alpha: 0.95, flip: Math.random() < 0.3, phase: rnd(0, 1) });
    }
    // 火箭（第一關山賊寨入口）：一排從寨子那邊射過來，拋物線掉進背景地上插著燒
    if (this.item('fire_arrow_fly') && this.every('arrows', dt, 5.5, 8.5, (I.arrows ?? 0) > 0.5)) {
      const n = 3 + Math.floor(rnd(0, 3));
      for (let k = 0; k < n; k++) {
        const sx = VIEW_W + rnd(20, 260), sy = rnd(70, 190);
        this.things.push({ key: 'fire_arrow_fly', layer: 'mid', kind: 'arrow', x: midX(sx), y: sy, vx: -rnd(330, 460), vy: rnd(-60, 20), g: 330, t: -k * 0.18, life: 30, size: rnd(70, 105), rot: 0, spin: 0, alpha: 1, phase: rnd(-8, 8) });
      }
    }
    // 鯉魚跳出水面（第二關河童川，背景河面）
    if (this.cre('carp') && this.every('carp', dt, 3.5, 7, (I.carp ?? 0) > 0.5)) {
      // 只在中景長卷畫了河面的那一段（長卷座標 5350～8050，水面約 y 580）
      const X = midX(rnd(200, VIEW_W - 150));
      if (X > 5350 && X < 8050) this.things.push({ key: 'carp', layer: 'mid', kind: 'carp', x: X, y: CARP_Y, vx: -rnd(20, 45), vy: -rnd(260, 300), g: 560, t: 0, life: 1.0, size: 1, rot: 0, spin: 0, alpha: 1 });
    }
    // 百鬼夜行（第二關河童川遠處）：一整排妖怪剪影慢慢走過
    if (this.every('parade', dt, 30, 40, (I.parade ?? 0) > 0.6)) {
      const kinds = ['parade_lantern', 'parade_kasa', 'parade_kappa', 'parade_dancer', 'parade_tanuki', 'parade_fox'].filter((k) => this.cre(k));
      if (kinds.length) for (let k = 0; k < 9; k++) {
        const key = kinds[(k * 7 + Math.floor(this.time)) % kinds.length]!;
        this.things.push({ key, layer: 'mid', kind: 'walker', x: midX(VIEW_W + 40 + k * 46), y: 500, vx: -24, vy: 0, g: 0, t: 0, life: 90, size: 1, rot: 0, spin: 0, alpha: 0.8, phase: rnd(0, 1) });
      }
    }
    // 流星雨（第二關往山頂神社）
    const met = this.item('meteors');
    if (met && (I.meteors ?? 0) > 0.3 && Math.random() < dt * 0.9 * (I.meteors ?? 0)) {
      const sp = rnd(520, 760);
      this.things.push({ key: 'meteors', layer: 'sky', x: rnd(300, VIEW_W + 200), y: rnd(-40, 140), vx: -sp * 0.86, vy: sp * 0.5, g: 0, t: 0, life: rnd(0.8, 1.2), size: rnd(140, 240), rot: 0, spin: 0, alpha: 0.9, frame: Math.floor(rnd(0, met.frames.length)), add: true });
    }
    // 魔王前：大隕石劃過天空、落到遠山後面爆一團光
    if (this.item('big_meteor') && this.st === 's2' && m > 16950 && !this.done.has('bigMeteor')) {   // 一進神社的天空（再往裡走中景的楓樹、本殿會把天空擋掉）
      this.done.add('bigMeteor');
      this.things.push({ key: 'big_meteor', layer: 'sky', kind: 'bigMeteor', x: 1150, y: -70, vx: -420, vy: 215, g: 0, t: 0, life: 1.6, size: 250, rot: 0, spin: 0, alpha: 0.95 });
    }
    // 城下：機關風箏（幾個固定在遠層、左右飄）與小飛艇巡邏
    if (this.st === 's3' && !this.done.has('kites') && this.item('kite')) {
      this.done.add('kites');
      // 城下的天空只有幾個地方露出來（中景長卷大多是城牆）：擺在城牆缺口看得到、又不會被上面資訊欄擋住的高度
      for (const [x, y] of [[560, 170], [1900, 150], [3300, 185], [4700, 160]] as const) this.things.push({ key: 'kite', layer: 'midfar', kind: 'kite', x, y, vx: 0, vy: 0, g: 0, t: 0, life: 1e9, size: rnd(110, 150), rot: 0, spin: 0, alpha: 1, phase: rnd(0, 6) });
    }
    if (this.item('airship') && this.every('airship', dt, 22, 30, (I.sky3 ?? 0) > 0.5)) {
      this.things.push({ key: 'airship', layer: 'midfar', kind: 'airship', x: mfX(VIEW_W + 160), y: rnd(150, 200), vx: -rnd(22, 32), vy: 0, g: 0, t: 0, life: 120, size: rnd(190, 240), rot: 0, spin: 0, alpha: 1, phase: rnd(0, 6) });
    }
    // 遠方巨大鐵爪機關貓黑影走過（魔王預告，只一次）：天守閣頂的暴風雨裡、遠方天守閣前面（城下、工廠的中景都是城牆，遠處看不到）
    if (this.cre('claw_shadow') && this.st === 's3' && m > 18900 && m < 19600 && !this.done.has('claw')) {
      this.done.add('claw');
      // 天守閣頂的中景長卷自己畫了遠方的天守閣（不透明）：黑影畫在中景那一層、半透明，像暴風雨裡遠處走過的巨獸
      this.things.push({ key: 'claw_shadow', layer: 'mid', kind: 'walker', x: midX(1060), y: 392, vx: -34, vy: 0, g: 0, t: 0, life: 60, size: 1, rot: 0, spin: 0, alpha: 0.85, phase: 0 });
    }
    // 工廠：背景鍛爐爆炸、噴出燒紅的碎鐵（在角色後面、不扣血）
    if (this.item('forge_blast') && this.every('forge', dt, 7, 11, (I.forge ?? 0) > 0.5)) {
      const sx = rnd(380, 1050), by = rnd(360, 400);
      this.things.push({ key: 'forge_blast', layer: 'mid', kind: 'forge', x: midX(sx), y: by, vx: 0, vy: 0, g: 0, t: 0, life: 0.6, size: rnd(220, 260), rot: 0, spin: 0, alpha: 0.8 });
      const scrap = this.item('scrap');
      if (scrap) for (let k = 0; k < 4; k++) this.things.push({ key: 'scrap', layer: 'mid', kind: 'scrap', x: midX(sx + rnd(-30, 30)), y: by - 120, vx: rnd(-260, 120), vy: -rnd(260, 420), g: 700, t: -0.12, life: 3, size: rnd(28, 46), rot: 0, spin: 0, alpha: 1, frame: k % scrap.frames.length });
    }
    // 天守閣頂：暴風雨裡打雷（大雨以上）；魔王前一道閃電劈中遠方天守閣屋脊、碎塊噴飛
    if (this.st === 's3' && this.storm > 1.3 && this.every('bolt', dt, 5, 9, true)) this.bolt(rnd(620, 1180), rnd(190, 260), false);
    if (this.st === 's3' && m > 18700 && !this.done.has('ridge') && this.item('strike')) { this.done.add('ridge'); this.bolt(1000, 216, true); }
    // 屋瓦濺水（世界座標，下大雨時）
    if (this.item('roof_splash') && this.storm > 1 && Math.random() < dt * 5 * Math.min(2, this.storm - 0.6)) {
      const x = cam + rnd(20, VIEW_W - 20), g = w.groundAt(x);
      if (Number.isFinite(g)) this.things.push({ key: 'roof_splash', layer: 'fore', kind: 'splash', x, y: g + 4, vx: 0, vy: 0, g: 0, t: 0, life: 0.18, size: rnd(36, 58), rot: 0, spin: 0, alpha: 0.85 });
    }
  }

  /** 閃電：先全畫面閃白＋剪影，遠層畫一道劈下來的閃電；ridge＝劈中屋脊（碎塊噴飛） */
  private bolt(sx: number, by: number, ridge: boolean): void {
    this.flashT = 0;
    if (!this.item('strike')) return;
    this.things.push({ key: 'strike', layer: 'midfar', kind: 'strike', x: sx + this.lastCam * this.rMidfar, y: by, vx: 0, vy: 0, g: 0, t: 0, life: 0.26, size: ridge ? 330 : rnd(260, 340), rot: 0, spin: 0, alpha: 1, add: true });
    const ch = this.item('ridge_chunks');
    if (ridge && ch) for (let k = 0; k < ch.frames.length; k++) {
      this.things.push({ key: 'ridge_chunks', layer: 'midfar', kind: 'chunk', x: sx + this.lastCam * this.rMidfar + rnd(-20, 20), y: by - 20, vx: [-110, 90, 30][k] ?? rnd(-100, 100), vy: -rnd(160, 260), g: 520, t: 0, life: 1.6, size: [62, 40, 32][k] ?? 36, rot: rnd(-0.5, 0.5), spin: rnd(-6, 6), alpha: 1, frame: k });
    }
  }

  private stepFloaters(dt: number, dcam: number): void {
    const kind = this.st === 's1' ? 'rice_fluff' : this.st === 's2' ? 'paper_petals' : 'ash';
    const it = this.item(kind), sp = this.item('sparks');
    const I = this.I;
    const amt = kind === 'rice_fluff' ? I.fluff ?? 0 : kind === 'paper_petals' ? I.petals ?? 0 : I.ash ?? 0;
    const want = it ? Math.round(18 * amt) : 0;
    const wantSp = sp ? Math.round(14 * (I.sparks ?? 0)) : 0;
    const cnt = (s: boolean): number => this.floaters.filter((f) => (f.i >= 100) === s).length;
    // 多出來的：飄出畫面就不補；少了就從上面補
    let n = cnt(false), ns = cnt(true);
    while (n < want) { this.floaters.push(this.newFloater(false, true)); n++; }
    while (ns < wantSp) { this.floaters.push(this.newFloater(true, true)); ns++; }
    for (const f of this.floaters) {
      f.ph += dt; f.rot += f.spin * dt;
      f.x += (f.vx + Math.sin(f.ph * 1.6) * (f.i >= 100 ? 0 : 22)) * dt - dcam * (f.fore ? 1.15 : this.rMid);
      f.y += f.vy * dt;
    }
    // 飄出畫面的：這一種還不夠就從上面重來，夠了（天氣變小）就不補
    const keep: Floater[] = [];
    const left: Record<string, number> = { false: want - this.floaters.filter((f) => f.i < 100 && !this.out(f)).length, true: wantSp - this.floaters.filter((f) => f.i >= 100 && !this.out(f)).length };
    for (const f of this.floaters) {
      const sp = f.i >= 100, k = String(sp);
      if (!this.out(f)) { keep.push(f); continue; }
      if (left[k]! > 0) { keep.push(this.newFloater(sp, false)); left[k]!--; }
    }
    this.floaters = keep;
  }
  private out(f: Floater): boolean { return f.y > VIEW_H + 40 || f.x < -80 || f.x > VIEW_W + 300; }

  private newFloater(sparks: boolean, anywhere: boolean): Floater {
    const fore = Math.random() < 0.4;
    const it = sparks ? this.item('sparks') : this.item(this.st === 's1' ? 'rice_fluff' : this.st === 's2' ? 'paper_petals' : 'ash');
    const n = it?.frames.length ?? 1;
    const hLo = sparks ? 24 : this.st === 's3' ? 10 : 12, hHi = sparks ? 60 : this.st === 's3' ? 22 : 26;
    const h = (fore ? rnd((hLo + hHi) / 2, hHi) : rnd(hLo, (hLo + hHi) / 2));
    return {
      x: rnd(-40, VIEW_W + 250), y: anywhere ? rnd(-VIEW_H * 0.2, VIEW_H * 0.9) : rnd(-80, -20),
      vx: sparks ? -rnd(60, 120) : -rnd(20, 60), vy: sparks ? rnd(160, 260) : rnd(28, 60) * (fore ? 1.4 : 0.8),
      rot: sparks ? 0 : rnd(0, 6), spin: sparks ? 0 : rnd(-2, 2), h, i: Math.floor(rnd(0, n)) + (sparks ? 100 : 0), fore, ph: rnd(0, 6),
    };
  }

  /** 螢火蟲：第 1～3 張同一隻亮→中→暗輪播閃爍，第 4～6 張失焦光點 */
  private stepFlies(dt: number, dcam: number): void {
    const want = this.item('fireflies') ? Math.round(20 * (this.I.flyA ?? 0)) : 0;
    while (this.flies.length < want) this.flies.push({ x: rnd(0, VIEW_W + 200), y: rnd(300, 590), vx: rnd(-14, 14), vy: rnd(-10, 10), rot: 0, spin: 0, h: rnd(14, 32), i: Math.random() < 0.55 ? 0 : 3 + Math.floor(rnd(0, 3)), fore: false, ph: rnd(0, 6) });
    if (this.flies.length > want) this.flies.length = want;
    for (const f of this.flies) {
      f.ph += dt;
      f.x += (f.vx + Math.sin(f.ph * 1.3) * 12) * dt - dcam * this.rMid;
      f.y += (f.vy + Math.cos(f.ph * 1.7) * 14) * dt;
      if (f.x < -60) f.x += VIEW_W + 160;
      if (f.x > VIEW_W + 160) f.x -= VIEW_W + 160;
      if (f.y < 280 || f.y > 600) f.vy = -f.vy;
    }
  }

  private stepWalkers(dt: number): void {
    for (const k of this.walkers) {
      k.ph += dt;
      if (k.wait > 0) { k.wait -= dt; continue; }
      k.pos += k.dir * k.speed * dt;
      if (k.motion === 'patrol') { if (k.pos < k.x0) { k.pos = k.x0; k.dir = 1; } if (k.pos > k.x1) { k.pos = k.x1; k.dir = -1; } continue; }
      if (k.pos < k.x0) { k.pos = k.x1; k.wait = rnd(2, 6); }
    }
  }

  // ───────────── 畫 ─────────────

  private img(k: string, i = 0): CanvasImageSource | undefined { return this.item(k)?.frames[i]; }
  /** 畫 ambient2 的一張：中心（或 bottom＝底部中間）在 (x, y)，寬 w（或高 h） */
  private put(ctx: CanvasRenderingContext2D, k: string, i: number, x: number, y: number, o: { w?: number; h?: number; bottom?: boolean; rot?: number; flip?: boolean; alpha?: number; add?: boolean }): void {
    const it = this.item(k);
    const img = it?.frames[i % (it?.frames.length || 1)];
    if (!it || !img) return;
    const [fw, fh] = it.sizes[i % it.sizes.length]!;
    const s = o.w ? o.w / fw : o.h ? o.h / fh : 1, dw = fw * s, dh = fh * s;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.add) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, o.bottom ? -dh : -dh / 2, dw, dh);
    ctx.restore();
  }
  private creature(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, t: number, o: { flip?: boolean; alpha?: number; scale?: number; rot?: number } = {}): void {
    const c = this.cre(key);
    if (!c) return;
    const img = c.frames[Math.floor(t * c.fps) % c.frames.length]!;
    const s = o.scale ?? 1, w = c.w * s, h = c.h * s;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
  /** 橫向重複的霧帶：near＝圖底放在 y，否則圖的中心在 y；兩層反向慢慢飄 */
  private fog(ctx: CanvasRenderingContext2D, near: boolean, y: number, alpha: number, cam: number, rate: number): void {
    const it = this.item(`fog_${this.st}_${near ? 'near' : 'far'}`);
    if (!it || alpha <= 0.01) return;
    const [fw, fh] = it.sizes[0]!;
    const off = ((cam * rate + this.time * (near ? 12 : -9)) % fw + fw) % fw;
    ctx.save(); ctx.globalAlpha *= alpha;
    for (let x = -off; x < VIEW_W; x += fw - 1) ctx.drawImage(it.frames[0]!, x, near ? y - fh : y - fh / 2, fw, fh);
    ctx.restore();
  }

  /** 遠山那一層（far 長卷之後）：流星、大隕石、爆光團、鳥群、雁群 */
  drawSky(ctx: CanvasRenderingContext2D, w: World, _cam: number): void {
    if (w !== this.world || !this.a.amb2?.get(this.st)) return;
    for (const t of this.things) {
      if (t.layer !== 'sky' || t.t < 0) continue;
      const fade = Math.min(1, t.t / 0.2) * Math.min(1, (t.life - t.t) / 0.25);
      if (t.key === 'goose') this.creature(ctx, 'goose', t.x, t.y + Math.sin(this.time * 1.4 + (t.phase ?? 0) * 6) * 3, this.time + (t.phase ?? 0), { alpha: 0.9 });
      else if (t.key === 'bird_flocks') this.put(ctx, 'bird_flocks', t.frame ?? 0, t.x, t.y + Math.sin(this.time * 1.2 + (t.phase ?? 0)) * 4, { w: t.size, alpha: 0.85 });
      else if (t.key === 'meteors') this.put(ctx, 'meteors', t.frame ?? 0, t.x, t.y, { w: t.size, alpha: 0.9 * fade, add: true });
      else if (t.key === 'big_meteor') {
        this.put(ctx, 'big_meteor', 0, t.x, t.y, { w: t.size, alpha: 0.95 * Math.min(1, t.t / 0.3) });
      } else if (t.key === 'impact_glow') {
        const i = Math.min(3, Math.floor(t.t / 0.15));
        const a = i < 3 ? 1 : Math.max(0, 1 - (t.t - 0.45) / 1.1);
        this.put(ctx, 'impact_glow', i, t.x, t.y, { w: t.size, bottom: true, alpha: a, add: true });
      }
    }
  }
  private frameGuess = 1 / 60;

  /** 遠層（midfar 長卷之後）：遠層霧、風箏、飛艇、百鬼夜行、鐵爪黑影、蝙蝠、閃電、屋脊碎塊 */
  drawMidfar(ctx: CanvasRenderingContext2D, w: World, cam: number, rate: number): void {
    this.rMidfar = rate;
    if (w !== this.world || !this.a.amb2?.get(this.st)) return;
    const off = cam * rate;
    // 遠處走的（百鬼夜行、鐵爪黑影）先畫，霧蓋住腳
    for (const t of this.things) {
      if (t.layer !== 'midfar' || t.kind !== 'walker') continue;
      const x = t.x - off;
      if (x < -300 || x > VIEW_W + 300) continue;
      const fade = Math.min(1, t.t / 1.5);
      this.creature(ctx, t.key, x, t.y + (t.key === 'claw_shadow' ? 0 : -Math.abs(Math.sin(this.time * 5 + (t.phase ?? 0) * 6)) * 2), this.time + (t.phase ?? 0), { alpha: t.alpha * fade });
    }
    const fogY = this.st === 's1' ? 380 : this.st === 's2' ? 470 : 330;
    this.fog(ctx, false, fogY, 0.55 * (this.I.fog ?? 0), cam, rate * 1.05);
    for (const t of this.things) {
      if (t.layer !== 'midfar' || t.kind === 'walker' || t.t < 0) continue;
      const x = t.x - off;
      if (x < -300 || x > VIEW_W + 300) continue;
      if (t.key === 'kite') this.put(ctx, 'kite', 0, x + Math.sin(this.time * 0.4 + (t.phase ?? 0)) * 30, t.y + Math.sin(this.time * 0.9 + (t.phase ?? 0)) * 10, { w: t.size, rot: Math.sin(this.time * 0.7 + (t.phase ?? 0)) * 0.1 });
      else if (t.key === 'airship') this.drawAirship(ctx, t, x);
      else if (t.key === 'bat') this.creature(ctx, 'bat', x + Math.sin(this.time * 3 + (t.phase ?? 0) * 9) * 10, t.y + Math.sin(this.time * 5 + (t.phase ?? 0) * 7) * 8, this.time + (t.phase ?? 0), { flip: t.flip, scale: t.size, alpha: Math.min(1, t.t / 0.5) * Math.min(1, (t.life - t.t) / 0.5) });
      else if (t.key === 'strike') this.put(ctx, 'strike', t.t < 0.08 ? 0 : 1, x, t.y, { h: t.size, bottom: true, add: true, alpha: t.t < 0.08 ? 1 : Math.max(0, 1 - (t.t - 0.08) / 0.18) });
      else if (t.key === 'ridge_chunks') this.put(ctx, 'ridge_chunks', t.frame ?? 0, x, t.y, { w: t.size, rot: t.rot, alpha: Math.min(1, (t.life - t.t) / 0.4) });
    }
  }

  private drawAirship(ctx: CanvasRenderingContext2D, t: Thing, x: number): void {
    const it = this.item('airship');
    if (!it) return;
    const [fw, fh] = it.sizes[0]!;
    const s = t.size / fw, y = t.y + Math.sin(this.time * 0.8 + (t.phase ?? 0)) * 5;
    const fade = Math.min(1, t.t / 1) * Math.min(1, (t.life - t.t) / 1);
    this.put(ctx, 'airship', 0, x, y, { w: t.size, alpha: fade });
    const pr = this.item('propeller'), pa = it.meta.propellerAt as { x: number; y: number } | undefined;
    if (pr && pa) {
      const [pw, ph] = pr.sizes[0]!;
      const ps = s * Number(it.meta.propellerScale ?? 0.67);
      this.put(ctx, 'propeller', Math.floor(this.time / 0.05) % 2, x - t.size / 2 + pa.x * s, y - fh * s / 2 + pa.y * s, { w: pw * ps, h: ph * ps, alpha: fade });
    }
  }

  /** 近層（mid 長卷之後、地形之前）：近層霧、背景小動物、火箭、鍛爐爆炸、碎鐵、鯉魚、螢火蟲、飄的東西（遠的） */
  drawMid(ctx: CanvasRenderingContext2D, w: World, cam: number, rate: number): void {
    this.rMid = rate;
    if (w !== this.world || !this.a.amb2?.get(this.st)) return;
    const off = cam * rate;
    // 背景生物（站在 mid 長卷畫的台階、城牆、瞭望台上）
    for (const k of this.walkers) {
      if (k.wait > 0 || !this.cre(k.key)) continue;
      for (let n = 0; n < k.count; n++) {
        const X = k.pos + n * k.gap * -k.dir, x = X - off;
        if (x < -120 || x > VIEW_W + 120) continue;
        const edge = Math.min(1, (X - k.x0) / 40, (k.x1 - X) / 40);
        const alpha = k.motion === 'patrol' ? 1 : Math.max(0, edge);
        const hop = k.motion === 'hop' ? -Math.abs(Math.sin(k.ph * 7 + n)) * 10 : -Math.abs(Math.sin(k.ph * 6 + n * 1.3)) * 2;
        const tilt = k.motion === 'hop' ? Math.sin(k.ph * 7 + n) * 0.08 : Math.sin(k.ph * 6 + n) * 0.03;
        this.creature(ctx, k.key, x, k.y + hop, k.ph, { flip: k.dir > 0, alpha, rot: tilt });
      }
    }
    for (const t of this.things) {
      if (t.layer !== 'mid' || t.t < 0) continue;
      const x = t.x - off;
      if (x < -300 || x > VIEW_W + 300) continue;
      if (t.kind === 'arrow') this.drawArrow(ctx, t, x);
      else if (t.kind === 'walker') this.creature(ctx, t.key, x, t.y - Math.abs(Math.sin(this.time * 5 + (t.phase ?? 0) * 6)) * 2, this.time + (t.phase ?? 0), { alpha: t.alpha * Math.min(1, t.t / 1.5) });   // 百鬼夜行
      else if (t.kind === 'forge') this.put(ctx, 'forge_blast', Math.min(5, Math.floor(t.t / 0.1)), x, t.y, { h: t.size, bottom: true, alpha: 0.8 * Math.min(1, (t.life - t.t) / 0.15) });
      else if (t.kind === 'scrap') this.put(ctx, 'scrap', t.frame ?? 0, x, t.y, { h: t.size, alpha: Math.min(1, (t.life - t.t) / 0.25) });
      else if (t.kind === 'carp') {
        const sp = this.a.fx?.get('splash');
        if (sp && (t.t < 0.18 || t.t > t.life - 0.2)) fxDraw(ctx, sp, Math.min(2, Math.floor(((t.t < 0.18 ? t.t : t.t - (t.life - 0.2)) / 0.07))), x, CARP_Y + 4, 0.28, { alpha: 0.85 });
        if (t.y < CARP_Y) this.creature(ctx, 'carp', x, t.y + 14, 0, { rot: Math.atan2(t.vy, -Math.abs(t.vx) - 60) + Math.PI, alpha: 1 });
      }
    }
    this.fog(ctx, true, 636, 0.6 * (this.I.fog ?? 0), cam, rate * 1.3);
    // 屋簷滴水（天守閣頂兩個屋簷，mock 鏡頭 18600）
    if (this.st === 's3' && this.item('eave_drip') && this.storm > 0.5) {
      for (const [mx, top] of [[640, 486], [520, 470]] as const) {
        const x = mx + 18600 * this.jsonMidRate() - off;
        if (x > -40 && x < VIEW_W + 40) this.put(ctx, 'eave_drip', Math.floor(this.time / 0.12) % 2, x, top + 45, { h: 90, alpha: 0.8 * Math.min(1, this.storm - 0.5) });
      }
    }
    // 螢火蟲（加亮）
    const ff = this.item('fireflies');
    if (ff) for (const f of this.flies) {
      const i = f.i === 0 ? [0, 1, 2, 1][Math.floor(f.ph * 5 + f.h) % 4]! : f.i;
      this.put(ctx, 'fireflies', i, f.x, f.y, { h: f.i === 0 ? f.h * 0.75 : f.h * 1.3, add: true, alpha: 0.9 });
    }
    for (const f of this.floaters) if (!f.fore) this.drawFloater(ctx, f);
  }

  private drawArrow(ctx: CanvasRenderingContext2D, t: Thing, x: number): void {
    if (!t.stuck) {
      this.put(ctx, 'fire_arrow_fly', 0, x, t.y, { w: t.size, rot: Math.atan2(t.vy, t.vx) + Math.PI });
      return;
    }
    const st = this.item('fire_arrow_stuck');
    if (!st) return;
    const [fw, fh] = st.sizes[0]!;
    const h = t.size * 0.82, s = h / fh;
    const fade = Math.min(1, (t.life - t.t) / 1.5);
    this.put(ctx, 'fire_arrow_stuck', 0, x, t.y, { h, bottom: true, alpha: fade });
    const burn = t.burn ?? 0, fl = this.item('flame'), at = st.meta.flameAt as { x: number; y: number } | undefined;
    if (fl && at && t.t < burn) {
      const k = t.t > burn - 1 ? (burn - t.t) : 1;   // 最後 1 秒火變小熄掉
      const [lw, lh] = fl.sizes[0]!;
      const fs = s * Number(st.meta.flameScale ?? 0.9) * (0.4 + 0.6 * k);
      this.put(ctx, 'flame', Math.floor(t.t / 0.08) % fl.frames.length, x - fw * s / 2 + at.x * s, t.y - fh * s + at.y * s + 4, { w: lw * fs, h: lh * fs, bottom: true, add: true, alpha: 0.95 });
    }
  }

  private drawFloater(ctx: CanvasRenderingContext2D, f: Floater): void {
    const sparks = f.i >= 100;
    const key = sparks ? 'sparks' : this.st === 's1' ? 'rice_fluff' : this.st === 's2' ? 'paper_petals' : 'ash';
    this.put(ctx, key, sparks ? f.i - 100 : f.i, f.x, f.y, { h: f.h, rot: f.rot, add: sparks, alpha: sparks ? 1 : f.fore ? 0.95 : 0.8 });
  }

  /** 地面上（世界座標，跟地形一起捲）：竹林水窪、屋瓦濺水 */
  drawGround(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    if (w !== this.world || !this.a.amb2?.get(this.st)) return;
    const wet = this.I.drizzle ?? 0;
    if (wet > 0.05 && this.item('puddles')) for (const p of this.puddles) {
      if (p.x < cam - 200 || p.x > cam + VIEW_W + 200) continue;
      const g = w.groundAt(p.x), g0 = w.groundAt(p.x - p.w / 2), g1 = w.groundAt(p.x + p.w / 2);
      if (!Number.isFinite(g) || Math.abs(g0 - g) > 2 || Math.abs(g1 - g) > 2) continue;   // 斜坡、坑邊不放
      this.put(ctx, 'puddles', p.i, p.x, g + 3, { w: p.w, alpha: 0.85 * wet });
    }
    for (const t of this.things) {
      if (t.kind !== 'splash') continue;
      this.put(ctx, 'roof_splash', Math.min(2, Math.floor(t.t / 0.06)), t.x, t.y, { h: t.size, bottom: true, alpha: 0.85 });
    }
  }

  /** 最上層（角色、前景之後）：雨幕、光束、飄的東西（近的）、閃電閃白 */
  drawOverlay(ctx: CanvasRenderingContext2D, w: World, cam: number): void {
    if (w !== this.world || !this.a.amb2?.get(this.st)) return;
    const I = this.I;
    // 光束（加亮：screen）
    if (this.st === 's1' && (I.sun ?? 0) > 0.01) this.beam(ctx, 'sunbeam', 0.4 * (I.sun ?? 0), false);
    if (this.st === 's2' && (I.moon ?? 0) > 0.01) this.beam(ctx, 'moonbeam', 0.35 * (I.moon ?? 0), true);
    // 雨幕（三層：遠細密、中、近粗長）
    const dt = Math.min(0.05, this.frameGuess);
    if (this.st === 's1') {
      const d = I.drizzle ?? 0;
      if (d > 0.01) for (const [i, a, vy, vx] of [[1, 0.35, 380, -68], [2, 0.45, 520, -94], [3, 0.5, 700, -126]] as const) this.rain(ctx, `drizzle_${i}`, a * d, vx, vy, dt, cam);
    }
    if (this.st === 's3' && this.storm > 0.02) {
      const L = this.storm;
      this.rain(ctx, 'storm_rain_1', 0.4 * clamp01(L), -477, 900, dt, cam);
      this.rain(ctx, 'storm_rain_2', 0.45 * clamp01(L - 1), -662, 1250, dt, cam);
      this.rain(ctx, 'storm_rain_3', 0.32 * clamp01(L - 2), -901, 1700, dt, cam);   // 第 3 層別超過 0.4，會擋到角色
    }
    for (const f of this.floaters) if (f.fore) this.drawFloater(ctx, f);
    // 打雷：剪影那一下之後，全畫面白光淡掉
    if (this.flashT >= 0.09 && this.flashT < 0.4) {
      ctx.fillStyle = `rgba(225,232,255,${0.35 * (1 - (this.flashT - 0.09) / 0.31)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  private beam(ctx: CanvasRenderingContext2D, k: string, alpha: number, flip: boolean): void {
    const img = this.img(k);
    if (!img) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.max(0, alpha + Math.sin(this.time * 0.8) * 0.06 * alpha / 0.4);
    if (flip) { ctx.translate(VIEW_W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  private rain(ctx: CanvasRenderingContext2D, k: string, alpha: number, vx: number, vy: number, dt: number, cam: number): void {
    const it = this.item(k);
    if (!it || alpha <= 0.01) return;
    const [tw, th] = it.sizes[0]!;
    const o = this.rainOff[k] ?? [Math.random() * tw, Math.random() * th];
    o[0] = (o[0] + vx * dt) % tw; o[1] = (o[1] + vy * dt) % th;
    this.rainOff[k] = o;
    const ox = ((o[0] - cam * 1.1) % tw + tw) % tw, oy = (o[1] % th + th) % th;
    ctx.save(); ctx.globalAlpha = alpha;
    for (let y = oy - th; y < VIEW_H; y += th) for (let x = ox - tw; x < VIEW_W; x += tw) ctx.drawImage(it.frames[0]!, Math.floor(x), Math.floor(y), tw + 1, th + 1);
    ctx.restore();
  }

}
