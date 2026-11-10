// نقطة MCP — نقل Streamable HTTP عبر SDK الرسمي (McpServer + النقل القياسي الرسمي
// WebStandardStreamableHTTPServerTransport — وهو نواة StreamableHTTPServerTransport نفسها
// بغلاف Node، ويعمل مباشرة مع Web Request/Response في App Router بلا أي JSON-RPC يدوي).
// POST لرسائل JSON-RPC، DELETE لإنهاء الجلسة، GET لتيار SSE من الخادم.
// إن ضُبط MCP_ACCESS_TOKEN فمطلوب Authorization: Bearer <token> على هذا المسار.
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// سقف مدة الدالة على Vercel — نافذة الانتظار داخل الأدوات تُقصّ وفق ذلك (انظر coordinator.ts)
export const maxDuration = 60;

// الجلسات الحية في هذه النسخة (تعيش طوال دفء النسخة؛ بداية باردة تعني إعادة initialize من العميل)
interface SessionEntry {
  server: ReturnType<typeof buildMcpServer>;
  transport: WebStandardStreamableHTTPServerTransport;
}
const sessions = new Map<string, SessionEntry>();
// سقف بسيط لعدد الجلسات في الذاكرة
const MAX_SESSIONS = 500;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handle(request: Request): Promise<Response> {
  // حماية اختيارية بـ Bearer token
  const token = process.env.MCP_ACCESS_TOKEN?.trim();
  if (token) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return jsonError(401, "مطلوب ترويسة Authorization: Bearer <MCP_ACCESS_TOKEN>");
    }
  }

  // نُمرِّر الجسم محلَّلًا (كما في أمثلة SDK الرسمية) تفاديًا لأي قراءة مزدوجة
  let parsedBody: unknown;
  if (request.method === "POST") {
    const text = await request.text();
    try {
      parsedBody = JSON.parse(text || "{}");
    } catch {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const sessionId = request.headers.get("mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  // لا توجد جلسة معروفة بهذا المعرّف
  if (!existing) {
    if (request.method === "DELETE") return jsonError(404, "لا توجد جلسة MCP بهذا المعرّف");
    if (request.method === "POST") {
      const method = (parsedBody as { method?: string } | undefined)?.method;
      if (method === "initialize" && !sessionId) {
        // جلسة جديدة: خادم + نقل رسميان من SDK
        let created: SessionEntry | undefined;
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (sessions.size >= MAX_SESSIONS) {
              // إخلاء أقدم جلسة عند الامتلاء
              const first = sessions.keys().next().value;
              if (first) sessions.delete(first);
            }
            if (created) sessions.set(sid, created);
          },
          onsessionclosed: (sid) => {
            sessions.delete(sid);
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };
        const server = buildMcpServer();
        await server.connect(transport);
        created = { server, transport };
        return await transport.handleRequest(request, { parsedBody });
      }
      if (!sessionId) return jsonError(400, "مطلوب إرسال initialize أولاً لإنشاء جلسة MCP");
      // معرّف جلسة غير معروف في هذه النسخة (بداية باردة في serverless) — يعيد العميل التهيئة
      return jsonError(404, "انتهت جلسة MCP أو غير معروفة — أعد إرسال initialize");
    }
    // GET بلا جلسة
    return jsonError(400, "مطلوب إرسال initialize أولاً لإنشاء جلسة MCP");
  }

  // الجلسة معروفة — تمرير الطلب للنقل الرسمي (POST/GET/DELETE)
  return await existing.transport.handleRequest(request, { parsedBody });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
