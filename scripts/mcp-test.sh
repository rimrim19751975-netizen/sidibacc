#!/bin/bash
# مساعد اختبار MCP عبر curl — يدعم JSON وSSE ويحفظ جلسة initialize
BASE=http://localhost:3000/mcp
H1='content-type: application/json'
H2='accept: application/json, text/event-stream'
SESS_FILE=/tmp/mcp-session

mcp_init() {
  curl -s -D /tmp/mcp-hdrs -X POST "$BASE" -H "$H1" -H "$H2" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}'
  sid=$(grep -i '^mcp-session-id:' /tmp/mcp-hdrs | tr -d '\r' | awk '{print $2}')
  echo "$sid" > "$SESS_FILE"
  curl -s -o /dev/null -X POST "$BASE" -H "$H1" -H "$H2" -H "mcp-session-id: $sid" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo "SESSION=$sid"
}

mcp_call() {
  # $1 = body JSON ; يستخدم الجلسة المحفوظة
  local sid=$(cat "$SESS_FILE")
  curl -s --max-time 300 -X POST "$BASE" -H "$H1" -H "$H2" -H "mcp-session-id: $sid" -d "$1"
}

# استخراج أول رسالة data من رد SSE (أو JSON مباشرة)
mcp_data() {
  # $1 = raw response
  if echo "$1" | grep -q '^data:'; then
    echo "$1" | grep '^data:' | head -1 | sed 's/^data:[ ]*//'
  else
    echo "$1"
  fi
}
