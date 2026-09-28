#!/bin/sh
# 用最新打包版錄三關自動玩有聲影片，轉 mp4、每關切成上下兩半（傳檔上限 30 MB）。
# 用法：sh tools/record_all.sh [標籤，預設 v2]；先 npm run build。
cd "$(dirname "$0")/.." || exit 1
TAG=${1:-v2}
SNAP=dist_rec_$TAG
rm -rf "$SNAP" && cp -r dist "$SNAP" || exit 1
cd vids/_record || exit 1
for n in 1 2 3; do
  before=$(ls stage${n}_*.webm 2>/dev/null | wc -l)
  (cd ../.. && REC_DIST=$SNAP node tools/record_play.mjs $n 2>&1 | grep -E "錄好|聲音|超過" )
  W=$(ls -t stage${n}_*.webm | head -1)
  out="第${n}關_${TAG}"
  ffmpeg -v error -y -i "$W" -c:v h264_nvenc -preset p6 -rc vbr -b:v 820k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p -r 30 \
    -af volume=-2.5dB -c:a aac -b:a 128k -movflags +faststart "${out}.mp4" || continue
  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${out}.mp4")
  H=$(python -c "print(int(float('$D')/2))")
  ffmpeg -v error -y -i "${out}.mp4" -t $((H+2)) -c copy -movflags +faststart "${out}_上半.mp4"
  ffmpeg -v error -y -ss $H -i "${out}.mp4" -c copy -movflags +faststart "${out}_下半.mp4"
  echo "第${n}關：$(python -c "print(round(float('$D')))") 秒｜$(ls -la "${out}_上半.mp4" | awk '{print $5}')／$(ls -la "${out}_下半.mp4" | awk '{print $5}') bytes"
done
