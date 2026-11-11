#!/bin/bash
# جلسة واحدة: تشغيل + initialize + get_task على المهمة الاخيرة
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

TASK_ID="$1"
curl -s -D /tmp/mcp-hdrs -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}' > /dev/null
SID=$(grep -i '^mcp-session-id:' /tmp/mcp-hdrs | tr -d '\r' | awk '{print $2}')
curl -s -o /dev/null -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "SESSION=$SID"
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_task\",\"arguments\":{\"task_id\":\"$TASK_ID\"}}}" --max-time 120 > /tmp/gt.txt
if grep -q '^data:' /tmp/gt.txt; then grep '^data:' /tmp/gt.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/gt.json; else cp /tmp/gt.txt /tmp/gt.json; fi
python3 -c "
import json
d = json.load(open('/tmp/gt.json'))
print(d['result']['content'][0]['text'][:600])
print('isError:', d['result'].get('isError', False))
"
