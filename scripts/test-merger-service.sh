#!/bin/bash
# اختبار كامل لخدمة الدمج الحقيقية بفيديوهات مُولَّدة محليًا:
# 3 مقاطع بمقاسات مختلفة + مقطع بلا صوت → يثبت توحيد المقاسات ومسار الصمت
cd /tmp && rm -rf mrgtest && mkdir mrgtest && cd mrgtest

echo "=== توليد 3 فيديوهات اختبارية ==="
ffmpeg -v error -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:duration=5" -c:v libx264 -preset veryfast -c:a aac -shortest A-1280x720-audio.mp4 -y
ffmpeg -v error -f lavfi -i "testsrc2=duration=5:size=640x360:rate=30" -c:v libx264 -preset veryfast -shortest B-640x360-NOaudio.mp4 -y
ffmpeg -v error -f lavfi -i "smptebars=duration=5:size=854x480:rate=30" -f lavfi -i "sine=frequency=880:duration=5" -c:v libx264 -preset veryfast -c:a aac -shortest C-854x480-audio.mp4 -y
ls -la *.mp4

cd /home/z/my-project
pkill -f "merger-service/server.mjs" 2>/dev/null; sleep 0.5
PORT=8788 nohup node merger-service/server.mjs > /tmp/merger-real.log 2>&1 &
nohup python3 -m http.server 8899 --directory /tmp/mrgtest > /tmp/http-test.log 2>&1 &
sleep 2

echo "=== إنشاء مهمة بـ 3 مقاطع (أحجام مختلفة + بلا صوت) ==="
RESP=$(curl -s --max-time 20 -X POST http://localhost:8788/api/jobs -H "Content-Type: application/json" -d '{"videos":["http://localhost:8899/A-1280x720-audio.mp4","http://localhost:8899/B-640x360-NOaudio.mp4","http://localhost:8899/C-854x480-audio.mp4"]}')
echo "$RESP"
JID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['jobId'])")

echo "=== المعالجة الحاجبة (تنزيل + دمج ffmpeg فعلي) ==="
time curl -s --max-time 300 -X POST "http://localhost:8788/api/jobs/$JID/process" > /tmp/proc.json
python3 -m json.tool /tmp/proc.json

echo "=== فحص المخرج بـ ffprobe (يجب: H.264+AAC، ~15 ثانية، 1280x720) ==="
curl -s --max-time 60 -o /tmp/merged-test.mp4 "http://localhost:8788/api/jobs/$JID/video"
ls -la /tmp/merged-test.mp4
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,codec_type,width,height -of default=noprint_wrappers=1 /tmp/merged-test.mp4

echo "=== حالة المهمة بعد النجاح ==="
curl -s --max-time 10 "http://localhost:8788/api/jobs/$JID" | python3 -m json.tool | head -12

echo "=== تنظيف ==="
curl -s --max-time 10 -X DELETE "http://localhost:8788/api/jobs/$JID"; echo
pkill -f "http.server 8899" 2>/dev/null
echo "=== DONE ==="
