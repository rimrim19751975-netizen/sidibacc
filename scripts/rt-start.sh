#!/bin/bash
# إعادة تشغيل الخدمات محليًا بطريقة idempotent — المحاكي على 8787 والسيرفر على 3000
cd /home/z/my-project
set -a; . ./.env.local; set +a

started_any=0
if ! curl -s --max-time 2 http://localhost:8787/api/config > /dev/null; then
  pkill -f mock-merger.mjs 2>/dev/null; sleep 0.5
  nohup node scripts/mock-merger.mjs > /tmp/merger.log 2>&1 &
  started_any=1
fi
if ! curl -s --max-time 3 http://localhost:3000/api/health > /dev/null; then
  pkill -f "standalone/server.js" 2>/dev/null; sleep 0.5
  PORT=3000 nohup bun .next/standalone/server.js > /tmp/next.log 2>&1 &
  started_any=1
fi
# انتظار الجهوزية الكاملة (حتى 25 ثانية)
for i in $(seq 1 25); do
  ok1=$(curl -s --max-time 2 http://localhost:8787/api/config | head -c 1)
  ok2=$(curl -s --max-time 3 http://localhost:3000/api/health | jq -r '.ok' 2>/dev/null)
  if [ "$ok1" = "{" ] && [ "$ok2" = "true" ]; then
    echo "READY after ${i}s (merger+next)"
    exit 0
  fi
  sleep 1
done
echo "NOT_READY — merger:$(curl -s --max-time 2 http://localhost:8787/api/config | head -c 20) next:$(tail -3 /tmp/next.log 2>/dev/null)"
exit 1
