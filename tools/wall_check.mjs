// 2026-10-09 貼牆下滑時手掌插進牆裡：練習場找實心方塊的側面與崖壁，讓球球貼上去滑，截圖看手掌是否剛好貼著牆面。
// 用法：npm run build 之後 node tools/wall_check.mjs → vids/_record/wall1009/wall_*.png
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'wall1009');
const PORT = 4416;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'wall');
const { page } = s;
const url = `http://127.0.0.1:${PORT}/?stage=practice&god`;
assertLocal(url);
await page.goto(url);
for (let i = 0; i < 60; i++) {
  if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
  await page.keyboard.press('Enter'); await sleep(500);
}
await sleep(5500);   // 等「練習 開始！」字卡收掉
const walls = await page.evaluate(() => {
  const w = window.__game.world;
  // 夠高的實心方塊（側面能滑）
  return w.solids.filter((s) => s.h >= 200).slice(0, 3).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
});
console.log('方塊', JSON.stringify(walls));
let n = 0;
for (const wl of walls) {
  for (const side of [1, -1]) {
    await page.evaluate(([wl, side]) => {
      const w = window.__game.world, b = w.player.body;
      b.x = side > 0 ? wl.x - 23 : wl.x + wl.w + 23; b.y = wl.y + 120; b.vx = 0; b.vy = 50; b.onGround = false;
      w.camX = Math.max(0, b.x - 640);
    }, [wl, side]);
    const key = side > 0 ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(key);
    await sleep(160);
    const st = await page.evaluate(() => { const p = window.__game.world.player; return { anim: p.anim.name, sliding: p.body.sliding, x: Math.round(p.body.x), y: Math.round(p.body.y) }; });
    await page.screenshot({ path: join(OUT, `wall_${n}_${side > 0 ? '右牆' : '左牆'}.png`) });
    console.log(n, side, JSON.stringify(st));
    await page.keyboard.up(key);
    n++;
  }
}
await s.close();
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
process.exit(0);
