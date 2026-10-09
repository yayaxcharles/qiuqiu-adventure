// 2026-10-09 使用者：「左上狀態列一堆字超出框」。開第一關（與練習場），截整個畫面＋左上狀態列放大，
// 幾種視窗大小各一張（1920×1080、1366×768、1280×720），看字有沒有超出框。
// 用法：npm run build 之後 node tools/hud_check.mjs → vids/_record/hud1009/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'hud1009');
const PORT = 4414;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
  const s = await newContext('side', `hud${w}`, { viewport: { width: w, height: h } });
  const { page } = s;
  const url = `http://127.0.0.1:${PORT}/`;
  assertLocal(url);
  await page.goto(url);
  for (let i = 0; i < 60; i++) {
    if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
    await page.keyboard.press('Enter'); await sleep(500);
  }
  await sleep(2500);
  await page.screenshot({ path: join(OUT, `full_${w}.png`) });
  const r = await page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.left, y: c.top, width: c.width * 0.62, height: c.height * 0.14 }; });
  await page.screenshot({ path: join(OUT, `hud_${w}.png`), clip: r });
  await s.close();
}
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
console.log('寫好了', OUT);
process.exit(0);
