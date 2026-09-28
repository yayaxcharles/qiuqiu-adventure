// 每一關的實機截圖檢查（第二關起用；第一關用 monster_anim_check.mjs、terrain_check.mjs）：
//   動畫_<怪>_1走／2出招／3受傷／4倒下.png：每隻新怪在練習場照遊戲的狀態機推到那一刻截圖
//   魔王_<魔王>_<招式>_1預兆／2出招.png：魔王每一招
//   場景_<地點>.png：這一關每一段場景（沒有敵人、沒有字幕；河童那段讓河童冒出來）
//   動畫_總覽.png：這一關每隻怪每個動作平均取 8 格（遊戲裡的大小、紅線＝地面）
//   總覽.png：上面所有截圖縮小排成一張
// 用法：node tools/stage_check.mjs 2   → vids/_stage2_check/
//       node tools/stage_check.mjs 1   → vids/_stage1_check/第二批美術/（第一關只截第二批美術換上去的場景）
// 場景的額外設定：onPlat＝把球球放到那個平台上、kappa＝讓河童從那個水坑冒出來、brk＝擺一排第二關打得爛的東西（true＝打爛後）、
//   gateBroken＝寨門先打爛、ending＝結局畫面（第幾秒）
// 瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] || 2);
const OUT = N === 1 ? join(ROOT, 'vids', '_stage1_check', '第二批美術') : join(ROOT, 'vids', `_stage${N}_check`);
const PORT = 4400 + N, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(動畫_|魔王_|場景_|總覽)/.test(f)) rmSync(join(OUT, f));

