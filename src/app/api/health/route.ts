// فحص الجهوزية العامة — الشكل الموثق في المواصفة §9 + تشخيص ذاتي
// (أسماء المتغيرات الناقصة فقط — لا قيم أبدًا؛ القيم السرية لا تخرج من البيئة)
import { NextResponse } from "next/server";
import { after } from "next/server";
import { dbStatus } from "@/lib/turso";
import { MODELS } from "@/lib/models";
import { mergerBase, mergerConfigured, mergerHealthy } from "@/lib/merger";
import { pumpQueue } from "@/lib/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = await dbStatus();
  const ok = db === "connected";
  // مضخة الطابور: كل نبضة جهوزية (مراقبة وقت التشغيل مثلًا) تستأنف مهمتين عالقتين في الخلفية
  if (ok) {
    try {
      after(async () => {
        await pumpQueue(2).catch(() => {});
      });
    } catch {}
  }
  // فحص خدمة الدمج بمهلة 4 ثوانٍ (GET /api/config) — يظهر غير مضبوطة إن لم يُضبط العنوان
  const mergerOk = mergerConfigured() ? await mergerHealthy() : false;
  // أسماء المتغيرات المطلوبة والناقصة في بيئة التشغيل (أسماء فقط — الأسرار لا تُعاد أبدًا)
  const missingEnv: string[] = [];
  if (!process.env.TURSO_DATABASE_URL?.trim()) missingEnv.push("TURSO_DATABASE_URL");
  if (!process.env.TURSO_AUTH_TOKEN?.trim()) missingEnv.push("TURSO_AUTH_TOKEN");
  return NextResponse.json({
    ok,
    // turso-connected | env-missing (المتغيرات غير مضبوطة على المنصة) | error (مضبوطة لكن الاتصال فشل)
    database: db === "connected" ? "turso-connected" : db,
    missingEnv,
    platform: process.env.VERCEL === "1" ? "vercel" : "unknown",
    mcpEndpoint: "/mcp",
    models: MODELS.map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers })),
    merger: {
      base: mergerConfigured() ? mergerBase() : null,
      configured: mergerConfigured(),
      healthy: mergerOk,
    },
    authRequired: !!process.env.MCP_ACCESS_TOKEN?.trim(),
  });
}
