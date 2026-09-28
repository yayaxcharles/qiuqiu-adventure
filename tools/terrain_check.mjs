// 地形與道具換圖的實機檢查：在美術代理模擬圖（art_raw/terrain/_check/scene_01～13）同樣的 13 個鏡頭位置截遊戲畫面。
//   改後＝現在的遊戲（terrain.json 的新圖、拉高的屋頂）
//   改前＝同一個鏡頭，把新圖關掉（退回程式畫）、屋頂擺回原本的高度（屋脊比地面高 140）
// 用法：node tools/terrain_check.mjs（開自己的開發伺服器；瀏覽器用 qiuqiu-coop 畫面比對閘門的獨立資料夾）
// 輸出：vids/_stage1_check/地形_<地點>.png（改後）、地形_前後對照.png、地形_檢查.json
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_stage1_check');
const PORT = 4399, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.startsWith('地形_')) rmSync(join(OUT, f));

// 名稱、鏡頭 x、球球站哪（roof＝站到那裡的平台上）、額外擺設
const SCENES = [
  ['01_村口', 500, 920], ['02_民家屋頂', 1950, 2730, 'roof'], ['03_小市集樓梯', 3350, 3780], ['04_上坡', 4900, 5420],
  ['05_高台斷崖', 6150, 6780], ['06_小溪坑', 8250, 8480], ['07_竹林竹架', 10850, 11480, 'roof'], ['08_竹林中魔王前', 12500, 13350, 'burrow'],
  ['09_山賊寨營地', 16200, 16480], ['10_寨門', 17900, 18040], ['11_打爛之後', 17250, 17900, 'broken'], ['12_魔王平地', 19927, 20080, 'boss'],
  ['13_竹林上樓梯', 14450, 14620],
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'terrain');
const { page } = s;
const result = { scenes: [] };
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 120000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 120000 });
  await page.evaluate(() => {
    const q = window.__qq; q.paused = true;
    window.__T = { terrain: q.assets.terrain, stage: q.STAGES[0] };
  });
  for (const [name, cam, px, extra] of SCENES) {
    for (const mode of ['before', 'after']) {
      const info = await page.evaluate(({ cam, px, extra, mode }) => {
        const q = window.__qq, g = q.game, T = window.__T;
        let stage = T.stage;
        if (mode === 'before') {
          // 改前：屋頂擺回原本的高度與寬度、沒有踏腳木台，新圖關掉
          stage = { ...T.stage, platforms: [
            { x: 2150, y: 366, w: 260, look: 'roof' }, { x: 2600, y: 366, w: 260, look: 'roof' }, { x: 3050, y: 366, w: 250, look: 'roof' },
            { x: 6330, y: 330, w: 260, look: 'roof' },
            ...T.stage.platforms.filter((p) => p.look !== 'roof' && !(p.look === 'plank' && p.x < 7000)),
          ] };
          q.assets.terrain = null;
        } else q.assets.terrain = T.terrain;
        g.start(stage);
        const w = g.world; w.god = true;
        for (let i = 0; i < 130; i++) q.step(1 / 120);
        w.skipTo(px);
        w.enemies.length = 0; w.banners = []; w.pops = []; w.particles = [];
        if (extra === 'roof') {
          const pl = w.platforms.filter((p) => px >= p.x && px <= p.x + p.w).sort((a, b) => a.y - b.y)[0];
          if (pl) { w.player.body.y = pl.y - 30; w.player.body.onGround = false; }
        }
        if (extra === 'broken') {
          for (const b of w.breakables) if (['tower', 'gate', 'cage'].includes(b.kind)) { b.hp = 0; w.damageBreakable(b, 1, b.x, b.y - 50, 1); b.fall = 1; }
        }
        if (extra === 'burrow') w.holes.push({ x: 13220, y: w.terrain.groundAt(13220), age: 1, life: 99 });
        if (extra === 'boss') {
          w.holes.push({ x: 20200, y: w.terrain.groundAt(20200), age: 0.2, life: 99 });
          w.decals.push({ key: 'king_pack_broken', x: 21000, y: w.terrain.groundAt(21000), flip: false });
          w.drop('fish', 20350, w.terrain.groundAt(20350) - 5, 0, 0).onGround = true;
          const bl = w.addBullet('bone', 20500, 380, 0, 0); bl.rot = 0.4; bl.life = 99;
        }
        for (let i = 0; i < 70; i++) { q.step(1 / 120); w.enemies.length = 0; w.banners = []; w.pops = []; if (extra === 'broken') w.particles = []; }
        for (const k of w.pickups) k.age = 0;
        w.camX = cam; w.shake = 0;
        q.render();
        const b = w.player.body;
        const pl = w.platforms.find((p) => Math.abs(b.y - p.y) < 0.5 && b.x >= p.x && b.x <= p.x + p.w);
        return { x: Math.round(b.x), y: +b.y.toFixed(1), floor: pl ? pl.y : +w.groundAt(b.x).toFixed(1), onGround: b.onGround };
      }, { cam, px, extra: extra ?? null, mode });
      await nextPaint();
      await page.evaluate(() => window.__qq.render());
      const file = mode === 'after' ? `地形_${name}.png` : `_before_${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      result.scenes.push({ name, mode, ...info });
    }
  }
  await page.evaluate(() => { window.__qq.assets.terrain = window.__T.terrain; });
  // 前後對照拼圖：每個地點一列（左改前、右改後）
  const names = SCENES.map((x) => x[0]);
  const shots = {};
  const { readFileSync } = await import('node:fs');
  for (const n of names) shots[n] = { before: readFileSync(join(OUT, `_before_${n}.png`)).toString('base64'), after: readFileSync(join(OUT, `地形_${n}.png`)).toString('base64') };
  const sheet = await page.evaluate(async ({ names, shots }) => {
    const W = 800, H = 450, L = 30;
    const c = document.createElement('canvas'); c.width = W * 2 + 12; c.height = names.length * (H + L) + 40;
    const g = c.getContext('2d'); g.fillStyle = '#16121c'; g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 24px "Microsoft JhengHei"'; g.fillStyle = '#ffe07a';
    g.fillText('改前（舊地面帶＋程式畫的屋子、架子、道具；屋脊比地面高 140）', 10, 28); g.fillText('改後（terrain.json 新圖、屋脊拉高到 220＋踏腳木台）', W + 22, 28);
    for (let i = 0; i < names.length; i++) {
      const y = 40 + i * (H + L);
      g.fillStyle = '#fff'; g.font = '20px "Microsoft JhengHei"'; g.fillText(names[i], 10, y + 22);
      for (const [k, x] of [['before', 0], ['after', W + 12]]) {
        const img = new Image(); img.src = 'data:image/png;base64,' + shots[names[i]][k]; await img.decode();
        g.drawImage(img, x, y + L, W, H);
      }
    }
    return c.toDataURL('image/png');
  }, { names, shots });
  writeFileSync(join(OUT, '地形_前後對照.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  for (const n of names) rmSync(join(OUT, `_before_${n}.png`));
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, '地形_檢查.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify(result.scenes.filter((x) => x.mode === 'after').map((x) => `${x.name} 腳${x.y} 地${x.floor}${x.onGround ? '' : '（空中）'}`)), JSON.stringify(result.logs.slice(0, 8)));
