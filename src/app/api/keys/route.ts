// إدارة المفاتيح — القائمة والعرض مُقنَّعان دائمًا (لا مفتاح كامل في أي استجابة)
import { NextResponse } from "next/server";
import { addKey, listKeys, maskKey } from "@/lib/keys";
import { ensureSchema } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await ensureSchema();
  const keys = await listKeys();
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      api_key: maskKey(k.api_key), // إخفاء إلزامي
      status: k.status,
      usage_count: k.usage_count,
      success_count: k.success_count,
      fail_count: k.fail_count,
      last_used_at: k.last_used_at,
      last_checked_at: k.last_checked_at,
      last_error: k.last_error,
      created_at: k.created_at,
    })),
  });
}

export async function POST(request: Request): Promise<Response> {
  await ensureSchema();
  let body: { provider?: string; api_key?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "جسم الطلب يجب أن يكون JSON صالحًا." }, { status: 400 });
  }
  const res = await addKey(String(body.provider ?? ""), String(body.api_key ?? ""), String(body.label ?? ""));
  if (!res.ok) {
    const messages: Record<string, { msg: string; status: number }> = {
      "invalid-provider": { msg: "المزود غير صالح — القيم المقبولة: kie أو cometapi.", status: 400 },
      "empty-key": { msg: "مفتاح API مطلوب.", status: 400 },
      duplicate: { msg: "هذا المفتاح مُضاف مسبقًا لنفس المزود.", status: 409 },
    };
    const e = messages[res.error];
    return NextResponse.json({ error: e.msg }, { status: e.status });
  }
  const k = res.key;
  return NextResponse.json(
    {
      key: {
        id: k.id,
        provider: k.provider,
        label: k.label,
        api_key: maskKey(k.api_key),
        status: k.status,
        usage_count: k.usage_count,
        success_count: k.success_count,
        fail_count: k.fail_count,
        last_used_at: k.last_used_at,
        last_checked_at: k.last_checked_at,
        last_error: k.last_error,
        created_at: k.created_at,
      },
    },
    { status: 201 },
  );
}
