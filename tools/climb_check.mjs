// 2026-10-09 使用者：「球球在攀爬時穿模了」。練習場和第一關各找一條攀爬物，讓球球抓上去往上爬，連截幾張看手、身體跟藤蔓（或牆）的關係。
// 用法：npm run build 之後 node tools/climb_check.mjs → vids/_record/climb1009/climb_*.png
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'climb1009');
const PORT = 4415;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
for (const [tag, q] of [['練習場', '?stage=practice&god'], ['第一關', '?god']]) {
  const s = await newContext('side', `climb-${tag === '練習場' ? 'p' : 's1'}`);
  const { page } = s;
  const url = `http://127.0.0.1:${PORT}/${q}`;
  assertLocal(url);
  await page.goto(url);
  for (let i = 0; i < 60; i++) {
    if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
    await page.keyboard.press('Enter'); await sleep(500);
  }
  await sleep(1500);
  const n = await page.evaluate(() => window.__game.world.climbs.length);
  for (let i = 0; i < Math.min(n, 3); i++) {
    // 走到攀爬物底下、抓上去
    const info = await page.evaluate((i) => {
      const w = window.__game.world, cl = w.climbs[i], b = w.player.body;
      b.x = cl.x - 60; b.y = Math.min(cl.bottom, w.groundAt(cl.x - 60)); b.vx = 0; b.vy = 0; b.onGround = true;
      w.camX = Math.max(0, cl.x - 640);
      return { x: cl.x, top: cl.top, bottom: cl.bottom, kind: cl.kind ?? '' };
    }, i);
    await page.keyboard.down('ArrowRight'); await sleep(250); await page.keyboard.up('ArrowRight');
    await page.keyboard.down('ArrowUp');
    for (let k = 0; k < 4; k++) {
      await sleep(350);
      const st = await page.evaluate(() => { const p = window.__game.world.player; return { act: p.act, anim: p.anim.name, x: Math.round(p.body.x), y: Math.round(p.body.y), climb: p.body.climb }; });
      await page.screenshot({ path: join(OUT, `climb_${tag}_${i}_${k}.png`) });
      console.log(tag, i, k, JSON.stringify(info), JSON.stringify(st));
    }
    await page.keyboard.up('ArrowUp');
  }
  await s.close();
}
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
process.exit(0);
