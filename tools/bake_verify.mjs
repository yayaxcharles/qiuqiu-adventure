// 對照：tools/bake_frames.py 預先算的裁切框與基準點，跟瀏覽器原本逐像素處理（loadFrameSlow）算出來的一不一樣。
// 用法：node tools/bake_verify.mjs [每幾格抽一格＝5]
// 瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVERY = Number(process.argv[2] || 5);
const PORT = 4471, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'bakeverify');
try {
  assertLocal(URL);
  await s.page.goto(URL, { waitUntil: 'load' });
  await s.page.waitForFunction(() => !!window.__qq?.loadFrameSlow, null, { timeout: 120000 });
  const r = await s.page.evaluate(async (EVERY) => {
    const q = window.__qq;
    const idx = await (await fetch('/sprites/monsters/index.json')).json();
    const dirs = ['/sprites/qiuqiu/', ...idx.monsters.map((m) => `/sprites/monsters/${m}/`)];
    let n = 0, maxA = 0, maxS = 0, bad = [];
    for (const d of dirs) {
      const j = await (await fetch(d + 'anims.json')).json();
      for (const [name, act] of Object.entries(j)) {
        if (name.startsWith('_')) continue;
        for (let i = 0; i < act.frames.length; i += EVERY) {
          const fr = act.frames[i];
          if (!fr.k) { bad.push(`${d}${name}/${fr.f} 沒有 k`); continue; }
          const copy = { f: fr.f, ax: fr.ax, ay: fr.ay };
          const bm = await q.loadFrameSlow(`${d}${name}/${fr.f}`, copy);
          const [, , w, h, ax, ay] = fr.k;
          const da = Math.max(Math.abs(copy.ax - ax), Math.abs(copy.ay - ay)), ds = Math.max(Math.abs(bm.width - w), Math.abs(bm.height - h));
          maxA = Math.max(maxA, da); maxS = Math.max(maxS, ds); n++;
          if (da > 0.51 || ds > 0) bad.push(`${d}${name}/${fr.f} 基準點差 ${da.toFixed(2)}、大小差 ${ds}`);
        }
      }
    }
    return { n, maxAnchorDiff: maxA, maxSizeDiff: maxS, bad: bad.slice(0, 20), badCount: bad.length };
  }, EVERY);
  console.log(JSON.stringify(r, null, 1));
} finally {
  await s.close();
  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
}
