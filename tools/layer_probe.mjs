// 2026-10-09 撕裂感追查：自動玩打到攀爬段（鏡頭往上抬）時暫停，同一格分別「照常」「拿掉中景長卷」「拿掉遠中景長卷」各截一張，
// 看天空破洞是哪一層沒蓋到。用法：npm run build 之後 node tools/layer_probe.mjs [關卡編號] → vids/_record/seam1009/probe_*.png
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_record', 'seam1009');
const PORT = 4419;
const ST = Number(process.argv[2] ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'probe' + ST);
const { page } = s;
const url = `http://127.0.0.1:${PORT}/?bot&god${ST > 1 ? `&stage=${ST}` : ''}`;
assertLocal(url);
await page.goto(url);
const t0 = Date.now();
while (Date.now() - t0 < 9 * 60 * 1000) {
  const cy = await page.evaluate(() => window.__game?.world?.camY ?? 0);
  if (cy < -150) break;
  await sleep(300);
}
await sleep(700);
const info = await page.evaluate(() => {
  window.__qq.paused = true;
  const g = window.__game, w = g.world, r = g.renderer;
  const sp = r.a.panels.get(w.stage.panels);
  window.__probe = { sp, origLayer: r.drawLayer, origFaded: r.drawLayerFaded };
  return { camX: Math.round(w.camX), camY: Math.round(w.camY), vs: w.vsection(), layers: Object.fromEntries(Object.entries(sp.layers).map(([k, v]) => [k, v.map((p) => [Math.round(p.w * (720 / p.h)), p.img.src.split('/').pop()])])) };
});
writeFileSync(join(OUT, `probe_s${ST}_info.json`), JSON.stringify(info, null, 1));
await sleep(200);
await page.screenshot({ path: join(OUT, `probe_s${ST}_a_照常.png`) });
for (const [tag, layer] of [['b_拿掉中景', 'mid'], ['c_拿掉遠中景', 'midfar']]) {
  await page.evaluate((layer) => {
    const r = window.__game.renderer, P = window.__probe, skip = P.sp.layers[layer];
    r.drawLayer = function (ctx, panels, off) { if (panels === skip) return; return P.origLayer.call(this, ctx, panels, off); };
  }, layer);
  await sleep(250);
  await page.screenshot({ path: join(OUT, `probe_s${ST}_${tag}.png`) });
  await page.evaluate(() => { const r = window.__game.renderer; r.drawLayer = window.__probe.origLayer; });
}
await s.close();
spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
console.log(JSON.stringify({ camX: info.camX, camY: info.camY, vs: info.vs }));
process.exit(0);
