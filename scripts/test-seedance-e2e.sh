#!/bin/bash
# اختبار نهاية-إلى-نهاية للفيديو السريع doubao-seedance-2-0-fast عبر MCP على الإنتاج
set -u
BASE="https://sidibacc2.vercel.app"
H1='content-type: application/json'
H2='accept: application/json, text/event-stream'

mcp_data() { if echo "$1" | grep -q '^data:'; then echo "$1" | grep '^data:' | head -1 | sed 's/^data:[ ]*//'; else echo "$1"; fi; }

echo "=== تهيئة جلسة MCP ==="
curl -s -D /tmp/seed-hdrs -X POST "$BASE/mcp" -H "$H1" -H "$H2" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"seedance-test","version":"1.0"}}}' -o /dev/null
SID=$(grep -i '^mcp-session-id:' /tmp/seed-hdrs | tr -d '\r' | awk '{print $2}')
echo "session=$SID"
curl -s -o /dev/null -X POST "$BASE/mcp" -H "$H1" -H "$H2" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "=== generate_video (seedance fast, 4s, 480p) — $(date +%H:%M:%S) ==="
START=$(date +%s)
RESP=$(curl -s --max-time 90 -X POST "$BASE/mcp" -H "$H1" -H "$H2" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_video","arguments":{"prompt":"A golden retriever puppy chasing a red ball across a sunny lawn, slow motion, cinematic","model":"doubao-seedance-2-0-fast","duration":4,"resolution":"480p","aspect_ratio":"16:9","wait_seconds":25}}}')
mcp_data "$RESP" | python3 -c "
import sys,json
j=json.load(sys.stdin)
print(j.get('result',{}).get('content',[{}])[0].get('text','')[:400])
"
