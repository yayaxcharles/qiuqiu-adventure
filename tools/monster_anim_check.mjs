// 怪物逐格動畫實機檢查：在練習場把每隻怪叫出來，照遊戲的狀態機推到「走、出招、受傷、倒下」各一刻截圖，
// 再用遊戲載入的動作圖（跟遊戲同一支 drawFrame、同樣大小）把每個動作平均取 8 格排成一張總覽。
// 用法：node tools/monster_anim_check.mjs（開自己的開發伺服器；瀏覽器用 qiuqiu-coop 畫面比對閘門的獨立資料夾）
// 輸出：vids/_stage1_check/動畫_<怪>_<動作>.png、動畫_總覽.png、動畫_檢查.json
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_stage1_check');
const PORT = 4398, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.startsWith('動畫_')) rmSync(join(OUT, f));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'manim');
const { page } = s;
const result = { shots: [] };
const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// 每隻怪：名字、要截的四個時刻（怎麼推到那一刻）
const PLAN = [
  ['rat', '鼠兵', 900], ['orange_bandit', '橘貓山賊', 900], ['black_ninja', '黑衣忍者', 1050], ['crow_small', '烏鴉', 820],
  ['wild_boar', '野豬', 1100], ['tanuki_kid', '小狸', 820], ['drum_tanuki', '太鼓狸', 1000], ['orange_king', '橘皮大王', 1000],
];

