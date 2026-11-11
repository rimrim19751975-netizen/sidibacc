#!/bin/bash
# تحقق شامل في جلسة واحدة: تشغيل السيرفر + فحوصات القبول كلها
cd /home/z/my-project
set -a; . ./.env.local; set +a

# 1) تشغيل المحاكي والسيرفر
pkill -f mock-merger.mjs 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null; sleep 1
PORT=3000 nohup bun .next/standalone/server.js > /tmp/next.log 2>&1 &
nohup node scripts/mock-merger.mjs > /tmp/merger.log 2>&1 &
for i in $(seq 1 20); do
  ok=$(curl -s --max-time 2 http://localhost:3000/api/health 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['ok'])" 2>/dev/null)
  [ "$ok" = "True" ] && break
  sleep 1
done
echo "=== 1) HEALTH ==="
curl -s --max-time 8 http://localhost:3000/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:',d['ok'],'| database:',d['database'],'| merger.healthy:',d['merger']['healthy'],'| authRequired:',d['authRequired'])"

# 2) MCP initialize + tools/list
echo "=== 2) MCP initialize + tools/list ==="
curl -s -D /tmp/mcp-hdrs -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}' > /tmp/init.txt
SID=$(grep -i '^mcp-session-id:' /tmp/mcp-hdrs | tr -d '\r' | awk '{print $2}')
curl -s -o /dev/null -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' > /tmp/tools.txt
if grep -q '^data:' /tmp/tools.txt; then grep '^data:' /tmp/tools.txt | head -1 | sed 's/^data:[ ]*//' > /tmp/tools.json; else cp /tmp/tools.txt /tmp/tools.json; fi
python3 -c "
import json
d = json.load(open('/tmp/tools.json'))
tools = d['result']['tools']
sv = d['result'].get('serverInfo', {})
print('serverInfo:', sv.get('name'), sv.get('version'))
print('TOOLS:', len(tools), '→', [t['name'] for t in tools])
for t in tools: print(' -', t['name'], 'required:', t.get('inputSchema',{}).get('required', []))
"

# 3) واجهة الإدارة RTL
echo "=== 3) Dashboard UI ==="
curl -s http://localhost:3000/ > /tmp/dash.html
python3 - <<'PY'
h = open('/tmp/dash.html', encoding='utf-8').read()
print('dir=rtl:', 'dir="rtl"' in h or "dir='rtl'" in h, '| lang=ar:', 'lang="ar"' in h or "lang='ar'" in h)
print('has keys card:', 'إدارة المفاتيح' in h, '| has tasks card:', 'المهام' in h or 'مراقبة المهام' in h, '| has connect card:', 'ربط السيرفر' in h or 'الاتصال' in h)
print('size:', len(h))
PY

# 4) e2e: توليد صورة حقيقي (المفاتيح مرهقة → يجب أن تبقى processing بالقاعدة الذهبية)
echo "=== 4) E2E generate_image (serial rotation + processing persistence) ==="
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"a red apple on a white table","wait_seconds":3}}}' --max-time 60 > /tmp/gen.txt
if grep -q '^data:' /tmp/gen.txt; then grep '^data:' /tmp/gen.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/gen.json; else cp /tmp/gen.txt /tmp/gen.json; fi
python3 -c "
import json
d = json.load(open('/tmp/gen.json'))
c = d['result']['content'][0]['text']
print(c[:400])
print('isError:', d['result'].get('isError', False))
"

# 5) get_task يُعيد المحاولة تلقائيًا (مهام processing)
echo "=== 5) list_media ==="
curl -s -X POST http://localhost:3000/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_media","arguments":{"limit":5}}}' --max-time 60 > /tmp/lm.txt
if grep -q '^data:' /tmp/lm.txt; then grep '^data:' /tmp/lm.txt | tail -1 | sed 's/^data:[ ]*//' > /tmp/lm.json; else cp /tmp/lm.txt /tmp/lm.json; fi
python3 -c "
import json
d = json.load(open('/tmp/lm.json'))
print(d['result']['content'][0]['text'][:300])
"

echo "=== 6) /api/keys (masked) ==="
curl -s http://localhost:3000/api/keys | python3 -c "
import json,sys
ks = json.load(sys.stdin)
keys = ks if isinstance(ks, list) else ks.get('keys', [])
for k in keys: print(k.get('provider'), '|', k.get('label'), '|', k.get('status'), '|', k.get('masked', k.get('masked_key','?')))
print('COUNT:', len(keys))
"

echo "=== DONE ==="
