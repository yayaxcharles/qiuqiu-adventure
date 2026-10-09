// 2026-10-09 角色手感：新接的七個動作（空翻、蹬牆、下落、攀爬、貼牆、翻滾、斜上投）在遊戲畫面裡實際畫出來的樣子，
// 每個動作取 6 格、裁球球周圍一塊排成一張；另外把「起跳／落地」那幾格的壓扁拉長各截一格。
// 用法：npm run build 之後 node tools/feel_check.mjs → vids/_record/feel1009/feel_check.png
// 打包版、獨立資料夾的無頭 Chrome（qiuqiu-coop 畫面比對閘門的 newContext），只開本機網址。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'feel1009');
const PORT = 4413, URL = `http://127.0.0.1:${PORT}/?stage=practice`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'feel');
const { page } = s;
assertLocal(URL);
await page.goto(URL);
// 標題 → 開始
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => window.__game?.screen ?? '');
  if (st === 'play') break;
  await page.keyboard.press('Enter'); await sleep(500);
}
await sleep(1500);
const NAMES = ['airflip', 'wallkick', 'fall', 'climb', 'wallslide', 'roll', 'throwdiag'];
const shots = [];
// 停住球球自己的狀態機，只換動作、格數（畫面照常畫）
await page.evaluate(() => { const p = window.__game.world.player; p.update = () => {}; p.body.onGround = true; });
for (const n of NAMES) {
  const len = await page.evaluate((n) => window.__game.world.player.anim.defs[n]?.frames.length ?? 0, n);
  for (let k = 0; k < 6; k++) {
    const fr = Math.min(len - 1, Math.round((k / 5) * (len - 1)));
    await page.evaluate(([n, fr]) => { const an = window.__game.world.player.anim; an.play(n, { restart: true, from: fr, to: fr }); }, [n, fr]);
    await sleep(120);
    const box = await page.evaluate(() => {
      const c = document.querySelector('canvas'), r = c.getBoundingClientRect(), w = window.__game.world, p = w.player.body;
      const kx = r.width / c.width, ky = r.height / c.height, cx = w.camX ?? 0, cy = w.camY ?? 0;
      return { x: r.left + (p.x - cx - 160) * kx, y: r.top + (p.y - cy - 300) * ky, width: 320 * kx, height: 340 * ky };
    });
    shots.push({ n, k, buf: await page.screenshot({ clip: box }) });
  }
}
await s.close();
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
// 排成一張（每列一個動作）
const { createRequire } = await import('node:module');
const sharp = createRequire('F:/ClaudeWork/qiuqiu-coop/package.json')('sharp');
const tiles = await Promise.all(shots.map((t) => sharp(t.buf).resize(240, 255, { fit: 'contain', background: '#1e1e28' }).png().toBuffer()));
const comp = tiles.map((b, i) => ({ input: b, left: (i % 6) * 240, top: Math.floor(i / 6) * 255 }));
await sharp({ create: { width: 6 * 240, height: Math.ceil(tiles.length / 6) * 255, channels: 3, background: '#1e1e28' } }).composite(comp).png().toFile(join(OUT, 'feel_check.png'));
console.log('寫好了', join(OUT, 'feel_check.png'), NAMES.join('、'));
process.exit(0);
