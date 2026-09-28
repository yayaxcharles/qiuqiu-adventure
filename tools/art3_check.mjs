// 第三批美術（fx2 子彈粒子爆炸資訊欄招牌魔王特寫村貓、ambient2 天氣背景生物大場面）接進遊戲後的實機截圖：
//   vids/_art3_check/<關>_<編號>_<內容>.png，最後拼一張 總覽.png
// 做法：開本機開發伺服器、全部載完，照關卡直接跳到那一段，自己推時間（遊戲與畫面同一個假時鐘，天氣、背景生物、特效都跟著走），
// 需要的子彈、爆炸直接放進世界裡。瀏覽器一律走 qiuqiu-coop 畫面比對閘門的 newContext（獨立設定資料夾、只開本機網址）。
// 用法：node tools/art3_check.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_art3_check');
const PORT = 4431, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.png$/.test(f)) rmSync(join(OUT, f));

// 每一張：[檔名, 關, 跳到世界 x（null＝從開場）, 推幾秒, 額外設定]
//   force：先把這些天氣計時器歸零（馬上出現）；act：推完之後在頁面裡做的事（放子彈、爆炸、打雷…），再推 after 秒
const SCENES = [
  ['1_01_山村_夕陽光束_稻穗_雁群_村貓走過', 1, 3400, 9, { force: ['geese', 'flock'] }],
  ['1_02_竹林中段_毛毛雨_水窪_霧_鹿', 1, 12100, 6, { act: 'claw' }],
  ['1_03_竹林_雨停後螢火蟲', 1, 15700, 5, {}],
  ['1_04_山賊寨_火箭插地燃燒_瞭望台山賊', 1, 16837, 4.2, { force: ['arrows'] }],
  ['1_05_魔王登場特寫_橘皮大王', 1, 20470, 0.7, { boss: true }],
  ['1_06_魔王戰_震波_中爆炸_黑煙_打中火花', 1, 20470, 3.5, { boss: true, act: 'fight1' }],
  ['2_01_任務二開始_書法招牌', 2, null, 0.9, {}],
  ['2_02_夜祭_紙花瓣_蝙蝠_青白火球_狐火_扇子', 2, 3137, 8, { force: ['bats'], act: 'bullets2a' }],
  ['2_03_河童川_霧_月光_鯉魚_百鬼夜行_螢火蟲', 2, 10090, 9, { force: ['parade', 'carp'], carpAt: 8.45 }],
  ['2_04_河童川_水彈_水花_泡泡_天狗的風', 2, 10090, 2, { act: 'bullets2b' }],
  ['2_05_往山頂神社_流星雨_狐狸', 2, 16450, 6, {}],
  ['2_06_神社天空_大隕石劃過', 2, 16880, 1.0, {}],
  ['2_07_大隕石落到遠山_爆光團', 2, 16880, 1.95, {}],
  ['3_01_城下_煙霧灰燼_風箏飛艇_機關貓兵', 3, 560, 8, { force: ['airship'], act: 'airship' }],
  ['3_02_天守閣頂_遠方鐵爪機關貓黑影走過', 3, 19300, 5, {}],
  ['3_03_工廠_鍛爐爆炸_碎鐵_火花雨_光彈垃圾彈', 3, 11537, 3, { act: 'forge' }],
  ['3_04_天守閣頂_暴風雨_打雷剪影', 3, 19300, 7, { act: 'bolt' }],
  ['3_05_天守閣頂_大雨_屋瓦濺水_閃電劈屋脊', 3, 19300, 1.2, {}],
  ['3_06_鐵爪二階雷射_木牌資訊欄_魔王血條', 3, 20470, 3, { boss: true, act: 'laser' }],
  ['3_07_魔王倒下_大爆炸_任務完成招牌', 3, 20470, 3, { boss: true, act: 'kill' }],
  ['3_08_接關畫面_書法招牌', 3, 11537, 0.5, { act: 'continue' }],
];

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'art3');
const { page } = s;
const result = { shots: [] };

