// لوحة المهام للواجهة: إحصائيات + أحدث المهام (تُستطع كل ~5 ثوانٍ من العميل)
// ملاحظة: لا يُعاد params_json هنا — تفاصيل داخلية تبقى في القاعدة.
import { NextResponse } from "next/server";
import { after } from "next/server";
import { listRecentTasks, taskStats, attemptsOf } from "@/lib/turso";
import { pumpQueue } from "@/lib/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20));

  const [stats, rows] = await Promise.all([taskStats(), listRecentTasks(limit)]);
  // مضخة الطابور: كل تحديث للوحة (كل ~5 ثوانٍ ما دامت مفتوحة) يستأنف مهمة عالقة
  // واحدة في الخلفية — المهام تكتمل وحدها ما دامت اللوحة مفتوحة حتى لو توقف عميل MCP.
  try {
    after(async () => {
      await pumpQueue(1).catch(() => {});
    });
  } catch {}
  return NextResponse.json({
    stats,
    tasks: rows.map((t) => {
      let resultUrls: string[] = [];
      try {
        const v = JSON.parse(t.result_urls_json ?? "[]");
        if (Array.isArray(v)) resultUrls = v.map(String);
      } catch {
        resultUrls = [];
      }
      return {
        id: t.id,
        type: t.type,
        model: t.model,
        provider: t.provider,
        status: t.status,
        progress: t.progress,
        prompt: t.prompt,
        resultUrls,
        // مهام فاشلة فقط — رسائلها لا تتضمن أبدًا تفاصيل مفاتيح/رصيد
        errorMessage: t.status === "failed" ? t.error_message : null,
        attemptsCount: attemptsOf(t).length,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        completedAt: t.completed_at,
      };
    }),
  });
}
