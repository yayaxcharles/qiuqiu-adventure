// 第二版階段二的實機截圖（練習場新段落）：陡坡、二段跳牆、岩棚、蹬牆夾縫、藤蔓、往上捲的大攀爬（幾個高度）、
// 另外一張「第三關鐵方塊＋冷卻水道材質」的修正檢查（把練習場換成第三關的地面帶、背景）。
// 用法：node tools/v2p2_check.mjs → vids/_record/v2p2/check_*.png（開發伺服器、獨立資料夾的無頭 Chrome、只開本機網址）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'v2p2');
const PORT = 4411, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// [檔名, 球球的 x, 球球的 y（null＝站在地上）, 鏡頭 x（null＝照 skipTo）, 額外]
const SHOTS = [
  ['check_01_陡坡上坡_木箱木樁人', 3700, null],
  ['check_02_二段跳牆', 4560, null],
  ['check_03_岩棚兩層', 5640, null],
  ['check_04_蹬牆夾縫', 6980, null],
  ['check_05_藤蔓岩塊', 7480, null],
  ['check_06_大攀爬_地面', 8400, null, 'vs'],
  ['check_07_大攀爬_岩棚中段', 8650, 30, 'vs'],
  ['check_08_大攀爬_藤蔓頂夾縫底', 8890, -330, 'vs'],
  ['check_09_大攀爬_夾縫頂', 9090, -1000, 'vs'],
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'v2p2');
const { page } = s;
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 120000 });
  await page.evaluate(() => { window.__qq.paused = true; });
  const place = (x, y, vs, stage) => page.evaluate(([x, y, vs, stage]) => {
    const q = window.__qq, g = q.game;
    g.start(stage ?? q.PRACTICE);
    const w = g.world; w.god = true;
    for (let i = 0; i < 130; i++) q.step(1 / 120);
    w.skipTo(x);
    if (vs) { w.camX = w.stage.vscroll[0].hold; }
    if (y !== null) { const b = w.player.body; b.y = y; b.vy = 0; b.onGround = true; }
    w.player.body.facing = 1;
    for (let i = 0; i < 240; i++) { q.step(1 / 120); w.banners = []; w.pops = []; w.tip = null; }
    return { camX: Math.round(w.camX), camY: Math.round(w.camY), x: Math.round(w.player.body.x), y: Math.round(w.player.body.y) };
  }, [x, y, vs, stage]);
  // 先把第二版的圖都叫一次（用到才載），等它們載好
  for (const [, x, y, vs] of SHOTS) { await place(x, y, !!vs); await page.evaluate(() => window.__qq.render()); }
  await sleep(2500);
  for (const [name, x, y, vs] of SHOTS) {
    const info = await place(x, y, !!vs);
    await page.evaluate(() => window.__qq.render());
    await nextPaint();
    await page.screenshot({ path: join(OUT, name + '.png') });
    console.log(name, JSON.stringify(info));
  }
  // 第三關材質：鐵方塊（提亮＋描邊）、濕鐵格柵地面、鐵牆
  const s3 = await page.evaluate(() => {
    const q = window.__qq, P = q.PRACTICE;
    window.__s3 = { ...P, panels: 's3', zones: [{ from: 0, name: 't', ground: 's3_wet', far: 's1_1_far', leaves: null, sky: '#445' }],
      solids: [{ x: 700, y: 300, w: 200, h: 296, art: 's3_iron' }, { x: 1000, y: 150, w: 160, h: 250, art: 's3_iron' }, { x: 1250, y: 330, w: 220, h: 266, art: 's3_plaster' }],
      climbs: [{ x: 950, top: 150, bottom: 596, art: 's3_chain' }], platforms: [{ x: 400, y: 420, w: 200, look: 'ledge', art: 's3_iron' }], spawns: [], breakables: [], vscroll: [], shafts: [] };
    return true;
  });
  void s3;
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => { const q = window.__qq; q.game.start(window.__s3); const w = q.game.world; w.god = true; for (let i = 0; i < 130; i++) q.step(1 / 120); w.skipTo(500); for (let i = 0; i < 60; i++) { q.step(1 / 120); w.banners = []; } q.render(); });
    await sleep(1500);
  }
  await nextPaint();
  await page.screenshot({ path: join(OUT, 'check_10_第三關鐵方塊修正.png') });
} finally {
  await s.close();
  stopServer();
}