try {
  assertLocal(URL);
  await page.goto(URL + '?dev', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__qq?.loadAll, null, { timeout: 120000 });
  await page.evaluate(() => window.__qq.loadAll());
  await page.evaluate(() => {
    const q = window.__qq; q.paused = true;
    let T = 5000;
    window.__A = {
      /** 開某一關、跳到 x（null＝開場字幕還在）；推 sec 秒，每一步都用假時鐘畫一格 */
      open(n, x) {
        const g = q.game; g.start(q.STAGES[n - 1]);
        const w = g.world; w.god = true;
        if (x === null) return w;
        for (let i = 0; i < 130; i++) q.step(1 / 120);
        w.skipTo(x);
        w.enemies.length = 0; w.banners = []; w.pops = []; w.bullets.length = 0;
        return w;
      },
      run(sec, each) {
        const w = q.game.world, n = Math.round(sec * 60);
        for (let i = 0; i < n; i++) {
          q.step(1 / 120); q.step(1 / 120);
          T += 1 / 60; q.drawAt(T);
          w.banners = w.banners.filter((b) => b.style !== 'hint');
          if (each && each(w, i) === true) return;
        }
      },
      amb() { return q.game.renderer.amb; },
      frame(o) { return { ...q.NO_INPUT, ...o }; },
      draw() { T += 1 / 60; q.drawAt(T); },
    };
  });

  for (const [file, n, x, sec, ex] of SCENES) {
    const info = await page.evaluate(({ n, x, sec, ex }) => {
      const q = window.__qq, A = window.__A;
      const w = A.open(n, x);
      const amb = A.amb();
      A.run(0.05);   // 天氣換成這一關
      for (const k of ex.force ?? []) amb.timers[k] = 0;
      if (!ex.boss) {
        if (ex.carpAt) { A.run(ex.carpAt); amb.timers.carp = 0; A.run(sec - ex.carpAt); } else A.run(sec);
      }
      if (ex.boss) {
        // 讓魔王出場（鏡頭已經過了魔王的觸發點）
        A.run(ex.act ? 2.4 : sec);
        if (!ex.act) return { cam: Math.round(w.camX), boss: w.boss?.kind, banners: w.banners.map((b) => b.style) };
      }
      const P = w.player.body;
      const g = w.groundAt(P.x);
      switch (ex.act) {
        case 'claw': {
          const e = w.spawn('rat', P.x + 110, w.groundAt(P.x + 110)); e.aware = true; e.hp = e.maxHp = 999;
          A.run(0.15);
          for (let i = 0; i < 10; i++) { q.step(1 / 120, A.frame({ attackPressed: i === 0, attackHeld: true })); }
          A.run(0.1);
          break;
        }
        case 'fight1': {
          w.boss.mem.cd = 99;
          w.addBullet('wave', P.x + 330, g, -420, 0);
          w.explode(P.x + 170, 470, 130, 0, 'scene', true);
          w.fx({ kind: 'hit', x: P.x + 80, y: g - 120, life: 0.16, r: 58, sprite: 'hit_claw' });
          for (let i = 0; i < 3; i++) w.fx({ kind: 'star', x: P.x - 20 + i * 25, y: g - 210, vx: 0, vy: 0, life: 1, r: 12, color: '#fff3a0' });
          A.run(0.22);
          break;
        }
        case 'bullets2a': {
          w.addBullet('fireball', P.x + 420, g - 250, -260, 40);
          w.addBullet('fireball', P.x + 560, g - 300, -260, 60);
          w.addBullet('foxfire', P.x + 480, g - 150, -150, 0, { life: 4 });
          w.addBullet('fan', P.x + 300, g - 130, -500, 0, { life: 3 });
          A.run(0.25);
          break;
        }
        case 'bullets2b': {
          w.addBullet('water', P.x + 380, g - 118, -420, 0);
          w.addBullet('splash', P.x + 520, g - 60, -200, -500, { g: 1500 });
          w.addBullet('bubble', P.x + 600, g - 260, -120, -20, { hp: 2, life: 4, w: 58, h: 58 });
          w.addBullet('gust', P.x + 360, g - 150, -1, 0, { w: 560, h: 200, life: 0.9, push: 0 });
          A.run(0.2);
          break;
        }
        case 'forge': {
          amb.timers.forge = 0;
          A.run(0.3);
          w.addBullet('pellet', P.x + 520, 330, -380, 20, { hp: 1, life: 3 });
          w.addBullet('pellet', P.x + 600, 350, -380, 40, { hp: 1, life: 3 });
          w.addBullet('garbage', P.x + 440, 300, -300, -200, { g: 1500, life: 3 });
          w.addBullet('missile', P.x + 250, 200, 0, 900, { life: 2 });
          w.explode(P.x + 700, 470, 90, 0, 'scene', false);
          A.run(0.12);
          break;
        }
        case 'airship': {
          // 飛艇從畫面右邊外慢慢飛進來要半分鐘：截圖直接挪到城牆缺口（畫面 x 640）那裡
          const t = amb.things.find((x) => x.key === 'airship');
          if (t) t.x = 640 + w.camX * amb.rMidfar;
          A.run(0.1);
          break;
        }
        case 'bolt': {
          amb.bolt(900, 230, false);
          A.draw();
          break;
        }
        case 'laser': {
          const e = w.boss;
          e.p2 = true; e.hp = e.maxHp = 1300; e.mem.low = 0; e.x = P.x + 560; e.facing = -1;
          A.run(0.2);
          e.state = 'laserWind'; e.t = 0; e.warn = 0.6; e.invuln = 0;
          A.run(1.25, (ww) => e.state !== 'laserWind' && e.t > 0.35);
          break;
        }
        case 'kill': {
          const e = w.boss; e.x = P.x + 520;
          // 一直打到真的倒下（第一階段打完會換階段、換階段中打不動）
          A.run(14, (ww) => {
            if (e.dying <= 0 && !e.dead && e.invuln <= 0) ww.damageEnemy(e, 999999, { x: e.x - 30, y: e.y - 100, dir: 1, kind: 'test' });
            return !ww.boss && ww.explosions.some((x) => x.boss && x.age > 0.2);
          });
          break;
        }
        case 'continue': {
          q.game.continueT = 8.6; q.game.screen = 'continue';
          q.render();
          break;
        }
      }
      return { cam: Math.round(w.camX), m: Math.round(w.camX + 640), zone: w.stage.zones[Math.max(0, w.zone)]?.name, I: Object.fromEntries(Object.entries(amb.I).map(([k, v]) => [k, +v.toFixed(2)])), storm: +amb.storm.toFixed(2), things: amb.things.length, boss: w.boss?.kind ?? null };
    }, { n, x, sec, ex }).catch((e) => ({ err: String(e).slice(0, 300) }));
    await page.screenshot({ path: join(OUT, file + '.png') });
    result.shots.push({ file, ...info });
    console.log(file, JSON.stringify(info));
  }
  const files = result.shots.map((x) => x.file + '.png');
  const r = spawnSync('python', [join(ROOT, 'tools', 'contact_sheet.py'), OUT, join(OUT, '總覽.png'), files.join(','), '4'], { encoding: 'utf8', windowsHide: true });
  result.sheet = (r.stdout || r.stderr || '').trim();
} finally {
  result.logs = s.logs;
  writeFileSync(join(OUT, 'art3_check.json'), JSON.stringify(result, null, 1));
  await s.close();
  stopServer();
}
console.log(result.sheet, JSON.stringify(result.logs.slice(0, 8)));
