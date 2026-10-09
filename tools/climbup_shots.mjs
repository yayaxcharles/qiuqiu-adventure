// 2026-10-09 撕裂感複驗：讓自動玩（?bot）照真的流程一路打到攀爬段，鏡頭往上抬的那段每 0.6 秒截一張（共 24 張排成一張總覽）。
// 用法：npm run build 之後 node tools/climbup_shots.mjs [關卡編號，預設 1] → vids/_record/seam1009/climbup_s<N>.png
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'seam1009');
const PORT = 4418;
const ST = Number(process.argv[2] ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'climbup' + ST);
const { page } = s;
const url = `http://127.0.0.1:${PORT}/?bot&god${ST > 1 ? `&stage=${ST}` : ''}`;
assertLocal(url);
await page.goto(url);
const shots = [];
const t0 = Date.now();
let seen = false;
while (Date.now() - t0 < 9 * 60 * 1000 && shots.length < 24) {
  const st = await page.evaluate(() => { const w = window.__game?.world; return w ? { camY: w.camY, screen: window.__game.screen } : null; });
  if (st && st.screen === 'play' && st.camY < -60) seen = true;
  if (seen && st && st.camY < -20) { const b = await page.screenshot(); shots.push(b); if (shots.length <= 8) (await import("node:fs")).writeFileSync(join(OUT, `climbup_s${ST}_${shots.length}.png`), b); await sleep(600); continue; }
  if (seen && st && st.camY >= -20 && shots.length > 6) break;
  await sleep(400);
}
await s.close();
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
const sharp = createRequire('F:/ClaudeWork/qiuqiu-coop/package.json')('sharp');
const tiles = await Promise.all(shots.map((b) => sharp(b).resize(640, 360).png().toBuffer()));
const comp = tiles.map((b, i) => ({ input: b, left: (i % 4) * 640, top: Math.floor(i / 4) * 360 }));
await sharp({ create: { width: 4 * 640, height: Math.max(1, Math.ceil(tiles.length / 4)) * 360, channels: 3, background: '#000' } }).composite(comp).png().toFile(join(OUT, `climbup_s${ST}.png`));
console.log('截了', shots.length, '張 →', join(OUT, `climbup_s${ST}.png`));
process.exit(0);
