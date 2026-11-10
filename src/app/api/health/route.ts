// فحص الجهوزية العامة — الشكل الموثق في المواصفة §9
import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/turso";
import { MODELS } from "@/lib/models";
import { mergerBase, mergerConfigured, mergerHealthy } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const ok = await dbHealthy();
  // فحص خدمة الدمج بمهلة 4 ثوانٍ (GET /api/config) — يظهر غير مضبوطة إن لم يُضبط العنوان
  const mergerOk = mergerConfigured() ? await mergerHealthy() : false;
  return NextResponse.json({
    ok,
    database: ok ? "turso-connected" : "unavailable",
    mcpEndpoint: "/mcp",
    models: MODELS.map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers })),
    merger: { base: mergerConfigured() ? mergerBase() : null, healthy: mergerOk },
    authRequired: !!process.env.MCP_ACCESS_TOKEN?.trim(),
  });
}
