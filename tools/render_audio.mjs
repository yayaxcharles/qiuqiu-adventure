// 音效與配樂的試聽檔＋數據自我檢查（聽不到聲音時用數字確認）：
// 開一個本機 vite 開發伺服器＋獨立資料夾的無頭 Chrome，在 tools/audio_lab.html 裡用 OfflineAudioContext 渲染，
// 取樣值交回這裡寫 WAV、量峰值／平均音量／有效長度／頻譜重心，再用 ffmpeg 轉 mp3。
//
// 用法：node tools/render_audio.mjs
// 輸出：vids/_audio/音效試聽.mp3、配樂_第一關.mp3、配樂_第二關.mp3、配樂_第三關.mp3、配樂_魔王.mp3、
//       音效試聽_清單.txt（每段依序是什麼、在第幾秒、數據）、_stats.json
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, loadPlaywright, newContext } from 'file:///F:/ClaudeWork/qiuqiu-coop/tools/visual-gate/lib/browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vids', '_audio');
const TMP = join(OUT, '_wav');
const PORT = 4411;
const URL = `http://127.0.0.1:${PORT}/tools/audio_lab.html`;
const GAP = 0.4;
const MUSIC_SEC = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(TMP, { recursive: true });

/** 每個音效的中文說明（清單用） */
const DESC = {
  throw: '手裏劍丟出（短促咻）', throw_bo: '棒手裏劍連射（輕快嗤）', throw_fuma: '風魔大手裏劍（重的呼嗡）', throw_flame: '火藥竹筒噴火（呼呼）',
  throw_caltrop: '撒菱（嘩啦）', throw_chain: '鎖鎌（鐵鍊甩出＋鏘）', throw_crane: '式神紙鶴（紙片沙沙＋法術亮音）', throw_mouse: '鼠火（引信嘶嘶＋吱吱）',
  throw_yarn: '毛球彈（啵嚶）', throw_dart: '吹箭（噗＋咻）', throw_bomb: '丟副武器（甩出＋引信）',
  explosion: '小爆炸（鼠火）', explosion_big: '大爆炸（爆裂符、焙烙玉、火藥桶）',
  claw_hit: '揮爪打中', hit: '打中敵人', deflect: '打掉敵人子彈／石獅封印（叮）', block_clang: '鐵羅漢擋掉忍具（噹）', enemy_down: '敵人倒下',
  break: '木箱／竹籠打爛（木頭碎裂）', break_barrel: '水桶打爛（木頭＋水）', break_big: '瞭望台／寨門垮掉', part_break: '魔王背包打爛',
  enemy_notice: '敵人發現球球（！）', enemy_attack: '敵人揮擊', enemy_throw: '敵人丟苦無／魚骨／扇子', enemy_slam: '敵人震波／壓地（轟咚）',
  enemy_fire: '敵人吐火球／狐火', enemy_water: '敵人噴水／泡泡', enemy_summon: '敵人叫小兵／分身', enemy_bite: '敵人咬／撲／舌頭抓',
  enemy_charge: '山豬衝鋒', enemy_dive: '烏鴉俯衝', enemy_wind: '天狗刮風',
  player_hurt: '球球受傷', player_down: '球球倒下', respawn: '重生', fall: '掉進坑', thorns: '爪子被魔王的刺彈開', smoke: '煙玉',
  time_up: '時間到（扣一條命）', hint: '提示字',
  pickup: '撿到魚乾／飯糰', pickup_weapon: '撿到忍具／副武器', thank_you: '村貓道謝（喵＋小旋律）',
  boss_warning: '魔王出場警報', boss_roar: '魔王換階段（低吼）', boss_down: '魔王倒下',
  mission_start: '任務開始（號角樂句）', mission_complete: '任務完成（號角樂句）', continue: '接關提示', countdown_tick: '接關倒數（每秒一聲）', result: '結算',
};
const TRACK_FILE = { stage1: '配樂_第一關', stage2: '配樂_第二關', stage3: '配樂_第三關', boss: '配樂_魔王' };

// ───────── 數學：解碼、量測 ─────────
const decode = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

function stats(L, R, sr) {
  const n = L.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
  // 有效長度：第一個到最後一個超過 -50 dBFS 的取樣
  const th = Math.pow(10, -50 / 20);
  let a = -1, b = -1;
  for (let i = 0; i < n; i++) if (Math.abs(mono[i]) > th) { if (a < 0) a = i; b = i; }
  let ss = 0;
  for (let i = Math.max(0, a); i <= b; i++) ss += mono[i] * mono[i];
  const rms = b > a ? Math.sqrt(ss / (b - a + 1)) : 0;
  // 頻譜重心：2048 點視窗、每 512 點一格，只算有聲音的格，以能量加權
  const N = 2048, hop = 512;
  let num = 0, den = 0;
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let s = 0; s + N <= n || s === 0; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) { const v = mono[s + i] ?? 0; re[i] = v * win[i]; e += v * v; }
    if (Math.sqrt(e / N) < 1e-3) { if (s + N > n) break; continue; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const mag = Math.hypot(re[k], im[k]); num += mag * (k * sr) / N * e; den += mag * e; }
    if (s + N > n) break;
  }
  return { peakDb: +db(peak).toFixed(2), rmsDb: +db(rms).toFixed(1), activeSec: a < 0 ? 0 : +((b - a) / sr).toFixed(3), centroidHz: den ? Math.round(num / den) : 0 };
}

function writeWav(file, chans, sr) {
  const n = chans[0].length, nc = chans.length;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * nc * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), o); o += 2; }
  writeFileSync(file, buf);
}

