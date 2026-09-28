"""從 record_play.mjs 錄的整關影片剪一段（用同名 _timeline.json 把「遊戲第幾秒」換成「影片第幾秒」）。
用法：python tools/cut_clip.py <錄影.webm> <遊戲開始秒> <遊戲結束秒> <輸出.mp4> [--pre 秒]
時間表每秒記一次，對得準到約 ±1 秒；前面多留 --pre 秒（預設 2）。"""
import json, subprocess, sys
from pathlib import Path

src, t0, t1, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
pre = float(sys.argv[sys.argv.index('--pre') + 1]) if '--pre' in sys.argv else 2.0
tl = json.loads(Path(src).with_name(Path(src).stem + '_timeline.json').read_text(encoding='utf-8'))['timeline']
pts = [(w, g) for w, scr, g in tl if scr == 'play']


def wall(t):
    for (w0, g0), (w1, g1) in zip(pts, pts[1:]):
        if g0 <= t <= g1 and g1 > g0:
            return w0 + (w1 - w0) * (t - g0) / (g1 - g0)
    return pts[-1][0] if t > pts[-1][1] else pts[0][0]


a, b = max(0.0, wall(t0) - pre), wall(t1) + 1.0
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.2f}', '-i', src, '-t', f'{b - a:.2f}',
                '-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-b:v', '1500k', '-maxrate', '2500k', '-bufsize', '5000k',
                '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], check=True)
print(f'{out}：影片 {a:.1f}～{b:.1f} 秒（遊戲 {t0}～{t1} 秒）')
