/**
 * 音效試聽渲染頁（tools/render_audio.mjs 在無頭 Chrome 裡開它）：
 * 用 OfflineAudioContext 把每個音效、每首配樂渲染出來，經過跟遊戲一模一樣的總輸出（壓縮、限幅、削波），
 * 把取樣值交回 Node 寫成 WAV、量峰值與頻譜重心。
 */
import { BGM, bgmGain } from '../src/audio/bgm';
import { buildMaster, SFX_LEVEL } from '../src/audio/engine';
import { renderTrack, TRACKS } from '../src/audio/music';
import { SFX_DEFS } from '../src/audio/sfxDefs';
import { makeRng, playSfx, sfxDuration } from '../src/audio/synth';

const SR = 44100;

function b64(f: Float32Array): string {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(bin);
}

const pack = (b: AudioBuffer): { sr: number; ch: string[] } => ({ sr: b.sampleRate, ch: [b64(b.getChannelData(0)), b64(b.getChannelData(1))] });

/** 一個音效：final＝經過總輸出（玩家聽到的）；raw＝只乘音效匯流音量、不經壓縮限幅（看限幅器壓了多少） */
async function renderSfx(name: string, raw = false): Promise<{ sr: number; ch: string[] }> {
  const def = SFX_DEFS[name]!;
  const len = sfxDuration(def) + 0.12;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
  let out: AudioNode;
  if (raw) { const g = ctx.createGain(); g.gain.value = SFX_LEVEL; g.connect(ctx.destination); out = g; }
  else out = buildMaster(ctx).sfx;
  playSfx(ctx, out, def, 0.01, makeRng(7));
  return pack(await ctx.startRendering());
}

async function renderMusic(id: string, sec: number): Promise<{ sr: number; ch: string[] }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sec * SR), SR);
  const m = buildMaster(ctx);
  renderTrack(ctx, m.music, TRACKS[id]!, sec, makeRng(11), 0.05);
  return pack(await ctx.startRendering());
}

/**
 * 配樂檔（爪破魔塔的 mp3）照遊戲裡的增益經過總輸出，從 from 秒開始渲染 sec 秒；withSfx＝同時疊一串最響的音效（看會不會破音）。
 * 這裡是檢查工具才整首解碼；遊戲本身是串流播放（audio/bgm.ts）。
 */
async function renderFileMusic(id: string, from: number, sec: number, withSfx = false): Promise<{ sr: number; ch: string[] }> {
  const buf = await (await fetch(`/bgm/${BGM[id]!.file}.mp3`)).arrayBuffer();
  const ctx = new OfflineAudioContext(2, Math.ceil(sec * SR), SR);
  const audio = await ctx.decodeAudioData(buf);
  const m = buildMaster(ctx);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  const g = ctx.createGain();
  g.gain.value = bgmGain(id);
  src.connect(g).connect(m.music);
  src.start(0, from);
  if (withSfx) {
    const rnd = makeRng(3);
    const loud = ['explosion_big', 'boss_warning', 'enemy_slam', 'break_big', 'mission_complete', 'player_down', 'explosion', 'claw_hit'];
    for (let t = 0.5, i = 0; t < sec - 2; t += 0.35, i++) playSfx(ctx, m.sfx, SFX_DEFS[loud[i % loud.length]!]!, t, rnd);
  }
  return pack(await ctx.startRendering());
}

(window as unknown as { __lab: unknown }).__lab = { names: () => Object.keys(SFX_DEFS), tracks: () => Object.keys(TRACKS), bgm: () => Object.keys(BGM), renderSfx, renderMusic, renderFileMusic };

// 手動開這頁時：每個音效一顆按鈕，點了用喇叭播
const live = new AudioContext();
const m = buildMaster(live);
for (const n of Object.keys(SFX_DEFS)) {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => { void live.resume(); playSfx(live, m.sfx, SFX_DEFS[n]!, live.currentTime + 0.02, makeRng()); };
  document.body.append(b);
}
