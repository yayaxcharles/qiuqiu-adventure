// 第一關實機自動玩：打包版、獨立瀏覽器資料夾的無頭 Chrome（qiuqiu-coop 畫面比對閘門的 newContext），
// 讓 src/autopilot.ts 用真的主迴圈（照實際時間推）從標題一路玩到結算，邊玩邊記每個畫面格花多久。
// 關鍵時刻（每段場景、每種敵人出招、村貓被救、撿武器、每種武器發射、魔王出場與換階段、結算…）第一次發生時，
// 當場暫停遊戲截圖再繼續（暫停中的畫面格不算進卡頓統計）。最後在練習場把十種忍具、三種副武器、三個丟的方向各截一張。
//
// 用法：npm run build 之後 node tools/stage1_play.mjs [--god] [--stage=2]（--god＝開無敵跑，只為了拿齊截圖時用）
// 輸出：第一關 vids/_stage1_check/（截圖、play_result.json、frames.json）；
//       第二關起 vids/_stageN_check/實機自動玩/（只有自動玩的截圖與統計；每隻怪、魔王每一招、每段場景另外用 tools/stage_check.mjs 截）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOD = process.argv.includes('--god');
const STAGE = Number((process.argv.find((a) => a.startsWith('--stage=')) ?? '--stage=1').slice(8));
/** --lq：用手機版的圖（怪物每秒約 12 格的跳格版，網址 ?lq），結果放另一個資料夾 */
const LQ = process.argv.includes('--lq');
const OUT0 = STAGE === 1 ? join(ROOT, 'vids', '_stage1_check') : join(ROOT, 'vids', `_stage${STAGE}_check`, '實機自動玩');
const OUT = LQ ? join(OUT0, '手機版圖') : OUT0;
const QS = [STAGE === 1 ? '' : `pick=${STAGE}`, LQ ? 'lq' : ''].filter(Boolean).join('&');
const PORT = 4397, URL = `http://127.0.0.1:${PORT}/${QS ? '?' + QS : ''}`;
const TIMEOUT_MS = 25 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
// 清掉上一次的截圖（腳底檢查的圖留著）
for (const f of readdirSync(OUT)) if (/^\d\d\d_.*\.png$|^武器_.*\.png$|^敵人_.*\.png$|^場景_.*\.png$/.test(f)) rmSync(join(OUT, f));

if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('先跑 npm run build'); process.exit(1); }
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'play');
const { page } = s;
const result = { stage: STAGE, god: GOD, lq: LQ, shots: [] };
let n = 0;
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = async (name) => {
  n++;
  const file = `${String(n).padStart(3, '0')}_${name.replace(/[\\/:*?"<>|]/g, '_')}.png`;
  await nextPaint();
  await page.screenshot({ path: join(OUT, file) });
  const info = await page.evaluate(() => { const w = window.__qq.game.world; return w ? { t: +w.time.toFixed(2), x: Math.round(w.player.body.x) } : {}; });
  result.shots.push({ file, ...info });
  return file;
};

