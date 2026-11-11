#!/bin/bash
# فحص دخاني سريع في جلسة واحدة — يثبت سلوك التشخيص الذاتي في الحالتين:
# B) بلا متغيرات بيئة = الوضع الحالي على منصة النشر → database: env-missing + أسماء المتغيرات الناقصة
# A) مع المتغيرات = الوضع بعد الضبط على المنصة → database: turso-connected
# لا يستهلك أي رصيد توليد (بدون generate) — فقط health و keys المُقنَّعة
cd /home/z/my-project
pkill -f "standalone/server.js" 2>/dev/null; sleep 1

echo "=== سيناريو B: بلا متغيرات بيئة (وضع المنصة الحالي) ==="
PORT=3101 nohup node .next/standalone/server.js > /tmp/next-b.log 2>&1 &
SPID=$!
sleep 4
echo "--- health (no env) ---"
curl -s http://localhost:3101/api/health | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('ok:',d['ok'])
print('database:',d['database'])
print('missingEnv:',d.get('missingEnv'))
print('platform:',d.get('platform'))
print('merger.configured:',d['merger'].get('configured'))
"
echo "--- dashboard page HTTP status + header title ---"
curl -s -o /tmp/dash-b.html -w "HTTP %{http_code}\n" http://localhost:3101/
grep -q "MCP Media Generator" /tmp/dash-b.html && echo "page renders OK" || echo "PAGE BROKEN"
kill $SPID 2>/dev/null; sleep 1

echo ""
echo "=== سيناريو A: مع المتغيرات (الوضع بعد الضبط على المنصة) ==="
set -a; . ./.env.local; set +a
PORT=3102 nohup node .next/standalone/server.js > /tmp/next-a.log 2>&1 &
SPID2=$!
sleep 4
echo "--- health (with env) ---"
curl -s http://localhost:3102/api/health | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('ok:',d['ok'])
print('database:',d['database'])
print('missingEnv:',d.get('missingEnv'))
print('merger.configured:',d['merger'].get('configured'))
print('merger.healthy:',d['merger']['healthy'])
"
echo "--- keys (masked only) ---"
curl -s http://localhost:3102/api/keys | python3 -c "
import json,sys
d=json.load(sys.stdin)
ks=d.get('keys',[])
print('keys count:',len(ks))
for k in ks: print(' -',k.get('provider'),'|',k.get('label'),'|',k.get('status'),'|',k.get('api_key'))
"
kill $SPID2 2>/dev/null
echo "=== تم الفحص ==="
