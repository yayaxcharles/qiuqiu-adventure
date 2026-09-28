// 量「打開網頁到標題畫面可以按 Enter」要幾秒，以及每關開始前要等多久（打包版、vite preview）。
// 分開記：下載（每個檔從發出請求到收完）、解碼、逐像素處理、預熱；列出載入量最大的幾類。
// 用法：npm run build 之後 node tools/boot_check.mjs [輸出 json 路徑]
// 瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'vids', '_boot_check.json');
const PORT = 4470, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'boot');
const res = {};
await s.page.addInitScript(() => { try { performance.setResourceTimingBufferSize(100000); } catch { /* 不支援就算了 */ } });
try {
  assertLocal(URL);
  await s.page.goto(URL, { waitUntil: 'load' });
  // 標題畫面可以按 Enter：game 已經建好、畫面是標題
  await s.page.waitForFunction(() => window.__qq?.game?.screen === 'title', null, { timeout: 180000, polling: 50 });
  res.title = await s.page.evaluate(() => {
    const b = window.__boot ?? {}, st = window.__bootStats ?? {};
    const ent = performance.getEntriesByType('resource');
    const byKind = {};
    for (const e of ent) {
      const u = new URL(e.name).pathname;
      const k = u.includes('/sprites/monsters/') ? '怪物逐格圖' : u.includes('/sprites/qiuqiu/') ? '球球逐格圖' : u.includes('/art/bg/') ? '背景長卷'
        : u.includes('/art/terrain/') || u.includes('/art/props2/') ? '地形與道具' : u.includes('/enemies/') ? '敵人單張立繪' : u.endsWith('.js') || u.endsWith('.json') ? '程式與資料' : '其他圖';
      const r = (byKind[k] ??= { files: 0, MB: 0, dlMs: 0 });
      r.files++; r.MB += (e.encodedBodySize || e.transferSize || 0) / 1048576; r.dlMs += e.responseEnd - e.startTime;
    }
    for (const r of Object.values(byKind)) { r.MB = +r.MB.toFixed(1); r.dlMs = Math.round(r.dlMs); }
    const lastResp = Math.max(...ent.map((e) => e.responseEnd));
    return {
      titleReadyMs: Math.round(performance.now()), bootStart: Math.round(b.start ?? 0), assetsDone: Math.round(b.assetsDone ?? 0), warmDone: Math.round(b.warmDone ?? 0),
      titleShown: Math.round(b.titleShown ?? 0), lastDownloadEnd: Math.round(lastResp), files: ent.length,
      decodeWallMs: Math.round(st.decodeMs ?? 0), processMsSum: Math.round(st.processMs ?? 0), frames: st.frames ?? 0, byKind,
    };
  });
  // 每一關：從標題按開始到能玩（世界建好、不在「準備中」）要等多久；分兩種：標題一出來馬上按、在標題等 10 秒再按
  res.stages = [];
  for (const wait of [0, 10]) {
    for (let n = 1; n <= 3; n++) {
      await s.page.goto(URL, { waitUntil: 'load' });
      await s.page.waitForFunction(() => window.__qq?.game?.screen === 'title', null, { timeout: 180000, polling: 50 });
      if (wait) await sleep(wait * 1000);
      const ms = await s.page.evaluate(async (n) => {
        const g = window.__qq.game;
        const t0 = performance.now();
        g.pickStage = n - 1;
        window.__qq.pressStart?.();
        if (!window.__qq.pressStart) g.start(window.__qq.STAGES[n - 1]);
        await new Promise((ok) => { const tick = () => { if (g.screen === 'play' && g.world) ok(); else requestAnimationFrame(tick); }; tick(); });
        return Math.round(performance.now() - t0);
      }, n);
      res.stages.push({ stage: n, waitOnTitle: wait, msToPlay: ms });
    }
  }
  // 第一關玩 20 秒（自動玩）之後直接進第二關、第二關玩 20 秒後直接進第三關（跳過結算畫面＝最壞情況：結算畫面時也會預熱）
  await s.page.goto(URL + '?bot', { waitUntil: 'load' });
  await s.page.waitForFunction(() => window.__qq?.game?.screen === 'title', null, { timeout: 180000, polling: 50 });
  res.chain = await s.page.evaluate(async () => {
    const q = window.__qq, g = q.game, out = [];
    const until = (f) => new Promise((ok) => { const tick = () => { if (f()) ok(); else requestAnimationFrame(tick); }; tick(); });
    const sleepMs = (ms) => new Promise((ok) => setTimeout(ok, ms));
    for (let n = 1; n <= 3; n++) {
      const t0 = performance.now();
      g.start(q.STAGES[n - 1], n > 1 ? { score: 0, lives: 3 } : null);
      await until(() => g.screen === 'play' && g.world);
      out.push({ stage: n, msToPlay: Math.round(performance.now() - t0) });
      await sleepMs(20000);
    }
    return out;
  });
  res.logs = s.logs.slice(0, 10);
} finally {
  writeFileSync(OUT, JSON.stringify(res, null, 1));
  await s.close();
  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
}
console.log(JSON.stringify(res, null, 1));
