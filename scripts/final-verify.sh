#!/bin/bash
# جلسة تحقق نهائية واحدة: صحة + تنشيط المفتاح + دمج e2e + تنظيف آثار الاختبار
cd /home/z/my-project
set -a; . ./.env.local; set +a
pkill -f mock-merger.mjs 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null; sleep 1
PORT=3000 nohup bun .next/standalone/server.js > /tmp/next.log 2>&1 &
nohup node scripts/mock-merger.mjs > /tmp/merger.log 2>&1 &
for i in $(seq 1 15); do
  ok=$(curl -s --max-time 2 http://localhost:3000/api/health 2>/dev/null | head -c 5)
  [ -n "$ok" ] && break
  sleep 1
done

echo "=== 1) HEALTH ==="
curl -s --max-time 8 http://localhost:3000/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:',d['ok'],'| database:',d['database'],'| merger.healthy:',d['merger']['healthy'])"

# جلسة MCP
curl -s -D /tmp/mcp-hdrs -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}' > /dev/null
SID=$(grep -i '^mcp-session-id:' /tmp/mcp-hdrs | tr -d '\r' | awk '{print $2}')
curl -s -o /dev/null -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
echo "MCP SESSION=$SID"

echo "=== 2) PATCH key1 → active (إعادة تنشيط بعد إثبات نجاح e2e) ==="
KID=$(curl -s http://localhost:3000/api/keys | python3 -c "
import json,sys
ks = json.load(sys.stdin)
keys = ks if isinstance(ks, list) else ks.get('keys', [])
print([k['id'] for k in keys if k.get('label') == '1'][0])
")
curl -s -X PATCH "http://localhost:3000/api/keys/$KID" -H "Content-Type: application/json" -d '{"status":"active"}'
echo

echo "=== 3) merge_videos e2e (محاكي الدمج + Turso الحقيقية) ==="
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"merge_videos","arguments":{"urls":["https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4","https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"],"wait_seconds":8}}}' --max-time 90 > /tmp/mg.txt
if grep -q '^data:' /tmp/mg.txt; then grep '^data:' /tmp/mg.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/mg.json; else cp /tmp/mg.txt /tmp/mg.json; fi
python3 -c "
import json, re
d = json.load(open('/tmp/mg.json'))
t = d['result']['content'][0]['text']
print(t[:300])
m = re.search(r'task_id: ([0-9a-f-]{36})', t)
open('/tmp/merge_tid','w').write(m.group(1) if m else '')
print('--- captured task_id:', m.group(1) if m else 'NONE')
"

echo "=== 4) get_task على مهمة الدمج ==="
TID=$(cat /tmp/merge_tid)
if [ -n "$TID" ]; then
  sleep 3
  curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"get_task\",\"arguments\":{\"task_id\":\"$TID\"}}}" --max-time 90 > /tmp/mg2.txt
  if grep -q '^data:' /tmp/mg2.txt; then grep '^data:' /tmp/mg2.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/mg2.json; else cp /tmp/mg2.txt /tmp/mg2.json; fi
  python3 -c "
import json
d = json.load(open('/tmp/mg2.json'))
print(d['result']['content'][0]['text'][:400])
"
fi

echo "=== 5) حالة المفاتيح النهائية ==="
curl -s http://localhost:3000/api/keys | python3 -c "
import json,sys
ks = json.load(sys.stdin)
keys = ks if isinstance(ks, list) else ks.get('keys', [])
for k in keys:
    mk = k.get('masked_key') or k.get('masked') or ''
    print(k.get('provider'),'|',k.get('label'),'|',k.get('status'),'|',mk)
"

echo "=== 6) تنظيف آثار الاختبار (مهام Turso الحقيقية) ==="
node scripts/cleanup-tasks.mjs --all 2>&1 | tail -3