// ── 每一關要截什麼 ──
// monsters：kind、名字、擺哪（y 給了就是飛在那個高度）、出招怎麼推（先把狀態設成 state，推到 until 成立再推 after 秒）
// bosses：kind、名字；moves：[招式名, kind, 設定, 預兆推幾秒, 出招再推幾秒]
const CFG = {
  1: {
    monsters: [],
    moves: [],
    scenes: [
      ['01_山村下樓梯（石階）', 3400], ['02_竹林大竹叢（暗色、前景壓暗）', 10480], ['03_竹林上樓梯（石階）', 14800],
      ['04_營地木柵營火矮牆', 16470], ['05_站上木造矮牆', 16700, { onPlat: [16740, 448] }],
      ['06_寨門（沒打爛）', 18300], ['07_寨門打爛後_矮牆木架', 18430, { gateBroken: true, onPlat: [18430, 448] }],
      ['08_寨內營火木柵', 19250, { gateBroken: true }], ['09_魔王平地木柵', 20400, { gateBroken: true }],
    ],
  },
  2: {
    monsters: [
      { kind: 'lantern_ghost', name: '燈籠鬼', x: 900, y: 360, walk: 60, attack: { state: 'windup', until: 'bullet:fireball', after: 0.12 } },
      { kind: 'kasa_obake', name: '傘妖', x: 880, walk: 70, attack: { state: 'crouch', until: 'bullet:wave', after: 0.06 } },
      { kind: 'paper_crane', name: '紙鶴', x: 900, y: 440, walk: 30, attack: { state: 'glide', after: 0.3 } },
      { kind: 'kappa', name: '河童', x: 860, walk: 60, attack: { state: 'aim', until: 'bullet:water', after: 0.1 } },
      { kind: 'mask_dancer', name: '面具舞者', x: 950, walk: 60, attack: { state: 'windup', until: 'bullet:fan', after: 0.25 } },
      { kind: 'fox_miko', name: '白狐巫女', x: 1000, walk: 40, attack: { state: 'windup', until: 'bullet:foxfire', after: 0.35 } },
      { kind: 'tengu', name: '天狗', x: 950, y: 380, walk: 60, attack: { state: 'windup', until: 'bullet:gust', after: 0.3 } },
      { kind: 'tadpole', name: '蝌蚪兵', x: 820, y: 500, walk: 30, attack: { state: 'start', after: 0.4 } },
      { kind: 'frog_daimyo', name: '蛙大名', x: 1000, boss: true },
      { kind: 'tanuki_lord', name: '狸大人', x: 1000, boss: true },
    ],
    moves: [
      ['蛙大名_舌頭抓人', 'frog_daimyo', { state: 'tongueWind' }, 0.35, 0.45],
      ['蛙大名_跳起來砸水花', 'frog_daimyo', { state: 'jumpWind' }, 0.25, 1.05],
      ['蛙大名_叫蝌蚪', 'frog_daimyo', { state: 'summonWind' }, 0.3, 0.5],
      ['蛙大名_換階段', 'frog_daimyo', { state: 'change' }, 0.9, 1.1],
      ['蛙大名二階_鼓頰吹泡泡', 'frog_daimyo', { state: 'cheekWind', p2: 700 }, 0.45, 0.4],
      ['狸大人_葉子手裏劍', 'tanuki_lord', { state: 'leafWind' }, 0.5, 0.35],
      ['狸大人_腹鼓震波', 'tanuki_lord', { state: 'drumWind' }, 0.3, 0.55],
      ['狸大人_變石像', 'tanuki_lord', { state: 'stone' }, 0.5, 1.1],
      ['狸大人_換階段', 'tanuki_lord', { state: 'change' }, 1.1, 1.2],
      ['狸大人二階_分身三隻', 'tanuki_lord', { state: 'cloneWind', p2: 1200 }, 0.3, 1.0],
      ['狸大人二階_巨大化踩踏', 'tanuki_lord', { state: 'giantWind', p2: 1200 }, 0.45, 0.45],
      ['橘皮大王二階_跳起來（新片段）', 'orange_king', { state: 'bellyWind', p2: 1100 }, 0.3, 0.45],
      ['蛙大名二階_吐舌頭（新片段）', 'frog_daimyo', { state: 'tongueWind', p2: 700 }, 0.3, 0.3],
      ['蛙大名二階_跳起來砸（新片段）', 'frog_daimyo', { state: 'jumpWind', p2: 700 }, 0.25, 1.05],
      ['狸大人二階_甩葉子（新片段）', 'tanuki_lord', { state: 'leafWind', p2: 1200 }, 0.45, 0.2],
    ],
    brk: ['s2_lantern_stall', 's2_crate', 's2_sake_stack', 's2_stone_lantern', 's2_offering_box', 's2_signboard'],
    scenes: [
      ['01_夜祭入口', 700], ['02_攤位長屋屋脊上', 2455, { onPlat: [2455, 376] }], ['03_下樓梯（石階）', 3380],
      ['04_煙火廣場_木台與大鳥居上', 4330, { onPlat: [4330, 290.5] }], ['05_燈籠長廊', 5650],
      ['06_河堤_河面與河童', 8700, { kappa: 8985 }], ['07_朱紅平橋', 9480, { onPlat: [9620, 618] }], ['08_第二座木橋', 11080, { onPlat: [11250, 618] }],
      ['09_河童的沼澤', 13000], ['10_神社石階', 16560], ['11_參道繪馬石燈籠', 17000], ['12_本殿前神社大鈴', 20400],
      ['13_打得爛的東西_完好', 1300, { brk: false }], ['14_打得爛的東西_打爛後', 1300, { brk: true }],
    ],
  },
  3: {
    monsters: [
      { kind: 'vacuum', name: '吸塵機器', x: 880, walk: 60, attack: { state: 'windup', until: 'state:suck', after: 0.4 } },
      { kind: 'mini_broom', name: '小掃把', x: 820, walk: 40, attack: { state: 'wait', after: 0.7 } },
      { kind: 'broom_centipede', name: '掃把蜈蚣', x: 950, walk: 60, attack: { state: 'rear', until: 'state:lunge', after: 0.15 } },
      { kind: 'iron_arhat', name: '鐵羅漢', x: 880, walk: 60, attack: { state: 'windup', until: 'state:punch', after: 0.08 } },
      { kind: 'armor_ghost', name: '空鎧武者', x: 930, walk: 60, attack: { state: 'windup', until: 'state:thrust', after: 0.1 } },
      { kind: 'plated_beetle', name: '甲蟲砲台', x: 900, y: 360, mount: true, walk: 30, attack: { state: 'windup', until: 'bullet:pellet', after: 0.12 } },
      { kind: 'wraith_samurai', name: '怨靈武士', x: 1000, walk: 60, attack: { state: 'vanish', until: 'state:slash', after: 0.1 } },
      { kind: 'guardian_statue', name: '守門石獅', x: 800, walk: 20, attack: { state: 'windup', until: 'state:swipe', after: 0.1 } },
      { kind: 'roomba_king', name: '掃地機王', x: 1000, boss: true },
      { kind: 'iron_claw', name: '鐵爪機關貓', x: 1000, boss: true },
    ],
    moves: [
      ['掃地機王_吸塵', 'roomba_king', { state: 'suckWind' }, 0.5, 0.8],
      ['掃地機王_噴垃圾彈', 'roomba_king', { state: 'garbageWind' }, 0.35, 0.45],
      ['掃地機王_衝撞', 'roomba_king', { state: 'ramWind' }, 0.5, 0.22],
      ['鐵爪_巨爪橫掃', 'iron_claw', { state: 'swipeWind' }, 0.5, 0.15],
      ['鐵爪_背後飛彈', 'iron_claw', { state: 'missileWind' }, 0.45, 1.45],
      ['鐵爪_放出小掃把', 'iron_claw', { state: 'broomWind' }, 0.4, 0.45],
      ['鐵爪_換階段', 'iron_claw', { state: 'change' }, 1.2, 1.2],
      ['鐵爪二階_雷射（低：躲上屋脊）', 'iron_claw', { state: 'laserWind', p2: 1300, low: 1 }, 0.7, 0.7],
      ['鐵爪二階_雷射（高：蹲下）', 'iron_claw', { state: 'laserWind', p2: 1300, low: 0 }, 0.7, 0.7],
      ['鐵爪二階_暴走衝撞', 'iron_claw', { state: 'rampageWind', p2: 1300 }, 0.5, 0.5],
    ],
    brk: ['s3_oil_drum', 's3_gearbox', 's3_crate', 's3_steam_pipe', 's3_crate', 's3_oil_drum'],
    scenes: [
      ['01_城下入口', 700], ['02_城牆與甲蟲砲台', 1850, { spawn: [['plated_beetle', 1960, 330, 1]] }],
      ['03_機關城門與守門石獅（鏡頭停在城門前）', 3847, { spawn: [['guardian_statue', 4010]] }], ['04_城門打爛後', 4500, { gateBroken: true }],
      ['05_蒸汽管走廊_噴口在噴', 5600, { vent: true }], ['06_鐵走道上', 5930, { onPlat: [5930, 446] }],
      ['07_輸送帶橋', 8150, { onPlat: [8400, 596] }], ['08_架高輸送帶', 9750, { onPlat: [9800, 450] }],
      ['09_鍛爐', 11450], ['10_升降機井_搭升降台', 15000, { lift: 1.9 }], ['11_上層', 15600],
      ['12_天守閣樓梯', 16800], ['13_屋脊上', 17200, { onPlat: [17200, 368] }], ['14_暴風雨屋頂_魔王場', 20400],
      ['15_打得爛的東西_完好', 1300, { brk: false }], ['16_打得爛的東西_打爛後', 1300, { brk: true }],
      ['17_結局_故事字幕', 0, { ending: 3.6 }], ['18_結局_全任務完成', 0, { ending: 7 }],
    ],
  },
};
const C = CFG[N];
if (!C) { console.error(`第 ${N} 關還沒有檢查設定`); process.exit(1); }

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', `stage${N}`);
const { page } = s;
const result = { shots: [] };
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = async (file, info) => {
  await page.evaluate(() => window.__qq.render());
  await nextPaint();
  await page.screenshot({ path: join(OUT, file) });
  result.shots.push({ file, ...info });
};

