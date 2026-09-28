// 電腦版記憶體與下載量實測（手機版看 tools/mobile_check.mjs）：打包版、1280×720、沒有觸控、網址 ?hq（電腦版的圖：怪物每秒 24 格）。
//   標題 → 按 Enter 開第一關 → 第二關 → 第三關（照遊戲流程換關，前一關的圖放掉）→ 第三關中魔王打倒、最後的魔王載好
//   每一步記：網路實際下載了多少（位元組）、解碼後的圖佔多少（__qq.memStats，寬×高×4 加總）
// 瀏覽器走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
// 用法：npm run build && node tools/mem_check.mjs [--lq]   → vids/_mem_check/mem_<hq|lq>.json
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LQ = process.argv.includes('--lq');
const OUT = join(ROOT, 'vids', '_mem_check');
const PORT = 4471, URL = `http://127.0.0.1:${PORT}/?${LQ ? 'lq' : 'hq'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', `mem-${LQ ? 'lq' : 'hq'}`);
const { page } = s;
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
let bytes = 0;
cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
const MB = (b) => +(b / 1048576).toFixed(1);
const G = (fn, arg) => page.evaluate(fn, arg);
const waitPlay = () => page.waitForFunction(() => window.__qq?.game?.screen === 'play' && (window.__qq.game.world?.time ?? 0) > 0.1, null, { timeout: 120000 });
const R = { set: LQ ? '手機版圖（?lq）' : '電腦版圖（?hq）', download: {}, mem: {} };
try {
  assertLocal(URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__boot?.titleShown, null, { timeout: 60000 });
  R.download.title = MB(bytes);
  R.env = await G(() => ({ touchUI: !!document.getElementById('tc'), w: innerWidth, h: innerHeight }));
  await page.keyboard.press('Enter');
  await waitPlay();
  R.download.beforeStage1 = MB(bytes);
  await G(() => { window.__qq.game.world.god = true; });
  await sleep(3200);
  R.mem.stage1 = await G(() => window.__qq.memStats());
  for (const n of [2, 3]) {
    const b0 = bytes;
    await G((n) => { const q = window.__qq; q.game.start(q.STAGES[n - 1]); }, n);
    await waitPlay();
    R.download[`stage${n}`] = MB(bytes - b0);
    await G(() => { window.__qq.game.world.god = true; });
    await sleep(3200);
    R.mem[`stage${n}`] = await G(() => window.__qq.memStats());
  }
  await G(() => { const w = window.__qq.game.world; w.bossDone[0] = true; w.skipTo(16500); });
  await page.waitForFunction(() => window.__qq.assets.monsters.has('iron_claw') && !window.__qq.assets.monsters.has('roomba_king'), null, { timeout: 120000 }).catch(() => {});
  await sleep(1500);
  R.mem.stage3_finalBoss = await G(() => window.__qq.memStats());
  R.download.total = MB(bytes);
} finally {
  R.logs = s.logs;
  writeFileSync(join(OUT, `mem_${LQ ? 'lq' : 'hq'}.json`), JSON.stringify(R, null, 1));
  await s.close();
  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
}
console.log(JSON.stringify({ set: R.set, env: R.env, download: R.download, mem: Object.fromEntries(Object.entries(R.mem).map(([k, v]) => [k, v.total])), logs: R.logs.slice(0, 5) }));
