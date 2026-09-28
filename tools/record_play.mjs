// 錄一段自動玩的影片給人看（使用者在外面不能玩時用）：打包版＋獨立資料夾的無頭 Chrome，
// 直接錄遊戲畫布（canvas.captureStream＋MediaRecorder，畫質比截螢幕好），從標題錄到結算畫面。
// 聲音另外接 sfx.ts 的混音輸出（window.__qqAudio.getMixStream），不走喇叭，所以無頭 Chrome 的 --mute-audio 不影響。
//
// 用法：npm run build 之後 node tools/record_play.mjs [關卡編號，預設 1] [--god]
// 輸出：vids/_record/stage<N>_<時間>.webm（再用 ffmpeg 轉 mp4 給手機看）
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1);
const GOD = process.argv.includes('--god');
const PORT = 4399;
const URL = `http://127.0.0.1:${PORT}/?bot${STAGE > 1 ? `&stage=${STAGE}` : ''}${GOD ? '&god' : ''}`;
const OUT = join(ROOT, 'vids', '_record');
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const FILE = join(OUT, `stage${STAGE}_${stamp}.webm`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
writeFileSync(FILE, Buffer.alloc(0));

// 服務的是 dist 的一份快照（dist_rec）：遊戲代理可能同時在重新打包，錄到一半換檔會壞
const SNAP = process.env.REC_DIST ?? 'dist_rec';
if (!existsSync(join(ROOT, SNAP, 'index.html'))) { console.error(`找不到 ${SNAP}/index.html：先 npm run build，再把 dist 複製成 ${SNAP}`); process.exit(1); }
const server = spawn('npx', ['vite', 'preview', '--outDir', SNAP, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 80 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'rec');
const { page } = s;
let bytes = 0;
await page.exposeBinding('__saveChunk', (_src, b64) => { const buf = Buffer.from(b64, 'base64'); appendFileSync(FILE, buf); bytes += buf.length; });
try {
  assertLocal(URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__qq?.game, null, { timeout: 90000 });
  await page.evaluate(() => {
    const c = document.getElementById('game');
    // 聲音：sfx.ts 的混音輸出（音效＋配樂，程式合成）接成音軌；舊版打包沒有這個就照舊只錄畫面
    const tracks = [...c.captureStream(30).getVideoTracks()];
    const mix = window.__qqAudio?.getMixStream?.();
    if (mix) tracks.push(...mix.getAudioTracks());
    window.__recAudio = tracks.length > 1;
    const rec = new MediaRecorder(new MediaStream(tracks), window.__recAudio
      ? { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 160_000 }
      : { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5_000_000 });
    window.__recDone = false;
    rec.ondataavailable = async (e) => {
      const u8 = new Uint8Array(await e.data.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      await window.__saveChunk(btoa(bin));
    };
    rec.onstop = () => { setTimeout(() => { window.__recDone = true; }, 1500); };
    rec.start(2000);
    window.__rec = rec;
  });
  const t0 = Date.now();
  let last = 0;
  for (;;) {
    await sleep(1000);
    const st = await page.evaluate(() => { const g = window.__qq.game, w = g.world; return { screen: g.screen, st: g.screenT, t: w ? +w.time.toFixed(0) : 0, x: w ? Math.round(w.player.body.x) : 0 }; });
    if (Date.now() - last > 20000) { last = Date.now(); console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} 秒｜${st.screen}｜遊戲 ${st.t} 秒｜x=${st.x}｜已錄 ${(bytes / 1e6).toFixed(1)} MB`); }
    if (st.screen === 'result' && st.st > 6) break;
    if (Date.now() - t0 > 10 * 60 * 1000) { console.log('超過 10 分鐘，停止'); break; }
  }
  console.log(`有沒有錄聲音：${await page.evaluate(() => window.__recAudio) ? '有' : '沒有（這份打包沒有 __qqAudio）'}`);
  await page.evaluate(() => window.__rec.stop());
  await page.waitForFunction(() => window.__recDone === true, null, { timeout: 30000 });
  console.log(`錄好：${FILE}（${(bytes / 1e6).toFixed(1)} MB）`);
} finally {
  await s.close();
  stopServer();
}
