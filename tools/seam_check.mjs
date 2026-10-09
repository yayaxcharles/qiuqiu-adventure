// 2026-10-09 撕裂感：第一關瀑布攀爬段爬上去之後（鏡頭往上抬），中景長卷頂端在天空裡是一條筆直的切邊。
// 讓球球站到攀爬物頂端，再往右走幾步，沿路截圖看長卷頂端有沒有淡出。
// 用法：npm run build 之後 node tools/seam_check.mjs [關卡：1 或 practice] → vids/_record/seam1009/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'seam1009');
const PORT = 4417;
const ST = process.argv[2] ?? '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'seam' + ST);
const { page } = s;
const url = `http://127.0.0.1:${PORT}/?${ST === 'practice' ? 'stage=practice&' : ''}god`;
assertLocal(url);
await page.goto(url);
for (let i = 0; i < 60; i++) {
  if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
  await page.keyboard.press('Enter'); await sleep(500);
}
await sleep(5000);
const n = await page.evaluate(() => window.__game.world.climbs.length);
for (let i = 0; i < n; i++) {
  const info = await page.evaluate((i) => {
    const w = window.__game.world, cl = w.climbs[i];
    return { x: cl.x, top: cl.top };
  }, i);
  if (info.top > 100) continue;   // 只看往上捲的高攀爬
  // 抓上去、爬到頂翻上去，再往右走
  await page.evaluate((i) => {
    const w = window.__game.world, cl = w.climbs[i], b = w.player.body;
    b.x = cl.x - 60; b.y = w.groundAt(cl.x - 60); b.vx = 0; b.vy = 0; b.onGround = true;
    w.camX = Math.max(0, cl.x - 640);
  }, i);
  await page.keyboard.down('ArrowRight'); await sleep(250); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp'); await sleep(2500); await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowRight');
  for (let k = 0; k < 6; k++) {
    await sleep(400);
    const st = await page.evaluate(() => { const w = window.__game.world; return { x: Math.round(w.player.body.x), y: Math.round(w.player.body.y), camY: Math.round(w.camY) }; });
    await page.screenshot({ path: join(OUT, `seam_${ST}_${i}_${k}.png`) });
    console.log(ST, i, k, JSON.stringify(st));
  }
  await page.keyboard.up('ArrowRight');
}
await s.close();
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
process.exit(0);
