/**
 * 總輸出：音效、配樂各一條匯流（配樂比音效小聲）→ 靜音開關 → 壓縮器 → 限幅 → 軟削波（保證不超過 -1 dBFS）→ 喇叭。
 * 錄影用的音軌（MediaStreamAudioDestinationNode）另外接在最後面，跟喇叭聽到的一模一樣。
 * 即時播放與離線渲染（試聽檔）共用這一份，量到的峰值就是玩家聽到的峰值。
 */

/** 配樂相對於音效的音量 */
export const MUSIC_LEVEL = 0.3;
export const SFX_LEVEL = 0.85;
/** 軟削波的天花板（線性值）：0.8 ≈ -1.9 dBFS（再經 opus／aac 壓縮會多冒一點點，留餘裕） */
export const CEILING = 0.8;

export interface Master {
  sfx: GainNode;
  music: GainNode;
  /** 靜音開關（1＝有聲、0＝靜音） */
  mute: GainNode;
  /** 最後一個節點（接喇叭、接錄影） */
  out: AudioNode;
}

/** 軟削波曲線：|x| ≤ 0.6 原樣通過，再上去用 tanh 慢慢壓，最大不超過 CEILING */
function clipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.6, room = CEILING - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return c;
}

export function buildMaster(ctx: BaseAudioContext): Master {
  const sfx = ctx.createGain(); sfx.gain.value = SFX_LEVEL;
  const music = ctx.createGain(); music.gain.value = MUSIC_LEVEL;
  const mute = ctx.createGain(); mute.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve();
  clip.oversample = 'none';   // 不要超取樣：超取樣的濾波器會讓波形冒出天花板一點點
  sfx.connect(mute); music.connect(mute);
  mute.connect(comp).connect(lim).connect(clip);
  clip.connect(ctx.destination);
  return { sfx, music, mute, out: clip };
}
