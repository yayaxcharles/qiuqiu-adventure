// 除錯用：開第 N 關跳到 x，推幾秒，印出天氣／背景生物的狀態（走的生物、東西清單）。用法：node tools/amb_debug.mjs 1 17537 7
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [N, X, SEC] = [Number(process.argv[2] || 1), Number(process.argv[3] || 3000), Number(process.argv[4] || 3)];
const PORT = 4432, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);
await loadPlaywright();
const s = await newContext('side', 'ambdbg');
try {
  assertLocal(URL);
  await s.page.goto(URL + `?stage=${N}&dev`, { waitUntil: 'load' });
  await s.page.waitForFunction(() => window.__qq?.game?.screen === 'play', null, { timeout: 120000 });
  const out = await s.page.evaluate(({ X, SEC }) => {
    const q = window.__qq, w = q.game.world; q.paused = true; w.god = true;
    w.skipTo(X);
    let T = 9000;
    for (let i = 0; i < SEC * 60; i++) { q.step(1 / 120); q.step(1 / 120); T += 1 / 60; q.drawAt(T); }
    const amb = q.game.renderer.amb;
    const a2 = q.assets.amb2.get(w.stage.panels);
    return {
      cam: w.camX, rMid: amb.rMid, jr: amb.jsonMidRate(), creatures: [...(a2?.creatures.keys() ?? [])], items: [...(a2?.items.keys() ?? [])].length,
      walkers: amb.walkers.map((k) => ({ key: k.key, x0: Math.round(k.x0), x1: Math.round(k.x1), pos: Math.round(k.pos), screen: Math.round(k.pos - w.camX * amb.rMid), y: k.y, wait: +k.wait.toFixed(2) })),
      things: amb.things.map((t) => ({ key: t.key, kind: t.kind, layer: t.layer, x: Math.round(t.x), sx: Math.round(t.layer === 'mid' ? t.x - w.camX * amb.rMid : t.layer === 'midfar' ? t.x - w.camX * amb.rMidfar : t.x), y: Math.round(t.y), t: +t.t.toFixed(2), stuck: !!t.stuck })),
    };
  }, { X, SEC });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await s.close();
  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
}