try {
  assertLocal(URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__qq?.game, null, { timeout: 90000 });
  await sleep(1200);
  await shot('標題畫面');

  // ── 頁面裡的監看：事件第一次發生就排一張截圖（延遲一點讓畫面演到位），到時間就暫停 ──
  await page.evaluate(({ GOD, STAGE }) => {
    const q = window.__qq, g = q.game;
    const NAME = {
      rat: '鼠兵', orange_bandit: '橘貓山賊', black_ninja: '黑衣忍者', crow_small: '烏鴉', wild_boar: '野豬', tanuki_kid: '小狸', drum_tanuki: '太鼓狸', orange_king: '橘皮大王',
      lantern_ghost: '燈籠鬼', kasa_obake: '傘妖', paper_crane: '紙鶴', kappa: '河童', mask_dancer: '面具舞者', fox_miko: '白狐巫女', tengu: '天狗', tadpole: '蝌蚪兵', frog_daimyo: '蛙大名', tanuki_lord: '狸大人', tanuki_clone: '狸大人分身',
      vacuum: '吸塵機器', mini_broom: '小掃把', broom_centipede: '掃把蜈蚣', iron_arhat: '鐵羅漢', armor_ghost: '空鎧武者', plated_beetle: '甲蟲砲台', wraith_samurai: '怨靈武士', guardian_statue: '守門石獅', roomba_king: '掃地機王', iron_claw: '鐵爪機關貓',
    };
    const MISSION = ['', '任務一開始', '任務二開始', '任務三開始'][STAGE] ?? '任務開始';
    const FIRST_ZONE = q.STAGES[STAGE - 1]?.zones[0]?.name;
    const WNAME = { shuriken: '手裏劍', H: '棒手裏劍連射', R: '風魔大手裏劍', F: '火藥竹筒', S: '撒菱', L: '鎖鎌', C: '式神紙鶴', I: '鼠火', D: '毛球彈', B: '吹箭', bomb: '爆裂符', bigbomb: '焙烙玉', smoke: '煙玉', fish: '魚乾', onigiri: '飯糰' };
    const ATK = { '咬': 0.08, '揮木棒': 0.06, '丟苦無': 0.2, '俯衝': 0.22, '衝鋒': 0.3, '撲': 0.15, '地面震波': 0.3, '叫小狸': 0.35, '鼓爆': 0.08, '肚皮壓': 0.5, '丟魚骨頭': 0.4, '滾過來': 0.35, '滾更快': 0.3, '泰山壓頂': 1.25 };
    const mon = window.__mon = { queue: [], taken: new Set(), pending: null, done: false, maxFootDiff: 0, footSamples: 0, caps: 0 };
    const want = (key, name, delay) => { if (mon.taken.has(key)) return; mon.taken.add(key); mon.queue.push({ name, due: (g.world?.time ?? 0) + delay }); };
    const classify = (e) => {
      switch (e.type) {
        case 'missionStart': want('mission', MISSION, 0.45); break;
        case 'zone': want('zone:' + e.zone, '場景_' + e.zone, e.zone === FIRST_ZONE ? 3.0 : 1.2); break;
        case 'notice': want('notice', '敵人發現球球（頭上冒！）', 0.12); break;
        case 'enemyAttack': want(`atk:${e.kind}:${e.move}`, `出招_${NAME[e.kind] ?? e.kind}_${e.move}`, ATK[e.move] ?? 0.2); break;
        case 'enemyMove': want(`mv:${e.kind}:${e.move}`, `敵人動作_${NAME[e.kind] ?? e.kind}_${e.move}`, 0.35); break;
        case 'captiveFreed': mon.caps++; want(`cap${mon.caps}`, `村貓${mon.caps}_道謝鞠躬`, 0.5); want(`cap${mon.caps}give`, `村貓${mon.caps}_掏出道具`, 1.2); want(`cap${mon.caps}run`, `村貓${mon.caps}_跑走`, 2.0); break;
        case 'pickup': if (!e.dev) want('pick:' + e.kind, '撿到_' + (WNAME[e.kind] ?? e.kind), 0.12); break;
        case 'fire': want('fire:' + e.weapon, '發射_' + (WNAME[e.weapon] ?? e.weapon), e.weapon === 'F' ? 0.14 : e.weapon === 'S' ? 0.08 : 0.1); break;
        case 'sub': want('sub:' + e.kind, '副武器_' + (WNAME[e.kind] ?? e.kind) + '_飛行中', 0.28); break;
        case 'explode': if (e.big) want('boom', '大爆炸', 0.1); break;
        case 'break': want('break:' + e.kind, '打爛_' + ({ crate: '木箱', barrel: '酒桶', powder: '火藥桶', cage: '竹籠', tower: '瞭望台', gate: '寨門', stall: '攤位', s2_lantern_stall: '燈籠攤', s2_crate: '祭典木箱', s2_sake_stack: '酒樽堆', s2_stone_lantern: '石燈籠', s2_offering_box: '賽錢箱', s2_signboard: '木看板', s3_oil_drum: '油桶', s3_gearbox: '齒輪箱', s3_crate: '機關城木箱', s3_steam_pipe: '蒸氣管', s3_gate: '機關城城門' }[e.kind] ?? e.kind), e.kind === 'tower' || e.kind === 'gate' || e.kind === 's3_gate' ? 0.45 : 0.12); break;
        case 'split': want('split', '掃把蜈蚣分裂', 0.3); break;
        case 'blocked': want('blocked', '鐵羅漢擋子彈', 0.05); break;
        case 'sealed': want('sealed', '城門封印（石獅守著）', 0.1); break;
        case 'bossEnter': want('boss:' + e.kind, '魔王出場_' + NAME[e.kind], 1.8); break;
        case 'partBroken': want('part', '橘皮大王_背包炸飛', 0.25); break;
        case 'bossPhase': want('phase2:' + (e.kind ?? g.world?.boss?.kind ?? ''), (NAME[e.kind ?? g.world?.boss?.kind] ?? '魔王') + '_第二階段', 1.3); break;
        case 'grabbed': want('grabbed', '被蛙大名的舌頭抓住', 0.25); break;
        case 'bossDown': want('down:' + e.kind, '打倒_' + NAME[e.kind], 0.8); break;
        case 'missionComplete': want('complete', '任務完成', 0.7); break;
        case 'playerHurt': want('hurt', '球球受傷', 0.06); break;
        case 'playerDown': want('pdown', '球球倒下', 1.0); break;
        case 'respawn': want('respawn', '重生從天上掉下來', 0.3); break;
        case 'fellInPit': want('pit', '掉進坑重來', 0.3); break;
        case 'waveCleared': want('wave', '一波打完_前進', 0.25); break;
        case 'thorns': want('thorns', '刺反彈', 0.05); break;
        case 'kill': want('kill', '敵人被打飛轉圈', 0.22); break;
      }
    };
    const orig = g.update.bind(g);
    window.__origUpdate = orig;
    let seen = 0;
    g.update = (dt, f) => {
      if (q.paused) return;
      orig(dt, f);
      const w = g.world; if (!w) return;
      if (g.eventLog.length < seen) seen = 0;
      for (let i = seen; i < g.eventLog.length; i++) classify(g.eventLog[i]);
      seen = g.eventLog.length;
      // 腳底：站在地上時身體的 y 跟地面（或平台）差多少
      const b = w.player.body;
      if (b.onGround && w.player.alive) {
        const pl = w.platforms.find((p) => Math.abs(b.y - p.y) < 0.5 && b.x >= p.x && b.x <= p.x + p.w);
        mon.maxFootDiff = Math.max(mon.maxFootDiff, Math.abs(b.y - (pl ? pl.y : w.groundAt(b.x))));
        mon.footSamples++;
      }
      if (!mon.pending) {
        const i = mon.queue.findIndex((x) => w.time >= x.due);
        if (i >= 0) { mon.pending = mon.queue.splice(i, 1)[0].name; q.paused = true; return; }
      }
      if (g.screen === 'continue' && !mon.taken.has('continue')) { mon.taken.add('continue'); mon.pending = '接關畫面_繼續？'; q.paused = true; }
      if (g.screen === 'result' && g.screenT > 4.2 && !mon.taken.has('result')) { mon.taken.add('result'); mon.pending = '結算畫面'; q.paused = true; mon.done = true; }
    };
    g.startGod = GOD;
    q.frameMs.length = 0; q.frameScr.length = 0; q.workMs.length = 0;
    g.bot = q.createBot();
    mon.t0 = performance.now();
  }, { GOD, STAGE });

  // ── 等著截圖 ──
  const t0 = Date.now();
  let lastLog = 0;
  for (;;) {
    if (Date.now() - t0 > TIMEOUT_MS) { result.timeout = true; break; }
    const st = await page.evaluate(() => { const g = window.__qq.game, w = g.world; return { pending: window.__mon.pending, done: window.__mon.done, screen: g.screen, t: w ? +w.time.toFixed(1) : 0, x: w ? Math.round(w.player.body.x) : 0, lives: w?.lives, cont: w?.continues }; });
    if (st.pending) {
      await shot(st.pending);
      await page.evaluate(() => { window.__mon.pending = null; window.__qq.paused = false; });
      if (st.done) break;
      continue;
    }
    if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`進度：遊戲 ${st.t} 秒、x=${st.x}、畫面 ${st.screen}、剩 ${st.lives} 命、接關 ${st.cont} 次（實際 ${Math.round((Date.now() - t0) / 1000)} 秒）`); }
    await sleep(40);
  }

  // ── 統計 ──
  const stats = await page.evaluate(() => {
    const q = window.__qq, g = q.game, w = g.world, ev = g.eventLog;
    const count = (t) => ev.filter((e) => e.type === t).length;
    const hurtBy = {}; for (const e of ev) if (e.type === 'playerHurt') { const k = e.src || (e.pit ? 'pit' : '?'); hurtBy[k] = (hurtBy[k] ?? 0) + 1; }
    return {
      screen: g.screen, cleared: g.screen === 'result', gameSeconds: +w.time.toFixed(1), realSeconds: +((performance.now() - window.__mon.t0) / 1000).toFixed(1),
      score: w.score, rescued: w.rescued, kills: w.kills, deaths: w.deaths, continues: w.continues, maxCombo: w.maxCombo,
      hurt: count('playerHurt'), hurtBy, pits: count('fellInPit'),
      bosses: ev.filter((e) => e.type === 'bossDown').map((e) => `${e.kind}@${e.t}s`),
      zones: ev.filter((e) => e.type === 'zone').map((e) => `${e.zone}@${e.t}s`),
      attacks: [...new Set(ev.filter((e) => e.type === 'enemyAttack').map((e) => `${e.kind}:${e.move}`))],
      weaponsFired: [...new Set(ev.filter((e) => e.type === 'fire').map((e) => e.weapon))],
      pickups: [...new Set(ev.filter((e) => e.type === 'pickup').map((e) => e.kind))],
      breaks: [...new Set(ev.filter((e) => e.type === 'break').map((e) => e.kind))],
      maxFootDiff: window.__mon.maxFootDiff, footSamples: window.__mon.footSamples,
      frameMs: q.frameMs.slice(),
    };
  });
  const fm = stats.frameMs; delete stats.frameMs;
  const fs = await page.evaluate(() => window.__qq.frameScr.slice());
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(fm));
  writeFileSync(join(OUT, 'frames_screen.json'), JSON.stringify(fs));
  // 打的時候（畫面＝play）超過 33 毫秒的格：第幾格、多久、在第幾秒
  let tt = 0; stats.longInPlay = [];
  fm.forEach((v, i) => { tt += v; if (v > 33.4 && fs[i] === 'play') stats.longInPlay.push({ i, ms: v, atSec: +(tt / 1000).toFixed(2) }); });
  stats.longOther = fm.map((v, i) => [v, fs[i]]).filter(([v, sc]) => v > 33.4 && sc !== 'play').map(([v, sc]) => `${sc}:${v}`);
  stats.longInfo = await page.evaluate(() => window.__qq.longInfo.slice());
  // 遊戲自己每一格花的時間（推＋畫）：打的時候 99% 要在 8 毫秒內
  const wk = await page.evaluate(() => window.__qq.workMs.slice());
  const wp = wk.filter((_, i) => fs[i] === 'play').sort((a, b) => a - b);
  const wq = (p) => wp[Math.min(wp.length - 1, Math.floor(wp.length * p))];
  stats.work = { count: wp.length, p50: wq(0.5), p95: wq(0.95), p99: wq(0.99), max: wp[wp.length - 1], over8: wp.filter((v) => v > 8).length, over8pct: +(100 * wp.filter((v) => v > 8).length / Math.max(1, wp.length)).toFixed(2) };
  const sorted = fm.slice(1).sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  stats.frames = {
    count: fm.length, meanMs: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1],
    over33: sorted.filter((v) => v > 33.4).length, over50: sorted.filter((v) => v > 50).length, over100: sorted.filter((v) => v > 100).length,
  };
  result.run = stats;

  // ── 練習場：十種忍具、三種副武器、三個丟的方向（只有第一關跑；第二關起每隻怪、每段場景用 stage_check.mjs）──
  result.showcase = [];
  if (STAGE !== 1) throw new Error('__skip_showcase__');
  await page.evaluate(() => window.__qq.loadAll());   // 下面直接開練習場、第一關截圖：先全部載完
  await page.evaluate(() => { const q = window.__qq; q.paused = true; q.game.bot = null; q.game.update = window.__origUpdate; });
  const WEAP = [['shuriken', '手裏劍'], ['H', '棒手裏劍連射'], ['R', '風魔大手裏劍'], ['F', '火藥竹筒'], ['S', '撒菱'], ['L', '鎖鎌'], ['C', '式神紙鶴'], ['I', '鼠火'], ['D', '毛球彈'], ['B', '吹箭']];
  const HOLD = { shuriken: 0.02, H: 0.35, R: 0.02, F: 0.2, S: 0.02, L: 0.02, C: 0.5, I: 0.02, D: 0.45, B: 0.02 };
  const AFTER = { shuriken: 0.14, H: 0.02, R: 0.3, F: 0.05, S: 0.1, L: 0.09, C: 0.25, I: 0.35, D: 0.3, B: 0.07 };
  for (const [id, name] of WEAP) {
    await page.evaluate(({ id, hold, after }) => {
      const q = window.__qq, g = q.game; g.start(q.PRACTICE);
      const w = g.world; w.god = true;
      const F = (o = {}) => ({ left: false, right: false, up: false, down: false, walk: false, jumpHeld: false, jumpPressed: false, attackPressed: false, attackHeld: false, subPressed: false, subSwitchPressed: false, dashPressed: false, startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, ...o });
      for (let i = 0; i < 130; i++) q.step(1 / 120, F());
      w.banners = [];
      w.skipTo(470); w.player.arsenal.pick(id);
      for (let i = 0; i < 30; i++) q.step(1 / 120, F());
      const n1 = Math.max(1, Math.round(hold * 120));
      for (let i = 0; i < n1; i++) q.step(1 / 120, F({ attackHeld: true, attackPressed: i === 0 }));
      for (let i = 0; i < Math.round(after * 120); i++) q.step(1 / 120, F());
      q.render();
    }, { id, hold: HOLD[id], after: AFTER[id] });
    const f = `武器_${id}_${name}.png`;
    await nextPaint(); await page.screenshot({ path: join(OUT, f) });
    result.showcase.push(f);
  }
  for (const [k, name, i] of [['bomb', '爆裂符', 0], ['bigbomb', '焙烙玉', 1], ['smoke', '煙玉', 2]]) {
    for (const [phase, t] of [['飛行中', 0.3], ['炸開', 0.62]]) {
      await page.evaluate(({ k, i, t }) => {
        const q = window.__qq, g = q.game; g.start(q.PRACTICE);
        const w = g.world; w.god = true;
        const F = (o = {}) => ({ left: false, right: false, up: false, down: false, walk: false, jumpHeld: false, jumpPressed: false, attackPressed: false, attackHeld: false, subPressed: false, subSwitchPressed: false, dashPressed: false, startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, ...o });
        for (let j = 0; j < 130; j++) q.step(1 / 120, F());
        w.banners = [];
        w.skipTo(560);
        if (k !== 'bomb') w.player.arsenal.pickSub(k);
        for (let j = 0; j < 30; j++) q.step(1 / 120, F());
        q.step(1 / 120, F({ subPressed: true }));
        for (let j = 0; j < Math.round(t * 120); j++) q.step(1 / 120, F());
        q.render();
        void i;
      }, { k, i, t });
      const f = `武器_副_${name}_${phase}.png`;
      await nextPaint(); await page.screenshot({ path: join(OUT, f) });
      result.showcase.push(f);
    }
  }
  for (const [name, seq] of [['朝上丟', 'up'], ['空中朝下丟', 'down'], ['蹲著丟', 'crouch']]) {
    await page.evaluate((seq) => {
      const q = window.__qq, g = q.game; g.start(q.PRACTICE);
      const w = g.world; w.god = true;
      const F = (o = {}) => ({ left: false, right: false, up: false, down: false, walk: false, jumpHeld: false, jumpPressed: false, attackPressed: false, attackHeld: false, subPressed: false, subSwitchPressed: false, dashPressed: false, startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, ...o });
      for (let j = 0; j < 130; j++) q.step(1 / 120, F());
      w.banners = [];
      w.skipTo(700);
      for (let j = 0; j < 30; j++) q.step(1 / 120, F());
      if (seq === 'up') { q.step(1 / 120, F({ up: true, attackPressed: true, attackHeld: true })); for (let j = 0; j < 22; j++) q.step(1 / 120, F({ up: true })); }
      if (seq === 'down') { q.step(1 / 120, F({ jumpPressed: true, jumpHeld: true })); for (let j = 0; j < 40; j++) q.step(1 / 120, F({ jumpHeld: true })); q.step(1 / 120, F({ down: true, attackPressed: true, jumpHeld: true })); for (let j = 0; j < 10; j++) q.step(1 / 120, F({ down: true, jumpHeld: true })); }
      if (seq === 'crouch') { for (let j = 0; j < 30; j++) q.step(1 / 120, F({ down: true })); q.step(1 / 120, F({ down: true, attackPressed: true })); for (let j = 0; j < 14; j++) q.step(1 / 120, F({ down: true })); }
      q.render();
    }, seq);
    const f = `武器_方向_${name}.png`;
    await nextPaint(); await page.screenshot({ path: join(OUT, f) });
    result.showcase.push(f);
  }
  // ── 場景（第一關幾個地方各一張，沒有敵人、沒有字幕）──
  for (const [name, x] of [['村口', 700], ['民家屋頂', 2500], ['小市集', 4200], ['石橋', 9000], ['竹林', 11600], ['中魔王平地', 13900], ['寨門', 17900], ['魔王平地', 20400]]) {
    await page.evaluate((x) => {
      const q = window.__qq, g = q.game; g.start(q.STAGES[0]);
      const w = g.world; w.god = true;
      for (let i = 0; i < 130; i++) q.step(1 / 120);
      w.skipTo(x); w.enemies.length = 0; w.banners = [];
      for (let i = 0; i < 150; i++) { q.step(1 / 120); w.enemies.length = 0; w.banners = []; }
      q.render();
    }, x);
    const f = `場景_${name}.png`;
    await nextPaint(); await page.screenshot({ path: join(OUT, f) });
    result.showcase.push(f);
  }

  // ── 每種敵人：預兆（閃紅＋頭上「！」、蓄力）→ 出招，各一張（練習場平地，球球無敵）──
  const FOES = [
    ['鼠兵_咬', 'rat', 640, null, { state: 'windup', warn: 0.3 }, 0.14, 0.2],
    ['橘貓山賊_揮木棒', 'orange_bandit', 660, null, { state: 'windup', warn: 0.5 }, 0.25, 0.33],
    ['黑衣忍者_丟苦無', 'black_ninja', 980, null, { state: 'windup', warn: 0.5 }, 0.25, 0.45],
    ['烏鴉_俯衝', 'crow_small', 720, 200, { state: 'windup', warn: 0.45 }, 0.2, 0.4],
    ['野豬_衝鋒', 'wild_boar', 1150, null, { state: 'windup', warn: 0.9 }, 0.45, 0.75],
    ['小狸_撲', 'tanuki_kid', 720, null, { state: 'crouch' }, 0.12, 0.25],
    ['太鼓狸_地面震波', 'drum_tanuki', 980, null, { state: 'waveWind', warn: 0.75 }, 0.4, 0.6],
    ['太鼓狸_叫小狸', 'drum_tanuki', 980, null, { state: 'summonWind', warn: 0.6 }, 0.3, 0.55],
    ['太鼓狸_鼓爆', 'drum_tanuki', 760, null, { state: 'blastWind', warn: 0.55 }, 0.3, 0.33],
    ['橘皮大王_肚皮壓', 'orange_king', 980, null, { state: 'bellyWind', warn: 0.6 }, 0.35, 0.6],
    ['橘皮大王_丟魚骨頭', 'orange_king', 980, null, { state: 'fishWind', warn: 0.5 }, 0.3, 0.55],
    ['橘皮大王_滾過來', 'orange_king', 1050, null, { state: 'rollWind', warn: 0.7 }, 0.4, 0.55],
    ['橘皮大王二階_泰山壓頂', 'orange_king', 980, null, { state: 'crushWind', warn: 0.4, p2: true }, 1.4, 1.1],
    ['橘皮大王二階_滾更快', 'orange_king', 1050, null, { state: 'rollWind', warn: 0.55, p2: true }, 0.35, 0.4],
  ];
  for (const [name, kind, x, y, pre, t1, t2] of FOES) {
    for (const [phase, t] of [['1預兆', t1], ['2出招', t2]]) {
      await page.evaluate(({ kind, x, y, pre, t1, t, phase }) => {
        const q = window.__qq, g = q.game; g.start(q.PRACTICE);
        const w = g.world; w.god = true;
        for (let i = 0; i < 130; i++) q.step(1 / 120);
        w.skipTo(500); w.enemies.length = 0; w.banners = [];
        w.player.body.facing = 1;
        for (let i = 0; i < 20; i++) q.step(1 / 120);
        const e = w.spawn(kind, x, y ?? w.groundAt(x));
        e.aware = true; e.act = 'none'; e.facing = -1;
        if (y !== null) e.onGround = false;
        if (e.boss) w.boss = e;
        if (pre.p2) { e.p2 = true; if (e.part) e.part.broken = true; e.hp = e.maxHp = 1100; }
        e.state = pre.state; e.t = 0; if (pre.warn) e.warn = pre.warn;
        const total = phase === '1預兆' ? t : t1 + t;
        for (let i = 0; i < Math.round(total * 120); i++) { q.step(1 / 120); w.banners = []; }
        q.render();
      }, { kind, x, y, pre, t1, t, phase });
      const f = `敵人_${name}_${phase}.png`;
      await nextPaint(); await page.screenshot({ path: join(OUT, f) });
      result.showcase.push(f);
    }
  }
} catch (err) {
  if (String(err?.message ?? err) !== '__skip_showcase__') throw err;
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, 'play_result.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify({ run: result.run, shots: result.shots.length, showcase: result.showcase.length, timeout: result.timeout, logs: result.logs.slice(0, 10) }, null, 1));
