// 腳底檢查（2026-09-26 使用者：「球球浮在空中了」）：
//   1. 每個動作的每一格，照遊戲畫球球的同一支函式（drawFrame、同樣縮放）畫在透明畫布上，基準線放在 y=450，
//      量「最下面一列至少 3 個實心像素（透明度 ≥128）」＝腳底，跟基準線差幾像素（正＝腳陷進地面、負＝浮起來）。
//   2. 每段地面帶照遊戲的畫法畫出來（平地、斜坡），量看起來的地面頂跟物理的站立線差幾像素。
//   3. 在第一關幾個地點（平地、屋頂高台、斜坡、高台、竹林、山賊寨）站好，確認身體的 y 就是那裡的地面高度，並截一小張腳邊的圖。
// 用法：node tools/feet_check.mjs（開自己的開發伺服器；瀏覽器用獨立資料夾）。輸出 vids/_stage1_check/feet_check.json 與兩張對照圖。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_stage1_check');
const PORT = 4396, URL = `http://127.0.0.1:${PORT}/`;
const LIMIT = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(log); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'feet');
const result = { limit: LIMIT };
try {
  assertLocal(URL);
  await s.page.goto(URL + '?stage=1', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await s.page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 90000 });
  await s.page.evaluate(() => window.__qq.loadAll());
  await s.page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 90000 });
  await s.page.evaluate(() => { window.__qq.paused = true; });

  // ── 1. 每個動作每一格 ──
  const frames = await s.page.evaluate(({ LIMIT }) => {
    const q = window.__qq, lib = q.assets.sprites, out = {};
    const W = 700, H = 620, BASE = 450;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const worst = [];
    for (const [name, def] of Object.entries(lib.defs)) {
      if (name === 'throw_baked') continue;
      const diffs = [];
      for (let i = 0; i < def.frames.length; i++) {
        let best = null;
        for (const facing of [1, -1]) {
          g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
          q.drawFrame(g, lib.images[name][i], def.frames[i], W / 2, BASE, facing, q.SCALE);
          const d = g.getImageData(0, 0, W, H).data;
          let foot = -1;
          for (let y = H - 1; y >= 0 && foot < 0; y--) { let n = 0; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] >= 128 && ++n >= 3) { foot = y + 1; break; } }
          const diff = foot - BASE;
          if (best === null || Math.abs(diff) > Math.abs(best)) best = diff;
        }
        diffs.push(best);
      }
      const maxAbs = Math.max(...diffs.map(Math.abs));
      const bad = diffs.map((d, i) => [i, d]).filter(([, d]) => Math.abs(d) > LIMIT);
      out[name] = { frames: diffs.length, min: Math.min(...diffs), max: Math.max(...diffs), maxAbs, over: bad.length, overFrames: bad.slice(0, 12) };
      const wi = diffs.findIndex((d) => Math.abs(d) === maxAbs);
      worst.push({ name, i: wi, d: diffs[wi] });
    }
    // 對照圖：每個動作差最多的那一格，紅線＝地面
    const cols = 5, cw = 250, ch = 290, rows = Math.ceil(worst.length / cols);
    const sheet = document.createElement('canvas'); sheet.width = cols * cw; sheet.height = rows * ch;
    const sg = sheet.getContext('2d');
    sg.fillStyle = '#2a2233'; sg.fillRect(0, 0, sheet.width, sheet.height);
    worst.forEach((w, k) => {
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      sg.save(); sg.beginPath(); sg.rect(x, y, cw, ch); sg.clip();
      q.drawFrame(sg, lib.images[w.name][w.i], lib.defs[w.name].frames[w.i], x + cw / 2, y + 240, 1, q.SCALE);
      sg.strokeStyle = '#ff3a3a'; sg.lineWidth = 1; sg.beginPath(); sg.moveTo(x, y + 240.5); sg.lineTo(x + cw, y + 240.5); sg.stroke();
      sg.fillStyle = '#fff'; sg.font = '15px "Microsoft JhengHei"'; sg.fillText(`${w.name} 第${w.i}格 腳底差 ${w.d} 像素`, x + 6, y + 272);
      sg.restore();
    });
    return { out, sheet: sheet.toDataURL('image/png') };
  }, { LIMIT });
  writeFileSync(join(OUT, 'feet_check_動作.png'), Buffer.from(frames.sheet.split(',')[1], 'base64'));
  result.actions = frames.out;

  // ── 2. 地面帶畫出來的站立線 ──
  result.ground = await s.page.evaluate(() => {
    const q = window.__qq, r = q.game.renderer, out = {};
    for (const z of q.game.world.stage.zones) {
      out[z.ground] = { flat596: r.measureGround(z.ground, 596, 0), flat470: r.measureGround(z.ground, 470, 0), slope: r.measureGround(z.ground, 560, -0.2) };
    }
    return out;
  });

  // ── 3. 關卡裡幾個地點：身體 y＝地面高度？截腳邊 ──
  const spots = [
    { name: '村口平地', x: 600 }, { name: '上坡中間', x: 1750 }, { name: '民家高台', x: 2300 }, { name: '屋頂上', x: 2700, roof: true },
    { name: '小市集', x: 4000 }, { name: '高台', x: 6000 }, { name: '斷崖下', x: 7200 }, { name: '竹林', x: 11500 },
    { name: '竹架上', x: 11480, roof: true }, { name: '山賊寨斜坡', x: 17150 }, { name: '魔王平地', x: 20300 },
  ];
  result.spots = [];
  const crops = [];
  for (const sp of spots) {
    const r = await s.page.evaluate((sp) => {
      const q = window.__qq, g = q.game;
      g.start(g.stage); const w = g.world; w.god = true;
      for (let i = 0; i < 130; i++) q.step(1 / 120);
      w.skipTo(sp.x);
      w.enemies.length = 0;
      if (sp.roof) {
        const pl = w.platforms.find((p) => sp.x >= p.x && sp.x <= p.x + p.w);
        if (pl) { w.player.body.y = pl.y - 40; w.player.body.onGround = false; }
      }
      for (let i = 0; i < 180; i++) { q.step(1 / 120); w.enemies.length = 0; }
      q.render();
      const b = w.player.body;
      const plat = w.platforms.find((p) => Math.abs(b.y - p.y) < 0.5 && b.x >= p.x && b.x <= p.x + p.w);
      const floor = plat ? plat.y : w.groundAt(b.x);
      return { name: sp.name, x: Math.round(b.x), y: +b.y.toFixed(2), floor: +floor.toFixed(2), diff: +(b.y - floor).toFixed(2), onGround: b.onGround, sx: b.x - w.camX, anim: g.renderer.lastDraw.name, frame: g.renderer.lastDraw.frame };
    }, sp);
    await s.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const clip = { x: Math.max(0, Math.round(r.sx - 150)), y: Math.max(0, Math.round(r.y - 230)), width: 300, height: 290 };
    clip.height = Math.min(clip.height, 720 - clip.y);
    const buf = await s.page.screenshot({ clip });
    crops.push({ name: r.name, png: buf.toString('base64'), y: r.y - clip.y });
    result.spots.push(r);
  }
  // 腳邊截圖拼成一張
  const sheet = await s.page.evaluate(async (crops) => {
    const cw = 300, ch = 320, cols = 4, rows = Math.ceil(crops.length / cols);
    const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * rows;
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < crops.length; k++) {
      const img = new Image(); img.src = 'data:image/png;base64,' + crops[k].png; await img.decode();
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      g.drawImage(img, x, y);
      g.strokeStyle = 'rgba(255,60,60,.8)'; g.beginPath(); g.moveTo(x, y + crops[k].y + 0.5); g.lineTo(x + 60, y + crops[k].y + 0.5); g.moveTo(x + 240, y + crops[k].y + 0.5); g.lineTo(x + cw, y + crops[k].y + 0.5); g.stroke();
      g.fillStyle = '#fff'; g.font = '16px "Microsoft JhengHei"'; g.fillText(crops[k].name + '（紅線＝物理站立線）', x + 6, y + ch - 10);
    }
    return c.toDataURL('image/png');
  }, crops);
  writeFileSync(join(OUT, 'feet_check_地點.png'), Buffer.from(sheet.split(',')[1], 'base64'));
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, 'feet_check.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
// 摘要
const rows = Object.entries(result.actions ?? {}).map(([k, v]) => `${k.padEnd(11)} ${String(v.frames).padStart(3)} 格  最大差 ${String(v.maxAbs).padStart(3)} 像素  超過 ${LIMIT} 的格數 ${v.over}`);
console.log(rows.join('\n'));
console.log('地面帶：', JSON.stringify(result.ground));
console.log('地點：', JSON.stringify(result.spots?.map((r) => `${r.name} 差${r.diff}${r.onGround ? '' : '（空中）'} ${r.anim}#${r.frame}`)));
console.log('記錄：', JSON.stringify(result.logs?.slice(0, 10)));