try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 120000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 120000 });
  await page.evaluate(() => {
    const q = window.__qq; q.paused = true;
    window.__m = {
      fresh() {
        const g = q.game; g.start(q.PRACTICE);
        const w = g.world; w.god = true;
        for (let i = 0; i < 130; i++) q.step(1 / 120);
        w.skipTo(420); w.enemies.length = 0; w.banners = []; w.pops = [];
        w.player.body.facing = 1;
        for (let i = 0; i < 20; i++) q.step(1 / 120);
        return w;
      },
      mk(kind, x, y, mount) {
        const w = q.game.world;
        const e = w.spawn(kind, x, y ?? w.groundAt(x));
        e.aware = true; e.act = 'none'; e.facing = -1;
        if (y !== undefined && y !== null) e.onGround = false;
        if (mount) e.mem.mount = 1;
        if (e.boss) { w.boss = e; e.state = 'idle'; e.mem.cd = 99; }
        return e;
      },
      step(sec, until) {
        const w = q.game.world, n = Math.round(sec * 120);
        for (let i = 0; i < n; i++) { q.step(1 / 120); w.banners = []; w.pops = []; if (until && until(w)) return i + 1; }
        return n;
      },
      cond(e, c) {
        if (!c) return null;
        const [k, v] = c.split(':');
        if (k === 'bullet') return (w) => w.bullets.some((b) => b.kind === v);
        if (k === 'state') return () => e.state === v;
        if (k === 'harm') return () => !!e.harm;
        return null;
      },
      info(e) { return { state: e.state, anim: e.anim?.name, frame: e.anim?.frame, animOn: e.animOn, p2: e.p2 }; },
    };
  });

  // ── 1. 每隻怪：走、出招、受傷、倒下 ──
  for (const m of C.monsters) {
    let info = await page.evaluate((m) => {
      const M = window.__m; M.fresh();
      const e = M.mk(m.kind, m.x, m.y, m.mount);
      M.step((m.walk ?? 40) / 120);
      return M.info(e);
    }, m);
    await snap(`動畫_${m.name}_1走.png`, info);
    if (!m.boss) {
      info = await page.evaluate((m) => {
        const M = window.__m; M.fresh();
        const e = M.mk(m.kind, m.x, m.y, m.mount);
        M.step(0.1);
        e.state = m.attack.state; e.t = 0; e.warn = 0.6;
        if (m.attack.until) M.step(8, M.cond(e, m.attack.until));   // 沒給 until 的（紙鶴、蝌蚪）直接推 after 秒
        M.step(m.attack.after ?? 0);
        return M.info(e);
      }, m);
      await snap(`動畫_${m.name}_2出招.png`, info);
    }
    info = await page.evaluate((m) => {
      const M = window.__m, w = M.fresh();
      const e = M.mk(m.kind, m.x, m.y, m.mount);
      M.step(0.15);
      e.hp = e.maxHp = 50000; if (e.part) e.part.hp = 50000;
      w.damageEnemy(e, 10, { x: e.x - 30, y: e.y - 60, dir: 1, kind: 'test' });
      M.step(0.1);
      return M.info(e);
    }, m);
    await snap(`動畫_${m.name}_3受傷.png`, info);
    info = await page.evaluate((m) => {
      const M = window.__m, w = M.fresh();
      const e = M.mk(m.kind, m.x, m.y, m.mount);
      if (e.boss) { e.p2 = true; e.hp = e.maxHp = 1000; }
      M.step(0.15);
      w.damageEnemy(e, 99999, { x: e.x - 30, y: e.y - 60, dir: 1, kind: 'test' });
      M.step(e.mem.ko ? (e.mem.koTime ?? 1.5) * 0.75 : e.boss ? 1.4 : 0.35);
      return { ...M.info(e), ko: !!e.mem.ko };
    }, m);
    await snap(`動畫_${m.name}_4倒下.png`, info);
  }

  // ── 2. 魔王每一招：預兆、出招 ──
  for (const [name, kind, set, t1, t2] of C.moves) {
    for (const [phase, t] of [['1預兆', t1], ['2出招', t2]]) {
      const info = await page.evaluate(({ kind, set, t1, t, phase }) => {
        const M = window.__m, w = M.fresh();
        const e = M.mk(kind, 1000);
        if (set.p2) { e.p2 = true; e.hp = e.maxHp = set.p2; if (e.part) e.part.broken = true; }
        if (set.low !== undefined) e.mem.low = set.low;
        M.step(0.3);
        e.state = set.state; e.t = 0; e.warn = 0.6; e.invuln = 0;
        if (set.low !== undefined) e.mem.low = set.low;
        M.step(phase === '1預兆' ? t : t1);
        if (phase === '2出招') M.step(t);
        return M.info(e);
      }, { kind, set, t1, t, phase });
      await snap(`魔王_${name}_${phase}.png`, info);
    }
  }

  // ── 3. 每段場景 ──
  for (const [name, x, extra] of C.scenes) {
    const info = await page.evaluate(({ x, extra, N, BRK }) => {
      const q = window.__qq, g = q.game; g.start(q.STAGES[N - 1]);
      if (extra?.ending) { g.finalScore = 318250; g.go('ending'); g.screenT = extra.ending; return { ending: extra.ending }; }
      const w = g.world; w.god = true;
      for (let i = 0; i < 130; i++) q.step(1 / 120);
      if (extra?.gateBroken) for (const b of w.breakables) if (b.kind === 'gate' || b.kind === 's3_gate') { b.broken = true; b.fall = 1; }
      w.skipTo(x);
      const clean = () => { w.enemies.length = 0; w.banners = []; w.pops = []; w.bullets.length = 0; w.particles.length = 0; };
      clean();
      for (let i = 0; i < 90; i++) { q.step(1 / 120); clean(); }
      if (extra?.onPlat) {
        const b = w.player.body; b.x = extra.onPlat[0]; b.y = extra.onPlat[1] - 4; b.vx = 0; b.vy = 0; b.onGround = false;
        for (let i = 0; i < 60; i++) { q.step(1 / 120); clean(); }
      }
      if (extra?.spawn) {
        for (const [k, x, y, mount] of extra.spawn) { const e = w.spawn(k, x, y ?? w.groundAt(x)); e.aware = true; if (y) { e.onGround = false; } if (mount) e.mem.mount = 1; }
        for (let i = 0; i < 40; i++) { q.step(1 / 120); w.banners = []; w.pops = []; w.bullets.length = 0; }
      }
      if (extra?.vent) {
        for (let i = 0; i < 600; i++) { q.step(1 / 120); clean(); if ((w.stage.vents ?? []).some((v) => w.onScreen(v.x, -100) && w.ventState(v).on && w.ventState(v).k > 0.4)) break; }
      }
      if (extra?.lift) {
        const pl = w.platforms.find((p) => p.lift);
        const b = w.player.body;
        for (let i = 0; i < 600; i++) { q.step(1 / 120); clean(); if (Math.abs(pl.y - pl.y0) < 1) break; }
        b.x = pl.x + pl.w / 2; b.y = pl.y; b.vy = 0; b.onGround = true;
        for (let i = 0; i < Math.round(extra.lift * 120); i++) { q.step(1 / 120); clean(); }
      }
      if (extra?.brk !== undefined) {
        const kinds = BRK;
        const xs = [260, 470, 630, 790, 930, 1120];
        w.breakables = w.breakables.filter((b) => b.x < w.camX - 300 || b.x > w.camX + 1600);
        kinds.forEach((k, i) => { const b = w.addBreakable(k, w.camX + xs[i]); if (extra.brk) b.broken = true; });
        w.player.body.x = w.camX + 90;
        for (let i = 0; i < 10; i++) { q.step(1 / 120); clean(); }
      }
      if (extra?.kappa) {
        const k = w.spawn('kappa', extra.kappa, w.waterSurface(extra.kappa) + 200);
        k.mem.water = 1; k.mem.surf = w.waterSurface(extra.kappa); k.aware = true; k.state = 'rise'; k.t = 0;
        for (let i = 0; i < 60; i++) { q.step(1 / 120); w.banners = []; w.pops = []; }
      }
      return { x: Math.round(w.player.body.x), y: Math.round(w.player.body.y), onGround: w.player.body.onGround, cam: Math.round(w.camX), zone: w.stage.zones[Math.max(0, w.zone)]?.name };
    }, { x, extra: extra ?? null, N, BRK: C.brk ?? [] });
    await snap(`場景_${name}.png`, info);
  }

  // ── 4. 這一關怪物的動作總覽 ──
  const kinds = [...new Set(C.monsters.map((m) => m.kind))];
  const sheet = !kinds.length ? null : await page.evaluate(({ kinds, N }) => {
    const q = window.__qq, A = q.assets;
    const DEF = { lantern_ghost: 170, kasa_obake: 190, paper_crane: 110, kappa: 180, mask_dancer: 210, fox_miko: 210, tengu: 210, tadpole: 95, frog_daimyo: 320, tanuki_lord: 380, orange_king: 380 };
    const rows = [];
    for (const k of N === 2 ? [...kinds, 'orange_king'] : kinds) {
      const v = A.monsters.get(k);
      if (!v) continue;
      DEF[k] ??= Math.round(v.standHeight / 1.25);
      for (const [act, d] of Object.entries(v.lib.defs)) if (k !== 'orange_king' || act === 'jump_p2') rows.push({ m: k, v, act, d });
    }
    const LABEL = 170, cols = 8;
    const cwOf = (r) => Math.max(190, Math.min(520, Math.round((DEF[r.m] ?? 200) * 1.35)));
    const rowH = (r) => Math.max(150, Math.min(470, (DEF[r.m] ?? 200) + 90));
    const H = rows.reduce((a, r) => a + rowH(r), 0);
    const c = document.createElement('canvas'); c.width = LABEL + Math.max(...rows.map(cwOf)) * cols; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#2c2638'; g.fillRect(0, 0, c.width, c.height);
    let y = 0;
    for (const r of rows) {
      const h = rowH(r), base = y + h - 24, scale = (DEF[r.m] ?? 200) / r.v.standHeight, CW = cwOf(r);
      g.fillStyle = (rows.indexOf(r) % 2) ? '#352e44' : '#2c2638'; g.fillRect(0, y, c.width, h);
      g.fillStyle = '#ffe07a'; g.font = 'bold 18px "Microsoft JhengHei"'; g.fillText(r.m, 8, y + 30);
      g.fillStyle = '#fff'; g.font = '16px "Microsoft JhengHei"'; g.fillText(`${r.act}（${r.d.frames.length} 格${r.d.loop ? '、循環' : ''}）`, 8, y + 54);
      const marks = Object.entries(r.d.markers).map(([k2, v2]) => `${k2}=${v2}`).join(' ');
      if (marks) { g.fillStyle = '#9ff0ff'; g.font = '14px "Microsoft JhengHei"'; g.fillText(marks, 8, y + 76); }
      const n = r.d.frames.length;
      const pick = [...new Set(Array.from({ length: cols }, (_, i) => Math.round(i * (n - 1) / (cols - 1))))];
      pick.forEach((fi, k2) => {
        const x = LABEL + k2 * CW + CW / 2;
        g.save(); g.beginPath(); g.rect(LABEL + k2 * CW, y, CW, h); g.clip();
        q.drawFrame(g, r.v.lib.images[r.act][fi], r.d.frames[fi], x, base, 1, scale);
        g.restore();
        g.strokeStyle = 'rgba(255,70,70,.8)'; g.beginPath(); g.moveTo(LABEL + k2 * CW + 4, base + 0.5); g.lineTo(LABEL + (k2 + 1) * CW - 4, base + 0.5); g.stroke();
        const tag = Object.entries(r.d.markers).filter(([, v2]) => v2 === fi).map(([k3]) => k3).join(',');
        g.fillStyle = tag ? '#9ff0ff' : '#ccc'; g.font = '13px "Microsoft JhengHei"'; g.fillText(`${fi}${tag ? ' ' + tag : ''}`, LABEL + k2 * CW + 6, y + 16);
      });
      y += h;
    }
    return c.toDataURL('image/png');
  }, { kinds, N });
  if (sheet) writeFileSync(join(OUT, '動畫_總覽.png'), Buffer.from(sheet.split(',')[1], 'base64'));

  // ── 5. 所有截圖縮小排成一張（在瀏覽器外面用 Python 拼：幾十張全尺寸截圖塞進頁面會把瀏覽器撐掛）──
  const files = result.shots.map((x) => x.file);
  const r = spawnSync('python', [join(ROOT, 'tools', 'contact_sheet.py'), OUT, join(OUT, '總覽.png'), files.join(',')], { encoding: 'utf8', windowsHide: true });
  result.sheet = (r.stdout || r.stderr || '').trim();
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, 'stage_check.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify(result.shots.map((x) => `${x.file} ${x.anim ?? ''}#${x.frame ?? ''} ${x.animOn === false ? '（單張立繪）' : ''}`), null, 0).slice(0, 4000), JSON.stringify(result.logs.slice(0, 8)));
