// 實機檢查：開本機 vite preview，用獨立瀏覽器資料夾的無頭 Chrome 跑遊戲，截圖＋逐格量位置與動作格。
// 用法：先 `npm run build`，再 `node tools/game_check.mjs`（加 `--dev` 改開開發伺服器，不用先打包）。輸出到 vids/_game_check/。
// 2026-09-26 改成新的遊戲架構：在「動作練習場」（src/stages/practice.ts，三根木樁人）量；一顆攻擊鍵 J（貼近自動揮爪、遠了丟），跳改成空白鍵／K。
// 瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只准開本機網址），不碰使用者的 Chrome。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_game_check');
const PORT = 4393;
const URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ── 本機伺服器 ──
const DEV = process.argv.includes('--dev');
const server = spawn('npx', ['vite', ...(DEV ? [] : ['preview']), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const stopServer = () => { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); else server.kill(); };
for (let i = 0; i < 60 && !/127\.0\.0\.1:\d+/.test(serverLog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'check');
const { page, logs } = s;
const result = {};
try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 60000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 60000 });
  await sleep(300);

  // 頁面裡的小工具：一步一步推（暫停主迴圈）、輸入
  await page.evaluate(() => {
    const F = (o = {}) => ({ left: false, right: false, up: false, down: false, walk: false, jumpHeld: false, jumpPressed: false, attackPressed: false, attackHeld: false, subPressed: false, subSwitchPressed: false, dashPressed: false, startPressed: false, pausePressed: false, reset: false, devWeapon: -1, devSub: -1, devGod: false, ...o });
    const P = () => window.__qq.game.world.player;
    window.__chk = {
      F, P,
      /** 重來：重新開練習場、跳過開場停頓 */
      reset() { const q = window.__qq; q.game.start(q.PRACTICE); q.game.world.god = true; for (let i = 0; i < 130; i++) q.step(1 / 120, F()); },
      /** 推 sec 秒（每步 1/120）；once＝只給第一步的「剛按下」；until＝條件成立就停 */
      step(sec, held = {}, once = {}, until = null) {
        const q = window.__qq, n = Math.round(sec * 120);
        for (let i = 0; i < n; i++) {
          q.step(1 / 120, F(i === 0 ? { ...held, ...once } : held));
          if (until && until(q.game.world)) return i + 1;
        }
        return n;
      },
      state() {
        const w = window.__qq.game.world, p = w.player;
        return { act: p.act, anim: p.anim.name, frame: p.anim.frame, x: +p.body.x.toFixed(1), y: +p.body.y.toFixed(1), vx: +p.body.vx.toFixed(1), vy: +p.body.vy.toFixed(1), onGround: p.body.onGround, shurikens: w.shots.length, hitstop: w.hitstop };
      },
    };
  });
  const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shot = async (name) => { await nextPaint(); await page.screenshot({ path: join(OUT, name), type: 'png' }); };

  // ── A. 暫停主迴圈、一步一步推到指定的那一格再截圖 ──
  const shots = {};
  await page.evaluate(() => { window.__qq.paused = true; window.__chk.reset(); window.__chk.step(0.6); });
  shots.idle = await page.evaluate(() => window.__chk.state());
  await shot('01_站著.png');

  await page.evaluate(() => window.__chk.step(0.7, { right: true }));
  shots.run = await page.evaluate(() => window.__chk.state());
  await shot('02_跑步中.png');

  // 揮爪：站到第一根木樁人（x=900）前面 110 像素，按 J，推到打中停頓的那一刻
  shots.claw = await page.evaluate(() => {
    const c = window.__chk;
    c.reset(); c.P().body.x = 790; c.step(0.3);
    const steps = c.step(1.5, {}, { attackPressed: true }, (w) => w.hitstop > 0);
    return { ...c.state(), secondsToHit: +(steps / 120).toFixed(3) };
  });
  await shot('03_揮爪打中.png');
  // 打中後到收完招、能取消的時間
  shots.clawAfter = await page.evaluate(() => {
    const c = window.__chk;
    const t0 = c.step(3, {}, {}, (w) => w.hitstop <= 0 && w.player.anim.frame >= (w.player.anim.def.markers.hit + 10));
    const t1 = c.step(3, {}, {}, (w) => w.player.act === 'move');
    return { cancellableAfterHitSec: +(t0 / 120).toFixed(3), endAfterThatSec: +(t1 / 120).toFixed(3) };
  });

  // 丟手裏劍：按 K，推到手裏劍飛出去的那一格
  shots.throw = await page.evaluate(() => {
    const c = window.__chk;
    c.reset(); c.step(0.3);
    const steps = c.step(1, {}, { attackPressed: true }, (w) => w.shots.length > 0);
    return { ...c.state(), secondsToRelease: +(steps / 120).toFixed(3) };
  });
  await shot('04_丟手裏劍出手.png');
  await page.evaluate(() => window.__chk.step(3 / 36));
  shots.throw2 = await page.evaluate(() => window.__chk.state());
  await shot('04b_出手後三格.png');

  // 跳：按住跳，推 0.2 秒（上升中）、再推到開始往下掉
  await page.evaluate(() => { const c = window.__chk; c.reset(); c.step(0.3); c.step(0.2, { jumpHeld: true }, { jumpPressed: true }); });
  shots.jumpUp = await page.evaluate(() => window.__chk.state());
  await shot('05_跳到空中.png');
  await page.evaluate(() => window.__chk.step(0.3, { jumpHeld: true }));
  shots.jumpDown = await page.evaluate(() => window.__chk.state());
  await shot('05b_空中下落.png');

  // 空中丟手裏劍（airthrow）
  await page.evaluate(() => { const c = window.__chk; c.reset(); c.step(0.3); c.step(0.15, { jumpHeld: true }, { jumpPressed: true }); c.step(1, { jumpHeld: true }, { attackPressed: true }, (w) => w.shots.length > 0); });
  shots.airThrow = await page.evaluate(() => window.__chk.state());
  await shot('06_空中丟手裏劍.png');
  result.shots = shots;

  // ── B. 真的跑主迴圈、用鍵盤操作，每個畫面格記一次 ──
  await page.evaluate(() => {
    const q = window.__qq, g = q.game.world, r = q.game.renderer;
    window.__chk.reset(); q.paused = false;
    const canvas = document.getElementById('game');
    const rec = (window.__rec = { rows: [], crops: [], prev: document.createElement('canvas'), cur: document.createElement('canvas') });
    for (const c of [rec.prev, rec.cur]) { c.width = 260; c.height = 260; }
    let lastSerial = g.player.anim.serial, lastName = g.player.anim.name, lastT = performance.now();
    const tick = (t) => {
      const w = q.game.world, p = w.player, d = r.lastDraw;
      const sx = p.body.x - w.camX;
      // 每格都把角色附近 260×260 抓下來（上一格留著），換動作時兩張都存起來比對
      [rec.prev, rec.cur] = [rec.cur, rec.prev];
      const cx = rec.cur.getContext('2d');
      cx.clearRect(0, 0, 260, 260);
      cx.drawImage(canvas, sx - 130, p.body.y - 225, 260, 260, 0, 0, 260, 260);
      rec.rows.push({ t: +(t - lastT).toFixed(2), x: p.body.x, vx: p.body.vx, cam: w.camX, sx, y: p.body.y, anim: d.name, frame: d.frame, serial: d.serial, ok: d.ok, act: p.act, hitstop: w.hitstop > 0, rate: p.anim.rate });
      lastT = t;
      if (d.serial !== lastSerial && rec.crops.length < 30) {
        const a = document.createElement('canvas'); a.width = 520; a.height = 260;
        const ax = a.getContext('2d'); ax.drawImage(rec.prev, 0, 0); ax.drawImage(rec.cur, 260, 0);
        rec.crops.push({ from: lastName, to: d.name, frame: d.frame, ok: d.ok, url: a.toDataURL('image/png') });
      }
      lastName = d.name; lastSerial = d.serial;
      if (!rec.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const kb = page.keyboard;
  const mark = (label) => page.evaluate((l) => window.__rec.rows.push({ mark: l }), label);
  // 先站到 x=700（鏡頭不會卡在世界左邊界），等鏡頭跟上再開始跑：量到的才是「鏡頭一路跟著跑」的情況
  await page.evaluate(() => { window.__qq.game.world.player.body.x = 700; });
  await sleep(1200);
  await mark('跑'); await kb.down('ArrowRight'); await sleep(2000); await kb.up('ArrowRight'); await mark('停'); await sleep(500);
  await mark('揮爪'); await page.evaluate(() => { window.__qq.game.world.player.body.x = 790; }); await sleep(50); await kb.press('KeyJ'); await sleep(1400);
  await mark('丟'); await page.evaluate(() => { window.__qq.game.world.player.body.x = 500; window.__qq.game.world.player.body.facing = 1; }); await sleep(50); await kb.press('KeyJ'); await sleep(800);
  await mark('跳'); await kb.down('Space'); await sleep(350); await kb.up('Space'); await sleep(900);
  await mark('跑跳丟'); await kb.down('ArrowRight'); await sleep(400); await kb.down('Space'); await sleep(150); await kb.press('KeyJ'); await sleep(200); await kb.up('Space'); await sleep(700); await kb.up('ArrowRight'); await sleep(400);
  await mark('跑中揮爪取消'); await kb.down('ArrowLeft'); await sleep(500); await kb.up('ArrowLeft'); await kb.press('KeyJ'); await sleep(650); await kb.down('ArrowLeft'); await sleep(500); await kb.up('ArrowLeft'); await sleep(400);
  const rec = await page.evaluate(() => { window.__rec.stop = true; return { rows: window.__rec.rows, crops: window.__rec.crops }; });
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(rec.rows));

  // 換動作的前後兩格拼成一張
  const strip = await page.evaluate(async (crops) => {
    const W = 520, H = 280, cols = 2, rows = Math.ceil(crops.length / cols);
    const c = document.createElement('canvas'); c.width = W * cols; c.height = H * rows;
    const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
    g.font = '14px "Microsoft JhengHei", sans-serif';
    for (let i = 0; i < crops.length; i++) {
      const img = new Image(); img.src = crops[i].url; await img.decode();
      const x = (i % cols) * W, y = Math.floor(i / cols) * H;
      g.drawImage(img, x, y + 20);
      g.fillStyle = '#ff0'; g.fillText(`${i + 1}. ${crops[i].from} → ${crops[i].to}（新動作第 ${crops[i].frame} 格，${crops[i].ok ? '有畫' : '沒畫！'}）左＝前一格 右＝換的那格`, x + 4, y + 15);
    }
    return c.toDataURL('image/png');
  }, rec.crops);
  writeFileSync(join(OUT, '07_換動作前後兩格.png'), Buffer.from(strip.split(',')[1], 'base64'));
  result.transitions = rec.crops.map((c) => ({ from: c.from, to: c.to, frame: c.frame, ok: c.ok }));
  result.measure = analyze(rec.rows);

  // （原本的 C 段「借現有的圖假裝有 walk／crouch／dash／jump」拿掉了：09-26 下午這些動作都轉好了，A、B 段直接量真的）
} finally {
  result.logs = logs;
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify(result, null, 1).slice(0, 6000));

/** 逐格紀錄 → 數字：跑步時每格移動量、畫面格間隔、動作格停留幾個畫面格、換動作那格有沒有畫、有沒有跳格 */
function analyze(rows) {
  const stat = (a) => {
    if (!a.length) return null;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
    const r = (v) => Math.round(v * 100) / 100;
    return { n: a.length, mean: r(m), sd: r(sd), min: r(Math.min(...a)), max: r(Math.max(...a)) };
  };
  const out = {};
  const data = rows.filter((r) => !r.mark);
  out.frameMs = stat(data.slice(1).map((r) => r.t));
  out.blankFrames = data.filter((r) => !r.ok).length;
  out.totalFrames = data.length;
  // 跑步：「跑」到「停」之間、全速（340）、跑了 0.6 秒以後（鏡頭已跟上）的畫面格
  const i0 = rows.findIndex((r) => r.mark === '跑'), i1 = rows.findIndex((r) => r.mark === '停');
  const seg = rows.slice(i0 + 1, i1).filter((r) => !r.mark);
  let acc = 0; const steady = [];
  for (const r of seg) { acc += r.t; if (acc > 900 && r.anim === 'run' && Math.abs(r.vx) >= 339.9) steady.push(r); }
  const d = (k) => steady.slice(1).map((r, i) => r[k] - steady[i][k]);
  out.run = {
    worldDxPerFrame: stat(d('x')), screenDxPerFrame: stat(d('sx')), camDxPerFrame: stat(d('cam')),
    pxPerMsWorld: stat(steady.slice(1).map((r, i) => (r.x - steady[i].x) / r.t)),
    rate: steady[0]?.rate,
    /** 著地那隻腳的來回：每張跑步圖停留期間身體前進多少（畫面像素）＝換圖那一刻腳往回跳多少 */
    bodyPxPerSpriteFrame: null,
  };
  // 跑步動畫每一格在畫面上停幾個畫面格
  const holds = []; let run = 0;
  for (let i = 1; i < steady.length; i++) { run++; if (steady[i].frame !== steady[i - 1].frame) { holds.push(run); run = 0; } }
  const hist = {}; for (const h of holds.slice(1)) hist[h] = (hist[h] ?? 0) + 1;
  out.run.spriteFrameHoldHistogram = hist;
  const moves = []; let last = null;
  for (const r of steady) { if (last && r.frame !== last.frame) { moves.push(r.x - last.x0); last = { frame: r.frame, x0: r.x }; } else if (!last) last = { frame: r.frame, x0: r.x }; }
  out.run.bodyPxPerSpriteFrame = stat(moves.slice(1));
  // 同一次播放裡，一個畫面格往前跳了 2 格以上（有動作格沒被畫到）
  const skips = {};
  for (let i = 1; i < data.length; i++) {
    const a = data[i - 1], b = data[i];
    if (a.serial !== b.serial || b.hitstop) continue;
    const step = b.frame - a.frame;
    if (step >= 2) { const k = `${b.anim}`; skips[k] = (skips[k] ?? 0) + 1; }
  }
  out.frameSkips = skips;
  // 換動作那一格
  const tr = [];
  for (let i = 1; i < data.length; i++) if (data[i].serial !== data[i - 1].serial) tr.push({ from: `${data[i - 1].anim}#${data[i - 1].frame}`, to: `${data[i].anim}#${data[i].frame}`, ok: data[i].ok });
  out.transitions = tr;
  return out;
}
