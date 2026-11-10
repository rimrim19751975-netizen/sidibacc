// تعطيل/تنشيط يدوي وحذف مفتاح — المعرف من المسار
import { NextResponse } from "next/server";
import { deleteKey, setKeyStatus } from "@/lib/keys";
import { ensureSchema } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await ensureSchema();
  const { id } = await ctx.params;
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "جسم الطلب يجب أن يكون JSON صالحًا." }, { status: 400 });
  }
  const status = String(body.status ?? "");
  if (status !== "active" && status !== "disabled" && status !== "exhausted") {
    return NextResponse.json({ error: "الحالة المقبولة: active أو disabled." }, { status: 400 });
  }
  const ok = await setKeyStatus(id, status);
  if (!ok) return NextResponse.json({ error: "المفتاح غير موجود." }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await ensureSchema();
  const { id } = await ctx.params;
  const ok = await deleteKey(id);
  if (!ok) return NextResponse.json({ error: "المفتاح غير موجود." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
