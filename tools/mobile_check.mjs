// 手機模擬檢查（09-27 使用者：「推上 git 讓我也能夠用手機玩」）：
//   無頭 Chrome 模擬手機（橫向 844×390、觸控、裝置倍率 3），開打包版的本機預覽（先 npm run build）：
//   1. 標題畫面（有方向盤）、直向時的「請轉成橫向」
//   2. 點畫面開始第一關 → 用模擬觸控實際按：方向盤往右走、跳、攻擊（丟）、爆裂符，各確認遊戲有反應
//   3. 依序進第二、三關（照遊戲流程換關：前一關的圖放掉），每關截一張有觸控按鈕的畫面
//   4. 每一段記下載了多少（網路實際傳的位元組）、解碼後的圖佔多少（__qq.memStats，寬×高×4）
// 瀏覽器：本機 Chrome、獨立設定資料夾（C:/pwsw/side-mobile），只開本機網址，結束一定關掉。
// 用法：npm run build && node tools/mobile_check.mjs   → vids/_mobile_check/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, killOwnChrome, loadPlaywright } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_mobile_check');
const PORT = 4470, URL = `http://127.0.0.1:${PORT}/`;
const TAG = 'side-mobile', DIR = `C:/pwsw/${TAG}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.(png|json)$/.test(f)) rmSync(join(OUT, f));

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

const chromium = await loadPlaywright();
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const ctx = await chromium.launchPersistentContext(DIR, {
  channel: 'chrome', headless: true,
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  serviceWorkers: 'block',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push({ kind: 'console.error', text: m.text().slice(0, 300) }); });
page.on('pageerror', (e) => logs.push({ kind: 'pageerror', text: String(e?.stack || e).slice(0, 500) }));
page.on('response', (r) => { if (r.status() >= 400) logs.push({ kind: 'http' + r.status(), text: r.url() }); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
let bytes = 0, files = 0;
const urlOf = new Map(), perKind = {};
cdp.on('Network.requestWillBeSent', (e) => { urlOf.set(e.requestId, e.request.url); });
cdp.on('Network.loadingFinished', (e) => {
  bytes += e.encodedDataLength || 0; files++;
  const u = (urlOf.get(e.requestId) || '').replace(/^https?:\/\/[^/]+\//, '');
  const k = /^sprites\/monsters(_m)?\//.test(u) ? 'monster:' + u.split('/')[2] : u.startsWith('sprites/') ? 'sprites:' + u.split('/')[1] : u.startsWith('art/bg/') ? 'panels:' + u.split('/')[2] : u.startsWith('art/') ? 'art:' + (u.split('/')[1].includes('.') ? 'json/核心' : u.split('/')[1]) : u.split('/')[0].includes('.') ? 'root' : u.split('/')[0];
  perKind[k] = (perKind[k] ?? 0) + (e.encodedDataLength || 0);
});
const snapKinds = () => Object.fromEntries(Object.entries(perKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, MB(v)]));
const MB = (b) => +(b / 1048576).toFixed(1);

const R = { steps: [], touch: {}, mem: {}, download: {} };
const shot = async (name) => { await page.screenshot({ path: join(OUT, name) }); R.steps.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
/** 一根手指按下、（可選）停一會、放開：CDP 的觸控事件，瀏覽器會變成 pointer 事件（pointerType＝touch） */
const touch = async (x, y, holdMs = 90, id = 1) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  await sleep(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const btn = (label) => G((label) => {
  const el = [...document.querySelectorAll('#tc .b')].find((b) => (b.id === label) || b.textContent.trim().startsWith(label));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, shown: getComputedStyle(el).display !== 'none' };
}, label);
const waitPlay = async (timeout = 90000) => {
  const t0 = Date.now();
  await page.waitForFunction(() => window.__qq?.game?.screen === 'play' && (window.__qq.game.world?.time ?? 0) > 0.1, null, { timeout });
  return (Date.now() - t0) / 1000;
};

try {
  assertLocal(URL);
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__boot?.titleShown, null, { timeout: 60000 });
  R.titleSec = (Date.now() - t0) / 1000;
  R.download.title = { MB: MB(bytes), files };
  R.env = await G(() => ({ touchUI: !!document.getElementById('tc'), ontouchstart: 'ontouchstart' in window, coarse: matchMedia('(pointer: coarse)').matches, dpr: devicePixelRatio, w: innerWidth, h: innerHeight, canvasCss: [document.getElementById('game').style.width, document.getElementById('game').style.height] }));
  await sleep(600);
  await shot('m_00_標題（有方向盤）.png');

  // 直向：應該出現「請把手機轉成橫向」
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  R.portraitOverlay = await G(() => getComputedStyle(document.getElementById('rot')).display);
  await shot('m_01_直向_請轉成橫向.png');
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);

  // 點畫面開始第一關
  await touch(422, 150);
  R.stage1Wait = await waitPlay();
  R.download.stage1Ready = { MB: MB(bytes), files, byKind: snapKinds() };
  await G(() => { window.__qq.game.world.god = true; });
  await sleep(3200);   // 開場字幕、定格
  R.mem.stage1 = await G(() => window.__qq.memStats());
  await shot('m_10_第一關（觸控按鈕）.png');

  // ── 模擬觸控：走、跳、丟、爆裂符 ──
  const P = () => G(() => { const w = window.__qq.game.world, b = w.player.body; return { x: b.x, y: b.y, vy: b.vy, onGround: b.onGround, shots: w.shots.length, bombs: w.bombs.length, ev: window.__qq.game.eventLog.map((e) => e.type) }; });
  const dp = await btn('dpad');
  R.touch.buttons = { dpad: dp, jump: await btn('跳'), attack: await btn('攻'), bomb: await btn('符'), swap: await btn('換'), pause: await btn('❚❚') };
  let a = await P();
  await touch(dp.x + dp.w * 0.36, dp.y, 900);
  let b = await P();
  R.touch.walk = { x0: Math.round(a.x), x1: Math.round(b.x), ok: b.x > a.x + 80 };
  const jb = R.touch.buttons.jump;
  a = await P();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x, y: jb.y, id: 2 }] });
  let minY = a.y;
  for (let i = 0; i < 8; i++) { await sleep(40); const p = await P(); minY = Math.min(minY, p.y); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  R.touch.jump = { y0: Math.round(a.y), minY: Math.round(minY), ok: minY < a.y - 40 };
  await sleep(900);
  // 攻擊：遠的丟忍具（fire 事件、飛出去的忍具變多），貼近敵人自動揮爪（球球的動作變成 claw）
  const ab = R.touch.buttons.attack;
  a = await P();
  await G(() => { window.__atk = []; const q = window.__qq; const t0 = performance.now(); const tick = () => { const p = q.game.world.player; window.__atk.push(p.act + ':' + p.anim.name); if (performance.now() - t0 < 600) requestAnimationFrame(tick); }; tick(); });
  await touch(ab.x, ab.y, 80, 3);
  await sleep(650);
  b = await P();
  const acts = await G(() => [...new Set(window.__atk)]);
  const nFire = (e) => e.filter((x) => x === 'fire' || x === 'claw').length;
  R.touch.throw = { fireEvents: nFire(b.ev) - nFire(a.ev), shots: b.shots - a.shots, acts, ok: nFire(b.ev) > nFire(a.ev) || b.shots > a.shots || acts.some((x) => /throw|claw/.test(x)) };
  await sleep(500);
  // 兩根手指同時：左手按住方向盤上（朝上丟）、右手點攻擊 → 一定是丟（朝上丟不會揮爪）；順便驗證多指同時按
  const up = { x: dp.x, y: dp.y - dp.h * 0.36, id: 11 };
  a = await P();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [up] });
  await sleep(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [up, { x: ab.x, y: ab.y, id: 12 }] });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [up] });
  await sleep(250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  b = await P();
  const upFires = await G(() => window.__qq.game.eventLog.filter((e) => e.type === 'fire' && e.aim === 'up').length);
  R.touch.throwUp = { fireUpEvents: upFires, shotsNow: b.shots, ok: upFires > 0 };
  await sleep(400);
  const bb = R.touch.buttons.bomb;
  a = await P();
  await touch(bb.x, bb.y, 80, 4);
  await sleep(250);
  b = await P();
  const nSub = (e) => e.filter((x) => x === 'sub').length;
  R.touch.bomb = { subEvents: nSub(b.ev) - nSub(a.ev), ok: nSub(b.ev) > nSub(a.ev) };
  await sleep(200);
  await shot('m_11_第一關_按過走跳丟符之後.png');
  // 暫停鈕
  const pb = R.touch.buttons.pause;
  await touch(pb.x, pb.y, 80, 5);
  await sleep(300);
  R.touch.pause = { screen: await G(() => window.__qq.game.screen) };
  await shot('m_12_暫停（觸控說明）.png');
  await touch(pb.x, pb.y, 80, 5);
  await sleep(300);

  // ── 第二、三關：照遊戲流程換關（start → 準備中 → 放掉上一關的圖） ──
  for (const n of [2, 3]) {
    const before = bytes;
    await G((n) => { const q = window.__qq; q.game.start(q.STAGES[n - 1]); }, n);
    R[`stage${n}Wait`] = await waitPlay();
    R.download[`stage${n}`] = { MB: MB(bytes - before) };
    await G(() => { window.__qq.game.world.god = true; });
    await sleep(3200);
    R.mem[`stage${n}`] = await G(() => window.__qq.memStats());
    await shot(`m_${n}0_第${n === 2 ? '二' : '三'}關（觸控按鈕）.png`);
  }
  // 最吃記憶體的時候：第三關中魔王打倒（放掉）、最後的魔王載好（手機上實際量，不是估的）
  await G(() => { const w = window.__qq.game.world; w.bossDone[0] = true; w.skipTo(16500); });
  await page.waitForFunction(() => window.__qq.assets.monsters.has('iron_claw') && !window.__qq.assets.monsters.has('roomba_king'), null, { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  R.mem.stage3_finalBoss = await G(() => window.__qq.memStats());
  R.download.afterFinalBoss = { MB: MB(bytes), byKind: snapKinds() };
  R.download.total = { MB: MB(bytes), files };
} finally {
  R.logs = logs;
  writeFileSync(join(OUT, 'mobile_check.json'), JSON.stringify(R, null, 1));
  try { await ctx.close(); } catch { killOwnChrome(TAG); }
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* 被佔用就算了 */ }
  stopServer();
}
console.log(JSON.stringify({ env: R.env, titleSec: R.titleSec, touch: { walk: R.touch.walk, jump: R.touch.jump, throw: R.touch.throw, throwUp: R.touch.throwUp, bomb: R.touch.bomb, pause: R.touch.pause }, download: { title: R.download.title, stage1Ready: R.download.stage1Ready, stage2: R.download.stage2, stage3: R.download.stage3, total: R.download.total }, mem: Object.fromEntries(Object.entries(R.mem).map(([k, v]) => [k, v.total])), waits: [R.stage1Wait, R.stage2Wait, R.stage3Wait], portrait: R.portraitOverlay, logs: logs.slice(0, 6) }, null, 1));
