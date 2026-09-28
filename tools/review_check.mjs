// 09-26 獨立審查修正的截圖證據：每一條看得到的修正截一張（遊戲照狀態機推到那一刻），輸出到 vids/_review_check/。
// 用法：node tools/review_check.mjs
// 瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_review_check');
const PORT = 4430, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// [檔名, 第幾關(0＝練習場), 鏡頭跳到哪, 設定（在頁面裡跑的程式，拿到 q、g、w）]
const SHOTS = [
  ['高2_撿到焙烙玉_資訊欄顯示Q換', 1, 700, `w.player.arsenal.pickSub('bigbomb'); w.player.arsenal.pick('D');`],
  ['高3_橘皮大王二階_全身是刺提示', 1, 20400, `const k = w.spawn('orange_king', w.player.body.x + 420, 596); w.boss = k; k.aware = true; k.facing = -1; k.part.broken = true; k.state = 'break'; k.t = 1.55; k.mem.cd = 99; step(0.3); k.mem.cd = 99;`],
  ['中1_鐵爪機關貓出場_鎖住後1秒', 3, 20470, `step(0.5, true);`],
  ['中2_烏鴉出招_驚嘆號在資訊欄下面', 1, 1300, `const c = w.spawn('crow_small', w.player.body.x + 250, 300); c.onGround = false; c.aware = true; c.state = 'hover'; c.t = 0; c.mem.wait = 0.2; for (let i = 0; i < 400 && c.state !== 'windup'; i++) step(1/120); step(0.12);`],
  ['中2_敵人在資訊欄底下_資訊欄變淡', 1, 1300, `const c = w.spawn('crow_small', w.camX + 330, 60); c.onGround = false; c.aware = true; c.state = 'hover'; c.t = 0; c.mem.wait = 99; c.mem.holdT = 5; c.mem.holdX = w.camX + 330; for (let i = 0; i < 30; i++) { c.y = 60; q.step(1/120); }`],
  ['中3_鎖畫面時前景淡掉_第三關10000', 3, 10500, `w.lockX = w.camX; w.locks.add(999); const a = w.spawn('armor_ghost', w.camX + 1000, 596); a.group = 999; a.aware = true; a.state = 'windup'; a.t = 0; a.warn = 0.6; step(0.2);`],
  ['中4_第一關寨門前的山賊站在地上', 1, 17500, `w.enemies.length = 0; const i = w.stage.spawns.findIndex((s) => s.at === 16800); w.fired[i] = false; w.camX = 16800; step(0.1); w.camX = 16800; step(2.5);`],
  ['中5_第一關開場教學提示', 1, 0, `step(3.0);`],
  ['中5_暫停畫面按鍵表', 1, 700, `g.go('pause');`],
  ['中6_蝌蚪兵邊光', 2, 13000, `for (let i = 0; i < 3; i++) { const t = w.spawn('tadpole', w.player.body.x + 200 + i * 120, 480); t.onGround = false; t.aware = true; } step(0.3);`],
  ['中6_鐵羅漢空鎧武者邊光', 3, 11450, `const a = w.spawn('iron_arhat', w.player.body.x + 300, 596); a.aware = true; a.mem.cd = 99; const b = w.spawn('armor_ghost', w.player.body.x + 520, 596); b.aware = true; b.mem.cd = 99; step(0.3);`],
  ['中7_夜祭火球青白光暈', 2, 2900, `const l = w.spawn('lantern_ghost', w.player.body.x + 420, 380); l.aware = true; l.onGround = false; l.state = 'windup'; l.t = 0; l.warn = 0.6; for (let i = 0; i < 120 && !w.bullets.some((b) => b.kind === 'fireball'); i++) step(1/120); step(0.35);`],
  ['中9_蛙大名跳起來砸_地上紅圈', 2, 13000, `const f = w.spawn('frog_daimyo', w.player.body.x + 520, 618); w.boss = f; f.aware = true; f.facing = -1; f.state = 'jumpWind'; f.t = 0; f.mem.cd = 99; step(0.3);`],
  ['中9_太鼓狸跳_地上紅圈', 1, 13900, `const d = w.spawn('drum_tanuki', w.player.body.x + 500, 596); w.boss = d; d.aware = true; d.facing = -1; d.state = 'hopWind'; d.t = 0; d.mem.cd = 99; step(0.25);`],
  ['低1_飛彈落點圈大小', 3, 20400, `w.enemies.length = 0; w.boss = null; w.addMark(w.player.body.x + 250, 1.2); step(1.0);`],
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'review');
const { page } = s;
const result = [];
try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 120000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 120000 });
  for (const [name, st, x, js] of SHOTS) {
    const info = await page.evaluate(({ st, x, js }) => {
      const q = window.__qq; q.paused = true;
      const g = q.game; g.start(st === 0 ? q.PRACTICE : q.STAGES[st - 1]);
      const w = g.world; w.god = true;
      const step = (sec, keep) => { const n = Math.max(1, Math.round(sec * 120)); for (let i = 0; i < n; i++) { q.step(1 / 120); if (!keep) w.pops = []; } };
      for (let i = 0; i < 130; i++) q.step(1 / 120);
      const clear = () => { w.enemies = w.enemies.filter((e) => e.boss); w.bullets.length = 0; w.banners = w.banners.filter((b) => b.style === 'boss'); };
      if (x > 0) { w.skipTo(x); clear(); step(0.5); clear(); }
      // eslint-disable-next-line no-eval
      eval(js);
      q.render();
      return { cam: Math.round(w.camX), boss: w.boss ? { kind: w.boss.kind, x: Math.round(w.boss.x), state: w.boss.state } : null, banners: w.banners.map((b) => b.text) };
    }, { st, x, js });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.__qq.render());
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    result.push({ name, ...info });
  }
  const r = spawnSync('python', [join(ROOT, 'tools', 'contact_sheet.py'), OUT, join(OUT, '總覽.png'), SHOTS.map((x) => `${x[0]}.png`).join(','), '3'], { encoding: 'utf8', windowsHide: true });
  result.push({ sheet: (r.stdout || r.stderr || '').trim(), logs: s.logs.slice(0, 10) });
} finally {
  writeFileSync(join(OUT, 'review_check.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify(result, null, 1).slice(0, 3000));