function toMp3(wav, mp3) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg 轉 mp3 失敗：${r.stderr}`);
}

// ───────── 開伺服器、開瀏覽器、渲染 ─────────
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, windowsHide: true });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const stopServer = () => spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
for (let i = 0; i < 120 && !/127\.0\.0\.1:\d+/.test(slog); i++) await sleep(250);

await loadPlaywright();
const s = await newContext('side', 'audio');
const { page } = s;
try {
  assertLocal(URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__lab, null, { timeout: 60000 });
  const names = await page.evaluate(() => window.__lab.names());
  const rows = [];
  const parts = [[], []];
  let t = 0, sr = 44100;
  for (const name of names) {
    const fin = await page.evaluate((n) => window.__lab.renderSfx(n), name);
    const raw = await page.evaluate((n) => window.__lab.renderSfx(n, true), name);
    sr = fin.sr;
    const [L, R] = fin.ch.map(decode);
    const [rL, rR] = raw.ch.map(decode);
    const st = stats(L, R, sr);
    const rst = stats(rL, rR, sr);
    rows.push({ i: rows.length + 1, name, desc: DESC[name] ?? '', startSec: +t.toFixed(2), ...st, rawPeakDb: rst.peakDb });
    parts[0].push(L, new Float32Array(Math.round(GAP * sr)));
    parts[1].push(R, new Float32Array(Math.round(GAP * sr)));
    t += L.length / sr + GAP;
  }
  const cat = (arr) => { const n = arr.reduce((a, x) => a + x.length, 0); const o = new Float32Array(n); let k = 0; for (const x of arr) { o.set(x, k); k += x.length; } return o; };
  const all = [cat(parts[0]), cat(parts[1])];
  writeWav(join(TMP, 'sfx.wav'), all, sr);
  toMp3(join(TMP, 'sfx.wav'), join(OUT, '音效試聽.mp3'));
  const whole = stats(all[0], all[1], sr);

  const music = [];
  for (const id of Object.keys(TRACK_FILE)) {
    const r = await page.evaluate(([i, sec]) => window.__lab.renderMusic(i, sec), [id, MUSIC_SEC]);
    const [L, R] = r.ch.map(decode);
    writeWav(join(TMP, `${id}.wav`), [L, R], r.sr);
    toMp3(join(TMP, `${id}.wav`), join(OUT, `${TRACK_FILE[id]}.mp3`));
    music.push({ id, file: `${TRACK_FILE[id]}.mp3`, ...stats(L, R, r.sr) });
  }

  // 配樂檔（爪破魔塔的 mp3）：照遊戲裡的增益、經過總輸出後的響度；再疊一串最響的音效看峰值
  const lufs = (wav) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    return Number(/I:\s*(-?[\d.]+) LUFS/.exec(r.stderr.slice(r.stderr.lastIndexOf('Summary')))?.[1]);
  };
  const files = [];
  for (const id of await page.evaluate(() => window.__lab.bgm())) {
    const r = await page.evaluate(([i]) => window.__lab.renderFileMusic(i, 20, 30), [id]);
    const [L, R] = r.ch.map(decode);
    writeWav(join(TMP, `bgm_${id}.wav`), [L, R], r.sr);
    const m = await page.evaluate(([i]) => window.__lab.renderFileMusic(i, 20, 30, true), [id]);
    const [mL, mR] = m.ch.map(decode);
    files.push({ id, lufs: lufs(join(TMP, `bgm_${id}.wav`)), peakDb: stats(L, R, r.sr).peakDb, withSfxPeakDb: stats(mL, mR, m.sr).peakDb });
  }

  const lines = [
    '音效試聽.mp3 的內容（依序；每段之間空 0.4 秒）',
    '欄位：開始秒數｜名稱｜說明｜有效長度（秒）｜峰值 dBFS｜平均 dBFS｜頻譜重心 Hz（越高聽起來越尖亮）',
    '',
    ...rows.map((r) => `${String(r.i).padStart(2)}. ${r.startSec.toFixed(2).padStart(6)} 秒｜${r.name}｜${r.desc}｜${r.activeSec.toFixed(2)}｜${r.peakDb.toFixed(1)}｜${r.rmsDb.toFixed(1)}｜${r.centroidHz}`),
    '',
    `整份試聽檔：峰值 ${whole.peakDb} dBFS`,
    '',
    '配樂（各 30 秒，音量就是遊戲裡的音量：比音效小聲）',
    ...music.map((m) => `${m.file}｜峰值 ${m.peakDb} dBFS｜平均 ${m.rmsDb} dBFS｜頻譜重心 ${m.centroidHz} Hz`),
    '（2026-09-27 起遊戲改放爪破魔塔的配樂檔，上面這四首合成曲只在檔案載不到時當退路）',
    '',
    '配樂檔（爪破魔塔的 mp3，第 20～50 秒，照遊戲裡的增益、經過總輸出）｜響度 LUFS｜峰值 dBFS｜同時疊最響的音效後的峰值 dBFS',
    ...files.map((f) => `${f.id}｜${f.lufs}｜${f.peakDb}｜${f.withSfxPeakDb}`),
  ];
  writeFileSync(join(OUT, '音效試聽_清單.txt'), lines.join('\r\n') + '\r\n', 'utf8');
  writeFileSync(join(OUT, '_stats.json'), JSON.stringify({ sfx: rows, whole, music, files }, null, 1));
  console.log(lines.join('\n'));
  console.log(`\n寫好：${OUT}`);
} finally {
  await s.close();
  stopServer();
  rmSync(TMP, { recursive: true, force: true });
}
