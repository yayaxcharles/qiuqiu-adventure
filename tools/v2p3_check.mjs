// 第二版階段三（第一關加長）的實機截圖：每個新段落一張、瀑布大攀爬幾個高度、背景長卷每一道插段接縫的放大圖。
// 用法：node tools/v2p3_check.mjs → vids/_record/v2p3/check_*.png、seam_*.png
// （開發伺服器、獨立資料夾的無頭 Chrome、只開本機網址；不寫線上網址的任何東西）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'v2p3');
const PORT = 4412, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// [檔名, 球球 x, 球球 y（null＝地上）, 鏡頭停在攀爬段（hold）]
const SHOTS = [
  ['check_01_梯田陡坡', 11300, null],
  ['check_02_梯田農舍', 13560, null],
  ['check_03_田埂石牆', 14720, null],
  ['check_04_梯田長下坡', 15500, null],
  ['check_05_竹林入口', 19350, null],
  ['check_06_溪邊岩坡', 25400, null],
  ['check_07_瀑布攀爬_水潭', 26500, null, true],
  ['check_08_瀑布攀爬_岩棚', 26460, 36, true],
  ['check_09_瀑布攀爬_藤蔓頂', 26800, -364, true],
  ['check_10_瀑布攀爬_夾縫', 27400, -404, true],
  ['check_11_瀑布頂', 27700, -850],
  ['check_12_大岩塊', 28420, -270],
  ['check_13_溪谷夾縫', 29900, null],
  ['check_14_小溪岩棚', 30800, null],
  ['check_15_山路夾擊', 33050, null],
  ['check_16_原木高台梯子', 34560, null],
  ['check_17_山賊寨入口', 37300, null],
];
// 背景長卷插段的接縫（那一層長卷座標）：鏡頭擺到接縫剛好在畫面中間
const SEAMS = [
  ['mid', 6120, 0.56974], ['mid', 10710, 0.56974], ['mid', 13770, 0.56974], ['mid', 21420, 0.56974],
  ['midfar', 1620, 0.20727], ['midfar', 3240, 0.20727], ['midfar', 6480, 0.20727], ['midfar', 8100, 0.20727],
  ['far', 3360, 0.13360], ['far', 5040, 0.13360],
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'v2p3');
const { page } = s;
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  assertLocal(URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__qq?.game, null, { timeout: 120000 });
  await page.evaluate(() => { window.__qq.paused = true; });
  await page.evaluate(() => window.__qq.loadAll());
  const place = (x, y, hold, camX) => page.evaluate(([x, y, hold, camX]) => {
    const q = window.__qq, g = q.game;
    g.start(q.STAGES[0]);
    const w = g.world; w.god = true;
    for (let i = 0; i < 130; i++) q.step(1 / 120);
    w.skipTo(x);
    if (hold) w.camX = w.stage.vscroll[0].hold;
    if (y !== null) { const b = w.player.body; b.y = y; b.vy = 0; b.onGround = true; }
    w.player.body.facing = 1;
    for (let i = 0; i < 240; i++) { q.step(1 / 120); w.banners = []; w.pops = []; w.tip = null; if (camX !== null) { w.camX = camX; w.player.body.x = camX + 140; } }
    for (const e of w.enemies) if (camX !== null) e.dead = true;
    return { camX: Math.round(w.camX), camY: Math.round(w.camY), x: Math.round(w.player.body.x), y: Math.round(w.player.body.y) };
  }, [x, y, !!hold, camX ?? null]);
  // 第二版的圖用到才載：每個位置先畫一次，等圖載好
  for (const [, x, y, hold] of SHOTS) { await place(x, y, hold); await page.evaluate(() => window.__qq.render()); }
  await sleep(3000);
  for (const [name, x, y, hold] of SHOTS) {
    const info = await place(x, y, hold);
    await page.evaluate(() => window.__qq.render());
    await nextPaint();
    await page.screenshot({ path: join(OUT, name + '.png') });
    console.log(name, JSON.stringify(info));
  }
  // 瀑布攀爬：長卷頂跟往上延伸那一欄的接縫在畫面中間（腳在 40 左右）
  for (const [name, y] of [['seam_climb_長卷頂', 36], ['seam_climb_第二塊', -404]]) {
    await place(name.endsWith('頂') ? 26460 : 27100, y, true);
    await page.evaluate(() => window.__qq.render());
    await nextPaint();
    await page.screenshot({ path: join(OUT, name + '.png') });
  }
  for (const [layer, sx, rate] of SEAMS) {
    const cam = Math.max(0, (sx - 640) / rate);
    const info = await place(cam + 140, null, false, cam);   // 球球站在左邊，不擋接縫
    await page.evaluate(() => window.__qq.render());
    await nextPaint();
    await page.screenshot({ path: join(OUT, `seam_${layer}_${sx}.png`), clip: { x: 440, y: 0, width: 400, height: 720 } });
    console.log('seam', layer, sx, JSON.stringify(info));
  }
} finally {
  await s.close();
  stopServer();
}
