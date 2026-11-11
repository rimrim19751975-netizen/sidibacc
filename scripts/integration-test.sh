#!/bin/bash
# اختبار التكامل النهائي: التطبيق الرئيسي + خدمة الدمج الحقيقية (ffmpeg) مع Turso
cd /home/z/my-project
set -a; . ./.env.local; set +a
pkill -f "merger-service/server.mjs" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null; pkill -f "http.server 8899" 2>/dev/null; sleep 1
PORT=8787 nohup node merger-service/server.mjs > /tmp/merger.log 2>&1 &
nohup python3 -m http.server 8899 --directory /tmp/mrgtest > /tmp/http-test.log 2>&1 &
PORT=3000 nohup bun .next/standalone/server.js > /tmp/next.log 2>&1 &
for i in $(seq 1 15); do
  ok=$(curl -s --max-time 2 http://localhost:3000/api/health 2>/dev/null | head -c 5)
  [ -n "$ok" ] && break
  sleep 1
done
echo "=== 1) HEALTH (يجب: turso-connected + merger healthy) ==="
curl -s --max-time 10 http://localhost:3000/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:',d['ok'],'| database:',d['database'],'| merger:',d['merger'])"

curl -s -D /tmp/mcp-hdrs -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}' > /dev/null
SID=$(grep -i '^mcp-session-id:' /tmp/mcp-hdrs | tr -d '\r' | awk '{print $2}')
curl -s -o /dev/null -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "=== 2) merge_videos عبر MCP (مقطعان عامّان حقيقيان) ==="
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"merge_videos","arguments":{"urls":["https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4","https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"],"wait_seconds":90}}}' --max-time 200 > /tmp/mg.txt
if grep -q '^data:' /tmp/mg.txt; then grep '^data:' /tmp/mg.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/mg.json; else cp /tmp/mg.txt /tmp/mg.json; fi
python3 -c "
import json
d = json.load(open('/tmp/mg.json'))
print(d['result']['content'][0]['text'][:400])
print('isError:', d['result'].get('isError', False))
"

echo "=== 3) تحقق من المهمة في Turso ==="
sleep 1
python3 - <<'PY'
import json, os, urllib.request
url = os.environ["TURSO_DATABASE_URL"].replace("libsql://", "https://") + "/v2/pipeline"
tok = os.environ["TURSO_AUTH_TOKEN"]
body = json.dumps({"requests":[{"type":"execute","stmt":{"sql":"SELECT type, status, progress, substr(result_urls_json,1,150) AS urls FROM tasks ORDER BY created_at DESC LIMIT 1"}}]}).encode()
req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=20))
r = d["results"][0]["response"]["result"]
cols = [c["name"] for c in r["cols"]]
row = {c: (v.get("value") if isinstance(v, dict) else v) for c, v in zip(cols, r["rows"][0])}
print(row)
PY

echo "=== 4) تنظيف آثار الاختبار ==="
node scripts/cleanup-tasks.mjs --all 2>&1 | tail -2
echo "=== DONE ==="
