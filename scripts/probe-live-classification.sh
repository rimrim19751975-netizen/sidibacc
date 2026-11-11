#!/bin/bash
# تشخيص حي: يدفع مهمة عالقة عبر get_task ليُعاد إنشاؤها على المفاتيح الحالية،
# ثم يعرض حالات المفاتيح بعدها — لكشف كيف يصنّف الكود المنشور أخطاء الرصيد/المفتاح.
set -u
BASE="https://sidibacc2.vercel.app"
H1='content-type: application/json'
H2='accept: application/json, text/event-stream'
SESS=/tmp/mcp-probe-session

echo "=== 1) قبل: حالات المفاتيح ==="
curl -s --max-time 20 "$BASE/api/keys" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in (d.get('keys') or []):
    print(k['provider'],'|',k['status'],'| ok:',k['success_count'],'fail:',k['fail_count'],'|',str(k.get('last_error'))[:60])
"

echo "=== 2) استخراج مهمة عالقة ==="
TASK=$(curl -s --max-time 20 "$BASE/api/tasks?limit=5" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ts=[t for t in d.get('tasks',[]) if t['status']=='processing']
print(ts[0]['id'] if ts else '')
")
echo "task=$TASK"

echo "=== 3) تهيئة جلسة MCP ==="
curl -s -D /tmp/mcp-probe-hdrs -X POST "$BASE/mcp" -H "$H1" -H "$H2" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}' -o /dev/null
SID=$(grep -i '^mcp-session-id:' /tmp/mcp-probe-hdrs | tr -d '\r' | awk '{print $2}')
echo "session=$SID"
curl -s -o /dev/null -X POST "$BASE/mcp" -H "$H1" -H "$H2" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

echo "=== 4) get_task (يدفع إعادة المحاولة) ==="
curl -s --max-time 90 -X POST "$BASE/mcp" -H "$H1" -H "$H2" -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_task\",\"arguments\":{\"task_id\":\"$TASK\"}}}" \
  | python3 -c "
import sys,json
raw=sys.stdin.read()
data=raw
if 'data:' in raw:
    for line in raw.splitlines():
        if line.startswith('data:'):
            data=line[5:].strip(); break
try:
    j=json.loads(data)
    txt=j.get('result',{}).get('content',[{}])[0].get('text','')
    print(txt[:500])
except Exception as e:
    print('raw:', raw[:300])
"

echo "=== 5) بعد: حالات المفاتيح ==="
sleep 2
curl -s --max-time 20 "$BASE/api/keys" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in (d.get('keys') or []):
    print(k['provider'],'|',k['status'],'| ok:',k['success_count'],'fail:',k['fail_count'],'|',str(k.get('last_error'))[:60])
"