try {
  assertLocal(URL);
  await page.goto(URL + '?stage=practice', { waitUntil: 'load' });
  // 09-26 起圖是背景一包一包載的：截圖工具先把全部載完、預熱完（各關、各種怪都會用到）
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 120000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.waitForFunction(() => !!window.__qq?.game?.world, null, { timeout: 120000 });
  result.loaded = await page.evaluate(() => [...window.__qq.assets.monsters].map(([k, v]) => `${k}:${Object.keys(v.lib.defs).join('/')}`));

  // 頁面裡的小工具：重開練習場、叫一隻怪、推到條件成立
  await page.evaluate(() => {
    const q = window.__qq; q.paused = true;
    window.__m = {
      fresh() {
        const g = q.game; g.start(q.PRACTICE);
        const w = g.world; w.god = true;
        for (let i = 0; i < 130; i++) q.step(1 / 120);
        w.skipTo(420); w.enemies.length = 0; w.banners = [];
        w.player.body.facing = 1;
        for (let i = 0; i < 20; i++) q.step(1 / 120);
        return w;
      },
      mk(kind, x) {
        const w = q.game.world;
        const e = w.spawn(kind, x, kind === 'crow_small' ? 230 : w.groundAt(x));
        e.aware = true; e.act = 'none'; e.facing = -1;
        if (e.boss) w.boss = e;
        return e;
      },
      step(n, until) {
        const w = q.game.world;
        for (let i = 0; i < n; i++) { q.step(1 / 120); w.banners = []; if (until && until(w)) return i + 1; }
        return n;
      },
      info(e) { return { state: e.state, anim: e.anim?.name, frame: e.anim?.frame, animOn: e.animOn, x: Math.round(e.x), y: Math.round(e.y), p2: e.p2 }; },
    };
  });

  const snap = async (name, info) => {
    q: {
      await page.evaluate(() => window.__qq.render());
      await nextPaint();
      const file = `動畫_${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      result.shots.push({ file, ...info });
    }
  };

  for (const [kind, label, x] of PLAN) {
    // 走（跑、飛）
    let info = await page.evaluate(([kind, x]) => {
      const M = window.__m; M.fresh();
      const e = M.mk(kind, x);
      if (kind === 'drum_tanuki' || kind === 'orange_king') { e.state = 'idle'; e.t = 0; e.mem.cd = 99; if (kind === 'orange_king') { e.y = window.__qq.game.world.groundAt(e.x); e.onGround = true; } }
      if (kind === 'wild_boar') { e.x = window.__qq.game.world.camX + 1120; e.mem.enterDir = -1; }
      if (kind === 'black_ninja') { e.x = window.__qq.game.world.camX + 1340; }
      M.step(kind === 'wild_boar' ? 34 : kind === 'black_ninja' ? 110 : 40);
      if (kind === 'drum_tanuki' || kind === 'orange_king') { e.vx = 0; e.x -= 0; }
      return M.info(e);
    }, [kind, x]);
    await snap(`${label}_1走`, info);

    // 出招：推到出手（開始傷人、丟出東西）那一刻
    info = await page.evaluate(([kind, x]) => {
      const M = window.__m, w = M.fresh();
      const e = M.mk(kind, kind === 'rat' ? 560 : kind === 'orange_bandit' ? 600 : x);
      const b0 = () => w.bullets.length;
      let n0 = b0();
      const STATES = { rat: 'windup', orange_bandit: 'windup', black_ninja: 'windup', crow_small: 'windup', wild_boar: 'windup', tanuki_kid: 'crouch', drum_tanuki: 'waveWind', orange_king: 'fishWind' };
      if (kind === 'orange_king') { e.y = w.groundAt(e.x); e.onGround = true; }
      if (kind === 'crow_small') { e.x = w.player.body.x + 260; e.y = 200; }
      e.state = STATES[kind]; e.t = 0; e.warn = 0.6;
      const until = {
        rat: () => !!e.harm, orange_bandit: () => !!e.harm, black_ninja: () => b0() > n0, crow_small: () => e.state === 'swoop' && e.t > 0.12,
        wild_boar: () => e.state === 'charge' && e.t > 0.25, tanuki_kid: () => !e.onGround && e.t > 0.12,
        drum_tanuki: () => b0() > n0 && e.t > 0.15, orange_king: () => b0() > n0 + 2 && e.t > 0.2,
      }[kind];
      M.step(600, until);
      return M.info(e);
    }, [kind, x]);
    await snap(`${label}_2出招`, info);

    // 受傷：還活著被打一下，推 0.12 秒
    info = await page.evaluate(([kind, x]) => {
      const M = window.__m, w = M.fresh();
      const e = M.mk(kind, x);
      if (kind === 'orange_king') { e.y = w.groundAt(e.x); e.onGround = true; e.state = 'idle'; e.mem.cd = 99; }
      if (kind === 'drum_tanuki') { e.state = 'idle'; e.mem.cd = 99; }
      M.step(20);
      e.hp = e.maxHp = 5000; if (e.part) e.part.hp = 5000;
      w.damageEnemy(e, 10, { x: e.x - 30, y: e.y - 60, dir: 1, kind: 'test' });
      M.step(12);
      return M.info(e);
    }, [kind, x]);
    await snap(`${label}_3受傷`, info);

    // 倒下：打死，推到倒地（魔王：倒下演出中段）
    info = await page.evaluate(([kind, x]) => {
      const M = window.__m, w = M.fresh();
      const e = M.mk(kind, x);
      if (kind === 'orange_king') { e.y = w.groundAt(e.x); e.onGround = true; e.state = 'idle'; e.mem.cd = 99; e.p2 = true; e.part.broken = true; e.hp = e.maxHp = 1100; }
      if (kind === 'drum_tanuki') { e.state = 'idle'; e.mem.cd = 99; }
      M.step(20);
      w.damageEnemy(e, 99999, { x: e.x - 30, y: e.y - 60, dir: 1, kind: 'test' });
      const t = e.mem.ko ? (e.mem.koTime ?? 1.5) * 0.75 : e.boss ? 1.3 : 0.35;
      M.step(Math.round(t * 120));
      return { ...M.info(e), ko: !!e.mem.ko };
    }, [kind, x]);
    await snap(`${label}_4倒下`, info);
  }

  // 橘皮大王：背包炸飛 → 暴怒長刺 → 二階走路；二階受傷
  let info = await page.evaluate(() => {
    const M = window.__m, w = M.fresh();
    const e = M.mk('orange_king', 1000); e.y = w.groundAt(e.x); e.onGround = true; e.state = 'idle'; e.mem.cd = 99;
    M.step(20);
    w.damageEnemy(e, 5000, { x: e.x, y: e.y - 300, dir: 1, kind: 'blast' });
    M.step(Math.round(1.3 * 120));
    return M.info(e);
  });
  await snap('橘皮大王_5暴怒長刺', info);
  info = await page.evaluate(() => {
    const M = window.__m;
    const e = window.__qq.game.world.boss;
    M.step(Math.round(1.2 * 120));
    return M.info(e);
  });
  await snap('橘皮大王_6二階走', info);

  // ── 總覽：每隻怪的每個動作平均取 8 格，照遊戲的大小畫（紅線＝地面）──
  const sheet = await page.evaluate(() => {
    const q = window.__qq, A = q.assets, DEF = q.game.world ? null : null;
    void DEF;
    const drawH = { rat: 132, orange_bandit: 196, black_ninja: 200, crow_small: 118, wild_boar: 150, tanuki_kid: 118, drum_tanuki: 300, orange_king: 380 };
    const rows = [];
    for (const [m, v] of A.monsters) for (const [act, d] of Object.entries(v.lib.defs)) rows.push({ m, v, act, d });
    const LABEL = 170, cols = 8;
    // 每一列的格寬、格高照那隻怪的大小（大隻的倒下、滾、肚皮壓會變很寬）
    const cwOf = (r) => Math.max(190, Math.min(520, Math.round(drawH[r.m] * 1.35)));
    const rowH = (r) => Math.max(150, Math.min(460, drawH[r.m] + 80));
    const H = rows.reduce((s, r) => s + rowH(r), 0);
    const c = document.createElement('canvas'); c.width = LABEL + Math.max(...rows.map(cwOf)) * cols; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#3a3448'; g.fillRect(0, 0, c.width, c.height);
    let y = 0;
    for (const r of rows) {
      const h = rowH(r), base = y + h - 24, scale = drawH[r.m] / r.v.standHeight, CW = cwOf(r);
      g.fillStyle = (rows.indexOf(r) % 2) ? '#433c54' : '#3a3448'; g.fillRect(0, y, c.width, h);
      g.fillStyle = '#ffe07a'; g.font = 'bold 18px "Microsoft JhengHei"'; g.fillText(r.m, 8, y + 30);
      g.fillStyle = '#fff'; g.font = '16px "Microsoft JhengHei"'; g.fillText(`${r.act}（${r.d.frames.length} 格${r.d.loop ? '、循環' : ''}）`, 8, y + 54);
      const marks = Object.entries(r.d.markers).map(([k, v]) => `${k}=${v}`).join(' ');
      if (marks) { g.fillStyle = '#9ff0ff'; g.font = '14px "Microsoft JhengHei"'; g.fillText(marks, 8, y + 76); }
      const n = r.d.frames.length;
      const pick = [...new Set(Array.from({ length: cols }, (_, i) => Math.round(i * (n - 1) / (cols - 1))))];
      pick.forEach((fi, k) => {
        const x = LABEL + k * CW + CW / 2;
        g.save(); g.beginPath(); g.rect(LABEL + k * CW, y, CW, h); g.clip();
        const img = r.v.lib.images[r.act][fi], fr = r.d.frames[fi];
        q.drawFrame(g, img, fr, x, base, 1, scale);
        g.restore();
        g.strokeStyle = 'rgba(255,70,70,.8)'; g.beginPath(); g.moveTo(LABEL + k * CW + 4, base + 0.5); g.lineTo(LABEL + (k + 1) * CW - 4, base + 0.5); g.stroke();
        const tag = Object.entries(r.d.markers).filter(([, v]) => v === fi).map(([k2]) => k2).join(',');
        g.fillStyle = tag ? '#9ff0ff' : '#ccc'; g.font = '13px "Microsoft JhengHei"'; g.fillText(`${fi}${tag ? ' ' + tag : ''}`, LABEL + k * CW + 6, y + 16);
      });
      y += h;
    }
    return c.toDataURL('image/png');
  });
  writeFileSync(join(OUT, '動畫_總覽.png'), Buffer.from(sheet.split(',')[1], 'base64'));
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, '動畫_檢查.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(JSON.stringify(result, null, 1).slice(0, 5000));
