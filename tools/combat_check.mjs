// 2026-10-10 戰鬥改版（丟東西才傷人、血量條、J／K／L）的畫面檢查：
//   1 剛開始（滿血、K 格空著）  2 被苦無打到一下（白色殘影）  3 殘影縮完  4 撿到風魔大手裏劍（K 格有東西）
//   5 按 K 丟出去  6 鼠兵吐魚骨飛在半路（暫停截）  7 野豬衝鋒推土浪  8 手機版按鈕（攻、特、大、換、跳）
// 用法：npm run build 之後 node tools/combat_check.mjs → vids/_record/combat1010/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'combat1010');
const PORT = 4415;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const url = `http://127.0.0.1:${PORT}/`;
assertLocal(url);

async function toPlay(page) {
  await page.goto(url);
  for (let i = 0; i < 60; i++) {
    if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
    await page.keyboard.press('Enter'); await sleep(500);
  }
  await sleep(2500);
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name) });
const notes = [];

// ── 電腦版
{
  const s = await newContext('side', 'combat', { viewport: { width: 1280, height: 720 } });
  const { page } = s;
  await toPlay(page);
  await shot(page, '1_滿血.png');
  await page.evaluate(() => { const w = window.__game.world; w.player.invincible = 0; w.hurtPlayer(1, 'kunai'); });
  await sleep(120); await shot(page, '2_被打一下_白色殘影.png');
  await sleep(1500); await shot(page, '3_殘影縮完.png');
  notes.push('血：' + await page.evaluate(() => window.__game.world.player.hp));
  await page.evaluate(() => { const w = window.__game.world; w.player.arsenal.pick('R'); });
  await sleep(300); await shot(page, '4_K格有風魔大手裏劍.png');
  await page.keyboard.press('KeyK'); await sleep(180); await shot(page, '5_按K丟出去.png');
  notes.push('按 K 後：' + await page.evaluate(() => JSON.stringify(window.__game.world.events.filter((e) => e.type === 'fire').map((e) => e.weapon))));
  // 鼠兵吐魚骨：放一隻在前面 420，等魚骨出現就暫停截
  await page.evaluate(() => { const w = window.__game.world, b = w.player.body; w.player.invincible = 99; const e = w.spawn('rat', b.x + 420, b.y); e.aware = true; e.facing = -1; });
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) { await sleep(50); ok = await page.evaluate(() => window.__game.world.bullets.some((q) => q.src === 'rat:bone' && q.age > 0.12)); }
  await page.evaluate(() => { window.__qq.paused = true; });
  await sleep(100); await shot(page, '6_鼠兵吐魚骨.png');
  notes.push('鼠兵魚骨：' + ok);
  await page.evaluate(() => { window.__qq.paused = false; });
  await page.evaluate(() => { const w = window.__game.world, b = w.player.body; const e = w.spawn('wild_boar', b.x + 600, b.y); e.aware = true; e.facing = -1; e.state = 'windup'; e.t = 0.8; });
  ok = false;
  for (let i = 0; i < 80 && !ok; i++) { await sleep(40); ok = await page.evaluate(() => window.__game.world.bullets.some((q) => q.src === 'wild_boar:wave' && q.age > 0.1)); }
  await page.evaluate(() => { window.__qq.paused = true; });
  await sleep(100); await shot(page, '7_野豬推土浪.png');
  notes.push('野豬土浪：' + ok);
  await s.close();
}

// ── 手機版（假裝是觸控螢幕）
{
  const s = await newContext('side', 'combat_touch', { viewport: { width: 844, height: 390 } });
  const { page } = s;
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('pointer: coarse') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : q.includes('pointer: fine') ? { matches: false, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
  });
  await page.goto(url);
  for (let i = 0; i < 60; i++) {
    if ((await page.evaluate(() => window.__game?.screen ?? '')) === 'play') break;
    await page.keyboard.press('Enter'); await sleep(500);
  }
  await sleep(2500);
  await page.evaluate(() => { const w = window.__game.world; w.player.arsenal.pick('H'); });
  await sleep(300);
  await shot(page, '8_手機按鈕.png');
  notes.push('手機按鈕：' + await page.evaluate(() => [...document.querySelectorAll('#tc .b')].filter((e) => e.style.display !== 'none').map((e) => e.textContent).join(' / ')));
  await s.close();
}
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
console.log(notes.join('\n'));
console.log('寫好了', OUT);
process.exit(0);
